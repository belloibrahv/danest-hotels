import { ChevronDown, Sparkles } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ID_LABELS, ID_TYPES, PAYMENT_LABELS, PAYMENT_METHODS, SOURCE_LABELS, type PaymentMethod, type ReservationSource } from '../../../../../shared/constants';
import { DateInput, Field, MoneyInput, SelectField } from '@/components/app/form';
import { ErrorNote, Money } from '@/components/app/page';
import { VipBadge } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { addDays, api, fmtDate, naira, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';

export interface NewReservationPreset {
  roomId?: number;
  typeId?: number;
  checkIn?: string;
  checkOut?: string;
  walkIn?: boolean;
  guest?: { name: string; phone: string; email?: string };
  companyId?: number;
}

export interface Quote {
  nights: { date: string; rate: number; rule: string | null }[];
  total: number;
  average: number;
  base: number;
  note: string | null;
}

/** Free rooms for a stay, as select options. */
export function useFreeRooms(checkIn: string, checkOut: string, typeId: number | null, exclude = 0, readyOnly = false) {
  const ok = checkOut > checkIn;
  const { data } = useApi<{ id: number; number: string; status: string; room_type_id: number }[]>(
    ok ? `/availability?check_in=${checkIn}&check_out=${checkOut}${typeId ? `&room_type_id=${typeId}` : ''}&exclude=${exclude}` : null,
  );
  return (data ?? []).filter((r) => !readyOnly || r.status === 'available');
}

interface Match {
  id: number;
  name: string;
  phone: string;
  vip: number;
}

export function NewReservation({ open, onClose, onCreated, preset }: { open: boolean; onClose: () => void; onCreated: (id: number) => void; preset?: NewReservationPreset }) {
  const { user } = useAuth();
  const t = todayISO();
  const types = useApi<{ id: number; name: string; rate: number; capacity: number }[]>(open ? '/room-types' : null);
  const companies = useApi<{ id: number; name: string; discount_pct: number }[]>(open ? '/companies' : null);
  const startIn = preset?.checkIn && preset.checkIn >= t ? preset.checkIn : t;
  const blank = () => ({
    name: preset?.guest?.name ?? '', phone: preset?.guest?.phone ?? '', email: preset?.guest?.email ?? '', id_type: '', id_number: '', address: '',
    check_in: startIn, check_out: preset?.checkOut && preset.checkOut > startIn ? preset.checkOut : addDays(startIn, 1),
    room_type_id: preset?.typeId ? String(preset.typeId) : '', room_id: preset?.roomId ? String(preset.roomId) : '', adults: '1',
    source: (preset?.walkIn ? 'walk_in' : 'phone') as ReservationSource, notes: '', deposit: '', deposit_method: 'transfer' as PaymentMethod, rate: '',
    company_id: preset?.companyId ? String(preset.companyId) : '', bill_to_company: !!preset?.companyId,
  });
  const [f, setF] = useState(blank);
  const [checkInNow, setCheckInNow] = useState(!!preset?.walkIn);
  const [match, setMatch] = useState<Match | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const { busy, error, setError, submit } = useSubmit();
  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (open) {
      setF(blank());
      setCheckInNow(!!preset?.walkIn);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!f.room_type_id && types.data?.length) set('room_type_id', String(types.data[0].id));
  }, [types.data, f.room_type_id]);

  // Recognise returning guests as their number is typed.
  useEffect(() => {
    const digits = f.phone.replace(/\D/g, '');
    if (digits.length < 10) return setMatch(null);
    const ctl = setTimeout(() => {
      api<{ guests: Match[] }>(`/search?q=${encodeURIComponent(f.phone.trim())}`)
        .then((r) => setMatch(r.guests.find((g) => g.phone.replace(/\D/g, '') === digits) ?? null))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(ctl);
  }, [f.phone]);

  // Live price: rate rules and company discount, night by night.
  useEffect(() => {
    if (!open || !f.room_type_id || f.check_out <= f.check_in) return setQuote(null);
    let live = true;
    api<Quote>(`/quote?room_type_id=${f.room_type_id}&check_in=${f.check_in}&check_out=${f.check_out}${f.company_id ? `&company_id=${f.company_id}` : ''}`)
      .then((q) => live && setQuote(q))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [open, f.room_type_id, f.check_in, f.check_out, f.company_id]);

  const rooms = useFreeRooms(f.check_in, f.check_out, f.room_type_id ? Number(f.room_type_id) : null, 0, checkInNow);
  const total = f.rate && quote ? Number(f.rate) * quote.nights.length : quote?.total ?? 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const r = await api<{ id: number }>('/reservations', {
        body: {
          guest: { name: f.name, phone: f.phone, email: f.email, id_type: f.id_type || undefined, id_number: f.id_number, address: f.address },
          check_in: f.check_in, check_out: f.check_out, room_type_id: Number(f.room_type_id), adults: Number(f.adults), source: f.source, notes: f.notes,
          room_id: f.room_id ? Number(f.room_id) : undefined, check_in_now: checkInNow && f.check_in === t,
          deposit: f.deposit ? Number(f.deposit) : undefined, deposit_method: f.deposit_method,
          rate: f.rate ? Number(f.rate) : undefined,
          company_id: f.company_id ? Number(f.company_id) : undefined, bill_to_company: f.bill_to_company,
        },
      });
      toast.success(checkInNow ? `${f.name.split(' ')[0]} is checked in` : 'Reservation saved', { description: `${naira(total)} · ${quote?.nights.length ?? 0} night(s)` });
      onCreated(r.id);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{checkInNow ? 'Walk-in check-in' : 'New reservation'}</DialogTitle>
          <DialogDescription>Prices include any active season, weekend or company rate.</DialogDescription>
        </DialogHeader>
        <form id="new-res" className="grid gap-5" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Phone" htmlFor="nr-phone">
              <Input id="nr-phone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} required pattern="[+\d][\d\s\-]{6,19}" autoFocus />
            </Field>
            <Field label="Guest name" htmlFor="nr-name">
              <Input id="nr-name" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} />
            </Field>
            <Field label="Email" htmlFor="nr-email">
              <Input id="nr-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="Optional" />
            </Field>
          </div>
          {match && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand-soft px-3 py-2 text-sm">
              <Sparkles className="size-4 text-brand-ink" />
              <span>
                Returning guest: <b>{match.name}</b>
              </span>
              {!!match.vip && <VipBadge />}
              {f.name !== match.name && (
                <Button type="button" size="sm" variant="outline" className="ml-auto h-7" onClick={() => set('name', match.name)}>
                  Use this profile
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Check-in">
              <DateInput value={f.check_in} min={t} onChange={(v) => (set('check_in', v), f.check_out <= v && set('check_out', addDays(v, 1)))} />
            </Field>
            <Field label="Check-out">
              <DateInput value={f.check_out} min={addDays(f.check_in, 1)} onChange={(v) => set('check_out', v)} />
            </Field>
            <Field label="Room type">
              <SelectField value={f.room_type_id} onChange={(v) => (set('room_type_id', v), set('room_id', ''))} options={(types.data ?? []).map((x) => ({ value: String(x.id), label: x.name }))} />
            </Field>
            <Field label={checkInNow ? 'Room (ready now)' : 'Room'}>
              <SelectField
                value={f.room_id}
                onChange={(v) => set('room_id', v === 'later' ? '' : v)}
                placeholder={rooms.length ? (checkInNow ? 'Choose a room' : 'Assign later') : 'None free'}
                options={[...(checkInNow ? [] : [{ value: 'later', label: 'Assign later' }]), ...rooms.map((r) => ({ value: String(r.id), label: `Room ${r.number}${r.status !== 'available' ? ` · ${r.status}` : ''}` }))]}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Guests">
              <SelectField value={f.adults} onChange={(v) => set('adults', v)} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} adult${n > 1 ? 's' : ''}` }))} />
            </Field>
            <Field label="Booked via">
              <SelectField value={f.source} onChange={(v) => set('source', v as ReservationSource)} options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Company account" className="sm:col-span-2">
              <SelectField
                value={f.company_id}
                onChange={(v) => (set('company_id', v === 'none' ? '' : v), set('bill_to_company', v !== 'none'))}
                placeholder="Private guest"
                options={[{ value: 'none', label: 'Private guest' }, ...(companies.data ?? []).map((c) => ({ value: String(c.id), label: `${c.name}${c.discount_pct ? ` · −${c.discount_pct}%` : ''}` }))]}
              />
            </Field>
          </div>
          {f.company_id && (
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={f.bill_to_company} onCheckedChange={(v) => set('bill_to_company', v)} />
              Bill the stay to the company at check-out (the guest pays nothing at the desk)
            </label>
          )}

          <Collapsible defaultOpen={checkInNow}>
            <CollapsibleTrigger className="group flex items-center gap-2 text-sm font-medium">
              <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" /> Guest registration (ID &amp; address)
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="ID type">
                <SelectField value={f.id_type} onChange={(v) => set('id_type', v)} placeholder="Not provided" options={ID_TYPES.map((k) => ({ value: k, label: ID_LABELS[k] }))} />
              </Field>
              <Field label="ID number">
                <Input value={f.id_number} onChange={(e) => set('id_number', e.target.value)} maxLength={40} />
              </Field>
              <Field label="Address / city">
                <Input value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={200} />
              </Field>
            </CollapsibleContent>
          </Collapsible>

          <div className="grid gap-4 sm:grid-cols-3">
            {!f.bill_to_company && (
              <>
                <Field label="Payment now">
                  <MoneyInput value={f.deposit} onChange={(v) => set('deposit', v)} placeholder="0" />
                </Field>
                <Field label="Paid by">
                  <SelectField value={f.deposit_method} onChange={(v) => set('deposit_method', v as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} />
                </Field>
              </>
            )}
            {can(user, 'manager') && (
              <Field label="Manager rate (per night)" hint="Overrides rules and discounts">
                <MoneyInput value={f.rate} onChange={(v) => set('rate', v)} placeholder={quote ? String(quote.average) : ''} />
              </Field>
            )}
          </div>
          <Field label="Notes">
            <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={500} placeholder="Late arrival, airport pickup, celebrating something…" rows={2} />
          </Field>

          {quote && (
            <div className="rounded-lg border bg-muted/40">
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-b px-4 py-2.5 text-xs text-muted-foreground">
                {(f.rate ? quote.nights.map((n) => ({ ...n, rate: Number(f.rate), rule: 'Manager rate' })) : quote.nights).slice(0, 14).map((n) => (
                  <span key={n.date} className="tabular-nums">
                    {fmtDate(n.date)} <b className="font-medium text-foreground">{naira(n.rate)}</b>
                    {n.rule && <span className="text-brand-ink"> · {n.rule}</span>}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  {quote.nights.length} night{quote.nights.length === 1 ? '' : 's'}
                  {quote.note && !f.rate && <span className="ml-2 text-muted-foreground">({quote.note})</span>}
                </span>
                <span className="text-base font-semibold">
                  <Money value={total} />
                </span>
              </div>
            </div>
          )}

          {f.check_in === t && (
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch checked={checkInNow} onCheckedChange={(v) => (setCheckInNow(v), set('room_id', ''))} />
              Guest is here — check them in now
            </label>
          )}
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-res" disabled={busy || (checkInNow && !f.room_id) || !quote}>
            {busy ? 'Saving…' : checkInNow ? 'Check in guest' : 'Save reservation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
