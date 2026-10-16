import { Pencil, Phone, Plus, Star } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ID_LABELS, ID_TYPES, type IdType } from '../../../../../shared/constants';
import { useDesk } from './Desk';
import type { Reservation } from './ReservationSheet';
import { Field, SelectField } from '@/components/app/form';
import { ErrorNote, KeyValue, LoadingRows } from '@/components/app/page';
import { ReservationStatusPill, VipBadge } from '@/components/app/status';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDate, naira } from '@/lib/api';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface Guest {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  vip: number;
  notes: string | null;
  id_type: IdType | null;
  id_number: string | null;
  address: string | null;
  stays: number;
  nights: number;
  spend: number;
  last_stay: string | null;
  next_stay: string | null;
  favourite_room: { name: string; n: number } | null;
  stays_list: Reservation[];
}

export function GuestSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">{id !== null && <Body id={id} />}</SheetContent>
    </Sheet>
  );
}

function Body({ id }: { id: number }) {
  const desk = useDesk();
  const { data: g, error, reload } = useApi<Guest>(`/guests/${id}?v=${desk.version}`);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', email: '', id_type: '', id_number: '', address: '', notes: '', vip: false });
  const { busy, error: saveErr, submit } = useSubmit();

  useEffect(() => {
    if (g) setF({ name: g.name, phone: g.phone, email: g.email ?? '', id_type: g.id_type ?? '', id_number: g.id_number ?? '', address: g.address ?? '', notes: g.notes ?? '', vip: !!g.vip });
  }, [g]);

  const save = (patch: Partial<typeof f> = {}, msg = 'Profile saved') =>
    submit(async () => {
      const next = { ...f, ...patch };
      await api(`/guests/${id}`, { method: 'PATCH', body: { ...next, id_type: next.id_type || undefined } });
      toast.success(msg);
      setEditing(false);
      reload();
      desk.changed();
    });

  if (!g) return <div className="p-6">{error ? <ErrorNote error={error} /> : <LoadingRows />}</div>;
  const initials = g.name.split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <>
      <SheetHeader className="gap-3 border-b p-5">
        <div className="flex items-center gap-3 pr-8">
          <Avatar className="size-11">
            <AvatarFallback className={cn('text-sm font-semibold', g.vip ? 'bg-brand text-brand-foreground' : '')}>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <SheetTitle className="flex items-center gap-2 text-lg">
              <span className="truncate">{g.name}</span>
              {!!g.vip && <VipBadge />}
            </SheetTitle>
            <SheetDescription className="flex items-center gap-1 text-xs">
              <Phone className="size-3" /> {g.phone}
              {g.email && <> · {g.email}</>}
            </SheetDescription>
          </div>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded-lg border text-sm">
          {[
            ['Stays', String(g.stays)],
            ['Nights', String(g.nights)],
            ['Lifetime spend', naira(g.spend)],
          ].map(([k, v], i) => (
            <div key={k} className={cn('px-3 py-2.5', i < 2 && 'border-r')}>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => desk.newReservation({ guest: { name: g.name, phone: g.phone, email: g.email ?? '' } })}>
            <Plus /> New booking
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
            <Pencil /> Edit profile
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => save({ vip: !g.vip }, g.vip ? 'VIP removed' : `${g.name.split(' ')[0]} is now a VIP`)}>
            <Star className={g.vip ? 'fill-brand text-brand' : ''} /> {g.vip ? 'Remove VIP' : 'Make VIP'}
          </Button>
        </div>
      </SheetHeader>

      <div className="space-y-6 p-5">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {g.last_stay && <span>Last stay {fmtDate(g.last_stay)}</span>}
          {g.next_stay && <span className="font-medium text-brand-ink">Coming back {fmtDate(g.next_stay)}</span>}
          {g.favourite_room && <span>Usually books {g.favourite_room.name}</span>}
        </div>

        {g.notes && !editing && (
          <div className="rounded-lg border border-brand/30 bg-brand-soft p-3 text-sm">
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-brand-ink uppercase">Preferences</div>
            {g.notes}
          </div>
        )}

        {editing ? (
          <form className="grid gap-4 rounded-lg border p-4" onSubmit={(e: FormEvent) => (e.preventDefault(), save())}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
              <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
              <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Address / city"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
              <Field label="ID type">
                <SelectField value={f.id_type} onChange={(v) => setF({ ...f, id_type: v })} placeholder="Not provided" options={ID_TYPES.map((k) => ({ value: k, label: ID_LABELS[k] }))} />
              </Field>
              <Field label="ID number"><Input value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value })} /></Field>
            </div>
            <Field label="Preferences & notes" hint="Shown to the desk whenever this guest books">
              <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} rows={3} />
            </Field>
            <ErrorNote error={saveErr} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button disabled={busy}>Save profile</Button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-2 gap-4">
            <KeyValue label="ID">{g.id_type ? `${ID_LABELS[g.id_type]} · ${g.id_number}` : <span className="text-muted-foreground">Not recorded</span>}</KeyValue>
            <KeyValue label="Address">{g.address ?? <span className="text-muted-foreground">Not recorded</span>}</KeyValue>
          </dl>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold">Stay history</h3>
          {g.stays_list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stays yet.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableBody>
                  {g.stays_list.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => desk.openReservation(s.id)}>
                      <TableCell className="text-sm tabular-nums">{fmtDate(s.check_in)} → {fmtDate(s.check_out)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.room_number ? `Room ${s.room_number}` : s.room_type}</TableCell>
                      <TableCell><ReservationStatusPill status={s.status} /></TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{naira(s.total + s.charges)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
