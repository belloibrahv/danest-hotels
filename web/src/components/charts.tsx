import { useState, type ReactNode } from 'react';
import { fmtDate, naira, nairaShort } from '../lib/api';

/**
 * Single-series column chart (one measure over days). Gold marks, recessive grid,
 * 4px rounded tops anchored to the baseline, per-bar hover tooltip, table fallback for screen readers.
 */
export function DailyBars({
  data,
  height = 220,
  label,
  tooltip,
}: {
  data: { date: string; value: number }[];
  height?: number;
  label: string;
  tooltip?: (d: { date: string; value: number }) => ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 48, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const gap = Math.min(4, bw * 0.3);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const every = Math.ceil(data.length / 8);
  const h = hover === null ? null : data[hover];

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {nairaShort(t)}
            </text>
          ))}
          {data.map((d, i) =>
            i % every === 0 ? (
              <text key={d.date} x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle">
                {fmtDate(d.date)}
              </text>
            ) : null,
          )}
        </g>
        {data.map((d, i) => {
          const x = pad.l + i * bw + gap / 2;
          const w = Math.max(1, bw - gap);
          const bh = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, w / 2, bh);
          return (
            <g key={d.date}>
              <path
                className={`bar${hover === i ? ' hover' : ''}${hover !== null && hover !== i ? ' dim' : ''}`}
                d={`M${x},${y(0)} V${y(0) - bh + r} Q${x},${y(0) - bh} ${x + r},${y(0) - bh} H${x + w - r} Q${x + w},${y(0) - bh} ${x + w},${y(0) - bh + r} V${y(0)} Z`}
              />
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="tooltip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: `${(y(h.value) / H) * 100}%` }}>
          {tooltip ? tooltip(h) : (
            <>
              {fmtDate(h.date)}
              <br />
              <b>{naira(h.value)}</b>
            </>
          )}
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{naira(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** Ranked magnitudes with labels and values; color is one hue, never identity. */
export function HBars({ rows, tone = 'gold' }: { rows: { label: ReactNode; value: number; sub?: ReactNode }[]; tone?: 'gold' | 'ink' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div className="hbar" key={i} title={`${naira(r.value)} · ${total ? Math.round((r.value / total) * 100) : 0}%`}>
          <div>{r.label}</div>
          <div className="track">
            <div className={`fill${tone === 'ink' ? ' ink' : ''}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="v">{naira(r.value)}</div>
        </div>
      ))}
    </div>
  );
}
