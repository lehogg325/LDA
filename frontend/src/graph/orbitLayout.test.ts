import { describe, expect, it } from "vitest";
import type { EgoEdge, EgoResponse, NodeType } from "../api/client";
import { orbitAttach, orbitLayout, type OrbitUnion } from "./orbitLayout";

const edge = (
  etype: EgoEdge["edge_type"], st: NodeType, sid: number, tt: NodeType, tid: number,
  uuid: string, amount: number | null = null,
): EgoEdge => ({
  edge_type: etype, source: { node_type: st, node_id: sid },
  target: { node_type: tt, node_id: tid }, filing_uuid: uuid, amount,
  amount_type: amount !== null ? "income" : null, issue_codes: null,
  attribution_level: "activity", is_superseded: false,
});

/** Company anchor in DISPLAY SPACE (a 2-ID name-group pre-collapsed to client:1 —
 * collapse.ts) — 3 firms with different amounts, lobbyists, one entity named by
 * every firm's filings (omni) and one named by a single firm. */
function makeUnion(): { union: OrbitUnion; anchors: Set<string> } {
  const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
  const add = (t: string, id: number, label = `${t}-${id}`) =>
    nodes.set(`${t}:${id}`, { size: 3, label, node_type: t, node_id: id });
  add("client", 1, "ACME CORP · 2 registrations");
  add("registrant", 10, "BIG FIRM"); add("registrant", 11, "MID FIRM"); add("registrant", 12, "SMALL FIRM");
  add("lobbyist", 100); add("lobbyist", 101); add("lobbyist", 102);
  add("gov_entity", 500, "SENATE"); add("gov_entity", 501, "EPA");
  add("client", 3, "SIBLING CO");   // 2-hop: another client of BIG FIRM

  // f3's edges originally touched member client:2 — re-pointed by toDisplaySpace.
  const orig2 = { node_type: "client" as NodeType, node_id: 2 };
  const edges: EgoEdge[] = [
    edge("represents", "registrant", 10, "client", 1, "f1", 900000),
    edge("represents", "registrant", 11, "client", 1, "f2", 500000),
    { ...edge("represents", "registrant", 12, "client", 1, "f3", 100000), orig_target: orig2 },
    edge("represents", "registrant", 10, "client", 3, "f4", 50000),
    edge("worked_on", "lobbyist", 100, "registrant", 10, "f1"),
    edge("worked_on", "lobbyist", 100, "client", 1, "f1"),
    edge("worked_on", "lobbyist", 101, "registrant", 11, "f2"),
    edge("worked_on", "lobbyist", 102, "registrant", 12, "f3"),
    // SENATE named by all three firms' filings; EPA only by SMALL FIRM's.
    edge("targeted", "client", 1, "gov_entity", 500, "f1"),
    edge("targeted", "client", 1, "gov_entity", 500, "f2"),
    { ...edge("targeted", "client", 1, "gov_entity", 500, "f3"), orig_source: orig2 },
    { ...edge("targeted", "client", 1, "gov_entity", 501, "f3"), orig_source: orig2 },
  ];
  const ego: EgoResponse = { nodes: [], edges, truncated: false, dropped: [], year: 2023, period: "first_quarter" };
  return {
    union: { nodes, quarters: [20231], byQuarter: new Map([[20231, ego]]) },
    anchors: new Set(["client:1"]),
  };
}

const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y) / 100;

describe("orbitLayout — company anchor", () => {
  const { union, anchors } = makeUnion();
  const pos = orbitLayout(union, "client", anchors).positions;

  it("places every node", () => {
    expect(Object.keys(pos).sort()).toEqual([...union.nodes.keys()].sort());
  });

  it("the collapsed anchor sits exactly on the hub, firms on ring 1, entities outside", () => {
    expect(radius(pos["client:1"])).toBeLessThan(0.01);   // origin ± epsilon jitter only
    for (const firm of ["registrant:10", "registrant:11", "registrant:12"]) {
      expect(radius(pos[firm])).toBeGreaterThan(0.4);
      expect(radius(pos[firm])).toBeLessThan(0.5);
    }
    expect(radius(pos["gov_entity:501"])).toBeGreaterThan(0.85);
  });

  it("the omni entity (named by every firm) sits on the reserved arc at 12 o'clock", () => {
    const senate = pos["gov_entity:500"];
    expect(radius(senate)).toBeGreaterThan(1.05);
    expect(senate.y).toBeGreaterThan(0);                      // top of the picture
    expect(Math.abs(senate.x)).toBeLessThan(Math.abs(senate.y)); // nearer 12 than 3/9 o'clock
  });

  it("a focused entity lands near its firm's angle", () => {
    const epa = pos["gov_entity:501"];
    const smallFirm = pos["registrant:12"];
    const angle = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
    const diff = Math.abs(angle(epa) - angle(smallFirm)) % (2 * Math.PI);
    expect(Math.min(diff, 2 * Math.PI - diff)).toBeLessThan(0.6);
  });

  it("lobbyists cluster near their primary firm", () => {
    const d = (a: string, b: string) =>
      Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y) / 100;
    expect(d("lobbyist:100", "registrant:10")).toBeLessThan(0.25);
    expect(d("lobbyist:101", "registrant:11")).toBeLessThan(0.25);
  });

  it("is deterministic and edge-order-invariant", () => {
    const again = orbitLayout(union, "client", anchors).positions;
    expect(again).toEqual(pos);

    const { union: u2, anchors: a2 } = makeUnion();
    const ego = u2.byQuarter.get(20231)!;
    ego.edges.reverse();
    expect(orbitLayout(u2, "client", a2).positions).toEqual(pos);
  });

  it("no two nodes share coordinates", () => {
    const seen = new Set(Object.values(pos).map((p) => `${p.x},${p.y}`));
    expect(seen.size).toBe(Object.keys(pos).length);
  });
});

describe("orbitLayout — capacity and other anchors", () => {
  it("demotes to an annulus when owners exceed the ring cap", () => {
    const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
    nodes.set("client:1", { size: 3, label: "A", node_type: "client", node_id: 1 });
    const edges: EgoEdge[] = [];
    for (let i = 0; i < 150; i++) {
      nodes.set(`registrant:${i}`, { size: 2, label: `R${i}`, node_type: "registrant", node_id: i });
      edges.push(edge("represents", "registrant", i, "client", 1, `u${i}`, 1000 + i));
    }
    const ego: EgoResponse = { nodes: [], edges, truncated: false, dropped: [], year: 2023, period: "first_quarter" };
    const pos = orbitLayout(
      { nodes, quarters: [1], byQuarter: new Map([[1, ego]]) }, "client", new Set(["client:1"])).positions;
    const radii = Array.from({ length: 150 }, (_, i) => radius(pos[`registrant:${i}`]));
    expect(Math.min(...radii)).toBeGreaterThan(0.3);
    expect(Math.max(...radii)).toBeLessThan(0.75);
    expect(new Set(radii.map((r) => r.toFixed(3))).size).toBeGreaterThan(50); // annulus, not one ring
  });

  it("multi-key anchor sets still pack into the center disc (legacy path)", () => {
    const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
    nodes.set("client:1", { size: 3, label: "A", node_type: "client", node_id: 1 });
    nodes.set("client:2", { size: 3, label: "A", node_type: "client", node_id: 2 });
    nodes.set("registrant:10", { size: 2, label: "R", node_type: "registrant", node_id: 10 });
    const edges: EgoEdge[] = [
      edge("represents", "registrant", 10, "client", 1, "u1", 1000),
      edge("represents", "registrant", 10, "client", 2, "u2", 2000),
    ];
    const ego: EgoResponse = { nodes: [], edges, truncated: false, dropped: [], year: 2023, period: "first_quarter" };
    const pos = orbitLayout(
      { nodes, quarters: [1], byQuarter: new Map([[1, ego]]) }, "client",
      new Set(["client:1", "client:2"])).positions;
    expect(radius(pos["client:1"])).toBeLessThan(0.1);
    expect(radius(pos["client:2"])).toBeLessThan(0.1);
    expect(pos["client:1"]).not.toEqual(pos["client:2"]);
  });

  it("gov anchor at hops=1 (clients only) becomes an annulus sunflower", () => {
    const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
    nodes.set("gov_entity:500", { size: 5, label: "SENATE", node_type: "gov_entity", node_id: 500 });
    const edges: EgoEdge[] = [];
    for (let i = 0; i < 40; i++) {
      nodes.set(`client:${i}`, { size: 2, label: `C${i}`, node_type: "client", node_id: i });
      edges.push(edge("targeted", "client", i, "gov_entity", 500, `u${i}`));
    }
    const ego: EgoResponse = { nodes: [], edges, truncated: false, dropped: [], year: 2023, period: "first_quarter" };
    const pos = orbitLayout(
      { nodes, quarters: [1], byQuarter: new Map([[1, ego]]) }, "gov_entity", new Set(["gov_entity:500"])).positions;
    expect(radius(pos["gov_entity:500"])).toBeLessThan(0.1);
    for (let i = 0; i < 40; i++) {
      const r = radius(pos[`client:${i}`]);
      expect(r).toBeGreaterThan(0.3);
      expect(r).toBeLessThan(0.85);
    }
  });
});

describe("orbitLayout — registrant anchor", () => {
  it("the registrant's own lobbyists cluster at the center, not scattered to client wedges", () => {
    const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
    nodes.set("registrant:10", { size: 3, label: "BIG FIRM", node_type: "registrant", node_id: 10 });
    nodes.set("client:1", { size: 3, label: "CLIENT A", node_type: "client", node_id: 1 });
    nodes.set("client:2", { size: 3, label: "CLIENT B", node_type: "client", node_id: 2 });
    nodes.set("lobbyist:100", { size: 2, label: "L1", node_type: "lobbyist", node_id: 100 });
    nodes.set("lobbyist:101", { size: 2, label: "L2", node_type: "lobbyist", node_id: 101 });
    const edges: EgoEdge[] = [
      edge("represents", "registrant", 10, "client", 1, "f1", 900000),
      edge("represents", "registrant", 10, "client", 2, "f2", 100000),
      // Each lobbyist's strongest tie (by the paired() tiebreak) would be a
      // DIFFERENT client if satellites were still keyed by "owner" (= client, for
      // a registrant anchor) — that's exactly the bug: they'd scatter to their
      // client's wedge instead of clustering with the firm they work for.
      edge("worked_on", "lobbyist", 100, "registrant", 10, "f1"),
      edge("worked_on", "lobbyist", 100, "client", 1, "f1"),
      edge("worked_on", "lobbyist", 101, "registrant", 10, "f2"),
      edge("worked_on", "lobbyist", 101, "client", 2, "f2"),
    ];
    const ego: EgoResponse = { nodes: [], edges, truncated: false, dropped: [], year: 2023, period: "first_quarter" };
    const pos = orbitLayout(
      { nodes, quarters: [1], byQuarter: new Map([[1, ego]]) },
      "registrant", new Set(["registrant:10"])).positions;

    for (const lob of ["lobbyist:100", "lobbyist:101"]) {
      expect(radius(pos[lob])).toBeGreaterThan(0.08);  // not literally on the anchor
      expect(radius(pos[lob])).toBeLessThan(0.35);     // well inside the client-wedge ring (0.45)
    }
  });
});

describe("orbitAttach — incremental expansion placement", () => {
  const { union, anchors } = makeUnion();
  const base = orbitLayout(union, "client", anchors);

  /** Merged union: BIG FIRM (registrant:10) expanded — two new clients + one new
   * gov entity arrive via its filings. */
  function mergedUnion(reversed = false): OrbitUnion {
    const nodes = new Map(union.nodes);
    nodes.set("client:70", { size: 2, label: "NEW CO A", node_type: "client", node_id: 70 });
    nodes.set("client:71", { size: 2, label: "NEW CO B", node_type: "client", node_id: 71 });
    nodes.set("gov_entity:502", { size: 2, label: "FTC", node_type: "gov_entity", node_id: 502 });
    const extra: EgoEdge[] = [
      edge("represents", "registrant", 10, "client", 70, "x1", 200000),
      edge("represents", "registrant", 10, "client", 71, "x2", 90000),
      edge("targeted", "client", 70, "gov_entity", 502, "x1"),
    ];
    const baseEgo = union.byQuarter.get(20231)!;
    const edges = [...baseEgo.edges, ...(reversed ? [...extra].reverse() : extra)];
    return { nodes, quarters: [20231], byQuarter: new Map([[20231, { ...baseEgo, edges }]]) };
  }

  const pos = orbitAttach(mergedUnion(), base);

  it("frozen keys pass through bit-identical", () => {
    for (const k of Object.keys(base.positions)) {
      expect(pos[k]).toBe(base.positions[k]);
    }
  });

  it("places every new key", () => {
    expect(Object.keys(pos).sort()).toEqual([...mergedUnion().nodes.keys()].sort());
  });

  it("new clients attach near their firm's angle at the extra-client band", () => {
    const angle = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
    for (const k of ["client:70", "client:71"]) {
      const r = radius(pos[k]);
      expect(r).toBeGreaterThan(0.5);
      expect(r).toBeLessThan(0.85);
      const diff = Math.abs(angle(pos[k]) - angle(pos["registrant:10"])) % (2 * Math.PI);
      expect(Math.min(diff, 2 * Math.PI - diff)).toBeLessThan(0.5);
    }
  });

  it("is deterministic and edge-order-invariant", () => {
    expect(orbitAttach(mergedUnion(), base)).toEqual(pos);
    expect(orbitAttach(mergedUnion(true), base)).toEqual(pos);
  });

  it("returns the frozen positions object untouched when nothing is new", () => {
    expect(orbitAttach(union, base)).toBe(base.positions);
  });

  it("never attaches to the anchor (it has no angle by design)", () => {
    // A node connected ONLY to the anchor must fall to the orphan ring, not to a
    // junk angle derived from the anchor's jittered origin.
    const nodes = new Map(union.nodes);
    nodes.set("registrant:99", { size: 2, label: "ONLY-ANCHOR", node_type: "registrant", node_id: 99 });
    const baseEgo = union.byQuarter.get(20231)!;
    const edges = [...baseEgo.edges, edge("represents", "registrant", 99, "client", 1, "z1", 5)];
    const merged: OrbitUnion = {
      nodes, quarters: [20231], byQuarter: new Map([[20231, { ...baseEgo, edges }]]),
    };
    const p = orbitAttach(merged, base);
    expect(radius(p["registrant:99"])).toBeGreaterThan(1.3); // orphan ring
  });
});
