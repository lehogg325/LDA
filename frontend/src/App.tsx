import { useEffect } from "react";
import { LegendBar, TruncationBanner } from "./components/Banners";
import { DebugPanel } from "./components/DebugPanel";
import { Footer } from "./components/Footer";
import { GraphView } from "./components/GraphView";
import { QuarterSlider } from "./components/QuarterSlider";
import { SearchBox } from "./components/SearchBox";
import { TimelineStrip } from "./components/TimelineStrip";
import { useEgoWindow } from "./graph/useEgoWindow";
import { useStore } from "./state/store";

export default function App() {
  const anchor = useStore((s) => s.anchor);
  const view = useStore((s) => s.view);
  const hops = useStore((s) => s.hops);
  const quarterOrd = useStore((s) => s.quarterOrd);
  const setQuarterOrd = useStore((s) => s.setQuarterOrd);
  const setView = useStore((s) => s.setView);
  const setHops = useStore((s) => s.setHops);
  const setAnchor = useStore((s) => s.setAnchor);

  const { timeline, presenceQuarters, loadedQuarters, failedQuarters, union, positions, isLoading } =
    useEgoWindow(anchor, hops, view);

  // Default the slider to the latest quarter in the window once loaded.
  useEffect(() => {
    if (union && quarterOrd === null && union.quarters.length > 0) {
      setQuarterOrd(union.quarters[union.quarters.length - 1]);
    }
  }, [union, quarterOrd, setQuarterOrd]);

  const currentEgo = union && quarterOrd !== null ? union.byQuarter.get(quarterOrd) : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <a
          className="masthead"
          href="/"
          title="Back to start"
          onClick={(e) => { e.preventDefault(); setAnchor(null); }}
        >
          <span className="kicker">Lobbying Disclosure Act · 2008 – Present</span>
          <h1>The Lobbying Network</h1>
        </a>
        <SearchBox />
        <div className="controls">
          <label>
            hops{" "}
            <select value={hops} onChange={(e) => setHops(Number(e.target.value) as 1 | 2)}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
          <label title="As currently amended vs. as originally filed — genuinely different histories">
            history{" "}
            <select value={view} onChange={(e) => setView(e.target.value as "amended" | "original")}>
              <option value="amended">as amended</option>
              <option value="original">as filed</option>
            </select>
          </label>
        </div>
      </header>

      {anchor === null ? (
        <div className="empty-state">
          <p>Every quarter since 2008, ten thousand lobbying firms and the interests they
            represent have filed their disclosures. Search for any registrant, client,
            lobbyist, or government entity — and watch its network change, quarter by
            quarter, across eighteen years.</p>
        </div>
      ) : (
        <>
          <div className="status-row">
            <strong>{anchor.label}</strong>
            {anchor.ids.length > 1 && (
              <span className="note"> {anchor.ids.length} registration-scoped IDs shown as one node (records never merged)</span>
            )}
            {isLoading && (
              <span className="loading"> loading window… {loadedQuarters}/{presenceQuarters.length} quarters
                {failedQuarters > 0 && ` (${failedQuarters} failed — retrying)`}</span>
            )}
          </div>
          <TruncationBanner ego={currentEgo} />
          <div className="main-row">
            <GraphView union={union} positions={positions} />
            <DebugPanel />
          </div>
          <LegendBar />
          {union && positions && <QuarterSlider quarters={union.quarters} />}
          <TimelineStrip quarters={timeline} />
        </>
      )}
      <Footer />
    </div>
  );
}
