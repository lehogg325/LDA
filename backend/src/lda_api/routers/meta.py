"""Available quarters, data-retrieval window (ToS citation), and disclaimer text."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..db import get_pool

router = APIRouter()


@router.get("/meta")
async def meta(request: Request):
    async with (await get_pool()).connection() as conn:
        quarters = await (await conn.execute(
            "SELECT filing_year, filing_period, period_ord, n_nodes, n_edges, "
            "n_current_filings FROM quarters ORDER BY period_ord")).fetchall()
        retrieval = await (await conn.execute(
            "SELECT min(retrieved_min), max(retrieved_max) FROM load_state")).fetchone()
        counts = await (await conn.execute(
            "SELECT (SELECT count(*) FROM filings), (SELECT count(*) FROM edges), "
            "(SELECT count(*) FROM contribution_filings)")).fetchone()
        # Deployment diagnostic: search needs pg_trgm and a populated entity_names
        # matview — both can silently go missing in a botched pg_restore.
        search_ready = await (await conn.execute(
            "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') "
            "AND EXISTS (SELECT 1 FROM entity_names LIMIT 1)")).fetchone()
    return {
        "quarters": [{"year": q[0], "period": q[1], "period_ord": q[2],
                      "n_nodes": q[3], "n_edges": q[4], "n_current_filings": q[5]}
                     for q in quarters],
        "retrieved_from": retrieval[0].isoformat() if retrieval[0] else None,
        "retrieved_to": retrieval[1].isoformat() if retrieval[1] else None,
        "counts": {"filings": counts[0], "edges": counts[1], "contribution_reports": counts[2]},
        "search_ready": bool(search_ready[0]),
        "disclaimer": request.app.state.settings.disclaimer,
    }
