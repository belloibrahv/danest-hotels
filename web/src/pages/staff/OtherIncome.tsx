import { useEffect, useState, type FormEvent } from 'react';
import { CHARGE_LABELS, CHARGE_METHODS, FACILITIES, FACILITY_LABELS, type ChargeMethod, type Facility } from '../../../../shared/constants';
import { DateRange, useRange } from '../../components/DateRange';
import { Card, Empty, ErrorBox, Field, Icon, Loading, PageHead, Stat, useSubmit, useToast } from '../../components/kit';
import { api, fmtDate, naira } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';

interface Data {
  rows: { id: number; facility: Facility; item: string; customer: string | null; amount: number; method: ChargeMethod; date: string; recorded_by: string; room_number: string | null }[];
  totals: { facility: Facility; total: number; count: number }[];
}

const ICON: Record<Facility, string> = { gym: 'dumbbell', pool: 'wave', lounge: 'music' };

export default function OtherIncome() {
  const { user } = useAuth();
  const range = useRange('today');
  const { data, error, reload } = useApi<Data>(`/facility-income?${range.qs}`);
  const [facility, setFacility] = useState<Facility>('gym');
  // One-tap prices come from the owner's price list in Settings.
  const priceList = useApi<{ id: number; facility: Facility; name: string; price: number }[]>('/settings/facility-items');
  const quick = (x: Facility) => (priceList.data ?? []).filter((i) => i.facility === x).map((i) => ({ item: i.name, amount: i.price }));
  const [f, setF] = useState({ item: '', amount: '', customer: '', method: 'transfer' as ChargeMethod, date: '' });
  useEffect(() => {
    const first = (priceList.data ?? []).find((i) => i.facility === facility);
    if (first && !f.item) setF((x) => ({ ...x, item: first.name, amount: String(first.price) }));
  }, [priceList.data]);
  const [guest, setGuest] = useState<number | ''>('');
  const inhouse = useApi<{ reservation_id: number; room_number: string; guest_name: string }[]>(f.method === 'room' ? '/inhouse' : null);
  const { busy, error: saveErr, submit } = useSubmit();
  const toast = useToast();

  const pickFacility = (x: Facility) => {
    setFacility(x);
    const first = quick(x)[0];
    setF({ ...f, item: first?.item ?? '', amount: first ? String(first.amount) : '' });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/facility-income', {
        body: { facility, item: f.item, amount: Number(f.amount), customer: f.customer, method: f.method, reservation_id: f.method === 'room' ? guest : undefined, date: f.date || undefined },
      });
      toast(f.method === 'room' ? `${naira(Number(f.amount))} added to the room bill` : `${naira(Number(f.amount))} recorded for the ${FACILITY_LABELS[facility].toLowerCase()}`);
      setGuest('');
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
                        <td>{r.method === 'room' ? <span className="badge gold plain">Room {r.room_number}</span> : CHARGE_LABELS[r.method]}</td>
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
              {quick(facility).length === 0 && (
                <span className="muted" style={{ fontSize: 13 }}>
                  {can(user, 'manager') ? <>No prices set for the {FACILITY_LABELS[facility].toLowerCase()}. <a href="/staff/settings?tab=facilities">Add them in Settings</a>.</> : 'No price list yet — type the item and amount.'}
                </span>
              )}
              {quick(facility).map((q) => (
                <button type="button" key={q.item} className="btn sm" aria-pressed={f.item === q.item} style={f.item === q.item ? { borderColor: 'var(--gold)', background: 'var(--gold-soft)' } : undefined} onClick={() => setF({ ...f, item: q.item, amount: String(q.amount) })}>
                  {q.item.replace(/^(Gym|Pool) /, '')}
                </button>
              ))}
            </div>
            <Field label="What was sold"><input className="input" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} required maxLength={120} /></Field>
            <div className="grid-2">
              <Field label="Amount (₦)"><input className="input num" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} required /></Field>
              <Field label="Paid by">
                <select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as ChargeMethod })}>
                  {CHARGE_METHODS.map((m) => <option key={m} value={m}>{CHARGE_LABELS[m]}</option>)}
                </select>
              </Field>
            </div>
            {f.method === 'room' && (
              <Field label="In-house guest">
                <select className="input" value={guest} onChange={(e) => setGuest(e.target.value ? Number(e.target.value) : '')} required>
                  <option value="">Choose a room…</option>
                  {inhouse.data?.map((g) => <option key={g.reservation_id} value={g.reservation_id}>Room {g.room_number} — {g.guest_name}</option>)}
                </select>
              </Field>
            )}
            {f.method !== 'room' && <Field label="Customer (optional)"><input className="input" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} maxLength={120} placeholder="Name or phone" /></Field>}
            {can(user, 'manager') && f.method !== 'room' && (
              <Field label="Date" hint="Leave empty for today"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            )}
            <ErrorBox error={saveErr} />
            <button className="btn gold lg block" disabled={busy || !f.amount || (f.method === 'room' && !guest)}>{busy ? 'Saving…' : `Record ${f.amount ? naira(Number(f.amount)) : ''}`}</button>
          </form>
        </Card>
      </div>
    </>
  );
}
