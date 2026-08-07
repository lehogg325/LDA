// Orchestrates the longitudinal ego view:
// 1. /timeline gives the anchor's presence quarters (slider extent).
// 2. /ego is fetched for every quarter in the visible window (react-query caches each).
// 3. Each quarter's response is mapped to DISPLAY SPACE (the anchor name-group
//    collapses to one node — see collapse.ts); the union across the window is laid
//    out ONCE (orbit layout) and coordinates are then held fixed.
// 4. Per-quarter node/edge sets drive visibility + temporal styling only.
// 5. Node EXPANSIONS (hops-1 ego of any other node, per quarter) merge in atomically
//    — an expansion joins only once all its quarters are loaded, keeping the graph
//    rebuild to one per expansion and avoiding false "new this quarter" flashes.
//    Base positions are FROZEN; expansion nodes are attached around them.
//
// NOTE: useQueries returns a fresh array each render; `combine` (structurally memoized
// by TanStack) is what keeps the union stable so the layout runs exactly once. Anchor
// and expansion queries live in two SEPARATE useQueries hooks so streaming expansion
// results never churn the anchor slice's identity (which would rebuild the graph).

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type EgoResponse, type NodeType, type ViewMode } from "../api/client";
import type { Anchor, Expansion } from "../state/store";
import {
  makeCollapse, mergeQuarter, nodeKey, superKeyOf, toDisplaySpace,
} from "./collapse";
import { orbitAttach, orbitLayout, type OrbitResult, type Positions } from "./orbitLayout";

const UNION_NODE_BUDGET = 6000;
const FALLBACK_WINDOW = 12;

export { nodeKey };

export interface UnionGraph {
  nodes: Map<string, { size: number; label: string; node_type: string; node_id: number }>;
  quarters: number[];
  byQuarter: Map<number, EgoResponse>; // display-space responses
}

export type ExpansionState = "adding" | "in-graph" | "too-large";
export interface ExpansionInfo {
  node_type: NodeType;
  label: string;
  state: ExpansionState;
  truncated: boolean; // any quarter hit the server's neighbor/node caps
}

function collectNodes(byQuarter: Map<number, EgoResponse>, ords: number[]) {
  const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
  for (const ord of ords) {
    const d = byQuarter.get(ord);
    if (!d) continue;
    for (const n of d.nodes) {
      const k = nodeKey(n.node_type, n.node_id);
      const size = Math.sqrt(n.metrics?.degree ?? 1);
      const prev = nodes.get(k);
      if (!prev || size > prev.size)
        nodes.set(k, { size, label: n.label, node_type: n.node_type, node_id: n.node_id });
    }
  }
  return nodes;
}

export function useEgoWindow(
  anchor: Anchor | null, hops: 1 | 2, view: ViewMode, expansions: Expansion[] = [],
) {
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
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.ego(anchor!.node_type, anchor!.ids, q.year, q.period, hops, view, signal),
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

  // allLoaded is ANCHOR-ONLY: expansion loading must never blank the graph.
  const allLoaded = presenceQuarters.length > 0 && egos.loaded === presenceQuarters.length;

  const baseUnion: UnionGraph | null = useMemo(() => {
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
    let nodes = collectNodes(byQuarter, quarters);
    if (nodes.size > UNION_NODE_BUDGET && quarters.length > FALLBACK_WINDOW) {
      quarters = quarters.slice(-FALLBACK_WINDOW);
      nodes = collectNodes(byQuarter, quarters);
    }
    return { nodes, quarters, byQuarter };
  }, [allLoaded, anchor, presenceQuarters, egos.data]);

  // Anchor-centric orbit layout: pure, synchronous, deterministic — one run per union.
  const anchorKey = anchor ? `${anchor.node_type}:${anchor.ids.join(",")}` : "";
  const baseLayout: OrbitResult | null = useMemo(() => {
    if (!baseUnion || !anchor) return null;
    // Display space has exactly one anchor node — the collapsed group.
    const anchorKeys = new Set([superKeyOf(makeCollapse(anchor))]);
    return orbitLayout(baseUnion, anchor.node_type, anchorKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUnion, anchorKey]);

  // Expansion egos: hops fixed at 1, one query per (expansion × window quarter).
  // Key shape matches anchor ego keys, so re-anchoring an expanded entity hits cache.
  const nQ = presenceQuarters.length;
  const expEgos = useQueries({
    queries: expansions.flatMap((exp) =>
      presenceQuarters.map((q) => ({
        queryKey: ["ego", exp.node_type, exp.ids.join(","), q.ord, 1, view],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          api.ego(exp.node_type, exp.ids, q.year, q.period, 1, view, signal),
        enabled: anchor !== null,
        staleTime: Infinity,
        retry: 3,
        retryDelay: (attempt: number) => Math.min(8000, 1000 * 2 ** attempt),
      }))),
    combine: (results) => ({
      data: results.map((r) => r.data ?? null),
    }),
  });

  const merged = useMemo(() => {
    if (!baseUnion || !anchor || expansions.length === 0) {
      return { union: baseUnion, expansionInfo: [] as ExpansionInfo[] };
    }
    const collapse = makeCollapse(anchor);
    const ordIndex = new Map(presenceQuarters.map((q, i) => [q.ord, i]));
    const info: ExpansionInfo[] = [];
    // Quarters are inherited from the base union VERBATIM — the node-budget
    // window-slicing fallback must never re-run on the merged union (it would
    // silently truncate the anchor's timeline as a side effect of expanding).
    // An expansion that would push past the budget is refused instead.
    let byQuarter = baseUnion.byQuarter;
    let nodes = baseUnion.nodes;
    expansions.forEach((exp, xi) => {
      const slice = expEgos.data.slice(xi * nQ, (xi + 1) * nQ);
      const ready = nQ > 0 && slice.every((d) => d !== null);
      if (!ready) {
        info.push({ node_type: exp.node_type, label: exp.label, state: "adding", truncated: false });
        return;
      }
      const truncated = slice.some((d) => d!.truncated);
      const memberKeys = new Set(exp.ids.map((id) => nodeKey(exp.node_type, id)));
      const nextBy = new Map<number, EgoResponse>();
      for (const ord of baseUnion.quarters) {
        const i = ordIndex.get(ord)!;
        nextBy.set(ord, mergeQuarter(byQuarter.get(ord)!, [{ resp: slice[i]!, memberKeys }], collapse));
      }
      const nextNodes = collectNodes(nextBy, baseUnion.quarters);
      if (nextNodes.size > UNION_NODE_BUDGET) {
        info.push({ node_type: exp.node_type, label: exp.label, state: "too-large", truncated });
        return;
      }
      byQuarter = nextBy;
      nodes = nextNodes;
      info.push({ node_type: exp.node_type, label: exp.label, state: "in-graph", truncated });
    });
    if (byQuarter === baseUnion.byQuarter) return { union: baseUnion, expansionInfo: info };
    return {
      union: { nodes, quarters: baseUnion.quarters, byQuarter } as UnionGraph,
      expansionInfo: info,
    };
  }, [baseUnion, anchor, expansions, expEgos.data, presenceQuarters, nQ]);

  // Base positions are FROZEN; expansion nodes attach around them (bit-identical
  // pass-through for every pre-existing key — expanding never moves the picture).
  const positions: Positions | null = useMemo(() => {
    if (!baseLayout) return null;
    if (!merged.union || merged.union === baseUnion) return baseLayout.positions;
    return orbitAttach(merged.union, baseLayout);
  }, [baseLayout, merged.union, baseUnion]);

  return {
    timeline: timeline.data?.quarters ?? [],
    presenceQuarters,
    loadedQuarters: egos.loaded,
    failedQuarters: egos.failed,
    union: merged.union,
    positions,
    expansionInfo: merged.expansionInfo,
    isLoading: anchor !== null && (!allLoaded || positions === null),
  };
}
