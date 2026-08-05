"""Ego network for one quarter: iterative hop expansion over the edges table.

Server-side caps (spec: never ship the full graph): NODE_CAP total nodes, NEIGHBOR_CAP
edges expanded per frontier node, both surfaced through an explicit truncation signal.
`view=amended` (default) serves the as-currently-amended history (NOT is_superseded);
`view=original` serves the as-originally-filed history (is_original).
Anchors may be a group of IDs (registration-scoped client IDs sharing an exact name).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from ..db import get_pool

router = APIRouter()

NODE_TYPES = ("registrant", "client", "lobbyist", "gov_entity")

EXPAND_SQL = """
WITH frontier (node_type, node_id) AS (SELECT * FROM unnest(%(types)s::text[], %(ids)s::bigint[])),
hits AS (
    SELECT e.edge_type, e.source_type, e.source_id, e.target_type, e.target_id,
           e.filing_uuid::text AS filing_uuid, e.amount, e.amount_type, e.issue_codes,
           e.attribution_level, e.is_superseded,
           f.node_type AS from_type, f.node_id AS from_id,
           row_number() OVER (
               PARTITION BY f.node_type, f.node_id
               ORDER BY e.amount DESC NULLS LAST, e.edge_id
           ) AS rn,
           count(*) OVER (PARTITION BY f.node_type, f.node_id) AS n_total
    FROM edges e
    JOIN frontier f ON (e.source_type = f.node_type AND e.source_id = f.node_id)
                    OR (e.target_type = f.node_type AND e.target_id = f.node_id)
    WHERE e.filing_year = %(year)s AND e.filing_period = %(period)s
      AND e.document_kind = 'quarterly' AND NOT e.is_termination
      AND CASE WHEN %(view)s = 'original' THEN e.is_original ELSE NOT e.is_superseded END
)
SELECT * FROM hits WHERE rn <= %(neighbor_cap)s
"""

METRICS_SQL = """
SELECT node_type, node_id, degree, weighted_degree, total_income, total_expenses,
       community_id, betweenness
FROM node_metrics
WHERE filing_year = %(year)s AND filing_period = %(period)s
  AND (node_type, node_id) IN (SELECT * FROM unnest(%(types)s::text[], %(ids)s::bigint[]))
"""

LABELS_SQL = """
SELECT DISTINCT ON (node_type, node_id) node_type, node_id, name
FROM entity_names
WHERE (node_type, node_id) IN (SELECT * FROM unnest(%(types)s::text[], %(ids)s::bigint[]))
ORDER BY node_type, node_id, last_seen_ord DESC, n_filings DESC
"""

GOV_LABELS_SQL = "SELECT id, name FROM gov_entities WHERE id = ANY(%(ids)s)"


async def build_ego(conn, anchors: list[tuple[str, int]], year: int, period: str,
                    hops: int, view: str, node_cap: int, neighbor_cap: int) -> dict:
    nodes: set[tuple[str, int]] = set(anchors)
    edges: dict[tuple, dict] = {}
    truncated = False
    dropped: list[dict] = []

    frontier = list(anchors)
    for _ in range(hops):
        if not frontier or len(nodes) >= node_cap:
            break
        rows = await (await conn.execute(EXPAND_SQL, {
            "types": [t for t, _ in frontier], "ids": [i for _, i in frontier],
            "year": year, "period": period, "view": view, "neighbor_cap": neighbor_cap,
        })).fetchall()

        next_frontier: set[tuple[str, int]] = set()
        per_node_seen: dict[tuple[str, int], int] = {}
        for r in rows:
            (etype, stype, sid, ttype, tid, fuuid, amount, amount_type, issues,
             attribution, superseded, from_type, from_id, rn, n_total) = r
            src, dst = (stype, sid), (ttype, tid)
            if n_total > neighbor_cap:
                per_node_seen[(from_type, from_id)] = n_total
            other = dst if src == (from_type, from_id) else src
            if other not in nodes:
                if len(nodes) >= node_cap:
                    truncated = True
                    continue
                nodes.add(other)
                next_frontier.add(other)
            key = (etype, src, dst, fuuid)
            edges[key] = {
                "edge_type": etype,
                "source": {"node_type": stype, "node_id": sid},
                "target": {"node_type": ttype, "node_id": tid},
                "filing_uuid": fuuid, "amount": float(amount) if amount is not None else None,
                "amount_type": amount_type, "issue_codes": issues,
                "attribution_level": attribution, "is_superseded": superseded,
            }
        for (ftype, fid), n_total in per_node_seen.items():
            truncated = True
            dropped.append({"node_type": ftype, "node_id": fid,
                            "dropped_neighbors": n_total - neighbor_cap})
        frontier = list(next_frontier)

    types, ids = [t for t, _ in nodes], [i for _, i in nodes]
    metrics = {(r[0], r[1]): r[2:] for r in await (await conn.execute(
        METRICS_SQL, {"year": year, "period": period, "types": types, "ids": ids})).fetchall()}
    labels = {(r[0], r[1]): r[2] for r in await (await conn.execute(
        LABELS_SQL, {"types": types, "ids": ids})).fetchall()}
    gov_ids = [i for (t, i) in nodes if t == "gov_entity"]
    if gov_ids:
        for gid, gname in await (await conn.execute(GOV_LABELS_SQL, {"ids": gov_ids})).fetchall():
            labels[("gov_entity", gid)] = gname

    node_payload = []
    for (ntype, nid) in sorted(nodes):
        m = metrics.get((ntype, nid))
        node_payload.append({
            "node_type": ntype, "node_id": nid,
            "label": labels.get((ntype, nid), str(nid)),
            "is_anchor": (ntype, nid) in set(anchors),
            "metrics": None if m is None else {
                "degree": m[0], "weighted_degree": m[1],
                "total_income": float(m[2]) if m[2] is not None else None,
                "total_expenses": float(m[3]) if m[3] is not None else None,
                "community_id": m[4], "betweenness": m[5],
            },
        })
    return {"nodes": node_payload, "edges": list(edges.values()),
            "truncated": truncated, "dropped": dropped}


@router.get("/ego/{node_type}/{node_id}")
async def ego(node_type: str, node_id: int, request: Request,
              year: int = Query(), period: str = Query(),
              hops: int = Query(default=1, ge=1, le=2),
              view: str = Query(default="amended", pattern="^(amended|original)$"),
              ids: str | None = Query(default=None,
                                      description="comma-separated group anchor IDs")):
    if node_type not in NODE_TYPES:
        raise HTTPException(404, f"unknown node type {node_type!r}")
    anchor_ids = [int(x) for x in ids.split(",")] if ids else [node_id]
    settings = request.app.state.settings
    async with (await get_pool()).connection() as conn:
        result = await build_ego(conn, [(node_type, i) for i in anchor_ids], year, period,
                                 hops, view, settings.node_cap, settings.neighbor_cap)
    result.update({"anchor": {"node_type": node_type, "ids": anchor_ids},
                   "year": year, "period": period, "hops": hops, "view": view})
    return result
