// Deterministic initial positions: same node key -> same seed position, always.
// This is half of layout pinning — the other half is running ForceAtlas2 exactly once
// over the union graph and never re-running it per quarter.

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedPosition(key: string): { x: number; y: number } {
  const rand = mulberry32(hashString(key));
  const angle = rand() * 2 * Math.PI;
  const radius = Math.sqrt(rand());
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/** Group members (registration-scoped IDs sharing an exact name) seed as a tight,
 * deterministic constellation: shared centroid from the group id, small per-key
 * jitter. Display-level only — nothing about the data is merged. */
export function seedGroupPosition(groupId: string, key: string): { x: number; y: number } {
  const centroid = seedPosition(groupId);
  const jitter = seedPosition(key);
  return { x: centroid.x + jitter.x * 0.15, y: centroid.y + jitter.y * 0.15 };
}
