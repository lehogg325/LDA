"""lda-ingest: plan | run | verify | status."""

from __future__ import annotations

import argparse
import logging
import sys

from .archive import clean_tmp_files
from .client import LdaClient
from .config import load_config
from .manifest import Manifest
from .planner import plan_partitions
from .runner import pull_constants, pull_partition
from .verify import verify_partition


def _setup_logging(cfg) -> None:
    cfg.log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(cfg.log_dir / "ingest.log"),
        ],
    )


def _selected(args) -> list[tuple[str, int, str]]:
    parts = plan_partitions()
    if args.all:
        return parts
    sel = [p for p in parts
           if (args.endpoint is None or p[0] == args.endpoint)
           and (args.year is None or p[1] == args.year)
           and (args.period is None or p[2] == args.period)]
    if not sel:
        sys.exit("no partitions match the given filters")
    return sel


def main() -> None:
    ap = argparse.ArgumentParser(prog="lda-ingest")
    sub = ap.add_subparsers(dest="cmd", required=True)

    for name in ("run", "verify"):
        p = sub.add_parser(name)
        p.add_argument("--all", action="store_true")
        p.add_argument("--endpoint")
        p.add_argument("--year", type=int)
        p.add_argument("--period")
    sub.add_parser("plan")
    sub.add_parser("status")

    args = ap.parse_args()
    cfg = load_config()
    _setup_logging(cfg)
    manifest = Manifest(cfg.manifest_path)
    log = logging.getLogger("lda_ingest")

    if args.cmd == "plan":
        for endpoint, year, period in plan_partitions():
            manifest.ensure_partition(endpoint, year, period)
        print(f"planned {len(plan_partitions())} partitions (+8 constants)")
        return

    if args.cmd == "status":
        rows = manifest.partitions()
        by_status: dict[str, int] = {}
        records = 0
        for r in rows:
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1
            if r["status"] in ("fetched", "verified") and r["count_final"]:
                records += r["count_final"]
        print(f"partitions: {dict(sorted(by_status.items()))}")
        print(f"records in fetched+verified partitions: {records:,}")
        for r in rows:
            if r["status"] in ("in_progress", "failed"):
                print(f"  {r['status']:<11} {r['endpoint']} {r['filing_year']}/{r['filing_period']}"
                      f"  {r['failure_reason'] or ''}")
        return

    if args.cmd == "run":
        n_tmp = clean_tmp_files(cfg.raw_dir)
        if n_tmp:
            log.info("cleaned %d orphaned .tmp part files", n_tmp)
        client = LdaClient(cfg, retry_logger=manifest.log_retry)
        log.info("mode: %s (%.0f req/min)", "authenticated" if client.authenticated else "ANONYMOUS",
                 cfg.rate_per_sec * 60)
        try:
            pull_constants(cfg, client, manifest)
            failures = []
            for endpoint, year, period in _selected(args):
                pull_partition(cfg, client, manifest, endpoint, year, period)
                if not verify_partition(cfg, manifest, endpoint, year, period):
                    failures.append((endpoint, year, period))
            if failures:
                sys.exit(f"FAILED partitions: {failures}")
        finally:
            client.close()
        return

    if args.cmd == "verify":
        ok = True
        for endpoint, year, period in _selected(args):
            part = manifest.partition(endpoint, year, period)
            if part is None or part["status"] == "pending":
                continue
            if not verify_partition(cfg, manifest, endpoint, year, period):
                ok = False
        if not ok:
            sys.exit(1)
        print("all selected partitions verified")
