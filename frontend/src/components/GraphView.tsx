// One long-lived Sigma renderer. The graphology graph is mutated in place; quarter
// changes only flip per-node/edge display attributes — never positions, never a
// renderer rebuild, never a per-quarter layout run.

import Graph from "graphology";
import { useEffect, useRef } from "react";
import Sigma from "sigma";
import type { EgoResponse } from "../api/client";
import { nodeKey } from "../graph/useEgoWindow";
import type { LayoutResponse } from "../graph/layout.worker";
import { NODE_TYPE_COLORS, STATUS_STYLE, temporalStatus } from "../graph/temporalStatus";
import { useStore } from "../state/store";

interface Props {
  union: {
    nodes: Map<string, { size: number; label: string; node_type: string; node_id: number }>;
    edges: Map<string, { s: string; t: string; w: number }>;
    quarters: number[];
    byQuarter: Map<number, EgoResponse>;
  } | null;
  positions: LayoutResponse | null;
}

const EDGE_COLORS: Record<string, string> = {
  represents: "#b03a48",
  worked_on: "#7d8a99",
  targeted: "#8a5fa8",
};

export function GraphView({ union, positions }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph>(new Graph({ multi: true, type: "undirected" }));
  const quarterOrd = useStore((s) => s.quarterOrd);
  const setSelectedEdge = useStore((s) => s.setSelectedEdge);

  // Mount once.
  useEffect(() => {
    if (!containerRef.current || sigmaRef.current) return;
    const sigma = new Sigma(graphRef.current, containerRef.current, {
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 8,
      labelDensity: 0.25,          // grouped anchors put many same-name nodes on screen
      labelGridCellSize: 140,      // — thin the labels instead of wallpapering them
      allowInvalidContainer: true,
      enableEdgeEvents: true,
    });
    sigma.on("clickEdge", ({ edge }) => {
      const payload = graphRef.current.getEdgeAttribute(edge, "payload");
      if (payload) setSelectedEdge(payload);
    });
    sigma.on("clickStage", () => setSelectedEdge(null));
    sigmaRef.current = sigma;
    // Debug/smoke-test handle.
    (window as unknown as Record<string, unknown>).__lda = { graph: graphRef.current, sigma };
    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [setSelectedEdge]);

  // Rebuild graph content when the union (anchor/window/view) changes — positions fixed.
  useEffect(() => {
    const graph = graphRef.current;
    graph.clear();
    if (!union || !positions) return;
    for (const [key, n] of union.nodes) {
      const pos = positions[key] ?? { x: 0, y: 0 };
      graph.addNode(key, {
        x: pos.x, y: pos.y,
        size: Math.max(2, Math.min(14, n.size * 1.6)),
        label: n.label,
        color: NODE_TYPE_COLORS[n.node_type] ?? "#999",
        nodeType: n.node_type,
        hidden: true,
      });
    }
    sigmaRef.current?.refresh();
  }, [union, positions]);

  // Quarter changes: visibility + temporal styling only.
  useEffect(() => {
    const graph = graphRef.current;
    if (!union || !positions || quarterOrd === null) return;

    const idx = union.quarters.indexOf(quarterOrd);
    const now = union.byQuarter.get(quarterOrd);
    const prevOrd = idx > 0 ? union.quarters[idx - 1] : null;
    const prev = prevOrd !== null ? union.byQuarter.get(prevOrd) : undefined;
    if (!now) return;

    const nowNodes = new Set(now.nodes.map((n) => nodeKey(n.node_type, n.node_id)));
    const prevNodes = new Set((prev?.nodes ?? []).map((n) => nodeKey(n.node_type, n.node_id)));
    const anchors = new Set(now.nodes.filter((n) => n.is_anchor).map((n) => nodeKey(n.node_type, n.node_id)));

    graph.forEachNode((key, attrs) => {
      const status = temporalStatus(nowNodes.has(key), prevNodes.has(key), prev !== undefined);
      const style = STATUS_STYLE[status];
      const base = NODE_TYPE_COLORS[attrs.nodeType as string] ?? "#999";
      graph.mergeNodeAttributes(key, {
        hidden: status === "hidden",
        color: status === "dropped" ? "#c9ced4" : base,
        highlighted: anchors.has(key) || status === "new",
        zIndex: status === "new" ? 2 : 1,
        opacityStatus: style.opacity,
      });
    });

    // Edges: drop and re-add per quarter (cheap at ego scale, keeps multi-edges honest).
    graph.clearEdges();
    const addEdges = (d: EgoResponse, dropped: boolean) => {
      for (const e of d.edges) {
        const s = nodeKey(e.source.node_type, e.source.node_id);
        const t = nodeKey(e.target.node_type, e.target.node_id);
        if (!graph.hasNode(s) || !graph.hasNode(t)) continue;
        const isNew = !dropped && prev !== undefined &&
          !(prev.edges ?? []).some(
            (pe) =>
              pe.edge_type === e.edge_type &&
              pe.source.node_id === e.source.node_id && pe.source.node_type === e.source.node_type &&
              pe.target.node_id === e.target.node_id && pe.target.node_type === e.target.node_type,
          );
        graph.addEdge(s, t, {
          size: dropped ? 0.5 : Math.max(0.6, e.amount ? Math.log10(1 + e.amount) / 2.2 : 0.6),
          color: dropped ? "#dcdfe3"
            : e.attribution_level === "filing" ? "#c9b3d9"
            : isNew ? "#e0a63c"
            : EDGE_COLORS[e.edge_type],
          payload: e,
        });
      }
    };
    addEdges(now, false);
    if (prev) {
      const nowEdgeKeys = new Set(now.edges.map(
        (e) => `${e.edge_type}|${e.source.node_type}:${e.source.node_id}|${e.target.node_type}:${e.target.node_id}`));
      const droppedEdges = (prev.edges ?? []).filter(
        (e) => !nowEdgeKeys.has(`${e.edge_type}|${e.source.node_type}:${e.source.node_id}|${e.target.node_type}:${e.target.node_id}`));
      addEdges({ ...prev, edges: droppedEdges }, true);
      // Nodes only present last quarter stay ghost-visible for one step.
      graph.forEachNode((key) => {
        if (!nowNodes.has(key) && prevNodes.has(key)) graph.setNodeAttribute(key, "hidden", false);
      });
    }
    sigmaRef.current?.refresh();
  }, [union, positions, quarterOrd]);

  return <div ref={containerRef} className="graph-container" />;
}
