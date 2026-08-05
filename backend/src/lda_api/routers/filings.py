"""Debug/traceability endpoints (spec: every aggregate must trace to filing UUIDs, and a
debug view shows the underlying filings behind any edge)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_pool

router = APIRouter()

FILING_SQL = """
SELECT f.filing_uuid::text, f.filing_type, rt.display, f.filing_year, f.filing_period,
       f.income, f.expenses, f.amount, f.amount_type, f.is_reported_zero,
       f.dt_posted, f.is_current, f.is_original, f.superseded_by::text,
       f.attribution_level, f.filing_document_url, f.retrieved_at,
       f.registrant_id, r.display_name, f.client_id, c.display_name
FROM filings f
JOIN ref_filing_types rt ON rt.code = f.filing_type
JOIN registrants r ON r.id = f.registrant_id
JOIN clients c ON c.id = f.client_id
WHERE f.filing_uuid = %(uuid)s
"""

ACTIVITIES_SQL = """
SELECT a.activity_index, a.general_issue_code, i.display, a.description,
       (SELECT array_agg(l.display_name ORDER BY l.display_name)
          FROM activity_lobbyists al JOIN lobbyists l ON l.id = al.lobbyist_id
         WHERE al.filing_uuid = a.filing_uuid AND al.activity_index = a.activity_index),
       (SELECT array_agg(g.name ORDER BY g.name)
          FROM activity_government_entities age JOIN gov_entities g ON g.id = age.gov_entity_id
         WHERE age.filing_uuid = a.filing_uuid AND age.activity_index = a.activity_index)
FROM filing_activities a
LEFT JOIN ref_issue_codes i ON i.code = a.general_issue_code
WHERE a.filing_uuid = %(uuid)s
ORDER BY a.activity_index
"""

EDGE_FILINGS_SQL = """
SELECT DISTINCT e.filing_uuid::text
FROM edges e
WHERE e.source_type = %(source_type)s AND e.source_id = %(source_id)s
  AND e.target_type = %(target_type)s AND e.target_id = %(target_id)s
  AND e.filing_year = %(year)s AND e.filing_period = %(period)s
"""


@router.get("/filings/{filing_uuid}")
async def filing_detail(filing_uuid: str):
    async with (await get_pool()).connection() as conn:
        row = await (await conn.execute(FILING_SQL, {"uuid": filing_uuid})).fetchone()
        if row is None:
            raise HTTPException(404, "filing not found")
        acts = await (await conn.execute(ACTIVITIES_SQL, {"uuid": filing_uuid})).fetchall()
    return {
        "filing_uuid": row[0], "filing_type": row[1], "filing_type_display": row[2],
        "filing_year": row[3], "filing_period": row[4],
        "income": float(row[5]) if row[5] is not None else None,
        "expenses": float(row[6]) if row[6] is not None else None,
        "amount": float(row[7]) if row[7] is not None else None,
        "amount_type": row[8], "is_reported_zero": row[9],
        "dt_posted": row[10].isoformat(), "is_current": row[11], "is_original": row[12],
        "superseded_by": row[13], "attribution_level": row[14],
        "filing_document_url": row[15], "retrieved_at": row[16].isoformat(),
        "registrant": {"id": row[17], "label": row[18]},
        "client": {"id": row[19], "label": row[20]},
        "activities": [{
            "index": a[0], "issue_code": a[1], "issue_display": a[2],
            "description": a[3], "lobbyists": a[4], "government_entities": a[5],
        } for a in acts],
    }


@router.get("/edge-filings")
async def edge_filings(source_type: str = Query(), source_id: int = Query(),
                       target_type: str = Query(), target_id: int = Query(),
                       year: int = Query(), period: str = Query()):
    """The filings behind one rendered edge — the debug view's data source."""
    async with (await get_pool()).connection() as conn:
        uuids = [r[0] for r in await (await conn.execute(EDGE_FILINGS_SQL, {
            "source_type": source_type, "source_id": source_id,
            "target_type": target_type, "target_id": target_id,
            "year": year, "period": period})).fetchall()]
        details = []
        for u in uuids:
            row = await (await conn.execute(FILING_SQL, {"uuid": u})).fetchone()
            if row:
                details.append({
                    "filing_uuid": row[0], "filing_type_display": row[2],
                    "amount": float(row[7]) if row[7] is not None else None,
                    "amount_type": row[8], "is_current": row[11],
                    "filing_document_url": row[15],
                })
    return {"filings": details}
