"""LD-203 contribution reports: per-partition idempotent load, same pattern as filings."""

from __future__ import annotations

import json
import logging
from decimal import Decimal

import psycopg

from ..db import iter_partition_records
from .amendments import resolve_partition
from .transform import _int_or_none

log = logging.getLogger("lda_pipeline")


def _dec(value) -> Decimal | None:
    return None if value in (None, "") else Decimal(str(value))


def load_contributions_partition(conn: psycopg.Connection, year: int, period: str) -> int:
    latest: dict[str, tuple] = {}
    for record, retrieved_at, request_url in iter_partition_records("contributions", year, period):
        prev = latest.get(record["filing_uuid"])
        if prev is None or retrieved_at >= prev[1]:
            latest[record["filing_uuid"]] = (record, retrieved_at, request_url)

    registrants: dict[int, tuple] = {}
    lobbyists: dict[int, tuple] = {}
    filings: list[tuple] = []
    items: list[tuple] = []
    retrieved_min = retrieved_max = None

    for record, retrieved_at, request_url in latest.values():
        reg, lob = record.get("registrant"), record.get("lobbyist")
        if reg:
            registrants[reg["id"]] = (
                reg["id"], reg.get("name"), _int_or_none(reg.get("house_registrant_id")), reg.get("city"),
                reg.get("state"), reg.get("country"), reg.get("ppb_country"),
                reg.get("contact_name"), reg.get("dt_updated"))
        if lob:
            display = " ".join(p for p in (lob.get("first_name"), lob.get("middle_name"),
                                           lob.get("last_name")) if p).strip().upper()
            lobbyists[lob["id"]] = (
                lob["id"], display, lob.get("prefix"), lob.get("first_name"),
                lob.get("middle_name"), lob.get("nickname"), lob.get("last_name"),
                lob.get("suffix"))

        extra = {k: record.get(k) for k in ("contact_name", "comments", "address_1", "address_2",
                                            "city", "state", "zip", "country", "pacs")}
        filings.append((
            record["filing_uuid"], record["filing_type"], record["filing_year"],
            record["filing_period"], reg["id"] if reg else None, lob["id"] if lob else None,
            record["filer_type"], bool(record.get("no_contributions")),
            record["dt_posted"], record.get("filing_document_url"),
            json.dumps(extra), retrieved_at, request_url))

        for item in record.get("contribution_items") or []:
            items.append((
                record["filing_uuid"], item.get("contribution_type"), _dec(item.get("amount")),
                item.get("date"), item.get("contributor_name"), item.get("payee_name"),
                item.get("honoree_name")))

        retrieved_min = retrieved_at if retrieved_min is None else min(retrieved_min, retrieved_at)
        retrieved_max = retrieved_at if retrieved_max is None else max(retrieved_max, retrieved_at)

    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO registrants VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO NOTHING", list(registrants.values()))
        cur.executemany(
            "INSERT INTO lobbyists VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO NOTHING", list(lobbyists.values()))

        cur.execute("DELETE FROM contribution_filings WHERE filing_year=%s AND filing_period=%s",
                    (year, period))
        with cur.copy(
            "COPY contribution_filings (filing_uuid, filing_type, filing_year, filing_period, "
            "registrant_id, lobbyist_id, filer_type, no_contributions, dt_posted, "
            "filing_document_url, raw_extra, retrieved_at, source_request_url) FROM STDIN"
        ) as copy:
            for row in filings:
                copy.write_row(row)
        with cur.copy(
            "COPY contribution_items (filing_uuid, item_type, amount, contribution_date, "
            "contributor_name, payee_name, honoree_name) FROM STDIN"
        ) as copy:
            for row in items:
                copy.write_row(row)

        resolve_partition(conn, year, period, table="contributions")

        cur.execute(
            "INSERT INTO load_state (endpoint, filing_year, filing_period, records_loaded, "
            "retrieved_min, retrieved_max) VALUES ('contributions',%s,%s,%s,%s,%s) "
            "ON CONFLICT (endpoint, filing_year, filing_period) DO UPDATE SET "
            "records_loaded=EXCLUDED.records_loaded, retrieved_min=EXCLUDED.retrieved_min, "
            "retrieved_max=EXCLUDED.retrieved_max, loaded_at=now()",
            (year, period, len(filings), retrieved_min, retrieved_max))

    conn.commit()
    log.info("loaded contributions %s/%s: %d reports, %d items", year, period, len(filings), len(items))
    return len(filings)
