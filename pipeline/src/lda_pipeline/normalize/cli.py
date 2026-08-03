"""lda-normalize: load verified raw partitions into Postgres.

Only partitions the ingest marked 'verified' are eligible. A partition is (re)loaded when
it has no load_state row or the manifest verified it after the last load. Re-loading is
always safe (delete + reinsert inside one transaction).
"""

from __future__ import annotations

import argparse
import logging
import sys

from ..db import connect, verified_partitions
from .contributions import load_contributions_partition
from .loader import load_filings_partition
from .refdata import filing_type_map, load_reference_tables

log = logging.getLogger("lda_pipeline")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(prog="lda-normalize")
    ap.add_argument("--all-verified", action="store_true",
                    help="load every verified filings partition not yet loaded")
    ap.add_argument("--entities", action="store_true",
                    help="also load registrants/clients/lobbyists listing pulls")
    ap.add_argument("--year", type=int)
    ap.add_argument("--period")
    ap.add_argument("--force", action="store_true", help="reload even if already loaded")
    ap.add_argument("--database-url", default=None)
    args = ap.parse_args()

    with connect(args.database_url) as conn:
        load_reference_tables(conn)
        type_map = filing_type_map(conn)

        loaded_state = {
            (r[0], r[1], r[2]): r[3] for r in conn.execute(
                "SELECT endpoint, filing_year, filing_period, loaded_at FROM load_state"
            ).fetchall()
        }

        candidates = []
        for endpoint in ("filings", "contributions"):
            for p in verified_partitions(endpoint):
                if args.year and p["filing_year"] != args.year:
                    continue
                if args.period and p["filing_period"] != args.period:
                    continue
                key = (endpoint, p["filing_year"], p["filing_period"])
                already = (key in loaded_state
                           and str(loaded_state[key]) >= str(p["verified_at"] or ""))
                if args.force or not already:
                    candidates.append((endpoint, p))

        if not candidates and not args.entities:
            print("nothing to load (all verified partitions already normalized)")
            return

        total = 0
        for endpoint, p in candidates:
            if endpoint == "filings":
                total += load_filings_partition(conn, p["filing_year"], p["filing_period"], type_map)
            else:
                total += load_contributions_partition(conn, p["filing_year"], p["filing_period"])

        if args.entities:
            from .entities import load_entity_listing
            for endpoint in ("registrants", "clients", "lobbyists"):
                if any(p["endpoint"] == endpoint for p in verified_partitions(endpoint)):
                    load_entity_listing(conn, endpoint)

        conn.execute("REFRESH MATERIALIZED VIEW entity_names")
        conn.commit()

        n = conn.execute("SELECT count(*) FROM filings").fetchone()[0]
        cur = conn.execute("SELECT count(*) FROM filings WHERE is_current").fetchone()[0]
        print(f"loaded {total} filings from {len(candidates)} partition(s); "
              f"table now holds {n} filings ({cur} current after amendment resolution)")
        sys.exit(0)
