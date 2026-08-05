// Pure display-decision logic for the spotlight interaction, kept out of the sigma
// reducers so it can be table-tested. The reducers spread these partial overrides
// onto the incoming display data (sigma's return-total-object contract).

export interface SpotlightState {
  node: string | null;
  pinned: boolean;
  neighbors: Set<string>;
  labeledNeighbors: Set<string>; // top-K by degree, capped for huge hubs
}

export const NO_SPOTLIGHT: SpotlightState = {
  node: null,
  pinned: false,
  neighbors: new Set(),
  labeledNeighbors: new Set(),
};

// Sigma's WebGL programs mishandle rgba: the node program renders rgba as white, the
// edge program drops the alpha channel. All translucency is therefore pre-blended
// into opaque hex against the Deep Space background (#0D0D14) — visually identical
// on a flat background.
export const DIMMED_NODE = "#23262f";
export const DIMMED_EDGE = "#15151b"; // gray @ 6% over Deep Space

export interface NodeStyleInput {
  key: string;
  tStatus?: string; // "new" | "persisting" | "dropped"
}

export function spotlightNodeStyle(
  s: SpotlightState,
  n: NodeStyleInput,
): { dim: boolean; label: "keep" | "suppress"; forceLabel?: boolean } {
  // Ghosts never carry labels, spotlight or not.
  if (n.tStatus === "dropped" && (s.node === null || !inSpotlight(s, n.key))) {
    return { dim: s.node !== null, label: "suppress" };
  }
  if (s.node === null) return { dim: false, label: "keep" };
  if (n.key === s.node) return { dim: false, label: "keep", forceLabel: true };
  if (s.neighbors.has(n.key)) {
    return { dim: false, label: "keep", forceLabel: s.labeledNeighbors.has(n.key) };
  }
  return { dim: true, label: "suppress" };
}

export function spotlightEdgeStyle(
  s: SpotlightState,
  source: string,
  target: string,
): { emphasis: "raise" | "dim" | "none" } {
  if (s.node === null) return { emphasis: "none" };
  if (source === s.node || target === s.node) return { emphasis: "raise" };
  return { emphasis: "dim" };
}

function inSpotlight(s: SpotlightState, key: string): boolean {
  return key === s.node || s.neighbors.has(key);
}

/** Top-K node keys by a degree lookup, for ambient hub labels and neighbor-label caps. */
export function topKByDegree(
  keys: Iterable<string>,
  degreeOf: (key: string) => number,
  k: number,
): Set<string> {
  return new Set(
    [...keys].sort((a, b) => degreeOf(b) - degreeOf(a)).slice(0, k),
  );
}
