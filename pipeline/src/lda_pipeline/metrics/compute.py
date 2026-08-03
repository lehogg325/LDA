"""Per-quarter node metrics over the current (non-superseded) quarterly-activity graph.

Registrations and terminations are excluded — they are not part of the quarterly activity
series (spec mandate). Metrics:
- degree: distinct neighbors; weighted_degree: incident edge-row multiplicity.
- total_income / total_expenses: sums of represents-edge amounts by amount_type,
  kept strictly separate (never combined into one number).
- community_id: Leiden (modularity) via python-igraph.
- betweenness: exact when the quarter computes in under BETWEENNESS_BUDGET_S, else
  distance-bounded (cutoff), with the method recorded per quarter.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict

import igraph as ig
import psycopg

log = logging.getLogger("lda_pipeline")

BETWEENNESS_BUDGET_S = 180.0
BETWEENNESS_CUTOFF = 6

EDGES_SQL = """
SELECT edge_type, source_type, source_id, target_type, target_id, amount, amount_type
FROM edges
WHERE filing_year = %(year)s AND filing_period = %(period)s
  AND NOT is_superseded AND document_kind = 'quarterly' AND NOT is_termination
"""


def compute_quarter(conn: psycopg.Connection, year: int, period: str,
                    benchmark_exact: bool = True) -> dict:
    # Exact betweenness measured at 23.9s on 2013 Q2 (32K nodes / 132K edges) — the
    # step-5 benchmark gate passed, so exact is the default; cutoff remains the fallback
    # for pathological quarters via --cutoff.
    rows = conn.execute(EDGES_SQL, {"year": year, "period": period}).fetchall()
    if not rows:
        return {"nodes": 0, "edges": 0}

    index: dict[tuple[str, int], int] = {}
    def vid(node_type: str, node_id: int) -> int:
        key = (node_type, node_id)
        if key not in index:
            index[key] = len(index)
        return index[key]

    edge_list: list[tuple[int, int]] = []
    multiplicity: defaultdict[int, int] = defaultdict(int)
    income: defaultdict[tuple[str, int], float] = defaultdict(float)
    expenses: defaultdict[tuple[str, int], float] = defaultdict(float)

    for etype, stype, sid, ttype, tid, amount, amount_type in rows:
        s, t = vid(stype, sid), vid(ttype, tid)
        edge_list.append((s, t))
        multiplicity[s] += 1
        multiplicity[t] += 1
        if etype == "represents" and amount is not None:
            bucket = income if amount_type == "income" else expenses
            bucket[(stype, sid)] += float(amount)
            bucket[(ttype, tid)] += float(amount)

    g = ig.Graph(n=len(index), edges=edge_list, directed=False)
    simple = g.simplify(multiple=True, loops=True)

    degree = simple.degree()
    communities = simple.community_leiden(objective_function="modularity", n_iterations=3)
    membership = communities.membership

    t0 = time.monotonic()
    if benchmark_exact:
        betweenness = simple.betweenness()
        method = "exact"
    else:
        betweenness = simple.betweenness(cutoff=BETWEENNESS_CUTOFF)
        method = f"cutoff-{BETWEENNESS_CUTOFF}"
    bt_seconds = time.monotonic() - t0

    period_ord_row = conn.execute(
        "SELECT DISTINCT period_ord FROM edges WHERE filing_year=%s AND filing_period=%s LIMIT 1",
        (year, period)).fetchone()
    period_ord = period_ord_row[0]

    with conn.cursor() as cur:
        cur.execute("DELETE FROM node_metrics WHERE filing_year=%s AND filing_period=%s",
                    (year, period))
        with cur.copy(
            "COPY node_metrics (filing_year, filing_period, period_ord, node_type, node_id, "
            "degree, weighted_degree, total_income, total_expenses, community_id, "
            "betweenness, betweenness_method) FROM STDIN"
        ) as copy:
            for (ntype, nid), v in index.items():
                copy.write_row((
                    year, period, period_ord, ntype, nid,
                    degree[v], multiplicity[v],
                    round(income[(ntype, nid)], 2) if (ntype, nid) in income else None,
                    round(expenses[(ntype, nid)], 2) if (ntype, nid) in expenses else None,
                    membership[v], betweenness[v], method))

        n_current = conn.execute(
            "SELECT count(*) FROM filings WHERE filing_year=%s AND filing_period=%s "
            "AND is_current AND document_kind='quarterly' AND NOT is_termination",
            (year, period)).fetchone()[0]
        cur.execute(
            "INSERT INTO quarters (filing_year, filing_period, period_ord, n_nodes, n_edges, "
            "n_current_filings, computed_at) VALUES (%s,%s,%s,%s,%s,%s,now()) "
            "ON CONFLICT (filing_year, filing_period) DO UPDATE SET n_nodes=EXCLUDED.n_nodes, "
            "n_edges=EXCLUDED.n_edges, n_current_filings=EXCLUDED.n_current_filings, "
            "computed_at=now()",
            (year, period, period_ord, len(index), len(edge_list), n_current))
    conn.commit()

    stats = {"nodes": len(index), "edges": len(edge_list),
             "communities": len(set(membership)), "betweenness_method": method,
             "betweenness_seconds": round(bt_seconds, 1)}
    log.info("metrics %s/%s: %s", year, period, stats)
    return stats
