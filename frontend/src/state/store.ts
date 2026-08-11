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

/** A node whose own hops-1 connections have been added to the graph. Client/lobbyist
 * expansions carry their whole exact-name group of registration-scoped IDs. */
export interface Expansion {
  node_type: NodeType;
  ids: number[];
  label: string;
}

export const MAX_EXPANSIONS = 12;

export type ColorMode = "type" | "community";

interface AppState {
  anchor: Anchor | null;
  quarterOrd: number | null; // currently displayed quarter (period_ord)
  view: ViewMode;
  hops: 1 | 2;
  colorMode: ColorMode;
  selectedEdge: EgoEdge | null;
  selectedNode: SelectedNode | null;
  expansions: Expansion[];
  setAnchor: (a: Anchor | null) => void;
  setQuarterOrd: (q: number) => void;
  setView: (v: ViewMode) => void;
  setHops: (h: 1 | 2) => void;
  setColorMode: (m: ColorMode) => void;
  setSelectedEdge: (e: EgoEdge | null) => void;
  setSelectedNode: (n: SelectedNode | null) => void;
  addExpansion: (e: Expansion) => void;
  removeExpansion: (node_type: NodeType, label: string) => void;
  clearExpansions: () => void;
}

// One side panel at a time: picking an edge closes the node panel and vice versa.
// Expansions are scoped to the current picture: anchor/hops/view changes clear them.
export const useStore = create<AppState>((set) => ({
  anchor: null,
  quarterOrd: null,
  view: "amended",
  hops: 1,
  colorMode: "type",
  selectedEdge: null,
  selectedNode: null,
  expansions: [],
  setAnchor: (anchor) =>
    set({ anchor, selectedEdge: null, selectedNode: null, expansions: [], quarterOrd: null }),
  setQuarterOrd: (quarterOrd) => set({ quarterOrd }),
  setView: (view) => set({ view, expansions: [] }),
  setHops: (hops) => set({ hops, expansions: [] }),
  setColorMode: (colorMode) => set({ colorMode }),
  setSelectedEdge: (selectedEdge) =>
    set(selectedEdge ? { selectedEdge, selectedNode: null } : { selectedEdge }),
  setSelectedNode: (selectedNode) =>
    set(selectedNode ? { selectedNode, selectedEdge: null } : { selectedNode }),
  addExpansion: (e) =>
    set((s) => {
      const dup = s.expansions.some(
        (x) => x.node_type === e.node_type && x.label === e.label);
      if (dup || s.expansions.length >= MAX_EXPANSIONS) return s;
      return { expansions: [...s.expansions, e] };
    }),
  removeExpansion: (node_type, label) =>
    set((s) => ({
      expansions: s.expansions.filter(
        (x) => !(x.node_type === node_type && x.label === label)),
    })),
  clearExpansions: () => set({ expansions: [], selectedNode: null, selectedEdge: null }),
}));
