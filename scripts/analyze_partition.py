"""One-off analysis over a completed raw partition (step 2 deliverables):

1. ID scope: are client/lobbyist/registrant numeric IDs real-world-entity-scoped or
   registration-scoped? Measured as distinct IDs per exact name string and vice versa.
2. Ordering stability: is dt_posted non-decreasing across the full page sequence, and how
   many duplicate/missing uuids did the pull produce?

Usage: uv run python scripts/analyze_partition.py [year period_alias]  (default: 2013 Q2)
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "ingest" / "src"))
from lda_ingest.archive import iter_pages  # noqa: E402
from lda_ingest.config import load_config  # noqa: E402
from lda_ingest.manifest import Manifest  # noqa: E402

PERIOD_FROM_ALIAS = {"Q1": "first_quarter", "Q2": "second_quarter", "Q3": "third_quarter",
                     "Q4": "fourth_quarter", "MY": "mid_year", "YE": "year_end"}


def main() -> None:
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2013
    period = PERIOD_FROM_ALIAS[sys.argv[2] if len(sys.argv) > 2 else "Q2"]

    cfg = load_config()
    manifest = Manifest(cfg.manifest_path)

    ids_per_name: dict[str, dict[str, set]] = {k: defaultdict(set) for k in ("client", "registrant", "lobbyist")}
    names_per_id: dict[str, dict[int, set]] = {k: defaultdict(set) for k in ("client", "registrant", "lobbyist")}

    uuids: Counter = Counter()
    prev_dt, order_violations = "", 0
    n_filings = n_pages = 0
    client_ids_per_pair: dict[tuple, set] = defaultdict(set)

    for part_file in manifest.part_files("filings", year, period):
        for env in iter_pages(cfg.data_dir / part_file):
            n_pages += 1
            for f in env["body"]["results"]:
                n_filings += 1
                uuids[f["filing_uuid"]] += 1
                dt = f.get("dt_posted") or ""
                if dt < prev_dt:
                    order_violations += 1
                prev_dt = dt

                reg, cli = f.get("registrant") or {}, f.get("client") or {}
                if reg.get("id") is not None:
                    ids_per_name["registrant"][(reg.get("name") or "").strip().upper()].add(reg["id"])
                    names_per_id["registrant"][reg["id"]].add((reg.get("name") or "").strip().upper())
                if cli.get("id") is not None:
                    cname = (cli.get("name") or "").strip().upper()
                    ids_per_name["client"][cname].add(cli["id"])
                    names_per_id["client"][cli["id"]].add(cname)
                    if reg.get("id") is not None:
                        client_ids_per_pair[(reg["id"], cname)].add(cli["id"])
                for act in f.get("lobbying_activities") or []:
                    for lob in act.get("lobbyists") or []:
                        li = (lob.get("lobbyist") or {})
                        if li.get("id") is not None:
                            lname = f"{li.get('first_name') or ''} {li.get('last_name') or ''}".strip().upper()
                            ids_per_name["lobbyist"][lname].add(li["id"])
                            names_per_id["lobbyist"][li["id"]].add(lname)

    dupes = sum(c - 1 for c in uuids.values())
    print(f"partition filings/{year}/{period}: {n_pages} pages, {n_filings} filing rows, "
          f"{len(uuids)} distinct uuids, {dupes} duplicate rows")
    print(f"dt_posted ordering violations across sequence: {order_violations}")

    for kind in ("registrant", "client", "lobbyist"):
        ipn = ids_per_name[kind]
        npi = names_per_id[kind]
        multi_id = {n: ids for n, ids in ipn.items() if len(ids) > 1}
        multi_name = {i: ns for i, ns in npi.items() if len(ns) > 1}
        n_multi = len(multi_id)
        share = 100 * n_multi / max(1, len(ipn))
        print(f"\n{kind}: {len(npi)} distinct ids, {len(ipn)} distinct exact names")
        print(f"  names mapping to >1 id: {n_multi} ({share:.1f}%)   ids with >1 name: {len(multi_name)}")
        worst = sorted(multi_id.items(), key=lambda kv: -len(kv[1]))[:5]
        for name, ids in worst:
            print(f"    {len(ids):>3} ids  {name[:70]!r}")

    same_pair_multi = {k: v for k, v in client_ids_per_pair.items() if len(v) > 1}
    print(f"\n(registrant, client-name) pairs with >1 client id: {len(same_pair_multi)} "
          f"of {len(client_ids_per_pair)}")


if __name__ == "__main__":
    main()
