// Orchestrates the longitudinal ego view:
// 1. /timeline gives the anchor's presence quarters (slider extent).
// 2. /ego is fetched for every quarter in the visible window (react-query caches each).
// 3. The union graph across the window is laid out ONCE in a web worker
//    (deterministically seeded ForceAtlas2); coordinates are then held fixed.
// 4. Per-quarter node/edge sets drive visibility + temporal styling only.
//
// NOTE: useQueries returns a fresh array each render; `combine` (structurally memoized
// by TanStack) is what keeps the union stable so the layout runs exactly once.

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type EgoResponse, type ViewMode } from "../api/client";
import type { Anchor } from "../state/store";
import { orbitLayout, type Positions } from "./orbitLayout";

const UNION_NODE_BUDGET = 6000;
const FALLBACK_WINDOW = 12;

export const nodeKey = (t: string, id: number) => `${t}:${id}`;

export interface UnionGraph {
  nodes: Map<string, { size: number; label: string; node_type: string; node_id: number }>;
  edges: Map<string, { s: string; t: string; w: number }>;
  quarters: number[];
  byQuarter: Map<number, EgoResponse>;
}

export function useEgoWindow(anchor: Anchor | null, hops: 1 | 2, view: ViewMode) {
  const timeline = useQuery({
    queryKey: ["timeline", anchor?.node_type, anchor?.ids.join(",")],
    queryFn: () => api.timeline(anchor!.node_type, anchor!.ids),
    enabled: anchor !== null,
    staleTime: Infinity,
  });

  const presenceQuarters = useMemo(
    () => (timeline.data?.quarters ?? []).map((q) => ({ year: q.year, period: q.period, ord: q.period_ord })),
    [timeline.data],
  );

  const egos = useQueries({
    queries: presenceQuarters.map((q) => ({
      queryKey: ["ego", anchor?.node_type, anchor?.ids.join(","), q.ord, hops, view],
      queryFn: () => api.ego(anchor!.node_type, anchor!.ids, q.year, q.period, hops, view),
      enabled: anchor !== null,
      staleTime: Infinity,
    })),
    combine: (results) => ({
      loaded: results.filter((r) => r.data).length,
      data: results.map((r) => r.data ?? null),
    }),
  });

  const allLoaded = presenceQuarters.length > 0 && egos.loaded === presenceQuarters.length;

  const union: UnionGraph | null = useMemo(() => {
    if (!allLoaded) return null;
    const byQuarter = new Map<number, EgoResponse>();
    presenceQuarters.forEach((q, i) => {
      const d = egos.data[i];
      if (d) byQuarter.set(q.ord, d);
    });

    let quarters = presenceQuarters.map((q) => q.ord);
    const collect = (ords: number[]) => {
      const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
      const edges = new Map<string, { s: string; t: string; w: number }>();
      for (const ord of ords) {
        const d = byQuarter.get(ord)!;
        for (const n of d.nodes) {
          const k = nodeKey(n.node_type, n.node_id);
          const size = Math.sqrt(n.metrics?.degree ?? 1);
          const prev = nodes.get(k);
          if (!prev || size > prev.size)
            nodes.set(k, { size, label: n.label, node_type: n.node_type, node_id: n.node_id });
        }
        for (const e of d.edges) {
          const s = nodeKey(e.source.node_type, e.source.node_id);
          const t = nodeKey(e.target.node_type, e.target.node_id);
          const k = s < t ? `${s}|${t}` : `${t}|${s}`;
          const w = e.amount ? Math.log10(1 + e.amount) : 1;
          const prev = edges.get(k);
          if (!prev || w > prev.w) edges.set(k, { s, t, w });
        }
      }
      return { nodes, edges };
    };

    let { nodes, edges } = collect(quarters);
    if (nodes.size > UNION_NODE_BUDGET && quarters.length > FALLBACK_WINDOW) {
      quarters = quarters.slice(-FALLBACK_WINDOW);
      ({ nodes, edges } = collect(quarters));
    }
    return { nodes, edges, quarters, byQuarter };
  }, [allLoaded, presenceQuarters, egos.data]);

  // Anchor-centric orbit layout: pure, synchronous, deterministic — one run per union.
  const anchorKey = anchor ? `${anchor.node_type}:${anchor.ids.join(",")}` : "";
  const positions: Positions | null = useMemo(() => {
    if (!union || !anchor) return null;
    const anchorKeys = new Set(anchor.ids.map((id) => nodeKey(anchor.node_type, id)));
    return orbitLayout(union, anchor.node_type, anchorKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [union, anchorKey]);

  return {
    timeline: timeline.data?.quarters ?? [],
    presenceQuarters,
    loadedQuarters: egos.loaded,
    union,
    positions,
    isLoading: anchor !== null && (!allLoaded || positions === null),
  };
}
