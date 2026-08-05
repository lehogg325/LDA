import { describe, expect, it } from "vitest";
import {
  chainEdges, NO_SPOTLIGHT, spotlightEdgeStyle, spotlightNodeStyle, topKByDegree,
  type SpotlightState,
} from "./spotlight";

const spot = (node: string, nodes: string[], edges: string[], labeled = nodes): SpotlightState => ({
  node, pinned: false, mode: "chain",
  nodes: new Set([node, ...nodes]),
  edges: new Set(edges),
  labeled: new Set(labeled),
});

describe("spotlightNodeStyle", () => {
  it("ambient: nodes keep labels, ghosts never labeled", () => {
    expect(spotlightNodeStyle(NO_SPOTLIGHT, { key: "a", tStatus: "persisting" }))
      .toEqual({ dim: false, label: "keep" });
    expect(spotlightNodeStyle(NO_SPOTLIGHT, { key: "a", tStatus: "dropped" }))
      .toEqual({ dim: false, label: "suppress" });
  });

  it("spotlight: chain members stay lit with capped labels, rest dims", () => {
    const s = spot("lob", ["firm", "co", "epa"], ["e1", "e2"], ["firm", "epa"]);
    expect(spotlightNodeStyle(s, { key: "lob" }))
      .toEqual({ dim: false, label: "keep", forceLabel: true });
    expect(spotlightNodeStyle(s, { key: "firm" }))
      .toEqual({ dim: false, label: "keep", forceLabel: true });
    expect(spotlightNodeStyle(s, { key: "co" }))
      .toEqual({ dim: false, label: "keep", forceLabel: false });
    expect(spotlightNodeStyle(s, { key: "stranger" }))
      .toEqual({ dim: true, label: "suppress" });
    expect(spotlightNodeStyle(s, { key: "ghost", tStatus: "dropped" }))
      .toEqual({ dim: true, label: "suppress" });
  });
});

describe("spotlightEdgeStyle", () => {
  it("raises chain edges by key, dims the rest, no-ops when idle", () => {
    const s = spot("lob", ["firm"], ["e1"]);
    expect(spotlightEdgeStyle(s, "e1").emphasis).toBe("raise");
    expect(spotlightEdgeStyle(s, "e9").emphasis).toBe("dim");
    expect(spotlightEdgeStyle(NO_SPOTLIGHT, "e1").emphasis).toBe("none");
  });
});

describe("chainEdges — the filing traversal", () => {
  // Filing f1: lobbyist worked it (e1), firm represents company (e2), targeted EPA (e3).
  const index = new Map<string, string[]>([
    ["f1", ["e1", "e2", "e3"]],
    ["f2", ["e4", "e5"]],
  ]);

  it("reaches every edge of the shared filings — the full lobbying chain", () => {
    const chain = chainEdges([{ key: "e1", uuids: ["f1"] }], index,
      { maxEdges: 100, maxUuids: 100 });
    expect(chain).toEqual(new Set(["e1", "e2", "e3"]));
  });

  it("multiple filings union their chains", () => {
    const chain = chainEdges(
      [{ key: "e1", uuids: ["f1"] }, { key: "e4", uuids: ["f2"] }], index,
      { maxEdges: 100, maxUuids: 100 });
    expect(chain).toEqual(new Set(["e1", "e2", "e3", "e4", "e5"]));
  });

  it("aborts (null) when the chain stops being selective", () => {
    expect(chainEdges([{ key: "e1", uuids: ["f1", "f2"] }], index,
      { maxEdges: 3, maxUuids: 100 })).toBeNull();
    expect(chainEdges([{ key: "e1", uuids: Array.from({ length: 50 }, (_, i) => `u${i}`) }],
      index, { maxEdges: 100, maxUuids: 10 })).toBeNull();
  });
});

describe("topKByDegree", () => {
  it("returns the K highest-degree keys with deterministic tiebreak", () => {
    const deg: Record<string, number> = { a: 5, b: 9, c: 5, d: 7 };
    expect(topKByDegree(["c", "a", "b", "d"], (k) => deg[k], 3))
      .toEqual(new Set(["b", "d", "a"]));   // a beats c on the key tiebreak
  });
});
