import { CheckCircle2, ChevronLeft, ChevronRight, Lock, LockOpen, SprayCan } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Field, MoneyInput } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { addDays, api, fmtDate, fmtDateLong, fmtDateTime, naira, pct } from '@/lib/api';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { Kpis } from './Dashboard';
import { useDesk } from './desk/Desk';

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
    no_shows: { id: number; code: string; check_in: string; guest_name: string; room_type: string }[];
    overdue: { id: number; check_out: string; guest_name: string; room_number: string | null; balance: number }[];
    unpaid: { id: number; guest_name: string; room_number: string | null; balance: number }[];
    dirty_rooms: number;
  };
  report: Report;
  history: { date: string; variance: number; closed_by_name: string }[];
}

/** Night audit: clear what is left open, count the drawer, close and lock the day. */
export default function CloseDay() {
  const desk = useDesk();
  const [date, setDate] = useState<string | null>(null);
  const { data, error, reload } = useApi<View>(`/close-day?${date ? `date=${date}&` : ''}v=${desk.version}`);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [reopening, setReopening] = useState(false);
  const { busy, error: closeErr, submit } = useSubmit();

  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={8} />;
  const r = data.closed?.summary ?? data.report;
  const expected = data.closed?.expected_cash ?? r.collections.byMethod.cash ?? 0;
  const variance = counted === '' ? null : Number(counted) - expected;
  const canClose = !data.closed && (!data.last_closed || data.date === addDays(data.last_closed, 1));
  const open = data.checks.no_shows.length + data.checks.overdue.length;
  const noShow = (id: number) => api(`/reservations/${id}/no-show`, { body: {} }).then(() => (toast.success('Marked as no-show'), desk.changed()), (e) => toast.error(e.message));

  const close = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/close-day', { body: { date: data.date, counted_cash: Number(counted), notes } });
      toast.success(`${fmtDateLong(data.date)} is closed`);
      setCounted('');
      setNotes('');
      reload();
    });
  };

  return (
    <>
      <PageHeader
        title="Close the day"
        description={data.closed ? `Closed by ${data.closed.closed_by_name} · ${fmtDateTime(data.closed.closed_at)}` : 'Clear what is open, count the cash drawer, and lock the day.'}
        actions={
          <div className="flex items-center rounded-md border">
            <Button variant="ghost" size="icon" className="rounded-r-none" onClick={() => setDate(addDays(data.date, -1))} aria-label="Previous day">
              <ChevronLeft />
            </Button>
            <span className="border-x px-3 text-sm font-medium tabular-nums">{fmtDateLong(data.date)}</span>
            <Button variant="ghost" size="icon" className="rounded-l-none" disabled={data.date >= data.today} onClick={() => setDate(addDays(data.date, 1))} aria-label="Next day">
              <ChevronRight />
            </Button>
          </div>
        }
      />
      {data.last_closed && (
        <p className="-mt-3 mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-3.5" /> Books closed up to <b className="text-foreground">{fmtDateLong(data.last_closed)}</b>. Nothing can be recorded on or before that date.
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Earned" value={<Money value={r.totalRevenue} />} hint={`Spent ${naira(r.expenses)}`} />
        <StatCard label="Collected" value={<Money value={r.collections.total} />} hint={`Cash ${naira(r.collections.byMethod.cash ?? 0)}`} />
        <StatCard label="Occupancy" value={pct(r.kpis.occupancy)} hint={`${r.kpis.roomNightsSold} rooms · ADR ${naira(r.kpis.adr)}`} />
        <StatCard label="Arrivals · departures" value={`${r.arrivals} · ${r.departures}`} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {!data.closed && (
            <Section title={open ? `${open} to sort before closing` : 'Nothing left open'} description="Every booking should end the day arrived, cancelled or a no-show." flush>
              {open === 0 && data.checks.unpaid.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="All clear" className="py-8">All arrivals are in and no one is past their departure date.</EmptyState>
              ) : (
                <Table>
                  <TableBody>
                    {data.checks.no_shows.map((n) => (
                      <TableRow key={`n${n.id}`}>
                        <TableCell className="pl-5"><StatusPill tone="warning">Didn't arrive</StatusPill></TableCell>
                        <TableCell>
                          <div className="font-medium">{n.guest_name}</div>
                          <div className="text-xs text-muted-foreground">{n.room_type} · due {fmtDate(n.check_in)}</div>
                        </TableCell>
                        <TableCell className="pr-5 text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => desk.openReservation(n.id)}>Open</Button>
                          <Button variant="outline" size="sm" onClick={() => noShow(n.id)}>No-show</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.checks.overdue.map((o) => (
                      <TableRow key={`o${o.id}`}>
                        <TableCell className="pl-5"><StatusPill tone="danger">Past departure</StatusPill></TableCell>
                        <TableCell>
                          <div className="font-medium">{o.guest_name}</div>
                          <div className="text-xs text-muted-foreground">Room {o.room_number} · due out {fmtDate(o.check_out)}{o.balance > 0 ? ` · owes ${naira(o.balance)}` : ''}</div>
                        </TableCell>
                        <TableCell className="pr-5 text-right"><Button variant="outline" size="sm" onClick={() => desk.openReservation(o.id)}>Check out or extend</Button></TableCell>
                      </TableRow>
                    ))}
                    {data.checks.unpaid.map((u) => (
                      <TableRow key={`u${u.id}`}>
                        <TableCell className="pl-5"><StatusPill>Owes</StatusPill></TableCell>
                        <TableCell>
                          <div className="font-medium">{u.guest_name}</div>
                          <div className="text-xs text-muted-foreground">Room {u.room_number} · in house · {naira(u.balance)} on the bill</div>
                        </TableCell>
                        <TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={() => desk.openReservation(u.id)}>Open bill</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {data.checks.dirty_rooms > 0 && (
                <div className="flex items-center gap-2 border-t px-5 py-3 text-sm text-muted-foreground">
                  <SprayCan className="size-4" /> {data.checks.dirty_rooms} room{data.checks.dirty_rooms > 1 ? 's' : ''} still to clean.
                  <Link to="/staff/housekeeping" className="font-medium text-foreground underline-offset-4 hover:underline">Housekeeping</Link>
                </div>
              )}
            </Section>
          )}

          <Section title="The day's money">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2 text-sm">
                <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Earned</div>
                {r.revenue.filter((x) => x.amount > 0).map((x) => (
                  <div key={x.key} className="flex justify-between"><span>{x.label}</span><Money value={x.amount} /></div>
                ))}
                {r.totalRevenue === 0 && <p className="text-muted-foreground">Nothing earned.</p>}
                <div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><Money value={r.totalRevenue} /></div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Collected</div>
                {Object.entries(r.collections.bySource).map(([k, v]) => (
                  <div key={k} className="flex justify-between"><span>{k}</span><Money value={v} /></div>
                ))}
                {r.collections.total === 0 && <p className="text-muted-foreground">Nothing collected.</p>}
                <div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><Money value={r.collections.total} /></div>
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-6 xl:sticky xl:top-20">
          {data.closed ? (
            <Section title={<span className="flex items-center gap-2"><Lock className="size-4" /> Day closed</span>}>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt>Cash expected</dt><Money value={data.closed.expected_cash} /></div>
                <div className="flex justify-between"><dt>Cash counted</dt><Money value={data.closed.counted_cash} /></div>
                <div className="flex justify-between font-semibold">
                  <dt>Difference</dt>
                  <span className={data.closed.variance === 0 ? 'text-success' : 'text-destructive'}>{data.closed.variance === 0 ? 'Balanced' : naira(data.closed.variance)}</span>
                </div>
              </dl>
              {data.closed.notes && <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm">“{data.closed.notes}”</p>}
              {data.date === data.last_closed && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setReopening(true)}>
                  <LockOpen /> Reopen this day
                </Button>
              )}
            </Section>
          ) : canClose ? (
            <Section title="Count the cash drawer" description="Count the notes and type the total. Check transfers and POS against the bank and POS slips.">
              <form className="grid gap-4" onSubmit={close}>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between font-medium"><dt>Cash expected</dt><Money value={expected} /></div>
                  <div className="flex justify-between text-muted-foreground"><dt>Transfers to check</dt><Money value={r.collections.byMethod.transfer ?? 0} /></div>
                  <div className="flex justify-between text-muted-foreground"><dt>POS slips to check</dt><Money value={r.collections.byMethod.pos ?? 0} /></div>
                  {!!r.collections.byMethod.online && <div className="flex justify-between text-muted-foreground"><dt>Paid online (Paystack)</dt><Money value={r.collections.byMethod.online} /></div>}
                </dl>
                <Field label="Cash counted">
                  <MoneyInput value={counted} onChange={setCounted} required className="[&_input]:h-12 [&_input]:text-lg" />
                </Field>
                {variance !== null && (
                  <div className={cn('rounded-md border px-3 py-2.5 text-sm font-medium', variance === 0 ? 'border-success/30 bg-success-soft text-success' : 'border-destructive/30 bg-danger-soft text-destructive')}>
                    {variance === 0 ? 'Balanced to the naira' : variance > 0 ? `${naira(variance)} over` : `${naira(-variance)} short`}
                  </div>
                )}
                <Field label={variance ? 'Explain the difference (required)' : 'Notes'}>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} required={!!variance} rows={2} />
                </Field>
                <ErrorNote error={closeErr} />
                {open > 0 && (
                  <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm">
                    Sort the {open} booking{open > 1 ? 's' : ''} under “to sort before closing” first: check in, mark as no-show, extend or check out.
                  </p>
                )}
                <Button size="lg" disabled={busy || counted === '' || open > 0}>
                  <Lock /> Close {fmtDate(data.date)}
                </Button>
                <p className="text-xs text-muted-foreground">After closing, no payment, sale or expense can be dated on or before this day unless a manager reopens it. Reopening is logged.</p>
              </form>
            </Section>
          ) : (
            <Section title="Not ready to close">
              <p className="text-sm text-muted-foreground">Days close in order. Close <b className="text-foreground">{fmtDateLong(addDays(data.last_closed!, 1))}</b> first.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setDate(addDays(data.last_closed!, 1))}>Go to that day</Button>
            </Section>
          )}

          {data.history.length > 0 && (
            <Section title="Recent closings" flush>
              <Table>
                <TableBody>
                  {data.history.map((h) => (
                    <TableRow key={h.date} className="cursor-pointer" onClick={() => setDate(h.date)}>
                      <TableCell className="pl-5 tabular-nums">{fmtDate(h.date)}</TableCell>
                      <TableCell className="text-muted-foreground">{h.closed_by_name}</TableCell>
                      <TableCell className="pr-5 text-right">{h.variance === 0 ? <StatusPill tone="success">Balanced</StatusPill> : <StatusPill tone="danger">{naira(h.variance)}</StatusPill>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          )}
        </div>
      </div>
      <Reopen open={reopening} onClose={() => setReopening(false)} onDone={() => (setReopening(false), reload())} />
    </>
  );
}

function Reopen({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reopen the day</DialogTitle>
          <DialogDescription>Money can be recorded on that day again. The reason is kept in the activity log.</DialogDescription>
        </DialogHeader>
        <form id="reopen" onSubmit={(e) => (e.preventDefault(), submit(async () => (await api('/close-day/reopen', { body: { reason } }), toast.success('Day reopened'), setReason(''), onDone())))}>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={300} placeholder="Diesel receipt came in late" /></Field>
          <div className="mt-3"><ErrorNote error={error} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="reopen" variant="destructive" disabled={busy}>Reopen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
