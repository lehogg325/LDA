// Clickable strip below the graph: the anchor's reported money by quarter.
// Income and expenses are separate series — never stacked into one figure (spec).

import type { TimelineQuarter } from "../api/client";
import { useStore } from "../state/store";

const W = 900, H = 110, PAD = 8;

export function TimelineStrip({ quarters }: { quarters: TimelineQuarter[] }) {
  const quarterOrd = useStore((s) => s.quarterOrd);
  const setQuarterOrd = useStore((s) => s.setQuarterOrd);
  if (quarters.length === 0) return null;

  const bw = (W - 2 * PAD) / quarters.length;
  const maxMoney = Math.max(1, ...quarters.map((q) => Math.max(q.total_income ?? 0, q.total_expenses ?? 0)));
  const moneyH = (v: number | null) => ((v ?? 0) / maxMoney) * (H - 30);

  return (
    <div className="timeline-strip">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {quarters.map((q, i) => (
          <g key={q.period_ord} onClick={() => setQuarterOrd(q.period_ord)} className="strip-col">
            <rect
              x={PAD + i * bw} y={0} width={bw} height={H - 14}
              fill={q.period_ord === quarterOrd ? "rgba(255, 163, 0, 0.16)" : "transparent"}
            />
            <rect
              x={PAD + i * bw + bw * 0.15} width={bw * 0.3}
              y={H - 22 - moneyH(q.total_income)} height={moneyH(q.total_income)}
              fill="#FF4F00"
            >
              <title>{`${q.year} — income $${(q.total_income ?? 0).toLocaleString()}`}</title>
            </rect>
            <rect
              x={PAD + i * bw + bw * 0.55} width={bw * 0.3}
              y={H - 22 - moneyH(q.total_expenses)} height={moneyH(q.total_expenses)}
              fill="#4997D0"
            >
              <title>{`${q.year} — expenses $${(q.total_expenses ?? 0).toLocaleString()}`}</title>
            </rect>
            {q.period.startsWith("first") && (
              <text x={PAD + i * bw + 1} y={H - 3} className="strip-year">{q.year}</text>
            )}
          </g>
        ))}
      </svg>
      <div className="strip-legend">
        <span><i className="sw" style={{ background: "#FF4F00" }} /> reported income</span>
        <span><i className="sw" style={{ background: "#4997D0" }} /> reported expenses</span>
      </div>
    </div>
  );
}
