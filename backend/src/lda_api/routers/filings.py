"""Debug/traceability endpoints (spec: every aggregate must trace to filing UUIDs, and a
debug view shows the underlying filings behind any edge)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_pool

router = APIRouter()

FILING_BASE_SQL = """
SELECT f.filing_uuid::text, f.filing_type, rt.display, f.filing_year, f.filing_period,
       f.income, f.expenses, f.amount, f.amount_type, f.is_reported_zero,
       f.dt_posted, f.is_current, f.is_original, f.superseded_by::text,
       f.attribution_level, f.filing_document_url, f.retrieved_at,
       f.registrant_id, r.display_name, f.client_id, c.display_name
FROM filings f
JOIN ref_filing_types rt ON rt.code = f.filing_type
JOIN registrants r ON r.id = f.registrant_id
JOIN clients c ON c.id = f.client_id
"""

FILING_SQL = FILING_BASE_SQL + "WHERE f.filing_uuid = %(uuid)s"

FILINGS_BATCH_SQL = (
    FILING_BASE_SQL
    + "WHERE f.filing_uuid = ANY(%(uuids)s::uuid[]) "
    + "ORDER BY f.is_current DESC, f.dt_posted DESC, f.filing_uuid"
)

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
WHERE e.source_type = %(source_type)s AND e.source_id = ANY(%(source_ids)s)
  AND e.target_type = %(target_type)s AND e.target_id = ANY(%(target_ids)s)
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


def _csv_ids(csv: str | None, fallback: int | None) -> list[int]:
    if not csv:
        if fallback is None:
            raise HTTPException(422, "ids is required")
        return [fallback]
    try:
        return [int(x) for x in csv.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(422, "ids must be a comma-separated list of integers")


# What a node lobbied on: its filings' activities for one quarter. The node-type
# fragment supplies the JOIN/WHERE; the shared tail applies quarter + view. Pre-2021
# legacy filings keep their (filing-level) entity lists in the same activity tables,
# so gov_entity works across the whole record.
_ACTIVITY_SCOPE = {
    "registrant": "WHERE f.registrant_id = ANY(%(ids)s)",
    "client": "WHERE f.client_id = ANY(%(ids)s)",
    "lobbyist": ("JOIN activity_lobbyists al ON al.filing_uuid = a.filing_uuid "
                 "AND al.activity_index = a.activity_index "
                 "WHERE al.lobbyist_id = ANY(%(ids)s)"),
    "gov_entity": ("JOIN activity_government_entities age ON age.filing_uuid = a.filing_uuid "
                   "AND age.activity_index = a.activity_index "
                   "WHERE age.gov_entity_id = ANY(%(ids)s)"),
}

_ACTIVITY_ROW_CAP = 2000
_PER_ISSUE_CAP = 30


def _node_activities_sql(node_type: str) -> str:
    return f"""
SELECT DISTINCT a.filing_uuid::text, a.activity_index, a.general_issue_code, i.display,
       a.description, r.display_name, c.display_name, f.filing_document_url
FROM filings f
JOIN filing_activities a ON a.filing_uuid = f.filing_uuid
LEFT JOIN ref_issue_codes i ON i.code = a.general_issue_code
JOIN registrants r ON r.id = f.registrant_id
JOIN clients c ON c.id = f.client_id
{_ACTIVITY_SCOPE[node_type]}
  AND f.filing_year = %(year)s AND f.filing_period = %(period)s
  AND CASE WHEN %(view)s = 'original' THEN f.is_original ELSE f.is_current END
ORDER BY a.general_issue_code, a.filing_uuid::text, a.activity_index
LIMIT {_ACTIVITY_ROW_CAP}
"""


@router.get("/node-activities")
async def node_activities(
        node_type: str = Query(pattern="^(registrant|client|lobbyist|gov_entity)$"),
        ids: str = Query(), year: int = Query(), period: str = Query(),
        view: str = Query(default="amended", pattern="^(amended|original)$")):
    """What this node lobbied on in one quarter, grouped by general issue code.

    Backs the node side panel. `ids` is a CSV list because a name-group anchor spans
    several registration-scoped IDs; `view` mirrors the ego endpoint's amended/original
    history semantics.
    """
    id_list = _csv_ids(ids, None)
    async with (await get_pool()).connection() as conn:
        rows = await (await conn.execute(_node_activities_sql(node_type), {
            "ids": id_list, "year": year, "period": period, "view": view})).fetchall()

    issues: dict[str, dict] = {}
    filings_seen: set[str] = set()
    for uuid, _idx, code, display, desc, reg, cli, url in rows:
        filings_seen.add(uuid)
        g = issues.setdefault(code or "", {
            "code": code or "", "display": display or code or "Unspecified",
            "n_activities": 0, "activities": []})
        g["n_activities"] += 1
        if len(g["activities"]) < _PER_ISSUE_CAP:
            g["activities"].append({
                "filing_uuid": uuid, "description": desc or None,
                "registrant": reg, "client": cli, "filing_document_url": url})
    return {
        "issues": sorted(issues.values(), key=lambda g: (-g["n_activities"], g["code"])),
        "n_filings": len(filings_seen),
        "truncated": len(rows) == _ACTIVITY_ROW_CAP,
    }


@router.get("/edge-filings")
async def edge_filings(source_type: str = Query(), source_id: int = Query(),
                       target_type: str = Query(), target_id: int = Query(),
                       year: int = Query(), period: str = Query(),
                       source_ids: str | None = Query(None),
                       target_ids: str | None = Query(None)):
    """The filings behind one rendered edge — the debug view's data source.

    A display edge may aggregate several registration-scoped IDs (a name-group anchor
    collapses to one node), so the optional CSV id lists widen the match. The ANY×ANY
    cross product is exact because such aggregates are stars: one concrete node on the
    non-anchor side, N member IDs on the anchor side.
    """
    s_ids = _csv_ids(source_ids, source_id)
    t_ids = _csv_ids(target_ids, target_id)
    async with (await get_pool()).connection() as conn:
        uuids = [r[0] for r in await (await conn.execute(EDGE_FILINGS_SQL, {
            "source_type": source_type, "source_ids": s_ids,
            "target_type": target_type, "target_ids": t_ids,
            "year": year, "period": period})).fetchall()]
        details = []
        if uuids:
            rows = await (await conn.execute(FILINGS_BATCH_SQL, {"uuids": uuids})).fetchall()
            details = [{
                "filing_uuid": row[0], "filing_type_display": row[2],
                "amount": float(row[7]) if row[7] is not None else None,
                "amount_type": row[8], "is_current": row[11],
                "filing_document_url": row[15],
            } for row in rows]
    return {"filings": details}
