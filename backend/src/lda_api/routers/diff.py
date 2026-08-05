"""Anchor-scoped quarter-over-quarter diff: added / dropped / persisting edges,
with amount deltas where both sides carry money."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from ..db import get_pool
from .ego import NODE_TYPES, build_ego

router = APIRouter()


def _key(e: dict) -> tuple:
    return (e["edge_type"], e["source"]["node_type"], e["source"]["node_id"],
            e["target"]["node_type"], e["target"]["node_id"])


@router.get("/diff")
async def diff(request: Request,
               node_type: str = Query(), node_id: int = Query(),
               from_year: int = Query(), from_period: str = Query(),
               to_year: int = Query(), to_period: str = Query(),
               view: str = Query(default="amended", pattern="^(amended|original)$"),
               ids: str | None = Query(default=None)):
    if node_type not in NODE_TYPES:
        raise HTTPException(404, f"unknown node type {node_type!r}")
    anchor_ids = [int(x) for x in ids.split(",")] if ids else [node_id]
    anchors = [(node_type, i) for i in anchor_ids]
    settings = request.app.state.settings

    async with (await get_pool()).connection() as conn:
        before = await build_ego(conn, anchors, from_year, from_period, 1, view,
                                 settings.node_cap, settings.neighbor_cap)
        after = await build_ego(conn, anchors, to_year, to_period, 1, view,
                                settings.node_cap, settings.neighbor_cap)

    b = {}
    for e in before["edges"]:
        b.setdefault(_key(e), e)
    a = {}
    for e in after["edges"]:
        a.setdefault(_key(e), e)

    added = [a[k] for k in a.keys() - b.keys()]
    dropped = [b[k] for k in b.keys() - a.keys()]
    persisting = []
    for k in a.keys() & b.keys():
        entry = {"edge": a[k]}
        if a[k]["amount"] is not None and b[k]["amount"] is not None \
                and a[k]["amount_type"] == b[k]["amount_type"]:
            entry["amount_before"] = b[k]["amount"]
            entry["amount_after"] = a[k]["amount"]
            entry["amount_delta"] = round(a[k]["amount"] - b[k]["amount"], 2)
        persisting.append(entry)

    return {"anchor": {"node_type": node_type, "ids": anchor_ids}, "view": view,
            "from": {"year": from_year, "period": from_period},
            "to": {"year": to_year, "period": to_period},
            "added": added, "dropped": dropped, "persisting": persisting,
            "truncated": before["truncated"] or after["truncated"]}
