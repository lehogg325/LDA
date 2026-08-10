// First-run orientation: a scripted walk through a real network (Walmart Inc, Hogan
// Lovells, House of Representatives) that teaches search, the two edge types, the
// node activity panel ("Issues lobbied"), and the quarter slider. Modeled on
// project-backbone's GuidedTour — same step/dots/panel shape — but every step here
// drives the real store against live filing data instead of static preloaded layers,
// so step 1 gates on the ego window actually finishing its fetch.

import { useEffect, useState } from "react";
import type { NodeType } from "../api/client";
import type { Anchor, SelectedNode } from "../state/store";
import { useStore } from "../state/store";

// Resolved directly against the loaded dataset on 2026-08-10 (client/registrant/gov_entity
// ids are stable per the spec — never re-keyed on name). If a future re-ingest ever drops
// one of these ids, the search box still finds the same names; re-resolve here.
const WALMART: Anchor = {
  node_type: "client",
  ids: [102066, 115265, 124339, 149707, 175513, 178530, 183484, 184452, 196162, 198271],
  label: "WALMART INC",
};
const WALMART_ANCHOR_NODE_ID = Math.min(...WALMART.ids);
const HOGAN_LOVELLS: SelectedNode = {
  node_type: "registrant" as NodeType, node_id: 18422,
  label: "HOGAN LOVELLS CADWALADER US LLP (FKA HOGAN LOVELLS US LLP)",
};
const HOUSE_OF_REPS: SelectedNode = {
  node_type: "gov_entity" as NodeType, node_id: 2, label: "HOUSE OF REPRESENTATIVES",
};
// 2026 Q2 — the most recently filed quarter at resolution time. Both example edges
// (Hogan Lovells "represents", House of Representatives "targeted") are live here,
// and have been every quarter for years, so this stays a safe, non-empty pick.
const DEMO_QUARTER_ORD = 20262;

type HighlightTarget = "issues" | "slider";
type StepKind = "search" | "firm" | "gov" | "issues" | "slider";

interface Step {
  kind: StepKind;
  title: string;
  subtitle: string;
  body: string;
  highlight?: HighlightTarget;
}

const STEPS: Step[] = [
  {
    kind: "search",
    title: "Search Any Entity",
    subtitle: "Step 1 of 5",
    body: "Type a name and the app searches every registrant, client, lobbyist, and " +
      "government entity on file. We've searched Walmart Inc — a client that has filed " +
      "lobbying disclosures every year since 2008. Its network is loading below: every " +
      "firm it has retained and every government body it has lobbied, in the most " +
      "recently filed quarter.",
  },
  {
    kind: "firm",
    title: "A Company and Its Firm",
    subtitle: "Step 2 of 5",
    body: "The orange line connects Walmart to Hogan Lovells — a registrant, meaning a " +
      "lobbying firm filing on Walmart's behalf. That's the “represents” " +
      "relationship, one of the two ways nodes connect in this network.",
  },
  {
    kind: "gov",
    title: "Who They Lobbied",
    subtitle: "Step 3 of 5",
    body: "The blue line connects Walmart to the House of Representatives — a " +
      "government entity. That's a “targeted” relationship: a government body " +
      "a disclosed lobbying activity was aimed at.",
  },
  {
    kind: "issues",
    title: "Issues Lobbied",
    subtitle: "Step 4 of 5",
    body: "Click any node to open this panel: what it lobbied on, grouped by issue " +
      "area, for the quarter you're viewing. Expand a group to see individual " +
      "activities — each one links back to the original filing document, so every " +
      "figure on screen traces to a real, public disclosure.",
    highlight: "issues",
  },
  {
    kind: "slider",
    title: "Move Through Time",
    subtitle: "Step 5 of 5",
    body: "This slider is the main event. Drag it, or hit ▶ Play, to move through " +
      "every quarter since this network first appears. Node positions never move — " +
      "only which nodes and edges are visible, and whether they're new, dropped, or " +
      "persisting since last quarter, changes.",
    highlight: "slider",
  },
];

const SUGGESTIONS = [
  { label: "WIDEN THE NETWORK", body: "Switch hops to 2 to pull in second-degree " +
    "connections — who Hogan Lovells' other clients are, for instance." },
  { label: "AS FILED VS. AS AMENDED", body: "Toggle history to “as filed” to " +
    "see the original disclosures before any amendments — genuinely different histories." },
  { label: "SEARCH YOUR OWN", body: "Try any company, firm, lobbyist, or government " +
    "entity you're curious about." },
];

function Dots({ total, current }: { total: number; current: number }) {
  return (
    <div className="guided-tour-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i === current ? "on" : ""} />
      ))}
    </div>
  );
}

function SuggestionCard({ onDone }: { onDone: () => void }) {
  return (
    <div className="guided-tour guided-tour-suggestions">
      <div className="guided-tour-subtitle">TOUR COMPLETE — TRY THIS NEXT</div>
      <div className="guided-tour-title">THREE THINGS WORTH EXPLORING</div>
      <div className="guided-tour-suggestion-list">
        {SUGGESTIONS.map((s) => (
          <div key={s.label} className="guided-tour-suggestion">
            <div className="guided-tour-suggestion-label">{s.label}</div>
            <div className="guided-tour-suggestion-body">{s.body}</div>
          </div>
        ))}
      </div>
      <div className="guided-tour-controls end">
        <button className="guided-tour-btn primary" onClick={onDone}>START EXPLORING →</button>
      </div>
    </div>
  );
}

interface GuidedTourProps {
  onDone: () => void;
  ready: boolean; // the anchor's ego window (union + positions) has finished loading
  onHighlight: (target: HighlightTarget | null) => void;
}

export default function GuidedTour({ onDone, ready, onHighlight }: GuidedTourProps) {
  const [step, setStep] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const setAnchor = useStore((s) => s.setAnchor);
  const setSelectedNode = useStore((s) => s.setSelectedNode);
  const setQuarterOrd = useStore((s) => s.setQuarterOrd);
  const setHops = useStore((s) => s.setHops);
  const setView = useStore((s) => s.setView);

  function applyStep(i: number) {
    switch (STEPS[i].kind) {
      case "search":
        setHops(1);
        setView("amended");
        setAnchor(WALMART);
        setQuarterOrd(DEMO_QUARTER_ORD);
        break;
      case "firm":
        setSelectedNode(HOGAN_LOVELLS);
        break;
      case "gov":
        setSelectedNode(HOUSE_OF_REPS);
        break;
      case "issues":
        setSelectedNode({ node_type: "client", node_id: WALMART_ANCHOR_NODE_ID, label: WALMART.label });
        break;
      case "slider":
        setSelectedNode(null);
        break;
    }
  }

  useEffect(() => { applyStep(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onHighlight(STEPS[step].highlight ?? null);
    return () => onHighlight(null);
  }, [step, onHighlight]);

  function next() {
    if (step < STEPS.length - 1) {
      const n = step + 1;
      setStep(n);
      applyStep(n);
    } else {
      onHighlight(null);
      setShowSuggestions(true);
    }
  }

  function back() {
    if (step > 0) {
      const p = step - 1;
      setStep(p);
      applyStep(p);
    }
  }

  function finish() {
    onHighlight(null);
    onDone();
  }

  if (showSuggestions) return <SuggestionCard onDone={finish} />;

  const s = STEPS[step];
  const waiting = s.kind === "search" && !ready;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="guided-tour">
      <Dots total={STEPS.length} current={step} />
      <div className="guided-tour-subtitle">{s.subtitle}</div>
      <div className="guided-tour-title">{s.title}</div>
      <div className="guided-tour-body">
        {waiting ? "Loading Walmart's network…" : s.body}
      </div>
      <div className="guided-tour-controls">
        <button className="guided-tour-btn" onClick={finish}>SKIP</button>
        <div className="guided-tour-controls-right">
          {step > 0 && <button className="guided-tour-btn" onClick={back}>← BACK</button>}
          <button className="guided-tour-btn primary" onClick={next} disabled={waiting}>
            {isLast ? "DONE →" : "NEXT →"}
          </button>
        </div>
      </div>
    </div>
  );
}
