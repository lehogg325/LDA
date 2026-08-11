// A small categorical palette for coloring nodes by their computed community
// (Leiden clustering, node_metrics.community_id) instead of by node type — an
// analytical signal the pipeline already computes but the graph never displayed.
const COMMUNITY_PALETTE = [
  "#FF4F00", "#4997D0", "#54A272", "#C97B2F", "#B15DE0",
  "#E0C044", "#5DBEB0", "#E0637A", "#8C8C8C", "#6E8EE0",
];

export function communityColor(communityId: number | null): string {
  if (communityId === null) return "#8C8C8C"; // Photographic Gray — no community assigned
  const idx = ((communityId % COMMUNITY_PALETTE.length) + COMMUNITY_PALETTE.length)
    % COMMUNITY_PALETTE.length;
  return COMMUNITY_PALETTE[idx];
}
