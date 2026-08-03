"""Per-quarter series for one node (or a client name-group): metrics + money,
income and expenses always reported as separate series."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import pool

router = APIRouter()

SQL = """
SELECT filing_year, filing_period, period_ord,
       sum(degree)::int, sum(weighted_degree)::int,
       sum(total_income), sum(total_expenses),
       max(betweenness)
FROM node_metrics
WHERE node_type = %(node_type)s AND node_id = ANY(%(ids)s)
GROUP BY filing_year, filing_period, period_ord
ORDER BY period_ord
"""


@router.get("/timeline/{node_type}/{node_id}")
async def timeline(node_type: str, node_id: int,
                   ids: str | None = Query(default=None)):
    if node_type not in ("registrant", "client", "lobbyist", "gov_entity"):
        raise HTTPException(404, f"unknown node type {node_type!r}")
    anchor_ids = [int(x) for x in ids.split(",")] if ids else [node_id]
    async with pool().connection() as conn:
        rows = await (await conn.execute(
            SQL, {"node_type": node_type, "ids": anchor_ids})).fetchall()
    return {
        "node_type": node_type, "ids": anchor_ids,
        "quarters": [{
            "year": r[0], "period": r[1], "period_ord": r[2],
            "degree": r[3], "weighted_degree": r[4],
            "total_income": float(r[5]) if r[5] is not None else None,
            "total_expenses": float(r[6]) if r[6] is not None else None,
            "betweenness": r[7],
        } for r in rows],
    }
