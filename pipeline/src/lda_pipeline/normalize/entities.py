"""Loads the standalone registrants/clients/lobbyists listing pulls.

These carry fields the filing-embedded objects lack (registrant descriptions, full
addresses). They upsert over the filing-derived rows — richer data wins — but never
create name observations (those come only from filings, which carry the quarter)."""

from __future__ import annotations

import logging

import psycopg

from ..db import iter_partition_records
from .transform import _int_or_none

log = logging.getLogger("lda_pipeline")


def load_entity_listing(conn: psycopg.Connection, endpoint: str) -> int:
    latest: dict[int, tuple] = {}
    for record, retrieved_at, request_url in iter_partition_records(endpoint, 0, "all"):
        prev = latest.get(record["id"])
        if prev is None or retrieved_at >= prev[1]:
            latest[record["id"]] = (record, retrieved_at, request_url)

    n = 0
    with conn.cursor() as cur:
        for record, _, _ in latest.values():
            if endpoint == "registrants":
                cur.execute(
                    "INSERT INTO registrants VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, "
                    "house_registrant_id=EXCLUDED.house_registrant_id, city=EXCLUDED.city, "
                    "state=EXCLUDED.state, country=EXCLUDED.country, "
                    "ppb_country=EXCLUDED.ppb_country, contact_name=EXCLUDED.contact_name, "
                    "dt_updated=EXCLUDED.dt_updated",
                    (record["id"], record.get("name"), _int_or_none(record.get("house_registrant_id")),
                     record.get("city"), record.get("state"), record.get("country"),
                     record.get("ppb_country"), record.get("contact_name"),
                     record.get("dt_updated")))
            elif endpoint == "clients":
                cur.execute(
                    "INSERT INTO clients VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, "
                    "is_government_entity=EXCLUDED.is_government_entity, "
                    "state=EXCLUDED.state, country=EXCLUDED.country, "
                    "ppb_state=EXCLUDED.ppb_state, ppb_country=EXCLUDED.ppb_country, "
                    "effective_date=EXCLUDED.effective_date",
                    (record["id"], record.get("name"), record.get("client_id"),
                     record.get("client_government_entity"), record.get("state"),
                     record.get("country"), record.get("ppb_state"),
                     record.get("ppb_country"), record.get("effective_date")))
            else:  # lobbyists
                # The listing schema (LobbyistWithRegistrant) may nest the person under
                # a 'lobbyist' key; flatten if so. Verified against real data at load time.
                if "lobbyist" in record and isinstance(record["lobbyist"], dict):
                    record = {**record["lobbyist"], "id": record["lobbyist"]["id"]}
                display = " ".join(p for p in (record.get("first_name"),
                                               record.get("middle_name"),
                                               record.get("last_name")) if p).strip().upper()
                cur.execute(
                    "INSERT INTO lobbyists VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, "
                    "prefix=EXCLUDED.prefix, first_name=EXCLUDED.first_name, "
                    "middle_name=EXCLUDED.middle_name, nickname=EXCLUDED.nickname, "
                    "last_name=EXCLUDED.last_name, suffix=EXCLUDED.suffix",
                    (record["id"], display, record.get("prefix"), record.get("first_name"),
                     record.get("middle_name"), record.get("nickname"),
                     record.get("last_name"), record.get("suffix")))
            n += 1

        cur.execute(
            "INSERT INTO load_state (endpoint, filing_year, filing_period, records_loaded) "
            "VALUES (%s, 0, 'all', %s) "
            "ON CONFLICT (endpoint, filing_year, filing_period) DO UPDATE SET "
            "records_loaded=EXCLUDED.records_loaded, loaded_at=now()",
            (endpoint, n))
    conn.commit()
    log.info("loaded %s listing: %d entities", endpoint, n)
    return n
