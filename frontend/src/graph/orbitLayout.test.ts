import { describe, expect, it } from "vitest";
import type { EgoEdge, EgoResponse, NodeType } from "../api/client";
import { orbitLayout, type OrbitUnion } from "./orbitLayout";

const edge = (
  etype: EgoEdge["edge_type"], st: NodeType, sid: number, tt: NodeType, tid: number,
  uuid: string, amount: number | null = null,
): EgoEdge => ({
  edge_type: etype, source: { node_type: st, node_id: sid },
  target: { node_type: tt, node_id: tid }, filing_uuid: uuid, amount,
  amount_type: amount !== null ? "income" : null, issue_codes: null,
  attribution_level: "activity", is_superseded: false,
});

/** Company anchor (2 group IDs) — 3 firms with different amounts, lobbyists, one
 * entity named by every firm's filings (omni) and one named by a single firm. */
function makeUnion(): { union: OrbitUnion; anchors: Set<string> } {
  const nodes = new Map<string, { size: number; label: string; node_type: string; node_id: number }>();
  const add = (t: string, id: number, label = `${t}-${id}`) =>
    nodes.set(`${t}:${id}`, { size: 3, label, node_type: t, node_id: id });
  add("client", 1, "ACME CORP"); add("client", 2, "ACME CORP");
  add("registrant", 10, "BIG FIRM"); add("registrant", 11, "MID FIRM"); add("registrant", 12, "SMALL FIRM");
  add("lobbyist", 100); add("lobbyist", 101); add("lobbyist", 102);
  add("gov_entity", 500, "SENATE"); add("gov_entity", 501, "EPA");
  add("client", 3, "SIBLING CO");   // 2-hop: another client of BIG FIRM

  const edges: EgoEdge[] = [
    edge("represents", "registrant", 10, "client", 1, "f1", 900000),
    edge("represents", "registrant", 11, "client", 1, "f2", 500000),
    edge("represents", "registrant", 12, "client", 2, "f3", 100000),
    edge("represents", "registrant", 10, "client", 3, "f4", 50000),
    edge("worked_on", "lobbyist", 100, "registrant", 10, "f1"),
    edge("worked_on", "lobbyist", 100, "client", 1, "f1"),
    edge("worked_on", "lobbyist", 101, "registrant", 11, "f2"),
    edge("worked_on", "lobbyist", 102, "registrant", 12, "f3"),
    // SENATE named by all three firms' filings; EPA only by SMALL FIRM's.
    edge("targeted", "client", 1, "gov_entity", 500, "f1"),
    edge("targeted", "client", 1, "gov_entity", 500, "f2"),
    edge("targeted", "client", 2, "gov_entity", 500, "f3"),
    edge("targeted", "client", 2, "gov_entity", 501, "f3"),
  ];
  const ego: EgoResponse = { nodes: [], edges, truncated: false, dropped: [], year: 2023, period: "first_quarter" };
  return {
    union: { nodes, quarters: [20231], byQuarter: new Map([[20231, ego]]) },
    anchors: new Set(["client:1", "client:2"]),
  };
}

const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y) / 100;

describe("orbitLayout — company anchor", () => {
  const { union, anchors } = makeUnion();
  const pos = orbitLayout(union, "client", anchors);

  it("places every node", () => {
    expect(Object.keys(pos).sort()).toEqual([...union.nodes.keys()].sort());
  });

  it("anchor members sit at the center, firms on ring 1, entities outside", () => {
    expect(radius(pos["client:1"])).toBeLessThan(0.1);
    expect(radius(pos["client:2"])).toBeLessThan(0.1);
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
    const again = orbitLayout(union, "client", anchors);
    expect(again).toEqual(pos);

    const { union: u2, anchors: a2 } = makeUnion();
    const ego = u2.byQuarter.get(20231)!;
    ego.edges.reverse();
    expect(orbitLayout(u2, "client", a2)).toEqual(pos);
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
      { nodes, quarters: [1], byQuarter: new Map([[1, ego]]) }, "client", new Set(["client:1"]));
    const radii = Array.from({ length: 150 }, (_, i) => radius(pos[`registrant:${i}`]));
    expect(Math.min(...radii)).toBeGreaterThan(0.3);
    expect(Math.max(...radii)).toBeLessThan(0.75);
    expect(new Set(radii.map((r) => r.toFixed(3))).size).toBeGreaterThan(50); // annulus, not one ring
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
      { nodes, quarters: [1], byQuarter: new Map([[1, ego]]) }, "gov_entity", new Set(["gov_entity:500"]));
    expect(radius(pos["gov_entity:500"])).toBeLessThan(0.1);
    for (let i = 0; i < 40; i++) {
      const r = radius(pos[`client:${i}`]);
      expect(r).toBeGreaterThan(0.3);
      expect(r).toBeLessThan(0.85);
    }
  });
});
