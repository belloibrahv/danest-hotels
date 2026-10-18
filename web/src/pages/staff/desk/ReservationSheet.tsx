import { ArrowLeftRight, Building2, CalendarDays, Check, LogOut, MessageCircle, Phone, Printer, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ALL_PAYMENT_LABELS,
  MESSAGE_TEMPLATE_LABELS,
  MESSAGE_TEMPLATES,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  SOURCE_LABELS,
  type MessageTemplate,
  type PaymentMethod,
  type ReservationSource,
  type ReservationStatus,
} from '../../../../../shared/constants';
import { useDesk } from './Desk';
import { useFreeRooms } from './NewReservation';
import { DateInput, Field, MoneyInput, SelectField, useConfirm } from '@/components/app/form';
import { ErrorNote, KeyValue, LoadingRows, Money } from '@/components/app/page';
import { ReservationStatusPill, StatusPill, VipBadge } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableFooter, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { addDays, api, fmtDate, fmtDateLong, fmtDateTime, naira, nightsBetween, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export interface Reservation {
  taxes?: { name: string; rate: number; base: number; amount: number }[];
  id: number;
  code: string;
  check_in: string;
  check_out: string;
  nights: number;
  rate: number;
  total: number;
  charges: number;
  paid: number;
  status: ReservationStatus;
  source: ReservationSource;
  adults: number;
  notes: string | null;
  guest_id: number;
  guest_name: string;
  guest_phone: string;
  guest_email: string | null;
  guest_vip: number;
  room_type: string;
  room_type_id: number;
  room_number: string | null;
  room_id: number | null;
  company_id: number | null;
  company_name: string | null;
  bill_to_company: number;
  rate_note: string | null;
  created_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  /** What is still owed (negative: owed to the guest). A cancelled booking owes only the deposit kept. */
  balance: number;
  retained: number;
  cancelled_on: string | null;
  payments?: { id: number; amount: number; method: string; date: string; received_by: string | null }[];
  refunds?: { id: number; amount: number; method: string; date: string; reason: string; refunded_by: string | null }[];
  folio?: { date: string; kind: string; description: string; amount: number }[];
  /** A guest still in house after their departure date: nights that will be charged at check-out. */
  overstay?: { since: string; nights: number; amount: number } | null;
}

export const balanceOf = (r: Pick<Reservation, 'balance'>) => r.balance;
/** Everything charged to the stay: room nights and extras, or only the kept deposit once cancelled. */
export const chargedOf = (r: Pick<Reservation, 'status' | 'retained' | 'total' | 'charges'>) => (r.status === 'cancelled' ? r.retained : r.total + r.charges);
const KIND: Record<string, string> = { room: 'Room', bar: 'Bar', gym: 'Gym', pool: 'Pool', lounge: 'Lounge' };
const iso = (s: string) => s.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

export function ReservationSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">{id !== null && <Body id={id} />}</SheetContent>
    </Sheet>
  );
}

function Body({ id }: { id: number }) {
  const { user } = useAuth();
  const desk = useDesk();
  const confirm = useConfirm();
  const { data: r, error, reload } = useApi<Reservation>(`/reservations/${id}?v=${desk.version}`);
  const [tab, setTab] = useState('stay');
  const [roomId, setRoomId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [panel, setPanel] = useState<'dates' | 'move' | 'company' | 'cancel' | 'no-show' | null>(null);
  const [newOut, setNewOut] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const { busy, error: actErr, setError, submit } = useSubmit();
  const t = todayISO();

  const act = (path: string, body: unknown, msg: string) =>
    submit(async () => {
      await api(`/reservations/${id}/${path}`, { body });
      toast.success(msg);
      setPanel(null);
      reload();
      desk.changed();
    });

  useEffect(() => {
    if (!r) return;
    setRoomId(r.room_id ? String(r.room_id) : '');
    setNewOut(r.check_out);
    const used = r.status === 'checked_in' && t < r.check_out ? Math.max(1, nightsBetween(r.check_in, t)) : r.nights;
    const extra = r.overstay?.amount ?? 0;
    const owedNow = Math.min(balanceOf(r) + extra, Math.round((r.total / r.nights) * used) + r.charges - r.paid + extra);
    setAmount(String(Math.max(0, owedNow) || Math.max(0, balanceOf(r) + extra) || ''));
  }, [r, t]);
  useEffect(() => setError(null), [tab, setError]);

  const assignRooms = useFreeRooms(r && r.check_in <= t ? t : r?.check_in ?? t, r?.check_out ?? t, r?.room_type_id ?? null, id, !!r && r.check_in <= t);
  const moveRooms = useFreeRooms(r?.status === 'checked_in' ? t : r?.check_in ?? t, r?.check_out ?? t, null, id, r?.status === 'checked_in');

  if (!r) return <div className="p-6">{error ? <ErrorNote error={error} /> : <LoadingRows />}</div>;

  const balance = balanceOf(r);
  const upcoming = r.status === 'pending' || r.status === 'confirmed';
  const live = upcoming || r.status === 'checked_in';
  // Leaving early pays only the nights used; staying past departure adds the extra nights.
  const extra = r.overstay?.amount ?? 0;
  const usedNights = r.status === 'checked_in' && t < r.check_out ? Math.max(1, nightsBetween(r.check_in, t)) : r.nights;
  const usedTotal = r.folio ? r.folio.filter((l) => l.kind === 'room').slice(0, usedNights).reduce((a, l) => a + l.amount, 0) : r.total;
  const leaveBalance = usedTotal + r.charges - r.paid + extra;
  const billToCompany = !!r.bill_to_company && !!r.company_id;
  const isManager = can(user, 'manager');
  // A booking that was paid for needs a decision about the money, not just a yes/no.
  const closeBooking = async (kind: 'cancel' | 'no-show') => {
    if (r.paid > 0) return setPanel(panel === kind ? null : kind);
    const ok =
      kind === 'cancel'
        ? await confirm({ title: 'Cancel this reservation?', confirmLabel: 'Cancel reservation', destructive: true })
        : await confirm({ title: `Mark ${r.guest_name} as a no-show?`, description: 'The booking is cancelled and marked as a no-show.', confirmLabel: 'Mark no-show' });
    if (ok) act(kind, {}, kind === 'cancel' ? 'Reservation cancelled' : 'Marked as no-show');
  };

  return (
    <>
      <SheetHeader className="gap-2 border-b p-5">
        <div className="flex items-center gap-2 pr-8">
          <SheetTitle className="truncate text-lg">{r.guest_name}</SheetTitle>
          {!!r.guest_vip && <VipBadge />}
        </div>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ReservationStatusPill status={r.status} />
            <span className="font-mono">{r.code}</span>
            <span>·</span>
            <span>{SOURCE_LABELS[r.source]}</span>
            {r.company_name && (
              <StatusPill tone="info" dot={false}>
                <Building2 /> {r.company_name}
              </StatusPill>
            )}
          </div>
        </SheetDescription>
        <div className="mt-1 grid grid-cols-3 overflow-hidden rounded-lg border text-sm">
          {[
            [r.status === 'cancelled' ? 'Kept' : 'Charges', naira(chargedOf(r)), ''],
            ['Paid', naira(r.paid), ''],
            [balance < 0 ? 'Owed to guest' : 'Balance', balance === 0 ? 'Settled' : naira(Math.abs(balance)), balance > 0 ? 'text-destructive' : 'text-success'],
          ].map(([k, v, c], i) => (
            <div key={k} className={cn('px-3 py-2.5', i < 2 && 'border-r')}>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className={cn('font-semibold tabular-nums', c)}>{v}</div>
            </div>
          ))}
        </div>
      </SheetHeader>

      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <TabsList className="mx-5 mt-4">
          <TabsTrigger value="stay">Stay</TabsTrigger>
          <TabsTrigger value="bill">
            Bill {balance > 0 && <span className="ml-1 text-[11px] tabular-nums text-destructive">{naira(balance)}</span>}
          </TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
        </TabsList>

        <div className={actErr ? 'px-5 pt-4' : 'h-4'}>
          <ErrorNote error={actErr} />
        </div>

        <TabsContent value="stay" className="space-y-5 px-5 pb-8">
          <dl className="grid grid-cols-2 gap-4">
            <KeyValue label="Arrive">
              {fmtDateLong(r.check_in)}
              {r.checked_in_at && <span className="block text-xs font-normal text-muted-foreground">in at {fmtDateTime(iso(r.checked_in_at))}</span>}
            </KeyValue>
            <KeyValue label="Leave">
              {fmtDateLong(r.check_out)}
              <span className="block text-xs font-normal text-muted-foreground">
                {r.nights} night{r.nights > 1 ? 's' : ''} · avg {naira(r.rate)}
              </span>
            </KeyValue>
            <KeyValue label="Room">
              {r.room_number ? `Room ${r.room_number}` : <span className="text-warning">Not assigned</span>}
              <span className="block text-xs font-normal text-muted-foreground">
                {r.room_type} · {r.adults} guest{r.adults > 1 ? 's' : ''}
              </span>
            </KeyValue>
            <KeyValue label="Guest">
              <button className="underline-offset-4 hover:underline" onClick={() => desk.openGuest(r.guest_id)}>
                View profile →
              </button>
              <a href={`tel:${r.guest_phone}`} className="mt-0.5 flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Phone className="size-3" /> {r.guest_phone}
              </a>
            </KeyValue>
          </dl>
          {r.rate_note && <p className="text-xs text-muted-foreground">Priced with: {r.rate_note}</p>}
          {r.notes && <p className="rounded-md border bg-muted/40 p-3 text-sm">“{r.notes}”</p>}
          <Overstay r={r} />
          {r.status === 'cancelled' && r.cancelled_on && (r.retained > 0 || !!r.refunds?.length) && (
            <p className="rounded-md border bg-muted/40 p-3 text-sm">
              Cancelled on {fmtDateLong(r.cancelled_on)}.{' '}
              {r.retained > 0 && <>{naira(r.retained)} kept as a cancellation fee. </>}
              {!!r.refunds?.length && <>{naira(r.refunds.reduce((a, x) => a + x.amount, 0))} given back.</>}
            </p>
          )}

          {upcoming && (
            <div className="space-y-3 rounded-lg border p-4">
              <Field label={r.check_in <= t ? 'Room (clean and ready)' : 'Room'}>
                <SelectField
                  value={roomId}
                  onChange={setRoomId}
                  placeholder={assignRooms.length ? 'Choose a room' : 'No free room of this type'}
                  options={assignRooms.map((x) => ({ value: String(x.id), label: `Room ${x.number}${r.check_in <= t && x.status !== 'available' ? ` · ${x.status === 'cleaning' ? 'being cleaned' : x.status}` : ''}` }))}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {r.status === 'pending' && (
                  <Button disabled={busy} onClick={() => act('confirm', { room_id: roomId ? Number(roomId) : undefined }, 'Booking confirmed')}>
                    <Check /> Confirm booking
                  </Button>
                )}
                {r.check_in <= t && (
                  <Button variant={r.status === 'pending' ? 'outline' : 'default'} disabled={busy || !roomId} onClick={() => act('check-in', { room_id: Number(roomId) }, `${r.guest_name.split(' ')[0]} is checked in`)}>
                    Check in now
                  </Button>
                )}
              </div>
            </div>
          )}

          {live && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setPanel(panel === 'dates' ? null : 'dates')}>
                <CalendarDays /> Change dates
              </Button>
              {r.room_id && (
                <Button size="sm" variant="outline" onClick={() => setPanel(panel === 'move' ? null : 'move')}>
                  <ArrowLeftRight /> Move room
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setPanel(panel === 'company' ? null : 'company')}>
                <Building2 /> Company billing
              </Button>
              <span className="flex-1" />
              {upcoming && r.check_in <= t && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => closeBooking('no-show')}>
                  No-show
                </Button>
              )}
              {upcoming && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => closeBooking('cancel')}>
                  Cancel
                </Button>
              )}
            </div>
          )}

          {panel === 'dates' && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
              <Field label="New check-out" className="min-w-52 flex-1">
                <DateInput value={newOut} min={r.status === 'checked_in' ? addDays(t, 1) : addDays(r.check_in, 1)} onChange={setNewOut} />
              </Field>
              <span className="pb-2 text-sm text-muted-foreground">{nightsBetween(r.check_in, newOut)} nights · new nights priced at today's rates</span>
              <Button disabled={busy || newOut === r.check_out} onClick={() => act('extend', { check_out: newOut }, newOut > r.check_out ? 'Stay extended' : 'Stay shortened')}>
                Save dates
              </Button>
            </div>
          )}
          {panel === 'move' && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
              <Field label="Move to" className="min-w-52 flex-1" hint="The agreed price stays the same.">
                <SelectField value={moveTo} onChange={setMoveTo} placeholder="Choose a room" options={moveRooms.filter((x) => x.id !== r.room_id).map((x) => ({ value: String(x.id), label: `Room ${x.number}` }))} />
              </Field>
              <Button disabled={busy || !moveTo} onClick={() => act('move', { room_id: Number(moveTo) }, 'Room changed')}>
                Move guest
              </Button>
            </div>
          )}
          {panel === 'company' && <CompanyPanel r={r} busy={busy} onSave={(b) => act('company', b, 'Company billing updated')} />}
          {(panel === 'cancel' || panel === 'no-show') && (
            <SettleDeposit
              kind={panel}
              paid={r.paid}
              manager={isManager}
              busy={busy}
              onSubmit={(b) => act(panel, b, panel === 'cancel' ? 'Reservation cancelled' : 'Marked as no-show')}
            />
          )}
        </TabsContent>

        <TabsContent value="bill" className="space-y-5 px-5 pb-8">
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableBody>
                {r.folio?.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="w-16 text-xs text-muted-foreground tabular-nums">{fmtDate(l.date)}</TableCell>
                    <TableCell className="text-sm whitespace-normal">
                      <span className="mr-2 inline-block w-12 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{KIND[l.kind] ?? l.kind}</span>
                      {l.description}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{naira(l.amount)}</TableCell>
                  </TableRow>
                ))}
                {r.overstay && (
                  <TableRow className="text-warning">
                    <TableCell className="text-xs tabular-nums">{fmtDate(r.overstay.since)}</TableCell>
                    <TableCell className="text-sm whitespace-normal">
                      <span className="mr-2 inline-block w-12 text-[10px] font-semibold tracking-wider uppercase">Room</span>
                      {r.overstay.nights} night{r.overstay.nights > 1 ? 's' : ''} past departure · added at check-out
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{naira(r.overstay.amount)}</TableCell>
                  </TableRow>
                )}
                {r.payments?.map((p) => (
                  <TableRow key={`p${p.id}`} className="text-success">
                    <TableCell className="text-xs tabular-nums">{fmtDate(p.date)}</TableCell>
                    <TableCell className="text-sm">
                      {ALL_PAYMENT_LABELS[p.method] ?? p.method}
                      {p.received_by && <span className="text-muted-foreground"> · {p.received_by}</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">−{naira(p.amount)}</TableCell>
                  </TableRow>
                ))}
                {r.refunds?.map((x) => (
                  <TableRow key={`r${x.id}`}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{fmtDate(x.date)}</TableCell>
                    <TableCell className="text-sm whitespace-normal">
                      Refund · {PAYMENT_LABELS[x.method as PaymentMethod] ?? x.method}
                      <span className="text-muted-foreground"> · {x.reason}{x.refunded_by ? ` · ${x.refunded_by}` : ''}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">+{naira(x.amount)}</TableCell>
                  </TableRow>
                ))}
                {r.status === 'cancelled' && (
                  <TableRow>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{r.cancelled_on ? fmtDate(r.cancelled_on) : ''}</TableCell>
                    <TableCell className="text-sm">Booking cancelled · deposit kept</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{naira(r.retained)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell />
                  <TableCell className="font-semibold">{balance + extra < 0 ? 'Owed to guest' : 'Balance due'}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{naira(Math.abs(balance + extra))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          {r.status === 'cancelled' && !!r.folio?.length && <p className="-mt-3 text-xs text-muted-foreground">The room nights above were not charged: the booking was cancelled.</p>}

          {r.status !== 'cancelled' && balance + extra > 0 && !billToCompany && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
              <Field label="Take payment" className="w-40">
                <MoneyInput value={amount} onChange={setAmount} />
              </Field>
              <Field label="Method" className="w-40">
                <SelectField value={method} onChange={(v) => setMethod(v as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} />
              </Field>
              <Button disabled={busy || !amount} onClick={() => act('payments', { amount: Number(amount), method }, `${naira(Number(amount))} received`)}>
                Record payment
              </Button>
            </div>
          )}
          {billToCompany && balance + extra > 0 && <p className="rounded-md border border-info/20 bg-info-soft p-3 text-sm text-info">At check-out, the balance moves to {r.company_name}'s account.</p>}
          {!upcoming && balance < 0 && (
            isManager ? (
              <RefundForm owed={-balance} busy={busy} onSubmit={(b) => act('refunds', b, `${naira(b.amount)} given back`)} />
            ) : (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">The guest is owed {naira(-balance)}. Ask a manager to give it back.</p>
            )
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/staff/invoice/${r.id}`} target="_blank" rel="noopener">
                <Printer /> Invoice
              </a>
            </Button>
            <span className="flex-1" />
            {r.status === 'checked_in' && (
              <>
                {leaveBalance > 0 && !billToCompany && can(user, 'manager') && (
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={async () => (await confirm({ title: 'Check out with money owed?', description: `${naira(leaveBalance)} is unpaid. This is recorded in the activity log.`, confirmLabel: 'Check out anyway', destructive: true })) && act('check-out', { force: true }, 'Checked out with balance owed')}
                  >
                    Check out anyway
                  </Button>
                )}
                <Button disabled={busy || (leaveBalance > 0 && !billToCompany)} onClick={() => act('check-out', {}, 'Checked out — room sent to housekeeping')}>
                  <LogOut /> {billToCompany ? 'Check out to company' : 'Check out'}
                </Button>
              </>
            )}
          </div>
          {r.status === 'checked_in' && usedNights < r.nights && (
            <p className="text-xs text-muted-foreground">
              Leaving today means {usedNights} night{usedNights > 1 ? 's' : ''} instead of {r.nights}; the bill becomes {naira(usedTotal + r.charges)}
              {leaveBalance < 0 ? ` and the guest is owed ${naira(-leaveBalance)}.` : '.'}
            </p>
          )}
        </TabsContent>

        <TabsContent value="messages" className="px-5 pb-8">
          <Messages reservationId={r.id} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Overstay({ r }: { r: Reservation }) {
  if (!r.overstay) return null;
  const n = r.overstay.nights;
  return (
    <p className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm">
      <b>Past departure.</b> The guest was due out on {fmtDateLong(r.overstay.since)}. {n} extra night{n > 1 ? 's' : ''} ({naira(r.overstay.amount)}) {n > 1 ? 'are' : 'is'} added at check-out. Extend the stay if they are staying on.
    </p>
  );
}

/** Cancelling or no-showing a booking that was paid for: keep the money as a fee, or (manager) give some back. */
function SettleDeposit({ kind, paid, manager, busy, onSubmit }: { kind: 'cancel' | 'no-show'; paid: number; manager: boolean; busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [refund, setRefund] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [reason, setReason] = useState('');
  const back = Number(refund || 0);
  const kept = paid - back;
  return (
    <form
      className="space-y-3 rounded-lg border border-destructive/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...(kind === 'cancel' && reason && { reason }), ...(back > 0 && { refund: back, refund_method: method }) });
      }}
    >
      <p className="text-sm">
        <b>{naira(paid)}</b> was paid on this booking.{' '}
        {manager ? 'Keep it as a cancellation fee, or give some or all of it back.' : 'It is kept as a cancellation fee. Only a manager can give money back.'}
      </p>
      {kind === 'cancel' && (
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Guest's plans changed" />
        </Field>
      )}
      {manager && (
        <div className="flex flex-wrap gap-3">
          <Field label="Give back" className="w-40" hint={back > paid ? `At most ${naira(paid)}` : undefined}>
            <MoneyInput value={refund} onChange={setRefund} />
          </Field>
          {back > 0 && (
            <Field label="Paid back by" className="w-40">
              <SelectField value={method} onChange={(v) => setMethod(v as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} />
            </Field>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {kept > 0 ? `${naira(kept)} is kept and counts as cancellation income today.` : 'Nothing is kept.'}
        {back > 0 && ` ${naira(back)} is recorded as money out today${method === 'cash' ? ', from the cash drawer' : ''}.`}
      </p>
      <Button type="submit" variant="destructive" size="sm" disabled={busy || back > paid}>
        {kind === 'cancel' ? 'Cancel reservation' : 'Mark no-show'}
      </Button>
    </form>
  );
}

/** Manager only: pay back what a stay has overpaid. Always with a reason, for the activity log. */
function RefundForm({ owed, busy, onSubmit }: { owed: number; busy: boolean; onSubmit: (b: { amount: number; method: PaymentMethod; reason: string }) => void }) {
  const [amount, setAmount] = useState(String(owed));
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [reason, setReason] = useState('');
  useEffect(() => setAmount(String(owed)), [owed]);
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ amount: Number(amount), method, reason });
      }}
    >
      <p className="text-sm">
        The guest has paid {naira(owed)} more than the bill.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Give back" className="w-36">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Method" className="w-36">
          <SelectField value={method} onChange={(v) => setMethod(v as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} />
        </Field>
        <Field label="Reason" className="min-w-40 flex-1">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Left a night early" required minLength={3} />
        </Field>
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={busy || !amount || Number(amount) > owed || reason.trim().length < 3}>
        Record refund
      </Button>
    </form>
  );
}

function CompanyPanel({ r, busy, onSave }: { r: Reservation; busy: boolean; onSave: (b: { company_id?: number; bill_to_company: boolean }) => void }) {
  const companies = useApi<{ id: number; name: string }[]>('/companies');
  const [company, setCompany] = useState(r.company_id ? String(r.company_id) : 'none');
  const [bill, setBill] = useState(!!r.bill_to_company);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <Field label="Company account" hint="Changing the company does not change the agreed price.">
        <SelectField value={company} onChange={setCompany} options={[{ value: 'none', label: 'Private guest' }, ...(companies.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))]} />
      </Field>
      {company !== 'none' && (
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={bill} onCheckedChange={setBill} /> Bill to the company at check-out
        </label>
      )}
      <Button size="sm" disabled={busy} onClick={() => onSave(company === 'none' ? { bill_to_company: false } : { company_id: Number(company), bill_to_company: bill })}>
        Save
      </Button>
    </div>
  );
}

interface Msg {
  id: number;
  template: MessageTemplate;
  channel: 'sms' | 'whatsapp';
  to_phone: string;
  body: string;
  status: 'sent' | 'failed' | 'manual';
  error: string | null;
  created_at: string;
  sent_by: string | null;
}

function Messages({ reservationId }: { reservationId: number }) {
  const status = useApi<{ sms: boolean }>('/messaging/status');
  const log = useApi<Msg[]>(`/reservations/${reservationId}/messages`);
  const [template, setTemplate] = useState<MessageTemplate>('booking_confirmed');
  const { busy, error, submit } = useSubmit();
  const send = (channel: 'sms' | 'whatsapp') =>
    submit(async () => {
      const r = await api<{ status: string; link?: string; error?: string }>(`/reservations/${reservationId}/messages`, { body: { template, channel } });
      if (r.link) window.open(r.link, '_blank', 'noopener');
      if (r.status === 'sent') toast.success('SMS sent');
      else if (r.status === 'failed') toast.error(`SMS failed: ${r.error}`);
      else toast('WhatsApp opened with the message ready to send');
      log.reload();
    });
  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border p-4">
        <Field label="Message">
          <SelectField value={template} onChange={(v) => setTemplate(v as MessageTemplate)} options={MESSAGE_TEMPLATES.map((m) => ({ value: m, label: MESSAGE_TEMPLATE_LABELS[m] }))} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => send('whatsapp')}>
            <MessageCircle /> Send on WhatsApp
          </Button>
          {status.data?.sms && (
            <Button variant="outline" disabled={busy} onClick={() => send('sms')}>
              <Send /> Send SMS
            </Button>
          )}
        </div>
        {!status.data?.sms && <p className="text-xs text-muted-foreground">SMS sending switches on when an SMS provider is connected. WhatsApp opens on this device with the message written for you.</p>}
        <ErrorNote error={error} />
      </div>
      <div className="space-y-3">
        {log.data?.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
        {log.data?.map((m) => (
          <div key={m.id} className="rounded-lg border p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusPill tone={m.status === 'sent' ? 'success' : m.status === 'failed' ? 'danger' : 'neutral'}>{m.status === 'manual' ? 'WhatsApp' : m.status === 'sent' ? 'SMS sent' : 'SMS failed'}</StatusPill>
              <span>{MESSAGE_TEMPLATE_LABELS[m.template]}</span>
              <span>·</span>
              <span>{fmtDateTime(m.created_at)}</span>
              {m.sent_by && <span>· {m.sent_by}</span>}
            </div>
            <p className="text-sm">{m.body}</p>
            {m.error && <p className="mt-1 text-xs text-destructive">{m.error}</p>}
          </div>
        ))}
      </div>
      <Separator />
      <p className="text-xs text-muted-foreground">Messages use the hotel details from Settings.</p>
    </div>
  );
}
