"""lda-edges: build the derived edge table for loaded quarters."""

from __future__ import annotations

import argparse
import logging

from ..db import connect
from .build import build_quarter


def _loaded_quarters(conn, from_year=None, to_year=None):
    rows = conn.execute(
        "SELECT DISTINCT filing_year, filing_period, period_ord FROM filings "
        "ORDER BY period_ord").fetchall()
    return [(y, p) for y, p, _ in rows
            if (from_year is None or y >= from_year) and (to_year is None or y <= to_year)]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(prog="lda-edges")
    ap.add_argument("--year", type=int)
    ap.add_argument("--period")
    ap.add_argument("--from-year", type=int)
    ap.add_argument("--to-year", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--database-url", default=None)
    args = ap.parse_args()

    with connect(args.database_url) as conn:
        if args.year and args.period:
            quarters = [(args.year, args.period)]
        else:
            quarters = _loaded_quarters(conn, args.from_year, args.to_year)
        totals: dict[str, int] = {}
        for year, period in quarters:
            for k, v in build_quarter(conn, year, period).items():
                totals[k] = totals.get(k, 0) + v
        n = conn.execute("SELECT count(*) FROM edges").fetchone()[0]
        print(f"built {len(quarters)} quarter(s): {totals}; edges table now {n:,} rows")
