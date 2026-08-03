"""Partition pull loop.

Per partition:
1. mark in_progress; resume at max committed page + 1 (crash leftovers were cleaned at startup).
2. fetch pages sequentially with `ordering` pinned so late-posted records sort to the tail and
   already-fetched pages never shift (dt_posted for filings/contributions, id for entities).
3. every K pages: finalize the part file (fsync + atomic rename), then commit the page rows to
   the manifest in one transaction. A page is committed iff its manifest row exists.
4. keep fetching while the API's `next` link is non-null; the count on the latest response
   tracks drift, and the final response's count is recorded as count_final.
5. hand off to verify (distinct-key check against count_final).
"""

from __future__ import annotations

import json
import logging
from math import ceil

from .archive import PartWriter, next_part_index, partition_dir
from .client import LdaClient, PageGone
from .config import PAGE_SIZE, Config
from .manifest import Manifest, utcnow

log = logging.getLogger("lda_ingest")

ORDERING = {"filings": "dt_posted", "contributions": "dt_posted",
            "registrants": "id", "clients": "id", "lobbyists": "id"}


def query_endpoint(endpoint_key: str) -> str:
    """'filings#repair1' -> 'filings' (repair rounds share the API endpoint)."""
    return endpoint_key.split("#", 1)[0]


def base_params(endpoint_key: str, year: int, period: str) -> dict:
    endpoint = query_endpoint(endpoint_key)
    params: dict = {"page_size": PAGE_SIZE}
    ordering = ORDERING.get(endpoint)
    if ordering:
        # Repair rounds alternate direction: reversed ordering moves both the page
        # boundaries and the tie traversal, recovering records that same-timestamp
        # tie blocks (legacy bulk imports) let slip through page seams.
        round_no = int(endpoint_key.split("#repair", 1)[1]) if "#repair" in endpoint_key else 0
        params["ordering"] = f"-{ordering}" if round_no % 2 == 1 else ordering
    if year:
        params["filing_year"] = year
        params["filing_period"] = period
    return params


def pull_partition(cfg: Config, client: LdaClient, manifest: Manifest,
                   endpoint: str, year: int, period: str) -> None:
    manifest.ensure_partition(endpoint, year, period)
    part = manifest.partition(endpoint, year, period)
    if part["status"] == "verified":
        log.info("skip %s %s/%s: already verified", endpoint, year, period)
        return

    manifest.update_partition(endpoint, year, period, status="in_progress",
                              started_at=part["started_at"] or utcnow())

    pdir = partition_dir(cfg.raw_dir, endpoint, year, period)
    page = manifest.max_committed_page(endpoint, year, period) + 1
    params = base_params(endpoint, year, period)

    writer: PartWriter | None = None
    buffered: list[tuple] = []
    latest_count: int | None = part["count_final"] or part["count_first_seen"]
    exhausted = False

    def flush() -> None:
        nonlocal writer, buffered
        if writer is None or writer.n_pages == 0:
            return
        part_file = writer.commit()
        rel = str(part_file.relative_to(cfg.data_dir))
        manifest.commit_pages([(*row, rel) for row in buffered])
        log.info("%s %s/%s: committed %d pages through page %d",
                 endpoint, year, period, len(buffered), buffered[-1][3])
        writer, buffered = None, []

    try:
        while not exhausted:
            try:
                body, url = client.get_json(f"{query_endpoint(endpoint)}/", {**params, "page": page})
            except PageGone:
                log.warning("%s %s/%s: page %d gone (result set shrank); stopping",
                            endpoint, year, period, page)
                break

            latest_count = int(body["count"])
            if part["count_first_seen"] is None and page <= 1:
                manifest.update_partition(endpoint, year, period, count_first_seen=latest_count)

            if writer is None:
                writer = PartWriter(pdir, next_part_index(pdir))
            writer.write_page({
                "request_url": url, "retrieved_at": utcnow(),
                "http_status": 200, "page": page, "body": body,
            })
            buffered.append((endpoint, year, period, page, url, 200, utcnow(),
                             len(body["results"])))

            exhausted = body.get("next") is None
            page += 1
            if writer.n_pages >= cfg.pages_per_part:
                flush()

        flush()
    except BaseException:
        if writer is not None:
            writer.abort()
        raise

    n_pages, max_page, _ = manifest.committed_page_stats(endpoint, year, period)
    manifest.update_partition(
        endpoint, year, period,
        status="fetched", fetched_at=utcnow(),
        count_final=latest_count, pages_expected=max_page,
    )
    expected_pages = max(1, ceil((latest_count or 0) / PAGE_SIZE))
    log.info("%s %s/%s: fetched — count=%s pages=%d (expected ~%d)",
             endpoint, year, period, latest_count, n_pages, expected_pages)


def pull_constants(cfg: Config, client: LdaClient, manifest: Manifest) -> None:
    """Constants are rate-limit exempt, unpaginated, and stored as single JSON files."""
    from .planner import CONSTANTS_ENDPOINTS

    out_dir = cfg.raw_dir / "constants"
    out_dir.mkdir(parents=True, exist_ok=True)
    for endpoint in CONSTANTS_ENDPOINTS:
        manifest.ensure_partition(endpoint, 0, "all")
        if manifest.partition(endpoint, 0, "all")["status"] == "verified":
            continue
        body, url = client.get_json(f"{endpoint}/")
        slug = endpoint.rsplit("/", 1)[-1]
        path = out_dir / f"{slug}.json"
        envelope = {"request_url": url, "retrieved_at": utcnow(), "http_status": 200, "body": body}
        path.write_text(json.dumps(envelope, indent=1, ensure_ascii=False))
        n = len(body) if isinstance(body, list) else len(body.get("results", []))
        manifest.commit_pages([(endpoint, 0, "all", 1, url, 200, utcnow(), n,
                                str(path.relative_to(cfg.data_dir)))])
        manifest.update_partition(endpoint, 0, "all", status="verified",
                                  started_at=utcnow(), fetched_at=utcnow(), verified_at=utcnow(),
                                  count_final=n, pages_expected=1)
        log.info("constants %s: %d values", slug, n)
