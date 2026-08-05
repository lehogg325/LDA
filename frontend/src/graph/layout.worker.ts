// Runs ForceAtlas2 over the union graph, off the main thread. Coordinates come back
// once and are then held fixed; the quarter slider only toggles visibility/styling.
//
// Layout recipe (tuned for hub-and-spoke ego topology):
// - outboundAttractionDistribution divides hub attraction by degree, so leaves ring
//   their hubs instead of collapsing onto them.
// - Two phases: the main run converges the global shape; a short adjustSizes pass
//   relieves node overlap without fighting expansion the whole way.
// - Group anchors (same-name registration IDs) get deterministic constellation seeds
//   plus weak phantom star edges (layout-only, never displayed) so they hold together.

import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { seedGroupPosition, seedPosition } from "./seed";

export interface LayoutRequest {
  nodes: { key: string; size: number }[];
  edges: [string, string, number][];
  /** Same-name anchor groups: each inner array is the member node keys, first = top-degree. */
  groups: string[][];
}

export type LayoutResponse = Record<string, { x: number; y: number }>;

const PHANTOM_WEIGHT = 0.3;

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { nodes, edges, groups } = event.data;
  const graph = new Graph({ multi: false, type: "undirected" });

  const groupOf = new Map<string, string>();
  for (const members of groups ?? []) {
    for (const key of members) groupOf.set(key, members[0]);
  }

  for (const n of nodes) {
    const groupHead = groupOf.get(n.key);
    const { x, y } = groupHead ? seedGroupPosition(groupHead, n.key) : seedPosition(n.key);
    graph.addNode(n.key, { x, y, size: n.size });
  }
  for (const [s, t, w] of edges) {
    if (!graph.hasEdge(s, t)) graph.addEdge(s, t, { weight: w });
    else graph.updateEdgeAttribute(s, t, "weight", (old) => (old as number) + w);
  }
  for (const members of groups ?? []) {
    for (const key of members.slice(1)) {
      if (!graph.hasEdge(members[0], key)) {
        graph.addEdge(members[0], key, { weight: PHANTOM_WEIGHT });
      }
    }
  }

  const settings = {
    ...forceAtlas2.inferSettings(graph),
    barnesHutOptimize: graph.order > 500,
    edgeWeightInfluence: 0.6,
    outboundAttractionDistribution: true,
    gravity: 0.08,
  };

  const iterations = graph.order > 3000 ? 200 : 400;
  forceAtlas2.assign(graph, { iterations, settings });
  // Overlap-relief pass: collision radii use the same clamped sizes the renderer draws.
  forceAtlas2.assign(graph, {
    iterations: 80,
    settings: { ...settings, adjustSizes: true, slowDown: 10 },
  });

  const positions: LayoutResponse = {};
  graph.forEachNode((key, attrs) => {
    positions[key] = { x: attrs.x as number, y: attrs.y as number };
  });
  (self as unknown as Worker).postMessage(positions);
};
