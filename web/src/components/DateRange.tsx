import { useState } from 'react';
import { addDays, todayISO } from '../lib/api';

export type Range = { from: string; to: string };

const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const prevMonth = (d: string) => {
  const end = addDays(monthStart(d), -1);
  return { from: monthStart(end), to: end };
};

export function presets(): { key: string; label: string; range: Range }[] {
  const t = todayISO();
  return [
    { key: 'today', label: 'Today', range: { from: t, to: t } },
    { key: '7d', label: 'Last 7 days', range: { from: addDays(t, -6), to: t } },
    { key: 'month', label: 'This month', range: { from: monthStart(t), to: t } },
    { key: 'last', label: 'Last month', range: prevMonth(t) },
    { key: '90d', label: 'Last 90 days', range: { from: addDays(t, -89), to: t } },
  ];
}

export function useRange(initial = 'month') {
  const [key, setKey] = useState(initial);
  const [custom, setCustom] = useState<Range>(presets().find((p) => p.key === initial)!.range);
  const range = key === 'custom' ? custom : presets().find((p) => p.key === key)!.range;
  return { key, setKey, range, custom, setCustom, qs: `from=${range.from}&to=${range.to}` };
}

/** One row of filters, above the content it controls. */
export function DateRange({ state }: { state: ReturnType<typeof useRange> }) {
  const t = todayISO();
  return (
    <div className="row">
      <div className="tabs" role="group" aria-label="Date range">
        {presets().map((p) => (
          <button key={p.key} type="button" aria-pressed={state.key === p.key} onClick={() => state.setKey(p.key)}>
            {p.label}
          </button>
        ))}
        <button type="button" aria-pressed={state.key === 'custom'} onClick={() => (state.setCustom(state.range), state.setKey('custom'))}>
          Custom
        </button>
      </div>
      {state.key === 'custom' && (
        <div className="row" style={{ gap: 6 }}>
          <input className="input" type="date" aria-label="From" max={state.custom.to} value={state.custom.from} onChange={(e) => e.target.value && state.setCustom({ ...state.custom, from: e.target.value })} style={{ width: 160 }} />
          <span className="muted">to</span>
          <input className="input" type="date" aria-label="To" min={state.custom.from} max={t} value={state.custom.to} onChange={(e) => e.target.value && state.setCustom({ ...state.custom, to: e.target.value })} style={{ width: 160 }} />
        </div>
      )}
    </div>
  );
}
