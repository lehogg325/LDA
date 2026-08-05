// Pure display-decision logic for the filing-chain spotlight, kept out of the sigma
// reducers so it can be table-tested. A spotlight lights a set of nodes and a set of
// display-edge keys; hovering follows FILINGS, not mere adjacency — a lobbyist's chain
// runs lobbyist → firm → company → every entity those filings targeted.

export interface SpotlightState {
  node: string | null;
  pinned: boolean;
  mode: "chain" | "neighbors" | null;
  nodes: Set<string>;   // lit nodes (focus + chain/neighbors)
  edges: Set<string>;   // lit display-edge keys
  labeled: Set<string>; // subset of lit nodes that get labels
}

export const NO_SPOTLIGHT: SpotlightState = {
  node: null, pinned: false, mode: null,
  nodes: new Set(), edges: new Set(), labeled: new Set(),
};

// Sigma's WebGL programs mishandle rgba (nodes render white, edges drop alpha), so all
// translucency is pre-blended opaque hex against Deep Space #0D0D14.
export const DIMMED_NODE = "#23262f";
export const DIMMED_EDGE = "#15151b";

export function spotlightNodeStyle(
  s: SpotlightState,
  n: { key: string; tStatus?: string },
): { dim: boolean; label: "keep" | "suppress"; forceLabel?: boolean } {
  if (n.tStatus === "dropped" && (s.node === null || !s.nodes.has(n.key))) {
    return { dim: s.node !== null, label: "suppress" };
  }
  if (s.node === null) return { dim: false, label: "keep" };
  if (n.key === s.node) return { dim: false, label: "keep", forceLabel: true };
  if (s.nodes.has(n.key)) {
    return { dim: false, label: "keep", forceLabel: s.labeled.has(n.key) };
  }
  return { dim: true, label: "suppress" };
}

export function spotlightEdgeStyle(
  s: SpotlightState, edgeKey: string,
): { emphasis: "raise" | "dim" | "none" } {
  if (s.node === null) return { emphasis: "none" };
  return { emphasis: s.edges.has(edgeKey) ? "raise" : "dim" };
}

/** Follow filings outward from a node's incident edges. Aborts (returns null) when the
 * chain stops being selective — the caller falls back to a neighbor spotlight. */
export function chainEdges(
  incident: { key: string; uuids: string[] }[],
  index: Map<string, string[]>,
  limits: { maxEdges: number; maxUuids: number },
): Set<string> | null {
  const uuids = new Set<string>();
  for (const e of incident) {
    for (const u of e.uuids) {
      uuids.add(u);
      if (uuids.size > limits.maxUuids) return null;
    }
  }
  const edges = new Set<string>(incident.map((e) => e.key));
  for (const u of uuids) {
    for (const key of index.get(u) ?? []) {
      edges.add(key);
      if (edges.size > limits.maxEdges) return null;
    }
  }
  return edges;
}

/** Top-K node keys by a degree lookup; deterministic via key tiebreak. */
export function topKByDegree(
  keys: Iterable<string>,
  degreeOf: (key: string) => number,
  k: number,
): Set<string> {
  return new Set(
    [...keys]
      .sort((a, b) => degreeOf(b) - degreeOf(a) || a.localeCompare(b))
      .slice(0, k),
  );
}
