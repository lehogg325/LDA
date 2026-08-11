import type { EgoResponse } from "../api/client";
import { useStore } from "../state/store";

export function TruncationBanner({ ego }: { ego: EgoResponse | undefined }) {
  const hops = useStore((s) => s.hops);
  const setHops = useStore((s) => s.setHops);
  if (!ego?.truncated) return null;
  const dropped = ego.dropped.reduce((a, d) => a + d.dropped_neighbors, 0);
  return (
    <div className="banner banner-warn">
      <span>
        View truncated by server-side caps{dropped > 0 && ` — at least ${dropped.toLocaleString()} neighbors not shown`}.
        {" "}{hops > 1 ? "Reduce hops for a complete picture." : "Narrow the anchor for a complete picture."}
      </span>
      {hops > 1 && <button onClick={() => setHops(1)}>Set hops to 1</button>}
    </div>
  );
}

// A quarter that permanently fails to load (retries exhausted) is simply excluded
// from the union rather than blocking the whole graph — this makes that exclusion
// visible instead of silent.
export function FailedQuartersBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="banner banner-warn">
      {count} quarter{count === 1 ? "" : "s"} failed to load and {count === 1 ? "is" : "are"} excluded
      from this view. The rest of the timeline is unaffected.
    </div>
  );
}

export function LegendBar() {
  const colorMode = useStore((s) => s.colorMode);
  const setColorMode = useStore((s) => s.setColorMode);
  return (
    <div className="legend">
      <span className="color-mode-toggle">
        color by{" "}
        <button className={colorMode === "type" ? "on" : ""} onClick={() => setColorMode("type")}>type</button>
        <button className={colorMode === "community" ? "on" : ""} onClick={() => setColorMode("community")}>community</button>
      </span>
      <span className="sep" />
      {colorMode === "type" ? (
        <>
          <span><i className="dot" style={{ background: "#4997D0" }} /> registrant</span>
          <span><i className="dot" style={{ background: "#FF4F00" }} /> client</span>
          <span><i className="dot" style={{ background: "#54A272" }} /> lobbyist</span>
          <span><i className="dot" style={{ background: "#C97B2F" }} /> gov entity</span>
        </>
      ) : (
        <span>hue = detected community, not node type</span>
      )}
      <span className="sep" />
      <span><i className="sw" style={{ background: "#FFA300" }} /> new this quarter</span>
      <span><i className="sw" style={{ background: "#3c414d" }} /> dropped since last</span>
      <span><i className="sw" style={{ background: "rgba(73,151,208,0.35)" }} /> pre-2021 filing-level entity link</span>
      <span className="hint">hover for the full lobbying chain · click a node for its issues · click an edge for filings</span>
    </div>
  );
}
