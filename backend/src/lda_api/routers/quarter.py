"""Landing view: top nodes for a quarter by a precomputed metric."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import pool

router = APIRouter()

METRICS = {"degree": "degree", "weighted_degree": "weighted_degree",
           "betweenness": "betweenness", "total_income": "total_income",
           "total_expenses": "total_expenses"}


@router.get("/quarter/{year}/{period}/top")
async def top(year: int, period: str,
              metric: str = Query(default="degree"),
              node_type: str | None = Query(default=None),
              limit: int = Query(default=25, le=100)):
    if metric not in METRICS:
        raise HTTPException(400, f"metric must be one of {sorted(METRICS)}")
    col = METRICS[metric]
    where_type = "AND m.node_type = %(node_type)s" if node_type else ""
    sql = f"""
        SELECT m.node_type, m.node_id, m.degree, m.weighted_degree,
               m.total_income, m.total_expenses, m.betweenness,
               (SELECT name FROM entity_names en
                 WHERE en.node_type = m.node_type AND en.node_id = m.node_id
                 ORDER BY last_seen_ord DESC, n_filings DESC LIMIT 1) AS label,
               (SELECT name FROM gov_entities g WHERE m.node_type = 'gov_entity'
                  AND g.id = m.node_id) AS gov_label
        FROM node_metrics m
        WHERE m.filing_year = %(year)s AND m.filing_period = %(period)s {where_type}
          AND m.{col} IS NOT NULL
        ORDER BY m.{col} DESC
        LIMIT %(limit)s
    """
    async with pool().connection() as conn:
        rows = await (await conn.execute(sql, {
            "year": year, "period": period, "node_type": node_type, "limit": limit,
        })).fetchall()
    return {"year": year, "period": period, "metric": metric, "results": [{
        "node_type": r[0], "node_id": r[1], "label": r[8] or r[7] or str(r[1]),
        "degree": r[2], "weighted_degree": r[3],
        "total_income": float(r[4]) if r[4] is not None else None,
        "total_expenses": float(r[5]) if r[5] is not None else None,
        "betweenness": r[6],
    } for r in rows]}
