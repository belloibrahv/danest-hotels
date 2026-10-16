import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useDesk } from '../../components/Desk';
import { Card, ErrorBox, Field, Icon, Loading, Modal, PageHead, Stat, useSubmit, useToast } from '../../components/kit';
import { addDays, api, fmtDate, fmtDateLong, fmtDateTime, naira, pct } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Kpis } from './Dashboard';

interface Report {
  revenue: { key: string; label: string; amount: number }[];
  totalRevenue: number;
  expenses: number;
  kpis: Kpis;
  collections: { byMethod: Record<string, number>; bySource: Record<string, number>; total: number };
  arrivals: number;
  departures: number;
}
interface View {
  date: string;
  today: string;
  last_closed: string | null;
  closed: null | { closed_by_name: string; closed_at: string; expected_cash: number; counted_cash: number; variance: number; notes: string | null; summary: Report };
  checks: {
    no_shows: { id: number; code: string; check_in: string; status: string; guest_name: string; room_type: string }[];
    overdue: { id: number; code: string; check_out: string; guest_name: string; room_number: string | null; balance: number }[];
    unpaid: { id: number; code: string; guest_name: string; room_number: string | null; balance: number }[];
    dirty_rooms: number;
  };
  report: Report;
  history: { date: string; expected_cash: number; counted_cash: number; variance: number; closed_at: string; closed_by_name: string }[];
}

/** Night audit: clear what is left open, count the drawer, close the books for the day. */
export default function CloseDay() {
  const desk = useDesk();
  const toast = useToast();
  const [date, setDate] = useState<string | null>(null);
  const { data, error, reload } = useApi<View>(`/close-day${date ? `?date=${date}` : ''}${date ? '&' : '?'}v=${desk.version}`);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [reopening, setReopening] = useState(false);
  const { busy, error: closeErr, submit } = useSubmit();

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const r = data.closed?.summary ?? data.report;
  const expectedCash = data.closed?.expected_cash ?? r.collections.byMethod.cash ?? 0;
  const variance = counted === '' ? null : Number(counted) - expectedCash;
  const canClose = !data.closed && (!data.last_closed || data.date === addDays(data.last_closed, 1));
  const noShow = (id: number) => api(`/reservations/${id}/no-show`, { body: {} }).then(() => (toast('Marked as no-show'), desk.changed()), (e) => toast(e.message));

  const close = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/close-day', { body: { date: data.date, counted_cash: Number(counted), notes } });
      toast(`${fmtDateLong(data.date)} is closed`);
      setCounted('');
      setNotes('');
      reload();
    });
  };

  const open = data.checks.no_shows.length + data.checks.overdue.length;

  return (
    <>
      <PageHead
        title="Close the day"
        sub={data.closed ? `Closed by ${data.closed.closed_by_name} · ${fmtDateTime(data.closed.closed_at)}` : 'Clear what is left open, count the cash drawer, and lock the day.'}
      >
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setDate(addDays(data.date, -1))} aria-label="Previous day">‹</button>
          <span className="badge plain" style={{ height: 32, padding: '0 12px', fontSize: 13 }}>{fmtDateLong(data.date)}</span>
          <button className="btn sm" disabled={data.date >= data.today} onClick={() => setDate(addDays(data.date, 1))} aria-label="Next day">›</button>
        </div>
      </PageHead>

      {data.last_closed && <p className="muted" style={{ marginTop: -12, marginBottom: 16, fontSize: 14 }}>Books are closed up to <b>{fmtDateLong(data.last_closed)}</b>. Money can't be recorded on or before that date.</p>}

      <div className="cards cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="receipt" label="Earned" value={naira(r.totalRevenue)} foot={`Spent ${naira(r.expenses)}`} />
        <Stat icon="bolt" label="Collected" value={naira(r.collections.total)} foot={`Cash ${naira(r.collections.byMethod.cash ?? 0)} · Transfer ${naira(r.collections.byMethod.transfer ?? 0)} · POS ${naira(r.collections.byMethod.pos ?? 0)}`} />
        <Stat icon="bed" label="Occupancy" value={pct(r.kpis.occupancy)} foot={`${r.kpis.roomNightsSold} rooms · ADR ${naira(r.kpis.adr)}`} />
        <Stat icon="calendar" label="Arrivals · departures" value={`${r.arrivals} · ${r.departures}`} />
      </div>

      <div className="cards cols-main" style={{ alignItems: 'start' }}>
        <div className="stack">
          {!data.closed && (
            <Card title={open ? `${open} thing${open > 1 ? 's' : ''} to sort before closing` : 'Nothing left open'} sub="Each booking should end the day as arrived, cancelled or a no-show." pad={false}>
              {open === 0 && data.checks.unpaid.length === 0 ? (
                <div className="empty">All arrivals are in and no one is past their departure date.</div>
              ) : (
                <div className="table-wrap">
                  <table className="t">
                    <tbody>
                      {data.checks.no_shows.map((n) => (
                        <tr key={`n${n.id}`}>
                          <td><span className="badge amber">Didn't arrive</span></td>
                          <td><b>{n.guest_name}</b><div className="muted" style={{ fontSize: 12.5 }}>{n.room_type} · due {fmtDate(n.check_in)} · {n.code}</div></td>
                          <td className="r" style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn sm ghost" onClick={() => desk.openReservation(n.id)}>Open</button>
                            <button className="btn sm" onClick={() => noShow(n.id)}>No-show</button>
                          </td>
                        </tr>
                      ))}
                      {data.checks.overdue.map((o) => (
                        <tr key={`o${o.id}`}>
                          <td><span className="badge red">Past departure</span></td>
                          <td><b>{o.guest_name}</b><div className="muted" style={{ fontSize: 12.5 }}>Room {o.room_number} · was due out {fmtDate(o.check_out)}{o.balance > 0 ? ` · owes ${naira(o.balance)}` : ''}</div></td>
                          <td className="r"><button className="btn sm" onClick={() => desk.openReservation(o.id)}>Check out or extend</button></td>
                        </tr>
                      ))}
                      {data.checks.unpaid.map((u) => (
                        <tr key={`u${u.id}`}>
                          <td><span className="badge plain">Owes</span></td>
                          <td><b>{u.guest_name}</b><div className="muted" style={{ fontSize: 12.5 }}>Room {u.room_number} · in house · {naira(u.balance)} on the bill</div></td>
                          <td className="r"><button className="btn sm ghost" onClick={() => desk.openReservation(u.id)}>Open bill</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.checks.dirty_rooms > 0 && (
                <div className="card-body muted" style={{ borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
                  {data.checks.dirty_rooms} room{data.checks.dirty_rooms > 1 ? 's are' : ' is'} still waiting for housekeeping. <Link to="/staff/housekeeping">See housekeeping</Link>
                </div>
              )}
            </Card>
          )}

          <Card title="Where the day's money came from">
            <div className="stack" style={{ gap: 8 }}>
              {r.revenue.filter((x) => x.amount > 0).map((x) => (
                <div key={x.key} className="row" style={{ justifyContent: 'space-between' }}><span>{x.label}</span><b className="num">{naira(x.amount)}</b></div>
              ))}
              {r.totalRevenue === 0 && <span className="muted">Nothing earned on this day.</span>}
              <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 8 }}><b>Total earned</b><b className="num">{naira(r.totalRevenue)}</b></div>
            </div>
          </Card>
        </div>

        <div className="stack">
          {data.closed ? (
            <Card title={<span className="row" style={{ gap: 8 }}><Icon name="lock" size={16} /> Day closed</span>}>
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>Cash expected</span><b className="num">{naira(data.closed.expected_cash)}</b></div>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>Cash counted</span><b className="num">{naira(data.closed.counted_cash)}</b></div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>Difference</span>
                  <b className="num" style={{ color: data.closed.variance === 0 ? 'var(--green)' : 'var(--red)' }}>{data.closed.variance === 0 ? 'Balanced' : naira(data.closed.variance)}</b>
                </div>
                {data.closed.notes && <div className="muted" style={{ fontSize: 14 }}>“{data.closed.notes}”</div>}
                {data.date === data.last_closed && (
                  <button className="btn sm danger" style={{ justifySelf: 'start', marginTop: 8 }} onClick={() => setReopening(true)}>Reopen this day</button>
                )}
              </div>
            </Card>
          ) : canClose ? (
            <Card title="Count the cash drawer" sub="Count the notes in the drawer and type the total. Transfers and POS are checked against the bank and POS slips.">
              <form className="stack" onSubmit={close}>
                <div className="stack" style={{ gap: 6, fontSize: 14 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span>Cash the system expects</span><b className="num">{naira(expectedCash)}</b></div>
                  <div className="row muted" style={{ justifyContent: 'space-between' }}><span>Transfers to check</span><span className="num">{naira(r.collections.byMethod.transfer ?? 0)}</span></div>
                  <div className="row muted" style={{ justifyContent: 'space-between' }}><span>POS slips to check</span><span className="num">{naira(r.collections.byMethod.pos ?? 0)}</span></div>
                </div>
                <Field label="Cash counted (₦)">
                  <input className="input num" style={{ fontSize: 20, height: 52 }} inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} required />
                </Field>
                {variance !== null && (
                  <div className={`status-card ${variance === 0 ? 'green' : 'red'}`} style={{ padding: '12px 14px' }}>
                    <b style={{ fontSize: 15 }}>{variance === 0 ? 'Balanced to the naira' : variance > 0 ? `${naira(variance)} over` : `${naira(-variance)} short`}</b>
                  </div>
                )}
                <Field label={variance ? 'Explain the difference (required)' : 'Notes (optional)'}>
                  <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} required={!!variance} />
                </Field>
                <ErrorBox error={closeErr} />
                <button className="btn primary lg block" disabled={busy || counted === ''}>
                  <Icon name="lock" size={16} /> Close {fmtDate(data.date)}
                </button>
                <p className="muted" style={{ fontSize: 12.5 }}>After closing, no payment, sale or expense can be recorded on or before this day unless a manager reopens it. Reopening is logged.</p>
              </form>
            </Card>
          ) : (
            <Card title="Not ready to close">
              <p className="muted">Days are closed in order. Close <b>{fmtDateLong(addDays(data.last_closed!, 1))}</b> first.</p>
              <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setDate(addDays(data.last_closed!, 1))}>Go to that day</button>
            </Card>
          )}

          {data.history.length > 0 && (
            <Card title="Recent closings" pad={false}>
              <table className="t">
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.date} className="click" onClick={() => setDate(h.date)}>
                      <td className="num">{fmtDate(h.date)}</td>
                      <td className="muted">{h.closed_by_name}</td>
                      <td className="r">{h.variance === 0 ? <span className="badge green">Balanced</span> : <span className="badge red">{naira(h.variance)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>

      {reopening && <Reopen onClose={() => setReopening(false)} onDone={() => (setReopening(false), reload())} />}
    </>
  );
}

function Reopen({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  return (
    <Modal title="Reopen the day" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), submit(async () => (await api('/close-day/reopen', { body: { reason } }), toast('Day reopened — this is in the activity log'), onDone())))}>
        <p className="muted">Reopening lets money be recorded on that day again. Say why — it's kept in the activity log.</p>
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={300} placeholder="e.g. Diesel receipt came in late" /></Field>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={busy}>Reopen</button>
        </div>
      </form>
    </Modal>
  );
}
