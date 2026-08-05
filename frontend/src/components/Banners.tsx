import type { EgoResponse } from "../api/client";

export function TruncationBanner({ ego }: { ego: EgoResponse | undefined }) {
  if (!ego?.truncated) return null;
  const dropped = ego.dropped.reduce((a, d) => a + d.dropped_neighbors, 0);
  return (
    <div className="banner banner-warn">
      View truncated by server-side caps{dropped > 0 && ` — at least ${dropped.toLocaleString()} neighbors not shown`}.
      Narrow the anchor or reduce hops for a complete picture.
    </div>
  );
}

export function LegendBar() {
  return (
    <div className="legend">
      <span><i className="dot" style={{ background: "#2f6fb7" }} /> registrant</span>
      <span><i className="dot" style={{ background: "#c96a2b" }} /> client</span>
      <span><i className="dot" style={{ background: "#5a9e6f" }} /> lobbyist</span>
      <span><i className="dot" style={{ background: "#8a5fa8" }} /> gov entity</span>
      <span className="sep" />
      <span><i className="sw" style={{ background: "#e0a63c" }} /> new this quarter</span>
      <span><i className="sw" style={{ background: "#dcdfe3" }} /> dropped since last</span>
      <span><i className="sw" style={{ background: "#c9b3d9" }} /> pre-2021 filing-level entity link</span>
    </div>
  );
}
