import { describe, expect, it } from "vitest";
import {
  NO_SPOTLIGHT, spotlightEdgeStyle, spotlightNodeStyle, topKByDegree,
  type SpotlightState,
} from "./spotlight";

const spot = (node: string, neighbors: string[], labeled = neighbors): SpotlightState => ({
  node, pinned: false,
  neighbors: new Set(neighbors),
  labeledNeighbors: new Set(labeled),
});

describe("spotlightNodeStyle", () => {
  it("ambient: persisting nodes keep their label decision, ghosts never labeled", () => {
    expect(spotlightNodeStyle(NO_SPOTLIGHT, { key: "a", tStatus: "persisting" }))
      .toEqual({ dim: false, label: "keep" });
    expect(spotlightNodeStyle(NO_SPOTLIGHT, { key: "a", tStatus: "dropped" }))
      .toEqual({ dim: false, label: "suppress" });
  });

  it("spotlight: focus node and neighbors stay lit, rest dims and loses labels", () => {
    const s = spot("hub", ["n1", "n2"], ["n1"]);
    expect(spotlightNodeStyle(s, { key: "hub" }))
      .toEqual({ dim: false, label: "keep", forceLabel: true });
    expect(spotlightNodeStyle(s, { key: "n1" }))
      .toEqual({ dim: false, label: "keep", forceLabel: true });
    expect(spotlightNodeStyle(s, { key: "n2" }))
      .toEqual({ dim: false, label: "keep", forceLabel: false }); // over the label cap
    expect(spotlightNodeStyle(s, { key: "stranger" }))
      .toEqual({ dim: true, label: "suppress" });
  });

  it("spotlight: dropped ghost outside the neighborhood dims without a label", () => {
    const s = spot("hub", ["n1"]);
    expect(spotlightNodeStyle(s, { key: "ghost", tStatus: "dropped" }))
      .toEqual({ dim: true, label: "suppress" });
  });
});

describe("spotlightEdgeStyle", () => {
  it("raises incident edges, dims the rest, no-ops when idle", () => {
    const s = spot("hub", ["n1"]);
    expect(spotlightEdgeStyle(s, "hub", "n1").emphasis).toBe("raise");
    expect(spotlightEdgeStyle(s, "n1", "hub").emphasis).toBe("raise");
    expect(spotlightEdgeStyle(s, "n1", "n2").emphasis).toBe("dim");
    expect(spotlightEdgeStyle(NO_SPOTLIGHT, "a", "b").emphasis).toBe("none");
  });
});

describe("topKByDegree", () => {
  it("returns the K highest-degree keys", () => {
    const deg: Record<string, number> = { a: 5, b: 9, c: 1, d: 7 };
    expect(topKByDegree(["a", "b", "c", "d"], (k) => deg[k], 2)).toEqual(new Set(["b", "d"]));
  });
});
