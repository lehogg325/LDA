"""Typeahead across all four node types.

Client IDs are registration-scoped (one real-world client = many IDs), so client hits
sharing an exact name string are grouped into one result carrying all member IDs — a
display-level grouping, never a data merge. Registrant/lobbyist hits stay per-ID.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import pool

router = APIRouter()

ENTITY_SQL = """
WITH hits AS (
    SELECT node_type, node_id, name,
           min(first_seen_ord) AS first_ord, max(last_seen_ord) AS last_ord,
           sum(n_filings)::int AS n_filings,
           max(similarity(name, %(q)s)) AS sim
    FROM entity_names
    WHERE name ILIKE %(prefix)s OR name %% %(q)s
    GROUP BY node_type, node_id, name
)
SELECT node_type, node_id, name, first_ord, last_ord, n_filings, sim
FROM hits
ORDER BY sim DESC, n_filings DESC
LIMIT %(limit)s
"""

GOV_SQL = """
SELECT id, name FROM gov_entities WHERE name ILIKE '%%' || %(q)s || '%%' LIMIT 10
"""


@router.get("/search")
async def search(q: str = Query(min_length=2), limit: int = Query(default=40, le=100)):
    async with pool().connection() as conn:
        rows = await (await conn.execute(
            ENTITY_SQL, {"q": q, "prefix": q + "%", "limit": limit * 2})).fetchall()
        gov = await (await conn.execute(GOV_SQL, {"q": q})).fetchall()

    results = []
    client_groups: dict[str, dict] = {}
    for node_type, node_id, name, first_ord, last_ord, n_filings, sim in rows:
        if node_type == "client":
            g = client_groups.setdefault(name, {
                "node_type": "client", "label": name, "ids": [],
                "first_ord": first_ord, "last_ord": last_ord, "n_filings": 0, "sim": sim})
            g["ids"].append(node_id)
            g["first_ord"] = min(g["first_ord"], first_ord)
            g["last_ord"] = max(g["last_ord"], last_ord)
            g["n_filings"] += n_filings
        else:
            results.append({"node_type": node_type, "label": name, "ids": [node_id],
                            "first_ord": first_ord, "last_ord": last_ord,
                            "n_filings": n_filings, "sim": sim})
    results.extend(client_groups.values())
    results.sort(key=lambda r: (-r["sim"], -r["n_filings"]))

    for _, (gid, gname) in enumerate(gov):
        results.append({"node_type": "gov_entity", "label": gname, "ids": [gid],
                        "first_ord": None, "last_ord": None, "n_filings": None, "sim": None})

    for r in results:
        r.pop("sim", None)
        r["n_ids"] = len(r["ids"])
    return {"query": q, "results": results[:limit]}
