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
      <span><i className="dot" style={{ background: "#4997D0" }} /> registrant</span>
      <span><i className="dot" style={{ background: "#FF4F00" }} /> client</span>
      <span><i className="dot" style={{ background: "#54A272" }} /> lobbyist</span>
      <span><i className="dot" style={{ background: "#C97B2F" }} /> gov entity</span>
      <span className="sep" />
      <span><i className="sw" style={{ background: "#FFA300" }} /> new this quarter</span>
      <span><i className="sw" style={{ background: "#3c414d" }} /> dropped since last</span>
      <span><i className="sw" style={{ background: "rgba(73,151,208,0.35)" }} /> pre-2021 filing-level entity link</span>
      <span className="hint">hover to spotlight · click to pin · click an edge for filings</span>
    </div>
  );
}
