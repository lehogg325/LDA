"""lda-metrics: compute per-quarter node metrics for quarters with built edges."""

from __future__ import annotations

import argparse
import logging

from ..db import connect
from .compute import compute_quarter


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(prog="lda-metrics")
    ap.add_argument("--year", type=int)
    ap.add_argument("--period")
    ap.add_argument("--from-year", type=int)
    ap.add_argument("--to-year", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--cutoff", action="store_true",
                    help="use distance-bounded betweenness instead of exact (fallback)")
    ap.add_argument("--database-url", default=None)
    args = ap.parse_args()

    with connect(args.database_url) as conn:
        if args.year and args.period:
            quarters = [(args.year, args.period)]
        else:
            rows = conn.execute(
                "SELECT DISTINCT filing_year, filing_period, period_ord FROM edges "
                "ORDER BY period_ord").fetchall()
            quarters = [(y, p) for y, p, _ in rows
                        if (args.from_year is None or y >= args.from_year)
                        and (args.to_year is None or y <= args.to_year)]
        for year, period in quarters:
            compute_quarter(conn, year, period, benchmark_exact=not args.cutoff)
        n = conn.execute("SELECT count(*) FROM node_metrics").fetchone()[0]
        print(f"metrics computed for {len(quarters)} quarter(s); node_metrics now {n:,} rows")
