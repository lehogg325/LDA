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
import { communityColor } from "../graph/communityColor";
import { nodeKey } from "../graph/useEgoWindow";
import type { Positions } from "../graph/orbitLayout";
import {
  chainEdges, DIMMED_EDGE, DIMMED_NODE, NO_SPOTLIGHT, spotlightEdgeStyle,
  spotlightNodeStyle, topKByDegree, type SpotlightState,
} from "../graph/spotlight";
import { NODE_TYPE_COLORS, temporalStatus } from "../graph/temporalStatus";
import { useStore } from "../state/store";

interface Props {
  union: {
    nodes: Map<string, { size: number; label: string; node_type: string; node_id: number }>;
    quarters: number[];
    byQuarter: Map<number, EgoResponse>; // display-space (anchor group = one node)
  } | null;
  positions: Positions | null;
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
  // Per-quarter filing index: filing_uuid -> display-edge keys (ghosts excluded).
  const filingIndexRef = useRef<Map<string, string[]>>(new Map());
  const anchorsRef = useRef<Set<string>>(new Set());
  const visibleEdgeCountRef = useRef(0);
  const setSpotlightRef = useRef<(node: string | null, pinned: boolean) => void>(() => {});
  const quarterOrd = useStore((s) => s.quarterOrd);
  const selectedNode = useStore((s) => s.selectedNode);
  const colorMode = useStore((s) => s.colorMode);
  const colorModeRef = useRef(colorMode);
  const setSelectedEdge = useStore((s) => s.setSelectedEdge);
  const setSelectedNode = useStore((s) => s.setSelectedNode);

  // Mount once.
  useEffect(() => {
    if (!containerRef.current || sigmaRef.current) return;
    const graph = graphRef.current;

    // Spotlight state is DERIVED — only {node, pinned} persists; the lit sets are
    // recomputed from the current graph + filing index (edge keys regenerate every
    // quarter, so cached sets would go stale on scrub).
    const setSpotlight = (node: string | null, pinned: boolean) => {
      if (node === null || !graph.hasNode(node) || graph.getNodeAttribute(node, "hidden")) {
        spotlightRef.current = NO_SPOTLIGHT;
        sigmaRef.current?.refresh({ skipIndexation: true, schedule: true });
        return;
      }
      const qDeg = (k: string) => (graph.getNodeAttribute(k, "qDegree") as number) ?? 0;

      const neighborSpotlight = (): SpotlightState => {
        const nodes = new Set(
          graph.neighbors(node).filter((n) => !graph.getNodeAttribute(n, "hidden")));
        nodes.add(node);
        const edges = new Set(
          graph.edges(node).filter((e) => !graph.getEdgeAttribute(e, "isGhost")));
        return { node, pinned, mode: "neighbors", nodes, edges,
                 labeled: topKByDegree(nodes, qDeg, NEIGHBOR_LABEL_CAP) };
      };

      // Anchor members skip chains — their chain is by definition the whole graph.
      if (anchorsRef.current.has(node)) {
        spotlightRef.current = neighborSpotlight();
      } else {
        const incident = graph.edges(node)
          .filter((e) => !graph.getEdgeAttribute(e, "isGhost"))
          .map((e) => ({ key: e, uuids: (graph.getEdgeAttribute(e, "uuids") as string[]) ?? [] }));
        const chain = chainEdges(incident, filingIndexRef.current, {
          maxEdges: Math.max(20, 0.5 * visibleEdgeCountRef.current),
          maxUuids: 400,
        });
        if (chain === null) {
          spotlightRef.current = neighborSpotlight(); // mega-hub: stay selective
        } else {
          const nodes = new Set<string>([node]);
          for (const e of chain) {
            const [s, t] = graph.extremities(e);
            nodes.add(s); nodes.add(t);
          }
          spotlightRef.current = { node, pinned, mode: "chain", nodes, edges: chain,
                                   labeled: topKByDegree(nodes, qDeg, NEIGHBOR_LABEL_CAP) };
        }
      }
      sigmaRef.current?.refresh({ skipIndexation: true, schedule: true });
    };
    setSpotlightRef.current = setSpotlight;

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
        const attrs = data as { tStatus?: string; communityId?: number | null };
        const style = spotlightNodeStyle(spotlightRef.current, {
          key: node, tStatus: attrs.tStatus,
        });
        // Community coloring is computed live here (not baked in per-quarter) so
        // toggling the mode recolors instantly without rebuilding the graph.
        // Dropped nodes stay their fixed dim gray regardless of mode — community
        // hue is only meaningful for what's actually present this quarter.
        const baseColor = attrs.tStatus !== "dropped" && colorModeRef.current === "community"
          ? communityColor(attrs.communityId ?? null)
          : (data.color as string);
        return {
          ...data,
          color: style.dim ? DIMMED_NODE : baseColor,
          label: style.label === "suppress" ? null : (data.label as string),
          forceLabel: style.forceLabel ?? (style.label === "keep" && (data.forceLabel as boolean)),
        };
      },
      edgeReducer: (edge, data) => {
        if (data.hidden) return data;
        const { emphasis } = spotlightEdgeStyle(spotlightRef.current, edge);
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
        setSelectedNode(null);
      } else {
        setSpotlight(node, true);
        // Open the activity panel for the clicked node (keys are "type:id").
        setSelectedNode({
          node_type: graph.getNodeAttribute(node, "nodeType"),
          node_id: Number(node.split(":")[1]),
          label: graph.getNodeAttribute(node, "label"),
        });
      }
    });
    sigma.on("clickEdge", ({ edge }) => {
      const payload = graph.getEdgeAttribute(edge, "payload");
      if (payload) setSelectedEdge(payload);
    });
    sigma.on("clickStage", () => {
      setSpotlight(null, false);
      setSelectedEdge(null);
      setSelectedNode(null);
    });

    sigmaRef.current = sigma;
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__lda = { graph, sigma };
    }

    // Sigma sizes its canvas from the container's dimensions AT CONSTRUCTION TIME.
    // The quarter slider and timeline strip mount later (once data loads) and shrink
    // this container via flex — without this, the canvas keeps its taller, stale
    // size forever, and the graph's fitted center (the anchor, most of the time)
    // renders below the real container, hidden under the rows beneath it.
    const resizeObserver = new ResizeObserver(() => {
      sigmaRef.current?.resize();
      sigmaRef.current?.refresh();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [setSelectedEdge, setSelectedNode]);

  // colorMode lives in a ref, not a nodeReducer dependency: toggling it just needs a
  // refresh (nodeReducer reads the ref live), never a graph rebuild.
  useEffect(() => {
    colorModeRef.current = colorMode;
    sigmaRef.current?.refresh();
  }, [colorMode]);

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
        communityId: null,
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
    anchorsRef.current = anchors;
    const qDegree = new Map(now.nodes.map((n) => [nodeKey(n.node_type, n.node_id), n.metrics?.degree ?? 0]));
    const communityOf = new Map(
      now.nodes.map((n) => [nodeKey(n.node_type, n.node_id), n.metrics?.community_id ?? null]));

    // Curated ambient labels: top hubs this quarter + the anchor itself (display
    // space collapses a group anchor to a single node).
    const hubLabels = topKByDegree(nowNodes, (k) => qDegree.get(k) ?? 0, AMBIENT_HUB_LABELS);
    for (const a of anchors) hubLabels.add(a);

    graph.forEachNode((key, attrs) => {
      const status = temporalStatus(nowNodes.has(key), prevNodes.has(key), prev !== undefined);
      const isAnchor = anchors.has(key);
      graph.mergeNodeAttributes(key, {
        hidden: status === "hidden",
        tStatus: status,
        qDegree: qDegree.get(key) ?? 0,
        communityId: communityOf.get(key) ?? null,
        color: status === "dropped" ? NODE_DROPPED : (NODE_TYPE_COLORS[attrs.nodeType as string] ?? "#8C8C8C"),
        size: isAnchor
          ? Math.max(4, (attrs.baseSize as number) * 1.35)
          : (attrs.baseSize as number),
        forceLabel: hubLabels.has(key) && status !== "hidden" && status !== "dropped",
        zIndex: status === "new" ? 2 : 1,
      });
    });

    // Edges: rebuilt per quarter, with parallel same-type edges aggregated into one
    // (overlapping straight lines hide multiplicity AND block clicks on all but the
    // topmost — the debug panel lists every underlying filing regardless).
    graph.clearEdges();
    type Agg = { rep: EgoEdge; count: number; amountSum: number; anyNew: boolean;
                 dropped: boolean; uuids: string[];
                 sourceIds: Set<number>; targetIds: Set<number> };
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
        // Underlying (pre-collapse) endpoints: a group anchor's display edge can
        // aggregate several registration-scoped IDs — the debug view needs them all.
        const origS = (e.orig_source ?? e.source).node_id;
        const origT = (e.orig_target ?? e.target).node_id;
        const agg = aggregates.get(k);
        if (agg) {
          agg.count += 1;
          agg.uuids.push(e.filing_uuid);
          agg.sourceIds.add(origS);
          agg.targetIds.add(origT);
          if (e.amount !== null && e.amount_type === agg.rep.amount_type) agg.amountSum += e.amount;
          agg.anyNew ||= isNew;
        } else {
          aggregates.set(k, { rep: e, count: 1, amountSum: e.amount ?? 0, anyNew: isNew,
                              dropped, uuids: [e.filing_uuid],
                              sourceIds: new Set([origS]), targetIds: new Set([origT]) });
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

    const filingIndex = new Map<string, string[]>();
    let visibleEdges = 0;
    for (const agg of aggregates.values()) {
      const e = agg.rep;
      const s = nodeKey(e.source.node_type, e.source.node_id);
      const t = nodeKey(e.target.node_type, e.target.node_id);
      const edgeKey = graph.addEdge(s, t, {
        size: agg.dropped ? 0.5
          : Math.min(3, Math.max(0.6, agg.amountSum > 0 ? Math.log10(1 + agg.amountSum) / 2.2 : 0.6 + Math.log2(agg.count) * 0.2)),
        color: agg.dropped ? EDGE_DROPPED
          : e.attribution_level === "filing" ? EDGE_LEGACY_ATTRIBUTION
          : agg.anyNew ? EDGE_NEW
          : EDGE_COLORS[e.edge_type],
        etype: e.edge_type,
        isNew: agg.anyNew,
        isGhost: agg.dropped,
        uuids: agg.uuids,
        zIndex: agg.anyNew ? 2 : 1,
        payload: { ...e, agg_count: agg.count, agg_amount: agg.amountSum,
                   source_ids: [...agg.sourceIds].sort((a, b) => a - b),
                   target_ids: [...agg.targetIds].sort((a, b) => a - b) },
      });
      if (!agg.dropped) {
        visibleEdges++;
        for (const u of agg.uuids) {
          const list = filingIndex.get(u);
          if (list) list.push(edgeKey);
          else filingIndex.set(u, [edgeKey]);
        }
      }
    }
    filingIndexRef.current = filingIndex;
    visibleEdgeCountRef.current = visibleEdges;

    // Re-derive any held spotlight against the fresh edges/index (edge keys were just
    // regenerated); clears itself if the pinned node left the quarter.
    if (spotlightRef.current.node) {
      setSpotlightRef.current(spotlightRef.current.node, spotlightRef.current.pinned);
    }
    sigmaRef.current?.refresh();
  }, [union, positions, quarterOrd]);

  // Pin the spotlight to whatever the store's selectedNode is, even when it was set
  // programmatically (the guided tour) rather than by clicking the node directly —
  // keeps the graph's visual highlight in sync with the side panel either way.
  useEffect(() => {
    if (!selectedNode) return;
    const key = nodeKey(selectedNode.node_type, selectedNode.node_id);
    const graph = graphRef.current;
    if (graph.hasNode(key) && !graph.getNodeAttribute(key, "hidden")) {
      setSpotlightRef.current(key, true);
    }
  }, [selectedNode]);

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
