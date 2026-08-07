// Display-space collapse of the anchor name-group: the ~N registration-scoped IDs
// behind an exact-name anchor (LDA client/lobbyist IDs are per-registration) render
// as ONE labeled node. This is strictly a display-level aggregation — the raw
// EgoResponses in the react-query cache are never mutated, edge rows keep their
// original endpoints in orig_source/orig_target, and no records are merged anywhere.
//
// Structural guarantee: every edge type connects two DIFFERENT node types
// (represents registrant→client, worked_on lobbyist→registrant/client, targeted
// client→gov_entity) and a name-group is single-typed, so collapsing can never
// produce a self-loop.

import type { EgoEdge, EgoNode, EgoResponse, NodeMetrics, NodeType } from "../api/client";
import type { Anchor } from "../state/store";

export const nodeKey = (t: string, id: number) => `${t}:${id}`;

export interface DisplayCollapse {
  members: Set<string>; // raw member keys ("type:id")
  node_type: NodeType;
  node_id: number; // numeric min of the group's ids — key strings sort lexicographically
  label: string;
}

export function makeCollapse(anchor: Anchor): DisplayCollapse {
  return {
    members: new Set(anchor.ids.map((id) => nodeKey(anchor.node_type, id))),
    node_type: anchor.node_type,
    node_id: Math.min(...anchor.ids),
    label: anchor.ids.length > 1
      ? `${anchor.label} · ${anchor.ids.length} registrations`
      : anchor.label,
  };
}

export const superKeyOf = (c: DisplayCollapse) => nodeKey(c.node_type, c.node_id);

// Inactive members carry metrics: null every quarter — they contribute 0, never a
// phantom +1 (79 idle registrations must not pin the node at max size).
function mergeMetrics(members: EgoNode[]): NodeMetrics | null {
  const withM = members.filter((m) => m.metrics != null);
  if (withM.length === 0) return null;
  const sumNullable = (f: (m: NodeMetrics) => number | null) => {
    const vals = withM.map((m) => f(m.metrics!)).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  return {
    degree: withM.reduce((a, m) => a + (m.metrics!.degree ?? 0), 0),
    weighted_degree: withM.reduce((a, m) => a + (m.metrics!.weighted_degree ?? 0), 0),
    total_income: sumNullable((m) => m.total_income),
    total_expenses: sumNullable((m) => m.total_expenses),
    community_id: null, // per-member quantities don't aggregate meaningfully
    betweenness: null,
  };
}

/** Pure display-space transform of one quarter's EgoResponse: member node rows merge
 * into a single anchor row (degrees summed), member edge endpoints re-point to the
 * collapsed node with originals preserved. Identity for single-id anchors. */
export function toDisplaySpace(resp: EgoResponse, c: DisplayCollapse): EgoResponse {
  if (c.members.size <= 1) return resp;

  const memberRows: EgoNode[] = [];
  const nodes: EgoNode[] = [];
  for (const n of resp.nodes) {
    if (c.members.has(nodeKey(n.node_type, n.node_id))) memberRows.push(n);
    else nodes.push(n);
  }
  if (memberRows.length === 0) return resp;
  nodes.push({
    node_type: c.node_type,
    node_id: c.node_id,
    label: c.label,
    is_anchor: true,
    metrics: mergeMetrics(memberRows),
  });

  const superEnd = { node_type: c.node_type, node_id: c.node_id };
  const edges: EgoEdge[] = resp.edges.map((e) => {
    const sMember = c.members.has(nodeKey(e.source.node_type, e.source.node_id));
    const tMember = c.members.has(nodeKey(e.target.node_type, e.target.node_id));
    if (!sMember && !tMember) return e;
    return {
      ...e,
      source: sMember ? superEnd : e.source,
      target: tMember ? superEnd : e.target,
      orig_source: e.source,
      orig_target: e.target,
    };
  });

  // dropped[] passes through untouched: only its dropped_neighbors counts are read.
  return { ...resp, nodes, edges };
}

/** One quarter's slice of an expansion: the RAW ego response for the expanded node
 * plus the expansion's own queried keys (needed to drop its seeded row in quarters
 * where it had no activity). */
export interface ExpansionSlice {
  resp: EgoResponse;
  memberKeys: Set<string>;
}

// Edge identity over RAW (pre-collapse) endpoints — matches the backend's own edge
// key (edge_type, src, dst, filing_uuid). Display-space identity would be wrong: a
// group anchor legitimately carries two member edges with the same display signature
// and uuid, and deduping those would halve its aggregated amounts.
const rawEdgeId = (e: EgoEdge) => {
  const s = e.orig_source ?? e.source;
  const t = e.orig_target ?? e.target;
  return `${e.edge_type}|${s.node_type}:${s.node_id}|${t.node_type}:${t.node_id}|${e.filing_uuid}`;
};

/** Merge one quarter's expansion responses into the anchor's display-space response.
 * Pure. Dedup rules (order matters):
 * - every expansion response goes through toDisplaySpace first (its edges can touch
 *   anchor members), THEN loses its is_anchor marks (the backend flags whatever node
 *   it was queried for, and toDisplaySpace synthesizes an anchor-marked row);
 * - node rows dedup by key, the anchor response's row winning;
 * - edges dedup by raw identity (kills anchor↔expansion duplicates that would
 *   double-count amounts in the per-quarter aggregation);
 * - an expansion's own seeded row is dropped in quarters where it has no metrics and
 *   no incident edge, so the expanded node hides instead of floating disconnected;
 * - truncated/dropped keep the ANCHOR's values (the truncation banner's advice would
 *   mislead for expansion-caused truncation — that surfaces on the expansions chip).
 */
export function mergeQuarter(
  anchorDisplay: EgoResponse,
  expansions: ExpansionSlice[],
  c: DisplayCollapse,
): EgoResponse {
  if (expansions.length === 0) return anchorDisplay;
  const nodes = new Map(anchorDisplay.nodes.map((n) => [nodeKey(n.node_type, n.node_id), n]));
  const edges = new Map(anchorDisplay.edges.map((e) => [rawEdgeId(e), e]));
  for (const { resp, memberKeys } of expansions) {
    const d = toDisplaySpace(resp, c);
    const touched = new Set<string>();
    for (const e of d.edges) {
      const id = rawEdgeId(e);
      if (!edges.has(id)) edges.set(id, e);
      touched.add(nodeKey(e.source.node_type, e.source.node_id));
      touched.add(nodeKey(e.target.node_type, e.target.node_id));
    }
    for (const n of d.nodes) {
      const k = nodeKey(n.node_type, n.node_id);
      if (nodes.has(k)) continue; // anchor row (incl. the collapsed super-row) wins
      if (memberKeys.has(k) && n.metrics == null && !touched.has(k)) continue;
      nodes.set(k, n.is_anchor ? { ...n, is_anchor: false } : n);
    }
  }
  return { ...anchorDisplay, nodes: [...nodes.values()], edges: [...edges.values()] };
}
