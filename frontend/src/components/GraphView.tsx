// One long-lived Sigma renderer. The graphology graph is mutated in place; quarter
// changes only flip per-node/edge display attributes — never positions, never a
// renderer rebuild, never a per-quarter layout run.
//
// Readability model (spotlight-first):
// - Ambient view is nearly label-free: labelDensity 0 disables grid labels; only
//   forceLabel nodes render (top-8 hubs per quarter + one member per group anchor).
// - Hover spotlights a node: neighbors keep color and gain labels, everything else
//   dims via node/edge reducers. Click pins the spotlight; stage click unpins.
// - Never set `highlighted`: sigma routes highlighted nodes through the hover
//   renderer, which is what produced the wall of paper tags.

import Graph from "graphology";
import { useEffect, useRef } from "react";
import Sigma from "sigma";
import type { EgoEdge, EgoResponse } from "../api/client";
import { nodeKey } from "../graph/useEgoWindow";
import type { LayoutResponse } from "../graph/layout.worker";
import {
  DIMMED_EDGE, DIMMED_NODE, NO_SPOTLIGHT, spotlightEdgeStyle, spotlightNodeStyle,
  topKByDegree, type SpotlightState,
} from "../graph/spotlight";
import { NODE_TYPE_COLORS, temporalStatus } from "../graph/temporalStatus";
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

// Sigma's edge shader drops rgba alpha (and the node shader renders rgba as white),
// so every "translucent" tone is pre-blended opaque hex over Deep Space #0D0D14.
const EDGE_COLORS: Record<string, string> = {
  represents: "#923109", // Signal Orange @ 55%
  worked_on: "#39393e",  // Photographic Gray @ 35%
  targeted: "#2e597b",   // Celestial Blue @ 55%
};
const EDGE_RAISED: Record<string, string> = {
  represents: "#f34c02", // Signal Orange @ 95%
  worked_on: "#a3a3a7",  // light gray @ ~72%
  targeted: "#4690c7",   // Celestial Blue @ 95%
};
const EDGE_NEW = "#FFA300";               // Chrome Yellow
const EDGE_LEGACY_ATTRIBUTION = "#1a2b3d"; // Celestial Blue @ 22%
const EDGE_DROPPED = "#212127";            // gray @ 16%
const NODE_DROPPED = "#3c414d";

const AMBIENT_HUB_LABELS = 8;
const NEIGHBOR_LABEL_CAP = 15;

export function GraphView({ union, positions }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph>(new Graph({ multi: true, type: "undirected" }));
  const spotlightRef = useRef<SpotlightState>(NO_SPOTLIGHT);
  const quarterOrd = useStore((s) => s.quarterOrd);
  const setSelectedEdge = useStore((s) => s.setSelectedEdge);

  // Mount once.
  useEffect(() => {
    if (!containerRef.current || sigmaRef.current) return;
    const graph = graphRef.current;

    const setSpotlight = (node: string | null, pinned: boolean) => {
      if (node === null) {
        spotlightRef.current = NO_SPOTLIGHT;
      } else {
        const neighbors = new Set(
          graph.neighbors(node).filter((n) => !graph.getNodeAttribute(n, "hidden")),
        );
        spotlightRef.current = {
          node, pinned, neighbors,
          labeledNeighbors: topKByDegree(
            neighbors, (k) => (graph.getNodeAttribute(k, "qDegree") as number) ?? 0,
            NEIGHBOR_LABEL_CAP),
        };
      }
      sigmaRef.current?.refresh({ skipIndexation: true, schedule: true });
    };

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      labelDensity: 0,                 // no ambient grid labels — forceLabel only
      labelColor: { color: "#F5F2EC" },
      labelFont: "IBM Plex Mono, monospace",
      labelSize: 10,
      labelWeight: "500",
      zIndex: true,
      minCameraRatio: 0.05,
      maxCameraRatio: 1.5,
      allowInvalidContainer: true,
      enableEdgeEvents: true,
      // Hovered node gets a Newsprint "paper tag": aged-paper box, teletype ink.
      defaultDrawNodeHover: (context, data, settings) => {
        const label = data.label as string | null;
        if (!label) return;
        const size = (settings.labelSize as number) ?? 10;
        const font = (settings.labelFont as string) ?? "monospace";
        context.font = `500 ${size}px ${font}`;
        const width = context.measureText(label).width + 8;
        const x = data.x + data.size + 3;
        const y = data.y - size / 2 - 3;
        context.fillStyle = "#EDE8DC";
        context.fillRect(x, y, width, size + 6);
        context.fillStyle = "#1A1A1A";
        context.fillText(label, x + 4, y + size);
      },
      nodeReducer: (node, data) => {
        if (data.hidden) return data;
        const style = spotlightNodeStyle(spotlightRef.current, {
          key: node, tStatus: (data as { tStatus?: string }).tStatus,
        });
        return {
          ...data,
          color: style.dim ? DIMMED_NODE : (data.color as string),
          label: style.label === "suppress" ? null : (data.label as string),
          forceLabel: style.forceLabel ?? (style.label === "keep" && (data.forceLabel as boolean)),
        };
      },
      edgeReducer: (edge, data) => {
        if (data.hidden) return data;
        const [source, target] = graph.extremities(edge);
        const { emphasis } = spotlightEdgeStyle(spotlightRef.current, source, target);
        if (emphasis === "raise") {
          const etype = (data as { etype?: string }).etype ?? "worked_on";
          const isNew = (data as { isNew?: boolean }).isNew;
          return {
            ...data,
            color: isNew ? EDGE_NEW : (EDGE_RAISED[etype] ?? (data.color as string)),
            size: (data.size as number) * 1.6,
            zIndex: 2,
          };
        }
        if (emphasis === "dim") return { ...data, color: DIMMED_EDGE, zIndex: 0 };
        return data;
      },
    });

    sigma.on("enterNode", ({ node }) => {
      if (!spotlightRef.current.pinned) setSpotlight(node, false);
    });
    sigma.on("leaveNode", () => {
      if (!spotlightRef.current.pinned) setSpotlight(null, false);
    });
    sigma.on("clickNode", ({ node }) => {
      if (spotlightRef.current.pinned && spotlightRef.current.node === node) {
        setSpotlight(null, false);
      } else {
        setSpotlight(node, true);
      }
    });
    sigma.on("clickEdge", ({ edge }) => {
      const payload = graph.getEdgeAttribute(edge, "payload");
      if (payload) setSelectedEdge(payload);
    });
    sigma.on("clickStage", () => {
      setSpotlight(null, false);
      setSelectedEdge(null);
    });

    sigmaRef.current = sigma;
    (window as unknown as Record<string, unknown>).__lda = { graph, sigma };
    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [setSelectedEdge]);

  // Rebuild graph content when the union (anchor/window/view) changes — positions fixed.
  useEffect(() => {
    const graph = graphRef.current;
    graph.clear();
    spotlightRef.current = NO_SPOTLIGHT;
    if (!union || !positions) return;
    for (const [key, n] of union.nodes) {
      const pos = positions[key] ?? { x: 0, y: 0 };
      const baseSize = Math.max(2, Math.min(14, n.size * 1.6));
      graph.addNode(key, {
        x: pos.x, y: pos.y,
        size: baseSize,
        baseSize,
        label: n.label,
        color: NODE_TYPE_COLORS[n.node_type] ?? "#8C8C8C",
        nodeType: n.node_type,
        hidden: true,
      });
    }
    sigmaRef.current?.refresh();
  }, [union, positions]);

  // Quarter changes: visibility + temporal styling + curated labels. Never positions.
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
    const qDegree = new Map(now.nodes.map((n) => [nodeKey(n.node_type, n.node_id), n.metrics?.degree ?? 0]));

    // Curated ambient labels: top hubs this quarter + one member per group anchor.
    const hubLabels = topKByDegree(nowNodes, (k) => qDegree.get(k) ?? 0, AMBIENT_HUB_LABELS);
    if (anchors.size > 0) {
      const [topAnchor] = topKByDegree(anchors, (k) => qDegree.get(k) ?? 0, 1);
      if (topAnchor) hubLabels.add(topAnchor);
    }

    graph.forEachNode((key, attrs) => {
      const status = temporalStatus(nowNodes.has(key), prevNodes.has(key), prev !== undefined);
      const isAnchor = anchors.has(key);
      graph.mergeNodeAttributes(key, {
        hidden: status === "hidden",
        tStatus: status,
        qDegree: qDegree.get(key) ?? 0,
        color: status === "dropped" ? NODE_DROPPED : (NODE_TYPE_COLORS[attrs.nodeType as string] ?? "#8C8C8C"),
        size: isAnchor
          ? Math.max(4, (attrs.baseSize as number) * 1.35)
          : (attrs.baseSize as number),
        forceLabel: hubLabels.has(key) && status !== "hidden" && status !== "dropped",
        zIndex: status === "new" ? 2 : 1,
      });
    });

    // A pinned spotlight on a node that left the graph is meaningless — clear it.
    if (spotlightRef.current.node && graph.getNodeAttribute(spotlightRef.current.node, "hidden")) {
      spotlightRef.current = NO_SPOTLIGHT;
    }

    // Edges: rebuilt per quarter, with parallel same-type edges aggregated into one
    // (overlapping straight lines hide multiplicity AND block clicks on all but the
    // topmost — the debug panel lists every underlying filing regardless).
    graph.clearEdges();
    type Agg = { rep: EgoEdge; count: number; amountSum: number; anyNew: boolean; dropped: boolean };
    const aggregates = new Map<string, Agg>();

    const prevEdgeKeys = new Set((prev?.edges ?? []).map(
      (e) => `${e.edge_type}|${e.source.node_type}:${e.source.node_id}|${e.target.node_type}:${e.target.node_id}`));
    const collect = (edges: EgoEdge[], dropped: boolean) => {
      for (const e of edges) {
        const s = nodeKey(e.source.node_type, e.source.node_id);
        const t = nodeKey(e.target.node_type, e.target.node_id);
        if (!graph.hasNode(s) || !graph.hasNode(t)) continue;
        const pair = s < t ? `${s}|${t}` : `${t}|${s}`;
        const k = `${pair}|${e.edge_type}|${dropped}|${e.attribution_level === "filing"}`;
        const isNew = !dropped && prev !== undefined &&
          !prevEdgeKeys.has(`${e.edge_type}|${e.source.node_type}:${e.source.node_id}|${e.target.node_type}:${e.target.node_id}`);
        const agg = aggregates.get(k);
        if (agg) {
          agg.count += 1;
          if (e.amount !== null && e.amount_type === agg.rep.amount_type) agg.amountSum += e.amount;
          agg.anyNew ||= isNew;
        } else {
          aggregates.set(k, { rep: e, count: 1, amountSum: e.amount ?? 0, anyNew: isNew, dropped });
        }
      }
    };

    collect(now.edges, false);
    if (prev) {
      const nowEdgeKeys = new Set(now.edges.map(
        (e) => `${e.edge_type}|${e.source.node_type}:${e.source.node_id}|${e.target.node_type}:${e.target.node_id}`));
      collect((prev.edges ?? []).filter(
        (e) => !nowEdgeKeys.has(`${e.edge_type}|${e.source.node_type}:${e.source.node_id}|${e.target.node_type}:${e.target.node_id}`)), true);
      graph.forEachNode((key) => {
        if (!nowNodes.has(key) && prevNodes.has(key)) graph.setNodeAttribute(key, "hidden", false);
      });
    }

    for (const agg of aggregates.values()) {
      const e = agg.rep;
      const s = nodeKey(e.source.node_type, e.source.node_id);
      const t = nodeKey(e.target.node_type, e.target.node_id);
      graph.addEdge(s, t, {
        size: agg.dropped ? 0.5
          : Math.min(3, Math.max(0.6, agg.amountSum > 0 ? Math.log10(1 + agg.amountSum) / 2.2 : 0.6 + Math.log2(agg.count) * 0.2)),
        color: agg.dropped ? EDGE_DROPPED
          : e.attribution_level === "filing" ? EDGE_LEGACY_ATTRIBUTION
          : agg.anyNew ? EDGE_NEW
          : EDGE_COLORS[e.edge_type],
        etype: e.edge_type,
        isNew: agg.anyNew,
        zIndex: agg.anyNew ? 2 : 1,
        payload: { ...e, agg_count: agg.count },
      });
    }
    sigmaRef.current?.refresh();
  }, [union, positions, quarterOrd]);

  const camera = (fn: "animatedZoom" | "animatedUnzoom" | "animatedReset") => () =>
    sigmaRef.current?.getCamera()[fn]({ duration: fn === "animatedReset" ? 400 : 250 });

  return (
    <div className="graph-wrap">
      <div ref={containerRef} className="graph-container" />
      <div className="camera-controls">
        <button onClick={camera("animatedZoom")} title="Zoom in">+</button>
        <button onClick={camera("animatedUnzoom")} title="Zoom out">−</button>
        <button onClick={camera("animatedReset")} title="Fit graph">⌂</button>
      </div>
    </div>
  );
}
