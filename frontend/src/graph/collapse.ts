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
