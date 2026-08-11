"""Real search-analytics: logs SearchBox selections and ranks the most-searched
companies/registrants over a rolling window — distinct from node_metrics-derived
"importance" (degree, income, etc.), which measures the lobbying network itself,
not what this app's users actually look up."""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import get_pool

router = APIRouter()

NODE_TYPES = ("registrant", "client", "lobbyist", "gov_entity")

TOP_SQL = """
    SELECT node_type, label, count(*) AS n
    FROM search_events
    WHERE node_type IN ('client', 'registrant')
      AND searched_at > now() - (%(days)s || ' days')::interval
    GROUP BY node_type, label
    ORDER BY n DESC, label
    LIMIT %(limit)s
"""


@router.post("/search-events")
async def log_search(node_type: str = Query(pattern="^(" + "|".join(NODE_TYPES) + ")$"),
                      label: str = Query(min_length=1)):
    async with (await get_pool()).connection() as conn:
        await conn.execute(
            "INSERT INTO search_events (node_type, label) VALUES (%(t)s, %(l)s)",
            {"t": node_type, "l": label})
    return {"ok": True}


@router.get("/search-events/top")
async def top_searches(days: int = Query(default=30, ge=1, le=365),
                        limit: int = Query(default=10, le=50)):
    async with (await get_pool()).connection() as conn:
        rows = await (await conn.execute(TOP_SQL, {"days": days, "limit": limit})).fetchall()
    return {"days": days, "results": [
        {"node_type": r[0], "label": r[1], "count": r[2]} for r in rows]}
