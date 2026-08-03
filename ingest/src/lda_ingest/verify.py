"""Completeness verification: fail loudly, never silently proceed.

A partition passes iff:
- its committed page sequence is gap-free (COUNT(*) == MAX(page)), and
- the number of DISTINCT record keys across its part files equals count_final.

Duplicate records across pages are tolerated (count-drift refetches cause them; the normalizer
dedupes by key keeping the latest retrieval). A *missing* key is fatal.
"""

from __future__ import annotations

import logging

from .archive import iter_pages
from .config import Config
from .manifest import Manifest, utcnow

log = logging.getLogger("lda_ingest")

RECORD_KEY = {"filings": "filing_uuid", "contributions": "filing_uuid",
              "registrants": "id", "clients": "id", "lobbyists": "id"}


def verify_partition(cfg: Config, manifest: Manifest,
                     endpoint: str, year: int, period: str) -> bool:
    part = manifest.partition(endpoint, year, period)
    if part is None or part["status"] not in ("fetched", "verified", "failed"):
        log.error("%s %s/%s: not in a verifiable state (%s)",
                  endpoint, year, period, part["status"] if part else "absent")
        return False

    n_pages, max_page, _ = manifest.committed_page_stats(endpoint, year, period)
    count_final = part["count_final"] or 0

    problems: list[str] = []
    if n_pages != max_page:
        problems.append(f"page sequence has gaps: {n_pages} committed, max page {max_page}")

    key_field = RECORD_KEY[endpoint]
    keys: set = set()
    duplicates = 0
    for part_file in manifest.part_files(endpoint, year, period):
        for envelope in iter_pages(cfg.data_dir / part_file):
            for record in envelope["body"]["results"]:
                k = record[key_field]
                if k in keys:
                    duplicates += 1
                else:
                    keys.add(k)

    if len(keys) != count_final:
        problems.append(f"distinct {key_field}s {len(keys)} != reported count {count_final}")

    if problems:
        reason = "; ".join(problems)
        manifest.update_partition(endpoint, year, period, status="failed", failure_reason=reason)
        log.error("VERIFY FAILED %s %s/%s: %s", endpoint, year, period, reason)
        return False

    manifest.update_partition(endpoint, year, period, status="verified",
                              verified_at=utcnow(), failure_reason=None)
    log.info("verified %s %s/%s: %d distinct records (%d duplicate rows tolerated), %d pages",
             endpoint, year, period, len(keys), duplicates, n_pages)
    return True
