import { create } from "zustand";
import type { EgoEdge, NodeType, ViewMode } from "../api/client";

export interface Anchor {
  node_type: NodeType;
  ids: number[];
  label: string;
}

interface AppState {
  anchor: Anchor | null;
  quarterOrd: number | null; // currently displayed quarter (period_ord)
  view: ViewMode;
  hops: 1 | 2;
  selectedEdge: EgoEdge | null;
  setAnchor: (a: Anchor | null) => void;
  setQuarterOrd: (q: number) => void;
  setView: (v: ViewMode) => void;
  setHops: (h: 1 | 2) => void;
  setSelectedEdge: (e: EgoEdge | null) => void;
}

export const useStore = create<AppState>((set) => ({
  anchor: null,
  quarterOrd: null,
  view: "amended",
  hops: 1,
  selectedEdge: null,
  setAnchor: (anchor) => set({ anchor, selectedEdge: null, quarterOrd: null }),
  setQuarterOrd: (quarterOrd) => set({ quarterOrd }),
  setView: (view) => set({ view }),
  setHops: (hops) => set({ hops }),
  setSelectedEdge: (selectedEdge) => set({ selectedEdge }),
}));
