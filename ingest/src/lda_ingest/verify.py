"""Completeness verification: fail loudly, never silently proceed.

The API offers no deterministic total ordering (tie-break ordering fields are silently
ignored), and legacy bulk imports share dt_posted timestamps, so a single pass can lose a
few records at page seams inside tie blocks. Completeness is therefore judged on the
UNION of a partition's main round and its repair rounds ('filings#repair1', ...), which
alternate ordering direction. A partition passes iff:

- every round's committed page sequence is gap-free, and
- distinct record keys across all rounds >= the latest reported count,
  (strictly greater is tolerated with a warning: records deleted upstream mid-pull
  remain in our archive, which is correct for an append-only store).

`ensure_complete` orchestrates: verify -> if short, pull a repair round -> re-verify,
up to MAX_REPAIR_ROUNDS before failing loudly.
"""

from __future__ import annotations

import logging

from .archive import iter_pages
from .config import Config
from .manifest import Manifest, utcnow

log = logging.getLogger("lda_ingest")

RECORD_KEY = {"filings": "filing_uuid", "contributions": "filing_uuid",
              "registrants": "id", "clients": "id", "lobbyists": "id"}

MAX_REPAIR_ROUNDS = 3


def _round_keys(manifest: Manifest, endpoint: str, year: int, period: str) -> list[str]:
    rows = manifest.db.execute(
        "SELECT DISTINCT endpoint FROM partitions WHERE (endpoint = ? OR endpoint LIKE ?) "
        "AND filing_year = ? AND filing_period = ? ORDER BY endpoint",
        (endpoint, f"{endpoint}#repair%", year, period),
    ).fetchall()
    return [r[0] for r in rows]


def union_distinct_keys(cfg: Config, manifest: Manifest,
                        endpoint: str, year: int, period: str) -> tuple[set, int]:
    key_field = RECORD_KEY[endpoint.split("#", 1)[0]]
    keys: set = set()
    rows = 0
    for round_key in _round_keys(manifest, endpoint, year, period):
        for part_file in manifest.part_files(round_key, year, period):
            for envelope in iter_pages(cfg.data_dir / part_file):
                for record in envelope["body"]["results"]:
                    keys.add(record[key_field])
                    rows += 1
    return keys, rows


def verify_partition(cfg: Config, manifest: Manifest,
                     endpoint: str, year: int, period: str) -> bool:
    """Union-verify a partition against the most recent round's count_final."""
    rounds = _round_keys(manifest, endpoint, year, period)
    latest_count = None
    problems: list[str] = []

    for round_key in rounds:
        part = manifest.partition(round_key, year, period)
        if part["status"] not in ("fetched", "verified", "failed"):
            problems.append(f"round {round_key} not fetched (status {part['status']})")
            continue
        n_pages, max_page, _ = manifest.committed_page_stats(round_key, year, period)
        if n_pages != max_page:
            problems.append(f"round {round_key} has page gaps ({n_pages} committed, max {max_page})")
        if part["count_final"] is not None:
            latest_count = part["count_final"]  # rounds are ordered; last wins

    keys, rows = union_distinct_keys(cfg, manifest, endpoint, year, period)
    if latest_count is None:
        problems.append("no round recorded a count_final")
    elif len(keys) < latest_count:
        problems.append(f"distinct keys {len(keys)} < reported count {latest_count}")
    elif len(keys) > latest_count:
        log.warning("%s %s/%s: %d distinct keys exceed reported count %d "
                    "(records deleted upstream mid-pull; retained in archive)",
                    endpoint, year, period, len(keys), latest_count)

    if problems:
        reason = "; ".join(problems)
        manifest.update_partition(endpoint, year, period, status="failed", failure_reason=reason)
        log.error("VERIFY FAILED %s %s/%s: %s", endpoint, year, period, reason)
        return False

    manifest.update_partition(endpoint, year, period, status="verified",
                              verified_at=utcnow(), failure_reason=None)
    log.info("verified %s %s/%s: %d distinct records across %d round(s) "
             "(%d raw rows incl. overlap)",
             endpoint, year, period, len(keys), len(rounds), rows)
    return True


def ensure_complete(cfg: Config, client, manifest: Manifest,
                    endpoint: str, year: int, period: str) -> bool:
    """Pull (resume) the partition, then verify; on shortfall pull repair rounds."""
    from .runner import pull_partition  # local import to avoid a cycle

    pull_partition(cfg, client, manifest, endpoint, year, period)
    if verify_partition(cfg, manifest, endpoint, year, period):
        return True

    for round_no in range(1, MAX_REPAIR_ROUNDS + 1):
        repair_key = f"{endpoint}#repair{round_no}"
        log.warning("%s %s/%s short after round %d — pulling repair round %s",
                    endpoint, year, period, round_no - 1, repair_key)
        pull_partition(cfg, client, manifest, repair_key, year, period)
        if verify_partition(cfg, manifest, endpoint, year, period):
            return True

    log.error("%s %s/%s STILL INCOMPLETE after %d repair rounds — failing loudly",
              endpoint, year, period, MAX_REPAIR_ROUNDS)
    return False
