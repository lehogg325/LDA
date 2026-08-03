"""Append-only raw archive writer.

Gzip streams cannot be safely appended to after a crash, so the commit unit is a *part file*:
pages accumulate in `part-NNNN.jsonl.gz.tmp`, which is fsynced and atomically renamed to its
final name before the pages are recorded in the manifest. Orphaned .tmp files (crash leftovers)
are deleted on startup; their pages were never committed and will be refetched.
"""

from __future__ import annotations

import gzip
import json
import os
import re
from pathlib import Path

PART_RE = re.compile(r"part-(\d{4})\.jsonl\.gz$")


def partition_dir(raw_dir: Path, endpoint: str, year: int, period: str) -> Path:
    if year == 0 and period == "all":
        return raw_dir / endpoint
    alias = {
        "first_quarter": "Q1", "second_quarter": "Q2", "third_quarter": "Q3",
        "fourth_quarter": "Q4", "mid_year": "MY", "year_end": "YE",
    }[period]
    return raw_dir / endpoint / f"year={year}" / f"period={alias}"


def clean_tmp_files(raw_dir: Path) -> int:
    n = 0
    if raw_dir.exists():
        for tmp in raw_dir.rglob("*.jsonl.gz.tmp"):
            tmp.unlink()
            n += 1
    return n


def next_part_index(part_dir: Path) -> int:
    if not part_dir.exists():
        return 0
    indices = [int(m.group(1)) for p in part_dir.iterdir() if (m := PART_RE.search(p.name))]
    return max(indices, default=-1) + 1


class PartWriter:
    """Accumulates page envelopes into one part file; commit() finalizes it atomically."""

    def __init__(self, part_dir: Path, index: int) -> None:
        part_dir.mkdir(parents=True, exist_ok=True)
        self.final_path = part_dir / f"part-{index:04d}.jsonl.gz"
        self.tmp_path = part_dir / f"part-{index:04d}.jsonl.gz.tmp"
        self._fh = gzip.open(self.tmp_path, "wt", encoding="utf-8", compresslevel=6)
        self.n_pages = 0

    def write_page(self, envelope: dict) -> None:
        self._fh.write(json.dumps(envelope, separators=(",", ":"), ensure_ascii=False))
        self._fh.write("\n")
        self.n_pages += 1

    def commit(self) -> Path:
        """fsync + atomic rename. After this returns, the bytes are durable."""
        self._fh.flush()
        os.fsync(self._fh.fileno())
        self._fh.close()
        os.rename(self.tmp_path, self.final_path)
        return self.final_path

    def abort(self) -> None:
        self._fh.close()
        self.tmp_path.unlink(missing_ok=True)


def iter_pages(part_file: Path):
    """Yield page envelopes from a committed part file."""
    with gzip.open(part_file, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)
