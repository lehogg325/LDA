"""Idempotent per-partition load: dedupe -> upsert entities -> delete+COPY -> resolve.

One transaction per partition. Re-running a partition is always safe: its filings are
deleted (children cascade), its name observations replaced, and amendment lanes re-resolved.
"""

from __future__ import annotations

import logging

import psycopg

from ..db import iter_partition_records
from .amendments import resolve_partition
from .transform import PERIOD_ORD, Bundle, add_filing

log = logging.getLogger("lda_pipeline")

FILING_COLS = (
    "filing_uuid, filing_type, document_kind, is_termination, is_amendment, is_no_activity, "
    "filing_year, filing_period, period_ord, registrant_id, client_id, "
    "income, expenses, expenses_method, amount, amount_type, is_reported_zero, "
    "dt_posted, termination_date, attribution_level, posted_by_name, filing_document_url, "
    "registrant_address, foreign_entities, affiliated_organizations, conviction_disclosures, "
    "retrieved_at, source_request_url"
)


def load_filings_partition(conn: psycopg.Connection, year: int, period: str,
                           type_map: dict) -> int:
    # Dedupe by uuid, keeping the latest retrieval (count-drift refetches create dupes).
    latest: dict[str, tuple] = {}
    for record, retrieved_at, request_url in iter_partition_records("filings", year, period):
        prev = latest.get(record["filing_uuid"])
        if prev is None or retrieved_at >= prev[1]:
            latest[record["filing_uuid"]] = (record, retrieved_at, request_url)

    bundle = Bundle()
    retrieved_min = retrieved_max = None
    for record, retrieved_at, request_url in latest.values():
        add_filing(bundle, record, retrieved_at, request_url, type_map)
        retrieved_min = retrieved_at if retrieved_min is None else min(retrieved_min, retrieved_at)
        retrieved_max = retrieved_at if retrieved_max is None else max(retrieved_max, retrieved_at)

    period_ord = year * 10 + PERIOD_ORD[period]

    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO registrants VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, "
            "city=EXCLUDED.city, state=EXCLUDED.state, country=EXCLUDED.country, "
            "ppb_country=EXCLUDED.ppb_country, contact_name=EXCLUDED.contact_name, "
            "dt_updated=EXCLUDED.dt_updated "
            "WHERE registrants.dt_updated IS NULL OR EXCLUDED.dt_updated >= registrants.dt_updated",
            list(bundle.registrants.values()))
        cur.executemany(
            "INSERT INTO clients VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, "
            "state=EXCLUDED.state, country=EXCLUDED.country, ppb_state=EXCLUDED.ppb_state, "
            "ppb_country=EXCLUDED.ppb_country",
            list(bundle.clients.values()))
        cur.executemany(
            "INSERT INTO lobbyists VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, "
            "prefix=EXCLUDED.prefix, first_name=EXCLUDED.first_name, "
            "middle_name=EXCLUDED.middle_name, nickname=EXCLUDED.nickname, "
            "last_name=EXCLUDED.last_name, suffix=EXCLUDED.suffix",
            list(bundle.lobbyists.values()))
        cur.executemany(
            "INSERT INTO gov_entities VALUES (%s,%s) ON CONFLICT (id) DO NOTHING",
            [(i, n) for i, n in bundle.gov_entities.items()])
        cur.executemany(
            "INSERT INTO ref_issue_codes VALUES (%s,%s) ON CONFLICT (code) DO NOTHING",
            [(c, d) for c, d in bundle.issue_codes.items()])

        cur.execute("DELETE FROM filings WHERE filing_year=%s AND filing_period=%s",
                    (year, period))
        cur.execute("DELETE FROM entity_name_observations WHERE period_ord=%s", (period_ord,))

        with cur.copy(f"COPY filings ({FILING_COLS}) FROM STDIN") as copy:
            for row in bundle.filings:
                copy.write_row(row)
        with cur.copy("COPY filing_activities (filing_uuid, activity_index, "
                      "general_issue_code, description, foreign_entity_issues) FROM STDIN") as copy:
            for row in bundle.activities:
                copy.write_row(row)
        with cur.copy("COPY activity_lobbyists (filing_uuid, activity_index, lobbyist_id, "
                      "covered_position, is_new) FROM STDIN") as copy:
            for row in bundle.activity_lobbyists:
                copy.write_row(row)
        with cur.copy("COPY activity_government_entities (filing_uuid, activity_index, "
                      "gov_entity_id) FROM STDIN") as copy:
            for row in bundle.activity_entities:
                copy.write_row(row)
        with cur.copy("COPY filing_lobbyists (filing_uuid, lobbyist_id) FROM STDIN") as copy:
            for row in bundle.filing_lobbyists:
                copy.write_row(row)
        with cur.copy("COPY entity_name_observations (node_type, node_id, name, period_ord, "
                      "n_filings) FROM STDIN") as copy:
            for (ntype, nid, name), n in bundle.name_obs.items():
                copy.write_row((ntype, nid, name, period_ord, n))

        resolve_partition(conn, year, period)

        cur.execute(
            "INSERT INTO load_state (endpoint, filing_year, filing_period, records_loaded, "
            "retrieved_min, retrieved_max) VALUES ('filings',%s,%s,%s,%s,%s) "
            "ON CONFLICT (endpoint, filing_year, filing_period) DO UPDATE SET "
            "records_loaded=EXCLUDED.records_loaded, retrieved_min=EXCLUDED.retrieved_min, "
            "retrieved_max=EXCLUDED.retrieved_max, loaded_at=now()",
            (year, period, len(bundle.filings), retrieved_min, retrieved_max))

    conn.commit()
    log.info("loaded filings %s/%s: %d filings, %d activities, %d activity-lobbyist rows",
             year, period, len(bundle.filings), len(bundle.activities),
             len(bundle.activity_lobbyists))
    return len(bundle.filings)
