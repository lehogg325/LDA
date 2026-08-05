// Runs ForceAtlas2 over the union graph, off the main thread. Coordinates come back
// once and are then held fixed; the quarter slider only toggles visibility/styling.

import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { seedPosition } from "./seed";

export interface LayoutRequest {
  nodes: { key: string; size: number }[];
  edges: [string, string, number][];
}

export type LayoutResponse = Record<string, { x: number; y: number }>;

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { nodes, edges } = event.data;
  const graph = new Graph({ multi: false, type: "undirected" });
  for (const n of nodes) {
    const { x, y } = seedPosition(n.key);
    graph.addNode(n.key, { x, y, size: n.size });
  }
  for (const [s, t, w] of edges) {
    if (!graph.hasEdge(s, t)) graph.addEdge(s, t, { weight: w });
    else graph.updateEdgeAttribute(s, t, "weight", (old) => (old as number) + w);
  }

  const iterations = graph.order > 3000 ? 200 : 400;
  forceAtlas2.assign(graph, {
    iterations,
    settings: {
      ...forceAtlas2.inferSettings(graph),
      barnesHutOptimize: graph.order > 500,
      edgeWeightInfluence: 0.6,
    },
  });

  const positions: LayoutResponse = {};
  graph.forEachNode((key, attrs) => {
    positions[key] = { x: attrs.x as number, y: attrs.y as number };
  });
  (self as unknown as Worker).postMessage(positions);
};
