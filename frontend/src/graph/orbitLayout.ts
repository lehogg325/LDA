// Anchor-centric "orbit" layout: the searched entity is the hub of its own picture.
//
//   center  — the anchor (a name-group collapses to ONE display node — collapse.ts)
//   ring 1  — its direct counterparties as amount-ordered wedges (firms for a company,
//             clients for a firm, ...) with lobbyists as sunflower satellites
//   outside — government entities, placed at the circular mean of the firms whose
//             filings named them; omnipresent hubs (Senate, House) sit on a reserved
//             arc at 12 o'clock, above everything
//
// Computed ONCE over the union of all quarters; positions are frozen (the slider only
// toggles visibility). Fully deterministic: raw edge lists are explicitly sorted before
// any aggregation (backend edge order is not stable), every comparator ends in a key
// tiebreak, and all jitter derives from hashes — no randomness anywhere.

import type { EgoEdge, EgoResponse, NodeType } from "../api/client";
import { hashString } from "./seed";

export interface OrbitUnion {
  nodes: Map<string, { size: number; label: string; node_type: string; node_id: number }>;
  quarters: number[];
  byQuarter: Map<number, EgoResponse>;
}

export type Positions = Record<string, { x: number; y: number }>;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const TAU = 2 * Math.PI;
const SCALE = 100;

// Radii (normalized units, scaled at the end)
const R_CENTER = 0.08;
const R_OWNERS = 0.45;
const R_SAT_MAX_DISC = 0.12;
const R_EXTRA_CLIENT = 0.68;
const R_ENTITIES = 0.95;
const R_OMNI = 1.15;
const R_COTARGET = 1.3;
const R_ORPHAN = 1.4;
const MIN_SEP = 0.02;             // arc-length separation on semantic rings
const OWNER_RING_CAP = 120;       // beyond this, wedges demote to an annulus sunflower

const nk = (t: string, id: number) => `${t}:${id}`;

// 12 o'clock, clockwise on screen. Sigma's viewport transform flips y (graph +y is
// screen-up), so screen-clockwise from the top is angle = π/2 − t in graph space.
const onCircle = (r: number, clockwiseFromTop: number) => ({
  x: r * Math.cos(Math.PI / 2 - clockwiseFromTop),
  y: r * Math.sin(Math.PI / 2 - clockwiseFromTop),
});

const jitter01 = (key: string, salt: string) => (hashString(salt + key) % 10000) / 10000;

function sunflower(keys: string[], cx: number, cy: number, maxRadius: number): Positions {
  const out: Positions = {};
  const rho0 = maxRadius / Math.sqrt(Math.max(1, keys.length));
  keys.forEach((key, i) => {
    const rho = rho0 * Math.sqrt(i + 0.5);
    const phi = i * GOLDEN;
    out[key] = { x: cx + rho * Math.cos(phi), y: cy + rho * Math.sin(phi) };
  });
  return out;
}

/** Sorted sweep with min separation: keeps semantic order, removes collisions.
 * Returns adjusted angles keyed as input. Staggers to a second row on overflow. */
function sweepSeparate(
  items: { key: string; angle: number }[], r: number,
): { key: string; angle: number; row: number }[] {
  if (items.length === 0) return [];
  const delta = MIN_SEP / r;
  const needsStagger = items.length * delta > TAU * 0.9;
  const rows = needsStagger ? 2 : 1;
  const sorted = [...items].sort((a, b) => a.angle - b.angle || (a.key < b.key ? -1 : 1));

  // Cut the circle at the largest angular gap so the sweep doesn't wrap.
  let cut = 0, biggest = -1;
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length];
    const gap = ((next.angle - sorted[i].angle) % TAU + TAU) % TAU || TAU;
    if (gap > biggest) { biggest = gap; cut = (i + 1) % sorted.length; }
  }
  const seq = [...sorted.slice(cut), ...sorted.slice(0, cut)];

  const perRow = rows === 1 ? [seq] : [seq.filter((_, i) => i % 2 === 0), seq.filter((_, i) => i % 2 === 1)];
  const out: { key: string; angle: number; row: number }[] = [];
  perRow.forEach((row, rowIdx) => {
    const eff = delta * (rows === 1 ? 1 : 0.9);
    const adjusted: number[] = [];
    let base = -Infinity;
    for (const item of row) {
      const a = Math.max(item.angle + (item.angle < base - Math.PI ? TAU : 0), base + eff);
      adjusted.push(a);
      base = a;
    }
    // Re-center the swept block on its original mean so clusters stay put.
    const meanOrig = row.reduce((s, it) => s + it.angle, 0) / Math.max(1, row.length);
    const meanAdj = adjusted.reduce((s, a) => s + a, 0) / Math.max(1, adjusted.length);
    const shift = meanOrig - meanAdj;
    row.forEach((item, i) => out.push({ key: item.key, angle: adjusted[i] + shift, row: rowIdx }));
  });
  return out;
}

function circularMean(entries: { angle: number; weight: number }[]): { angle: number; r: number } {
  let sx = 0, sy = 0, sw = 0;
  for (const e of entries) {
    sx += Math.cos(e.angle) * e.weight;
    sy += Math.sin(e.angle) * e.weight;
    sw += e.weight;
  }
  if (sw === 0) return { angle: 0, r: 0 };
  return { angle: Math.atan2(sy / sw, sx / sw), r: Math.hypot(sx / sw, sy / sw) };
}

export interface OrbitResult {
  positions: Positions;
  /** Graph-radian angle per placed node (the center anchor deliberately has none —
   * it must never serve as an attachment parent). Needed by orbitAttach. */
  angles: Map<string, number>;
}

// ── Phase 0 (shared): deterministic aggregates over the raw per-quarter edges ────
function pairAggregates(union: OrbitUnion) {
  const has = (k: string) => union.nodes.has(k);
  const allEdges: EgoEdge[] = [];
  for (const q of [...union.quarters].sort((a, b) => a - b)) {
    const d = union.byQuarter.get(q);
    if (d) allEdges.push(...d.edges);
  }
  allEdges.sort((a, b) =>
    a.filing_uuid.localeCompare(b.filing_uuid)
    || nk(a.source.node_type, a.source.node_id).localeCompare(nk(b.source.node_type, b.source.node_id))
    || nk(a.target.node_type, a.target.node_id).localeCompare(nk(b.target.node_type, b.target.node_id))
    || a.edge_type.localeCompare(b.edge_type));

  const pairAmount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  const uuidRegistrant = new Map<string, string>();
  const entityAttractorRaw: { ent: string; via: string | null; other: string }[] = [];

  const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const e of allEdges) {
    const s = nk(e.source.node_type, e.source.node_id);
    const t = nk(e.target.node_type, e.target.node_id);
    if (!has(s) || !has(t)) continue;
    const key = pk(s, t);
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    if (e.amount !== null) pairAmount.set(key, (pairAmount.get(key) ?? 0) + e.amount);
    if (e.edge_type === "represents") uuidRegistrant.set(e.filing_uuid, s);
    if (e.edge_type === "targeted") entityAttractorRaw.push({ ent: t, via: e.filing_uuid, other: s });
  }

  const paired = (k: string) => {
    // deterministic list of (partner, count, amount) for node k
    const out: { partner: string; count: number; amount: number }[] = [];
    for (const [key, count] of pairCount) {
      const [a, b] = key.split("|");
      if (a === k) out.push({ partner: b, count, amount: pairAmount.get(key) ?? 0 });
      else if (b === k) out.push({ partner: a, count, amount: pairAmount.get(key) ?? 0 });
    }
    return out.sort((x, y) => y.count - x.count || y.amount - x.amount || x.partner.localeCompare(y.partner));
  };

  return { paired, uuidRegistrant, entityAttractorRaw };
}

type Paired = ReturnType<typeof pairAggregates>["paired"];

// ── Phase 5 + orphan ring (shared): attach unplaced keys to their strongest placed
// partner, in normalized units. Mutates positions/angleOf for NEW keys only. ──────
function attachUnplaced(
  nodeKeys: OrbitUnion["nodes"],
  paired: Paired,
  positions: Positions,
  angleOf: Map<string, number>,
): void {
  const unplaced = () => [...nodeKeys.keys()].filter((k) => !(k in positions)).sort();
  for (let pass = 0; pass < 3; pass++) {
    const todo = unplaced();
    if (todo.length === 0) break;
    for (const key of todo) {
      const partners = paired(key).filter((p) => p.partner in positions && angleOf.has(p.partner));
      if (partners.length === 0) continue;
      const parent = partners[0].partner;
      const baseAngle = angleOf.get(parent)!;
      const spread = (jitter01(key, "spread") - 0.5) * 0.5;
      const ntype = nodeKeys.get(key)!.node_type;
      const parentType = nodeKeys.get(parent)!.node_type;
      const r = ntype === "client" && parentType === "gov_entity" ? R_COTARGET
        : ntype === "client" ? R_EXTRA_CLIENT
        : ntype === "gov_entity" ? R_ENTITIES
        : ntype === "lobbyist" ? R_OWNERS + 0.14
        : R_EXTRA_CLIENT;
      positions[key] = onCircle(r, ((Math.PI / 2 - baseAngle) % TAU + TAU) % TAU + spread);
      angleOf.set(key, baseAngle - spread);
    }
  }
  // True orphans (also unaffiliated lobbyists with no placed partner)
  for (const key of unplaced()) {
    positions[key] = onCircle(R_ORPHAN, jitter01(key, "orphan") * TAU);
  }
}

// ── Phase 6 (shared): epsilon de-dup + scale, applied per key ─────────────────────
function jitterScale(keys: Iterable<string>, positions: Positions): void {
  for (const key of keys) {
    positions[key] = {
      x: (positions[key].x + (jitter01(key, "ex") - 0.5) * 0.004) * SCALE,
      y: (positions[key].y + (jitter01(key, "ey") - 0.5) * 0.004) * SCALE,
    };
  }
}

export function orbitLayout(
  union: OrbitUnion, anchorType: NodeType, anchorKeys: Set<string>,
): OrbitResult {
  const nodeKeys = union.nodes;
  const has = (k: string) => nodeKeys.has(k);
  const { paired, uuidRegistrant, entityAttractorRaw } = pairAggregates(union);

  // ── Tier classification ────────────────────────────────────────────────────────
  const byType = (t: string) =>
    [...nodeKeys.entries()].filter(([, n]) => n.node_type === t).map(([k]) => k).sort();
  const anchorMembers = [...anchorKeys].filter(has).sort();
  const nonAnchor = (keys: string[]) => keys.filter((k) => !anchorKeys.has(k));

  const ownerType: Record<NodeType, string> = {
    client: "registrant", registrant: "client", lobbyist: "registrant", gov_entity: "client",
  };
  let owners = nonAnchor(byType(ownerType[anchorType]));

  // gov anchor at hops=1 has ONLY clients: no wedge owners, clients become an annulus.
  const govAnnulusMode = anchorType === "gov_entity" &&
    byType("registrant").filter((k) => !anchorKeys.has(k)).length === 0;
  if (anchorType === "gov_entity" && !govAnnulusMode) owners = nonAnchor(byType("registrant"));

  // Owner metric: money toward/from the anchor, else relationship count.
  const ownerMetric = new Map<string, number>();
  for (const o of owners) {
    let m = 0;
    for (const p of paired(o)) if (anchorKeys.has(p.partner)) m += p.amount > 0 ? p.amount : p.count;
    ownerMetric.set(o, m);
  }
  owners = [...owners].sort((a, b) =>
    (ownerMetric.get(b)! - ownerMetric.get(a)!) || a.localeCompare(b));

  // Lobbyist satellites: primary owner = the one they share the most filings with.
  const satellitesOf = new Map<string, string[]>();
  const lobbyists = anchorType === "lobbyist" ? [] : nonAnchor(byType("lobbyist"));
  const unaffiliated: string[] = [];
  for (const lob of lobbyists) {
    const firms = paired(lob).filter((p) => owners.includes(p.partner));
    if (firms.length === 0) { unaffiliated.push(lob); continue; }
    const primary = firms[0].partner;
    if (!satellitesOf.has(primary)) satellitesOf.set(primary, []);
    satellitesOf.get(primary)!.push(lob);
  }

  const positions: Positions = {};
  const angleOf = new Map<string, number>();

  // ── Phase 1: center ────────────────────────────────────────────────────────────
  // Display space collapses a name-group anchor to one node, which sits exactly on
  // the hub (sunflower(1) would offset it by ~0.057). The disc path remains for any
  // multi-key anchor set.
  const centerSorted = [...anchorMembers].sort((a, b) => {
    const amt = (k: string) => paired(k).reduce((s, p) => s + p.amount, 0);
    return amt(b) - amt(a) || a.localeCompare(b);
  });
  if (centerSorted.length === 1) positions[centerSorted[0]] = { x: 0, y: 0 };
  else Object.assign(positions, sunflower(centerSorted, 0, 0, R_CENTER));

  // ── Phase 2: owners — wedges, or an annulus sunflower past the capacity cap ───
  if (govAnnulusMode) {
    const clients = nonAnchor(byType("client")).sort((a, b) => {
      const m = (k: string) => ownerMetricFallback(k);
      return m(b) - m(a) || a.localeCompare(b);
    });
    function ownerMetricFallback(k: string): number {
      let s = 0;
      for (const p of paired(k)) if (anchorKeys.has(p.partner)) s += p.amount > 0 ? p.amount : p.count;
      return s;
    }
    clients.forEach((key, i) => {
      const rho = Math.sqrt(0.35 ** 2 + (0.8 ** 2 - 0.35 ** 2) * (i / Math.max(1, clients.length)));
      const phi = i * GOLDEN;
      positions[key] = { x: rho * Math.cos(phi), y: rho * Math.sin(phi) };
      angleOf.set(key, phi);
    });
  } else if (owners.length > OWNER_RING_CAP) {
    owners.forEach((key, i) => {
      const rho = Math.sqrt(0.4 ** 2 + (0.7 ** 2 - 0.4 ** 2) * (i / owners.length));
      const phi = i * GOLDEN;
      positions[key] = { x: rho * Math.cos(phi), y: rho * Math.sin(phi) };
      angleOf.set(key, phi);
    });
  } else if (owners.length > 0) {
    const PAD = 0.02;
    const weights = owners.map((o) => 1 + Math.sqrt((satellitesOf.get(o) ?? []).length) + PAD);
    const total = weights.reduce((s, w) => s + w, 0);
    let cursor = 0;
    owners.forEach((key, i) => {
      const span = (weights[i] / total) * TAU;
      const mid = cursor + span / 2;
      positions[key] = onCircle(R_OWNERS, mid);
      angleOf.set(key, Math.PI / 2 - mid);   // angleOf always stores graph radians
      cursor += span;

      // ── Phase 3: this owner's lobbyist satellites, sunflower beside the wedge ─
      const sats = (satellitesOf.get(key) ?? []).sort((a, b) => {
        const shared = (l: string) => paired(l).find((p) => p.partner === key)?.count ?? 0;
        return shared(b) - shared(a) || a.localeCompare(b);
      });
      if (sats.length > 0) {
        const discR = Math.min((span / 2) * R_OWNERS, R_SAT_MAX_DISC);
        const c = onCircle(R_OWNERS + 0.14, mid);
        Object.assign(positions, sunflower(sats, c.x, c.y, discR));
        sats.forEach((sat) => angleOf.set(sat, Math.PI / 2 - mid));
      }
    });
  }

  // ── Phase 4: government entities — omni arc at 12 o'clock, focused by attractor ─
  if (anchorType !== "gov_entity") {
    const entities = nonAnchor(byType("gov_entity"));
    const attractorWeights = new Map<string, Map<string, number>>();
    for (const rec of entityAttractorRaw) {
      if (!has(rec.ent)) continue;
      // Client anchor: the entity's attractor is the registrant whose filing named it
      // (its direct endpoint is the center, which has no angle). Other anchors: the
      // client endpoint itself.
      let attractor: string | null = null;
      if (anchorType === "client") {
        attractor = (rec.via && uuidRegistrant.get(rec.via)) || (anchorKeys.has(rec.other) ? null : rec.other);
      } else {
        attractor = anchorKeys.has(rec.other) ? null : rec.other;
      }
      if (!attractor || angleOf.get(attractor) === undefined) continue;
      if (!attractorWeights.has(rec.ent)) attractorWeights.set(rec.ent, new Map());
      const m = attractorWeights.get(rec.ent)!;
      m.set(attractor, (m.get(attractor) ?? 0) + 1);
    }

    const omni: string[] = [];
    const focused: { key: string; angle: number }[] = [];
    const wedgeOwnerCount = Math.max(1, owners.length);
    for (const ent of entities) {
      const attractors = attractorWeights.get(ent);
      if (!attractors || attractors.size === 0) { omni.push(ent); continue; }
      const entries = [...attractors.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const mean = circularMean(entries.map(([k, w]) => ({ angle: angleOf.get(k)!, weight: w })));
      const isOmni = attractors.size >= 0.6 * wedgeOwnerCount || (mean.r < 0.15 && attractors.size > 10);
      if (isOmni) omni.push(ent);
      else if (mean.r < 0.15) focused.push({ key: ent, angle: angleOf.get(entries[0][0])! });
      else focused.push({ key: ent, angle: mean.angle });
    }

    for (const item of sweepSeparate(
      // circularMean/angleOf work in graph radians; convert to clockwise-from-top for onCircle
      focused.map((f) => ({ key: f.key, angle: ((Math.PI / 2 - f.angle) % TAU + TAU) % TAU })),
      R_ENTITIES,
    )) {
      positions[item.key] = onCircle(R_ENTITIES + item.row * 0.08, item.angle);
      angleOf.set(item.key, Math.PI / 2 - item.angle);
    }

    const omniSorted = [...omni].sort((a, b) => {
      const deg = (k: string) => paired(k).length;
      return deg(b) - deg(a) || (nodeKeys.get(a)!.label ?? "").localeCompare(nodeKeys.get(b)!.label ?? "") || a.localeCompare(b);
    });
    const arcSpan = Math.min(Math.PI * 0.6, Math.max(0.3, omniSorted.length * 0.12));
    omniSorted.forEach((key, i) => {
      const t = omniSorted.length === 1 ? 0 : i / (omniSorted.length - 1) - 0.5;
      positions[key] = onCircle(R_OMNI, t * arcSpan);   // centered on 12 o'clock
      angleOf.set(key, Math.PI / 2 - t * arcSpan);
    });
  }

  // ── Phase 5: everything unplaced — attach to strongest placed partner ──────────
  attachUnplaced(nodeKeys, paired, positions, angleOf);

  // ── Phase 6: epsilon de-dup + scale ────────────────────────────────────────────
  jitterScale(Object.keys(positions), positions);
  return { positions, angles: angleOf };
}

/** Incremental placement for node expansions: keys already in `frozen` pass through
 * BIT-IDENTICAL (mental-map preservation — expanding never moves what's on screen);
 * only new keys are placed, via the same Phase-5 attachment + orphan ring + jitter,
 * using pair aggregates recomputed over the merged union. Frozen coordinates are
 * used for membership only, never read numerically — attachment works on angles. */
export function orbitAttach(union: OrbitUnion, frozen: OrbitResult): Positions {
  const newKeys = [...union.nodes.keys()].filter((k) => !(k in frozen.positions));
  if (newKeys.length === 0) return frozen.positions;
  const { paired } = pairAggregates(union);
  const positions: Positions = { ...frozen.positions };
  const angleOf = new Map(frozen.angles);
  attachUnplaced(union.nodes, paired, positions, angleOf);
  jitterScale(newKeys, positions);
  return positions;
}
