import { useState, type FormEvent } from 'react';
import { EXPENSE_CATEGORIES, PAYMENT_LABELS, PAYMENT_METHODS, type ExpenseCategory, type PaymentMethod } from '../../../../shared/constants';
import { HBars } from '../../components/charts';
import { DateRange, useRange } from '../../components/DateRange';
import { Card, Empty, ErrorBox, Field, Loading, PageHead, useSubmit, useToast } from '../../components/ui';
import { api, fmtDate, naira, todayISO } from '../../lib/api';
import { useApi } from '../../lib/hooks';

interface Data {
  rows: { id: number; date: string; category: ExpenseCategory; description: string; paid_to: string | null; amount: number; method: PaymentMethod; recorded_by: string }[];
  totals: { category: ExpenseCategory; total: number }[];
}

const LABEL = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label])) as Record<ExpenseCategory, string>;

/** One-tap starting points for the costs the hotel pays most often. */
const QUICK: { category: ExpenseCategory; description: string }[] = [
  { category: 'diesel', description: 'Diesel for generator' },
  { category: 'electricity', description: 'Prepaid electricity units (IBEDC)' },
  { category: 'salaries', description: 'Monthly payroll' },
  { category: 'repairs', description: 'Generator servicing' },
  { category: 'housekeeping', description: 'Toiletries, detergent & laundry' },
];

export default function Expenses() {
  const range = useRange('month');
  const { data, error, reload } = useApi<Data>(`/expenses?${range.qs}`);
  const [cat, setCat] = useState<ExpenseCategory | 'all'>('all');
  const [f, setF] = useState({ category: 'diesel' as ExpenseCategory, description: '', paid_to: '', amount: '', method: 'transfer' as PaymentMethod, date: todayISO() });
  const { busy, error: saveErr, submit } = useSubmit();
  const toast = useToast();
  const total = data?.totals.reduce((a, t) => a + t.total, 0) ?? 0;
  const rows = data?.rows.filter((r) => cat === 'all' || r.category === cat) ?? [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/expenses', { body: { ...f, amount: Number(f.amount) } });
      toast(`${LABEL[f.category]}: ${naira(Number(f.amount))} recorded`);
      setF({ ...f, description: '', paid_to: '', amount: '' });
      reload();
    });
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this expense? The deletion is kept in the activity log.')) return;
    await api(`/expenses/${id}`, { method: 'DELETE' }).then(() => (toast('Expense deleted'), reload()), (e) => toast(e.message));
  };

  return (
    <>
      <PageHead title="Expenses" sub="Salaries, diesel, NEPA, repairs and every other running cost. These come straight off the profit." />
      <div className="row" style={{ marginBottom: 16 }}>
        <DateRange state={range} />
      </div>

      <div className="cards cols-main" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card title={`${naira(total)} spent`} sub="By category · tap a bar's label to filter the list">
            {!data ? <Loading /> : data.totals.length === 0 ? <Empty>No expenses yet in this period.</Empty> : (
              <HBars
                tone="ink"
                rows={data.totals.map((t) => ({
                  label: (
                    <button className="btn ghost sm" style={{ padding: 0, height: 'auto', fontWeight: cat === t.category ? 800 : 500 }} onClick={() => setCat(cat === t.category ? 'all' : t.category)}>
                      {LABEL[t.category] ?? t.category}
                    </button>
                  ),
                  value: t.total,
                }))}
              />
            )}
          </Card>
          <Card pad={false} title={cat === 'all' ? 'All expenses' : LABEL[cat]} action={cat !== 'all' && <button className="btn sm" onClick={() => setCat('all')}>Show all</button>}>
            <ErrorBox error={error} />
            {rows.length === 0 ? <Empty>Nothing to show.</Empty> : (
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Date</th><th>What</th><th>Category</th><th>Paid to</th><th className="r">Amount</th><th /></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="num">{fmtDate(r.date)}</td>
                        <td>{r.description}<div className="muted" style={{ fontSize: 12.5 }}>{PAYMENT_LABELS[r.method]} · {r.recorded_by}</div></td>
                        <td><span className="badge plain">{LABEL[r.category] ?? r.category}</span></td>
                        <td className="muted">{r.paid_to ?? '—'}</td>
                        <td className="r strong">{naira(r.amount)}</td>
                        <td className="r"><button className="btn ghost sm danger" onClick={() => remove(r.id)} aria-label={`Delete ${r.description}`}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card title="Record an expense">
          <form className="stack" onSubmit={onSubmit}>
            <div className="row" style={{ gap: 6 }}>
              {QUICK.map((q) => (
                <button type="button" key={q.description} className="btn sm" onClick={() => setF({ ...f, category: q.category, description: q.description })}>
                  {LABEL[q.category].split(' (')[0]}
                </button>
              ))}
            </div>
            <Field label="Category">
              <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategory })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="What was it for"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required maxLength={200} placeholder="e.g. Diesel 200 litres" /></Field>
            <div className="grid-2">
              <Field label="Amount (₦)"><input className="input num" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} required /></Field>
              <Field label="Date"><input className="input" type="date" max={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
            </div>
            <div className="grid-2">
              <Field label="Paid to (optional)"><input className="input" value={f.paid_to} onChange={(e) => setF({ ...f, paid_to: e.target.value })} maxLength={120} /></Field>
              <Field label="Paid by">
                <select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                </select>
              </Field>
            </div>
            <ErrorBox error={saveErr} />
            <button className="btn primary lg block" disabled={busy}>{busy ? 'Saving…' : 'Record expense'}</button>
          </form>
        </Card>
      </div>
    </>
  );
}
