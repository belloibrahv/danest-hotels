import { Dumbbell, Music, Waves } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CHARGE_LABELS, CHARGE_METHODS, FACILITIES, FACILITY_LABELS, type ChargeMethod, type Facility } from '../../../../shared/constants';
import { DateRangePicker, useRange } from '@/components/app/date-range';
import { DateInput, Field, MoneyInput, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, fmtDate, naira, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';

interface Data {
  rows: { id: number; facility: Facility; item: string; customer: string | null; amount: number; method: ChargeMethod; date: string; recorded_by: string; room_number: string | null }[];
  totals: { facility: Facility; total: number; count: number }[];
}
const ICON = { gym: Dumbbell, pool: Waves, lounge: Music };

export default function OtherIncome() {
  const { user } = useAuth();
  const range = useRange('today');
  const { data, error, reload } = useApi<Data>(`/facility-income?${range.qs}`);
  const priceList = useApi<{ id: number; facility: Facility; name: string; price: number }[]>('/settings/facility-items');
  const [facility, setFacility] = useState<Facility>('gym');
  const [f, setF] = useState({ item: '', amount: '', customer: '', method: 'transfer' as ChargeMethod, date: '' });
  const [guest, setGuest] = useState('');
  const inhouse = useApi<{ reservation_id: number; room_number: string; guest_name: string }[]>(f.method === 'room' ? '/inhouse' : null);
  const { busy, error: saveErr, submit } = useSubmit();
  const quick = (x: Facility) => (priceList.data ?? []).filter((i) => i.facility === x);

  useEffect(() => {
    const first = quick(facility)[0];
    if (first && !f.item) setF((x) => ({ ...x, item: first.name, amount: String(first.price) }));
  }, [priceList.data]);

  const pick = (x: Facility) => {
    setFacility(x);
    const first = quick(x)[0];
    setF({ ...f, item: first?.name ?? '', amount: first ? String(first.price) : '' });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/facility-income', {
        body: { facility, item: f.item, amount: Number(f.amount), customer: f.customer, method: f.method, reservation_id: f.method === 'room' ? Number(guest) : undefined, date: f.date || undefined },
      });
      toast.success(f.method === 'room' ? `${naira(Number(f.amount))} added to the room bill` : `${naira(Number(f.amount))} recorded`);
      setF({ ...f, customer: '' });
      setGuest('');
      reload();
    });
  };
  const total = (x: Facility) => data?.totals.find((t) => t.facility === x);

  return (
    <>
      <PageHeader title="Gym, pool & lounge" description="Passes, memberships and bookings — so other income shows up in profit." actions={<DateRangePicker state={range} />} />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {FACILITIES.map((x) => (
              <StatCard key={x} icon={ICON[x]} label={FACILITY_LABELS[x]} value={<Money value={total(x)?.total ?? 0} />} hint={`${total(x)?.count ?? 0} entries`} />
            ))}
          </div>
          <Section title="Entries" flush>
            <ErrorNote error={error} />
            {!data ? (
              <LoadingRows rows={5} />
            ) : data.rows.length === 0 ? (
              <EmptyState icon={Waves} title="Nothing recorded for this period" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-5">Date</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Paid by</TableHead>
                    <TableHead className="pr-5 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-5 tabular-nums">{fmtDate(r.date)}</TableCell>
                      <TableCell>
                        {r.item}
                        <div className="text-xs text-muted-foreground">{FACILITY_LABELS[r.facility]}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.customer ?? '—'}</TableCell>
                      <TableCell>{r.method === 'room' ? <StatusPill tone="brand">Room {r.room_number}</StatusPill> : CHARGE_LABELS[r.method]}</TableCell>
                      <TableCell className="pr-5 text-right font-medium">
                        <Money value={r.amount} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </div>

        <Section title="Record income" className="xl:sticky xl:top-20">
          <form className="grid gap-4" onSubmit={onSubmit}>
            <ToggleGroup type="single" variant="outline" value={facility} onValueChange={(v) => v && pick(v as Facility)} className="grid w-full grid-cols-3">
              {FACILITIES.map((x) => {
                const I = ICON[x];
                return (
                  <ToggleGroupItem key={x} value={x} className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    <I /> {FACILITY_LABELS[x].split(' ')[0]}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <div className="flex flex-wrap gap-1.5">
              {quick(facility).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {can(user, 'manager') ? (
                    <>
                      No price list for the {FACILITY_LABELS[facility].toLowerCase()} yet.{' '}
                      <Link className="underline" to="/staff/settings?tab=facilities">
                        Add prices
                      </Link>
                    </>
                  ) : (
                    'No price list yet — type the item and amount.'
                  )}
                </p>
              )}
              {quick(facility).map((q) => (
                <Button key={q.id} type="button" size="sm" variant={f.item === q.name ? 'secondary' : 'outline'} className="h-7 text-xs" onClick={() => setF({ ...f, item: q.name, amount: String(q.price) })}>
                  {q.name.replace(/^(Gym|Pool) /, '')} · {naira(q.price)}
                </Button>
              ))}
            </div>
            <Field label="What was sold">
              <Input value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} required maxLength={120} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount">
                <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} required />
              </Field>
              <Field label="Paid by">
                <SelectField value={f.method} onChange={(v) => setF({ ...f, method: v as ChargeMethod })} options={CHARGE_METHODS.map((m) => ({ value: m, label: CHARGE_LABELS[m] }))} />
              </Field>
            </div>
            {f.method === 'room' ? (
              <Field label="In-house guest">
                <SelectField value={guest} onChange={setGuest} placeholder="Choose a room" options={(inhouse.data ?? []).map((g) => ({ value: String(g.reservation_id), label: `Room ${g.room_number} — ${g.guest_name}` }))} />
              </Field>
            ) : (
              <Field label="Customer">
                <Input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} maxLength={120} placeholder="Optional" />
              </Field>
            )}
            {can(user, 'manager') && f.method !== 'room' && (
              <Field label="Date" hint="Leave as today unless recording a past sale">
                <DateInput value={f.date || todayISO()} max={todayISO()} onChange={(v) => setF({ ...f, date: v })} />
              </Field>
            )}
            <ErrorNote error={saveErr} />
            <Button size="lg" disabled={busy || !f.amount || (f.method === 'room' && !guest)}>
              {busy ? 'Saving…' : `Record ${f.amount ? naira(Number(f.amount)) : ''}`}
            </Button>
          </form>
        </Section>
      </div>
    </>
  );
}
