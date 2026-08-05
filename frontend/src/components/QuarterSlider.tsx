// The primary longitudinal control (spec): a quarter slider over the anchor's window.
// Moving it only changes which nodes/edges are drawn — the layout never moves.

import { useEffect, useRef, useState } from "react";
import { periodLabel } from "../api/client";
import { useStore } from "../state/store";

export function QuarterSlider({ quarters }: { quarters: number[] }) {
  const quarterOrd = useStore((s) => s.quarterOrd);
  const setQuarterOrd = useStore((s) => s.setQuarterOrd);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<number | undefined>(undefined);

  const idx = quarterOrd !== null ? quarters.indexOf(quarterOrd) : -1;

  useEffect(() => {
    if (!playing) { window.clearInterval(playRef.current); return; }
    playRef.current = window.setInterval(() => {
      const cur = useStore.getState().quarterOrd;
      const i = cur !== null ? quarters.indexOf(cur) : -1;
      if (i < 0 || i >= quarters.length - 1) setPlaying(false);
      else setQuarterOrd(quarters[i + 1]);
    }, 900);
    return () => window.clearInterval(playRef.current);
  }, [playing, quarters, setQuarterOrd]);

  if (quarters.length === 0 || quarterOrd === null) return null;
  const label = (ord: number) =>
    `${Math.floor(ord / 10)} ${periodLabel(["", "first_quarter", "second_quarter", "third_quarter", "fourth_quarter", "mid_year", "year_end"][ord % 10])}`;

  return (
    <div className="quarter-slider">
      <button onClick={() => setPlaying(!playing)} title="Play through quarters">
        {playing ? "⏸" : "▶"}
      </button>
      <input
        type="range"
        min={0}
        max={quarters.length - 1}
        value={Math.max(0, idx)}
        onChange={(e) => setQuarterOrd(quarters[Number(e.target.value)])}
      />
      <span className="quarter-label">{label(quarterOrd)}</span>
    </div>
  );
}
