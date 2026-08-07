import { create } from "zustand";
import type { EgoEdge, NodeType, ViewMode } from "../api/client";

export interface Anchor {
  node_type: NodeType;
  ids: number[];
  label: string;
}

export interface SelectedNode {
  node_type: NodeType;
  node_id: number; // display-space id (the collapsed anchor carries min of its group)
  label: string;
}

interface AppState {
  anchor: Anchor | null;
  quarterOrd: number | null; // currently displayed quarter (period_ord)
  view: ViewMode;
  hops: 1 | 2;
  selectedEdge: EgoEdge | null;
  selectedNode: SelectedNode | null;
  setAnchor: (a: Anchor | null) => void;
  setQuarterOrd: (q: number) => void;
  setView: (v: ViewMode) => void;
  setHops: (h: 1 | 2) => void;
  setSelectedEdge: (e: EgoEdge | null) => void;
  setSelectedNode: (n: SelectedNode | null) => void;
}

// One side panel at a time: picking an edge closes the node panel and vice versa.
export const useStore = create<AppState>((set) => ({
  anchor: null,
  quarterOrd: null,
  view: "amended",
  hops: 1,
  selectedEdge: null,
  selectedNode: null,
  setAnchor: (anchor) => set({ anchor, selectedEdge: null, selectedNode: null, quarterOrd: null }),
  setQuarterOrd: (quarterOrd) => set({ quarterOrd }),
  setView: (view) => set({ view }),
  setHops: (hops) => set({ hops }),
  setSelectedEdge: (selectedEdge) =>
    set(selectedEdge ? { selectedEdge, selectedNode: null } : { selectedEdge }),
  setSelectedNode: (selectedNode) =>
    set(selectedNode ? { selectedNode, selectedEdge: null } : { selectedNode }),
}));
