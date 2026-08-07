// Orchestrates the longitudinal ego view:
// 1. /timeline gives the anchor's presence quarters (slider extent).
// 2. /ego is fetched for every quarter in the visible window (react-query caches each).
// 3. Each quarter's response is mapped to DISPLAY SPACE (the anchor name-group
//    collapses to one node — see collapse.ts); the union across the window is laid
//    out ONCE (orbit layout) and coordinates are then held fixed.
// 4. Per-quarter node/edge sets drive visibility + temporal styling only.
//
// NOTE: useQueries returns a fresh array each render; `combine` (structurally memoized
// by TanStack) is what keeps the union stable so the layout runs exactly once.

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type EgoResponse, type ViewMode } from "../api/client";
import type { Anchor } from "../state/store";
import { makeCollapse, nodeKey, superKeyOf, toDisplaySpace } from "./collapse";
import { orbitLayout, type Positions } from "./orbitLayout";

const UNION_NODE_BUDGET = 6000;
const FALLBACK_WINDOW = 12;

export { nodeKey };

export interface UnionGraph {
  nodes: Map<string, { size: number; label: string; node_type: string; node_id: number }>;
  quarters: number[];
  byQuarter: Map<number, EgoResponse>; // display-space responses
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
      retry: 3,
      retryDelay: (attempt: number) => Math.min(8000, 1000 * 2 ** attempt),
    })),
    combine: (results) => ({
      loaded: results.filter((r) => r.data).length,
      failed: results.filter((r) => r.isError).length,
      data: results.map((r) => r.data ?? null),
    }),
  });

  const allLoaded = presenceQuarters.length > 0 && egos.loaded === presenceQuarters.length;

  const union: UnionGraph | null = useMemo(() => {
    if (!allLoaded || !anchor) return null;
    // Display space: the anchor name-group renders as one node. Raw responses in the
    // react-query cache stay untouched; originals survive on each edge (orig_*).
    const collapse = makeCollapse(anchor);
    const byQuarter = new Map<number, EgoResponse>();
    presenceQuarters.forEach((q, i) => {
      const d = egos.data[i];
      if (d) byQuarter.set(q.ord, toDisplaySpace(d, collapse));
    });

    let quarters = presenceQuarters.map((q) => q.ord);
    const collect = (ords: number[]) => {
      const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
      for (const ord of ords) {
        const d = byQuarter.get(ord)!;
        for (const n of d.nodes) {
          const k = nodeKey(n.node_type, n.node_id);
          const size = Math.sqrt(n.metrics?.degree ?? 1);
          const prev = nodes.get(k);
          if (!prev || size > prev.size)
            nodes.set(k, { size, label: n.label, node_type: n.node_type, node_id: n.node_id });
        }
      }
      return nodes;
    };

    let nodes = collect(quarters);
    if (nodes.size > UNION_NODE_BUDGET && quarters.length > FALLBACK_WINDOW) {
      quarters = quarters.slice(-FALLBACK_WINDOW);
      nodes = collect(quarters);
    }
    return { nodes, quarters, byQuarter };
  }, [allLoaded, anchor, presenceQuarters, egos.data]);

  // Anchor-centric orbit layout: pure, synchronous, deterministic — one run per union.
  const anchorKey = anchor ? `${anchor.node_type}:${anchor.ids.join(",")}` : "";
  const positions: Positions | null = useMemo(() => {
    if (!union || !anchor) return null;
    // Display space has exactly one anchor node — the collapsed group.
    const anchorKeys = new Set([superKeyOf(makeCollapse(anchor))]);
    return orbitLayout(union, anchor.node_type, anchorKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [union, anchorKey]);

  return {
    timeline: timeline.data?.quarters ?? [],
    presenceQuarters,
    loadedQuarters: egos.loaded,
    failedQuarters: egos.failed,
    union,
    positions,
    isLoading: anchor !== null && (!allLoaded || positions === null),
  };
}
