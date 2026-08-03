"""Offline tests of the ingest's crash-safety and completeness machinery.

A stub client serves a synthetic 130-record partition (6 pages at page_size 25). We prove:
- pages commit in part-file units and survive a mid-pull crash without duplicating/skipping,
- count drift (records appended at the tail mid-pull) is absorbed,
- verification passes on complete partitions and fails loudly on gaps/missing records.
"""

from __future__ import annotations

import gzip
import json
from math import ceil
from pathlib import Path

import pytest

from lda_ingest.archive import PartWriter, clean_tmp_files, iter_pages, next_part_index
from lda_ingest.config import Config
from lda_ingest.manifest import Manifest
from lda_ingest.runner import pull_partition
from lda_ingest.verify import verify_partition

PAGE_SIZE = 25


class StubClient:
    """Mimics LdaClient.get_json for filings/?filing_year=&filing_period=&page=."""

    def __init__(self, n_records: int, crash_after_page: int | None = None,
                 grow_to: int | None = None, grow_at_page: int | None = None):
        self.records = [{"filing_uuid": f"uuid-{i:05d}", "dt_posted": f"2013-04-{i % 28 + 1:02d}"}
                        for i in range(n_records)]
        self.crash_after_page = crash_after_page
        self.grow_to = grow_to
        self.grow_at_page = grow_at_page
        self.pages_served = 0

    def get_json(self, path: str, params: dict) -> tuple[dict, str]:
        page = int(params["page"])
        if self.grow_to and self.grow_at_page and page >= self.grow_at_page:
            while len(self.records) < self.grow_to:
                i = len(self.records)
                self.records.append({"filing_uuid": f"uuid-{i:05d}", "dt_posted": "2026-01-01"})
        start, end = (page - 1) * PAGE_SIZE, page * PAGE_SIZE
        count = len(self.records)
        body = {
            "count": count,
            "next": None if end >= count else f"stub://next?page={page + 1}",
            "previous": None,
            "results": self.records[start:end],
        }
        self.pages_served += 1
        if self.crash_after_page is not None and self.pages_served > self.crash_after_page:
            raise KeyboardInterrupt("simulated kill")
        return body, f"stub://{path}?page={page}"


@pytest.fixture
def cfg(tmp_path: Path) -> Config:
    c = Config(api_key=None, data_dir=tmp_path / "data")
    c.pages_per_part = 2  # small parts so crashes land mid-partition
    return c


def _distinct_uuids(cfg: Config, manifest: Manifest) -> list[str]:
    seen = []
    for part_file in manifest.part_files("filings", 2013, "second_quarter"):
        for env in iter_pages(cfg.data_dir / part_file):
            seen.extend(r["filing_uuid"] for r in env["body"]["results"])
    return seen


def test_clean_pull_verifies(cfg):
    manifest = Manifest(cfg.manifest_path)
    pull_partition(cfg, StubClient(130), manifest, "filings", 2013, "second_quarter")
    assert verify_partition(cfg, manifest, "filings", 2013, "second_quarter")
    part = manifest.partition("filings", 2013, "second_quarter")
    assert part["status"] == "verified"
    assert part["count_final"] == 130
    assert part["pages_expected"] == ceil(130 / PAGE_SIZE)
    assert len(set(_distinct_uuids(cfg, manifest))) == 130


def test_kill_and_resume_no_dup_no_skip(cfg):
    manifest = Manifest(cfg.manifest_path)
    with pytest.raises(KeyboardInterrupt):
        pull_partition(cfg, StubClient(130, crash_after_page=3), manifest,
                       "filings", 2013, "second_quarter")

    # crash leaves an uncommitted tail: fewer than 3 pages committed, no tmp after cleanup
    committed_before = manifest.max_committed_page("filings", 2013, "second_quarter")
    assert committed_before <= 3
    clean_tmp_files(cfg.raw_dir)
    assert not list(cfg.raw_dir.rglob("*.tmp"))

    pull_partition(cfg, StubClient(130), manifest, "filings", 2013, "second_quarter")
    assert verify_partition(cfg, manifest, "filings", 2013, "second_quarter")
    uuids = _distinct_uuids(cfg, manifest)
    assert len(set(uuids)) == 130          # nothing skipped
    assert len(uuids) == 130               # nothing duplicated either (page-aligned resume)


def test_count_growth_mid_pull_absorbed(cfg):
    manifest = Manifest(cfg.manifest_path)
    stub = StubClient(130, grow_to=140, grow_at_page=4)
    pull_partition(cfg, stub, manifest, "filings", 2013, "second_quarter")
    assert verify_partition(cfg, manifest, "filings", 2013, "second_quarter")
    part = manifest.partition("filings", 2013, "second_quarter")
    assert part["count_first_seen"] == 130
    assert part["count_final"] == 140
    assert len(set(_distinct_uuids(cfg, manifest))) == 140


def test_verify_fails_loudly_on_gap(cfg):
    manifest = Manifest(cfg.manifest_path)
    pull_partition(cfg, StubClient(130), manifest, "filings", 2013, "second_quarter")
    manifest.db.execute("DELETE FROM pages WHERE page = 2")
    manifest.db.commit()
    assert not verify_partition(cfg, manifest, "filings", 2013, "second_quarter")
    part = manifest.partition("filings", 2013, "second_quarter")
    assert part["status"] == "failed"
    assert "gap" in part["failure_reason"] or "distinct" in part["failure_reason"]


def test_part_writer_commit_protocol(tmp_path):
    w = PartWriter(tmp_path, 0)
    w.write_page({"page": 1, "body": {"results": []}})
    assert w.tmp_path.exists() and not w.final_path.exists()
    w.commit()
    assert w.final_path.exists() and not w.tmp_path.exists()
    with gzip.open(w.final_path, "rt") as fh:
        assert json.loads(fh.readline())["page"] == 1
    assert next_part_index(tmp_path) == 1

    w2 = PartWriter(tmp_path, 1)
    w2.write_page({"page": 2})
    w2.abort()
    assert not w2.tmp_path.exists() and not w2.final_path.exists()
