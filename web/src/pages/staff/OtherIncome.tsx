import { useState, type FormEvent } from 'react';
import { FACILITIES, FACILITY_LABELS, PAYMENT_LABELS, PAYMENT_METHODS, type Facility, type PaymentMethod } from '../../../../shared/constants';
import { DateRange, useRange } from '../../components/DateRange';
import { Card, Empty, ErrorBox, Field, Icon, Loading, PageHead, Stat, useSubmit, useToast } from '../../components/ui';
import { api, fmtDate, naira } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';

interface Data {
  rows: { id: number; facility: Facility; item: string; customer: string | null; amount: number; method: PaymentMethod; date: string; recorded_by: string }[];
  totals: { facility: Facility; total: number; count: number }[];
}

/** Common items per facility, so the desk taps instead of typing. Amounts stay editable. */
const QUICK: Record<Facility, { item: string; amount: number }[]> = {
  gym: [
    { item: 'Gym day pass', amount: 3000 },
    { item: 'Gym monthly membership', amount: 25000 },
    { item: 'Personal training (4 sessions)', amount: 40000 },
  ],
  pool: [
    { item: 'Pool day pass — adult', amount: 5000 },
    { item: 'Pool day pass — child', amount: 3000 },
    { item: 'Pool party booking', amount: 120000 },
  ],
  lounge: [
    { item: 'VIP table reservation', amount: 20000 },
    { item: 'Friday karaoke night — cover', amount: 2000 },
    { item: 'Lounge hire — private event', amount: 200000 },
  ],
};
const ICON: Record<Facility, string> = { gym: 'dumbbell', pool: 'wave', lounge: 'music' };

export default function OtherIncome() {
  const { user } = useAuth();
  const range = useRange('today');
  const { data, error, reload } = useApi<Data>(`/facility-income?${range.qs}`);
  const [facility, setFacility] = useState<Facility>('gym');
  const [f, setF] = useState({ item: QUICK.gym[0].item, amount: String(QUICK.gym[0].amount), customer: '', method: 'transfer' as PaymentMethod, date: '' });
  const { busy, error: saveErr, submit } = useSubmit();
  const toast = useToast();

  const pickFacility = (x: Facility) => {
    setFacility(x);
    setF({ ...f, item: QUICK[x][0].item, amount: String(QUICK[x][0].amount) });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/facility-income', { body: { facility, item: f.item, amount: Number(f.amount), customer: f.customer, method: f.method, date: f.date || undefined } });
      toast(`${naira(Number(f.amount))} recorded for the ${FACILITY_LABELS[facility].toLowerCase()}`);
      setF({ ...f, customer: '' });
      reload();
    });
  };

  const total = (x: Facility) => data?.totals.find((t) => t.facility === x);

  return (
    <>
      <PageHead title="Gym, pool & lounge" sub="Record every pass, membership and booking so other income shows up in the profit figures." />

      <div className="cards cols-main" style={{ marginBottom: 16, alignItems: 'start' }}>
        <div className="stack">
          <DateRange state={range} />
          <div className="cards cols-3">
            {FACILITIES.map((x) => (
              <Stat key={x} icon={ICON[x]} label={FACILITY_LABELS[x]} value={naira(total(x)?.total ?? 0)} foot={`${total(x)?.count ?? 0} entries`} />
            ))}
          </div>
          <Card pad={false} title="Entries">
            <ErrorBox error={error} />
            {!data ? <Loading /> : data.rows.length === 0 ? <Empty>Nothing recorded for this period yet.</Empty> : (
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Date</th><th>Facility</th><th>Item</th><th>Customer</th><th>Paid by</th><th className="r">Amount</th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="num">{fmtDate(r.date)}</td>
                        <td><span className="badge plain">{FACILITY_LABELS[r.facility]}</span></td>
                        <td>{r.item}</td>
                        <td className="muted">{r.customer ?? '—'}</td>
                        <td>{PAYMENT_LABELS[r.method]}</td>
                        <td className="r strong">{naira(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card title="Record income">
          <form className="stack" onSubmit={onSubmit}>
            <div className="pay-methods" role="group" aria-label="Facility">
              {FACILITIES.map((x) => (
                <button type="button" key={x} aria-pressed={facility === x} onClick={() => pickFacility(x)}>
                  <Icon name={ICON[x]} size={14} /> {FACILITY_LABELS[x].split(' ')[0]}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 6 }}>
              {QUICK[facility].map((q) => (
                <button type="button" key={q.item} className="btn sm" aria-pressed={f.item === q.item} style={f.item === q.item ? { borderColor: 'var(--gold)', background: 'var(--gold-soft)' } : undefined} onClick={() => setF({ ...f, item: q.item, amount: String(q.amount) })}>
                  {q.item.replace(/^(Gym|Pool) /, '')}
                </button>
              ))}
            </div>
            <Field label="What was sold"><input className="input" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} required maxLength={120} /></Field>
            <div className="grid-2">
              <Field label="Amount (₦)"><input className="input num" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} required /></Field>
              <Field label="Paid by">
                <select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Customer (optional)"><input className="input" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} maxLength={120} placeholder="Name or room number" /></Field>
            {can(user, 'manager') && (
              <Field label="Date" hint="Leave empty for today"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            )}
            <ErrorBox error={saveErr} />
            <button className="btn gold lg block" disabled={busy || !f.amount}>{busy ? 'Saving…' : `Record ${f.amount ? naira(Number(f.amount)) : ''}`}</button>
          </form>
        </Card>
      </div>
    </>
  );
}
