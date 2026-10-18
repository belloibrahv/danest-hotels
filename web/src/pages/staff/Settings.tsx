import { BedDouble, CreditCard, ImageIcon, MessageCircle, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { FACILITIES, FACILITY_LABELS, OUTLETS, OUTLET_LABELS, TAX_GROUPS, type HotelSettings, type Outlet as Facility } from '../../../../shared/constants';
import { Field, MoneyInput, SelectField, useConfirm } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, naira } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { shrinkPhoto } from '@/lib/photo';
import { cn } from '@/lib/utils';

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'hotel';
  return (
    <>
      <PageHeader title="Settings" description="How the hotel is set up: details guests see, rooms and prices, online payments." />
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t })}>
        <TabsList className="mb-6 h-9 flex-wrap">
          <TabsTrigger value="hotel">Hotel details</TabsTrigger>
          <TabsTrigger value="rooms">Rooms & base rates</TabsTrigger>
          <TabsTrigger value="photos">Website photos</TabsTrigger>
          <TabsTrigger value="facilities">Facility & service prices</TabsTrigger>
          <TabsTrigger value="payments">Payments & messages</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
        </TabsList>
        <TabsContent value="hotel"><HotelForm /></TabsContent>
        <TabsContent value="rooms"><RoomsSettings /></TabsContent>
        <TabsContent value="photos"><WebsitePhotos /></TabsContent>
        <TabsContent value="facilities"><FacilityPrices /></TabsContent>
        <TabsContent value="payments"><Integrations /></TabsContent>
        <TabsContent value="backups"><Backups /></TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------

function HotelForm() {
  const { data, reload } = useApi<HotelSettings>('/settings');
  const [f, setF] = useState<HotelSettings | null>(null);
  const { busy, error, submit } = useSubmit();
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  if (!f) return <LoadingRows />;
  const set = <K extends keyof HotelSettings>(k: K, v: HotelSettings[K]) => setF({ ...f, [k]: v });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/settings', { method: 'PUT', body: { ...f, highlights: f.highlights.filter((h) => h.title.trim()), taxes: f.taxes.map((t) => ({ ...t, rate: Number(t.rate) })) } });
      toast.success('Saved', { description: 'The website, invoices and messages now use these details.' });
      reload();
    });
  };
  return (
    <form className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]" onSubmit={onSubmit}>
      <div className="space-y-6">
        <Section title="Identity & contact" description="Shown on the website, invoices, receipts and guest messages">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hotel name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} /></Field>
            <Field label="Tagline"><Input value={f.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={120} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set('address', e.target.value)} required maxLength={200} /></Field>
            <Field label="Front desk phone" hint="Guests call this to confirm"><Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="080…" /></Field>
            <Field label="WhatsApp"><Input type="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="Optional" /></Field>
            <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="Optional" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Check-in from"><Input type="time" value={f.check_in_time} onChange={(e) => set('check_in_time', e.target.value)} required /></Field>
              <Field label="Check-out by"><Input type="time" value={f.check_out_time} onChange={(e) => set('check_out_time', e.target.value)} required /></Field>
            </div>
          </div>
        </Section>
        <Section title="Invoices">
          <div className="grid gap-4">
            <Field label="Bank details for transfers" hint="Printed on invoices and balance reminders — never on the website">
              <Textarea value={f.bank_details} onChange={(e) => set('bank_details', e.target.value)} maxLength={300} rows={2} placeholder="Bank · Account name · Account number" />
            </Field>
            <Field label="Closing note"><Input value={f.invoice_note} onChange={(e) => set('invoice_note', e.target.value)} maxLength={300} /></Field>
          </div>
        </Section>
        <Section title="Daily summary for the owner" description="When the day is closed, a one-paragraph summary goes here: takings, rooms sold, the cash count, the month against target. By SMS and email when those are connected; otherwise one tap on WhatsApp.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner's phone"><Input type="tel" value={f.summary_phone} onChange={(e) => set('summary_phone', e.target.value)} placeholder="080…" /></Field>
            <Field label="Owner's email"><Input type="email" value={f.summary_email} onChange={(e) => set('summary_email', e.target.value)} placeholder="Optional" /></Field>
          </div>
        </Section>
        <Section
          title="Taxes"
          description="Your prices include these taxes: guests pay the price you set, and bills show how much of it is tax. Check the rates with your accountant."
          action={f.taxes.length < 4 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => set('taxes', [...f.taxes, f.taxes.length ? { name: 'Consumption tax', rate: 5, applies: ['rooms', 'food', 'bar'] } : { name: 'VAT', rate: 7.5, applies: TAX_GROUPS.map((g) => g.key) }])}>
              <Plus /> Add a tax
            </Button>
          )}
        >
          <div className="grid gap-4">
            <Field label="Tax ID (TIN)" hint="Printed on invoices and receipts"><Input value={f.tax_id} onChange={(e) => set('tax_id', e.target.value)} maxLength={40} placeholder="Optional" /></Field>
            {f.taxes.length === 0 && <p className="text-sm text-muted-foreground">No taxes set. Bills show no tax lines.</p>}
            {f.taxes.map((t, i) => {
              const upd = (patch: Partial<typeof t>) => set('taxes', f.taxes.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid gap-3 rounded-lg border p-3">
                  <div className="grid grid-cols-[1fr_110px_auto] gap-2">
                    <Input value={t.name} onChange={(e) => upd({ name: e.target.value })} maxLength={40} aria-label="Tax name" required />
                    <div className="relative">
                      <Input inputMode="decimal" className="pr-7 tabular-nums" value={String(t.rate)} onChange={(e) => upd({ rate: e.target.value.replace(/[^\d.]/g, '') as unknown as number })} aria-label="Rate" required />
                      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${t.name}`} onClick={() => set('taxes', f.taxes.filter((_, j) => j !== i))}><Trash2 /></Button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {TAX_GROUPS.map((g) => (
                      <label key={g.key} className="flex items-center gap-2">
                        <Checkbox checked={t.applies.includes(g.key)} onCheckedChange={(on) => upd({ applies: on ? [...t.applies, g.key] : t.applies.filter((a) => a !== g.key) })} />
                        {g.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
      <div className="space-y-6">
        <Section title="Website highlights" description="Up to four promises under the booking bar. Only what is true every day.">
          <div className="grid gap-3">
            {[0, 1, 2, 3].map((i) => {
              const h = f.highlights[i] ?? { title: '', text: '' };
              const upd = (patch: Partial<typeof h>) => {
                const next = [...f.highlights];
                next[i] = { ...h, ...patch };
                set('highlights', next);
              };
              return (
                <div key={i} className="grid grid-cols-[1fr_1.3fr] gap-2">
                  <Input value={h.title} onChange={(e) => upd({ title: e.target.value })} maxLength={40} placeholder={['Gated & secure', 'Free Wi-Fi', 'Pay on arrival', 'On-site parking'][i]} aria-label={`Highlight ${i + 1}`} />
                  <Input value={h.text} onChange={(e) => upd({ text: e.target.value })} maxLength={90} placeholder="Detail" aria-label={`Highlight ${i + 1} detail`} />
                </div>
              );
            })}
          </div>
        </Section>
        <Section
          title="Guest reviews"
          description="What real guests have said (from Google, WhatsApp or the guest book). Shown on the website. Leave empty rather than invent one."
          action={f.reviews.length < 9 && <Button type="button" variant="ghost" size="sm" onClick={() => set('reviews', [...f.reviews, { quote: '', name: '', detail: '' }])}><Plus /> Add</Button>}
        >
          {f.reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet. The reviews section stays hidden on the website until you add one.</p>
          ) : (
            <div className="grid gap-4">
              {f.reviews.map((r, i) => {
                const upd = (patch: Partial<typeof r>) => set('reviews', f.reviews.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="grid gap-2 rounded-lg border p-3">
                    <Textarea value={r.quote} onChange={(e) => upd({ quote: e.target.value })} rows={2} maxLength={400} placeholder="The room was spotless and the power never went off…" aria-label={`Review ${i + 1}`} required minLength={10} />
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input value={r.name} onChange={(e) => upd({ name: e.target.value })} maxLength={60} placeholder="Guest's name" aria-label="Name" required />
                      <Input value={r.detail} onChange={(e) => upd({ detail: e.target.value })} maxLength={60} placeholder="Business trip, Lagos" aria-label="Detail" />
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove review" onClick={() => set('reviews', f.reviews.filter((_, j) => j !== i))}><Trash2 /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        <ErrorNote error={error} />
        <Button size="lg" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save hotel details'}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

interface RoomType { id: number; name: string; rate: number; capacity: number; description: string; amenities: string[]; active: number; rooms: number }
interface Room { id: number; number: string; floor: number; status: string; active: number; room_type_id: number; room_type: string; bookings: number }

function RoomsSettings() {
  const types = useApi<RoomType[]>('/settings/room-types');
  const rooms = useApi<Room[]>('/settings/rooms');
  const [editType, setEditType] = useState<RoomType | 'new' | null>(null);
  const [adding, setAdding] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const reload = () => (types.reload(), rooms.reload());
  if (!types.data || !rooms.data) return <LoadingRows />;
  return (
    <div className="space-y-6">
      <Section
        title="Room types & base rates"
        description="Base rate per night. Weekend and seasonal prices are set under Rates & seasons. Existing bookings keep their price."
        action={<Button size="sm" onClick={() => setEditType('new')}><Plus /> Room type</Button>}
        flush
      >
        {types.data.length === 0 ? (
          <EmptyState icon={BedDouble} title="Start with your room types" action={<Button size="sm" onClick={() => setEditType('new')}><Plus /> Add a room type</Button>}>
            For example “Standard Room — ₦25,000” and “Executive Suite — ₦55,000”. Then add room numbers.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Room type</TableHead>
                <TableHead className="text-right">Base rate</TableHead>
                <TableHead className="text-right">Sleeps</TableHead>
                <TableHead className="text-right">Rooms</TableHead>
                <TableHead>On sale</TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.data.map((t) => (
                <TableRow key={t.id} className={t.active ? '' : 'opacity-55'}>
                  <TableCell className="pl-5"><div className="font-medium">{t.name}</div><div className="max-w-md truncate text-xs text-muted-foreground">{t.amenities.join(' · ')}</div></TableCell>
                  <TableCell className="text-right font-medium"><Money value={t.rate} /></TableCell>
                  <TableCell className="text-right tabular-nums">{t.capacity}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.rooms}</TableCell>
                  <TableCell>{t.active ? <StatusPill tone="success">Yes</StatusPill> : <StatusPill>Hidden</StatusPill>}</TableCell>
                  <TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={() => setEditType(t)}>Edit</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section
        title={`Rooms (${rooms.data.filter((r) => r.active).length})`}
        description="Switch a room off if it is closed long-term; it leaves bookings and reports."
        action={types.data.length > 0 && <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add rooms</Button>}
      >
        {rooms.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{types.data.length ? 'No rooms yet. Add them by number — a whole floor at once, like 101-108.' : 'Add a room type first.'}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
            {rooms.data.map((r) => (
              <button key={r.id} onClick={() => setEditRoom(r)} className={cn('rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50', !r.active && 'opacity-50')}>
                <div className="font-mono text-lg font-semibold">{r.number}</div>
                <div className="truncate text-xs text-muted-foreground">{r.room_type} · floor {r.floor}</div>
                {!r.active && <StatusPill className="mt-1">Off</StatusPill>}
              </button>
            ))}
          </div>
        )}
      </Section>
      <RoomTypeDialog type={editType} onClose={() => setEditType(null)} onSaved={() => (setEditType(null), reload())} />
      <AddRooms open={adding} types={types.data.filter((t) => t.active)} onClose={() => setAdding(false)} onSaved={() => (setAdding(false), reload())} />
      <RoomDialog room={editRoom} types={types.data} onClose={() => setEditRoom(null)} onSaved={() => (setEditRoom(null), reload())} />
    </div>
  );
}

function RoomTypeDialog({ type, onClose, onSaved }: { type: RoomType | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = type && type !== 'new' ? type : null;
  const init = () => ({ name: t?.name ?? '', rate: String(t?.rate ?? ''), capacity: String(t?.capacity ?? 2), description: t?.description ?? '', amenities: (t?.amenities ?? []).join(', '), active: t ? !!t.active : true });
  const [f, setF] = useState(init);
  const [key, setKey] = useState<typeof type>(null);
  if (key !== type) (setKey(type), setF(init()));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const body = { ...f, rate: Number(f.rate), capacity: Number(f.capacity), amenities: f.amenities.split(',').map((a) => a.trim()).filter(Boolean) };
      await api(t ? `/settings/room-types/${t.id}` : '/settings/room-types', { method: t ? 'PUT' : 'POST', body });
      toast.success(t ? 'Room type updated' : 'Room type added', { description: t ? undefined : 'Now add its room numbers.' });
      onSaved();
    });
  };
  return (
    <Dialog open={!!type} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t ? `Edit ${t.name}` : 'Add a room type'}</DialogTitle></DialogHeader>
        <form id="rtype" className="grid gap-4" onSubmit={onSubmit}>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} placeholder="Deluxe Room" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Base rate / night"><MoneyInput value={f.rate} onChange={(v) => setF({ ...f, rate: v })} required /></Field>
            <Field label="Sleeps"><Input inputMode="numeric" className="tabular-nums" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} required /></Field>
          </div>
          <Field label="Description" hint="One or two sentences for the website"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} rows={2} /></Field>
          <Field label="In the room" hint="Comma-separated: King bed, Smart TV, Mini-fridge"><Input value={f.amenities} onChange={(e) => setF({ ...f, amenities: e.target.value })} /></Field>
          {t && <label className="flex items-center gap-3 text-sm"><Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} /> On sale</label>}
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="rtype" disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRooms({ open, types, onClose, onSaved }: { open: boolean; types: RoomType[]; onClose: () => void; onSaved: () => void }) {
  const [typeId, setTypeId] = useState('');
  const [numbers, setNumbers] = useState('');
  const [floor, setFloor] = useState('');
  const { busy, error, submit } = useSubmit();
  useEffect(() => {
    if (open && !typeId && types[0]) setTypeId(String(types[0].id));
  }, [open, types, typeId]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add rooms</DialogTitle></DialogHeader>
        <form
          id="rooms"
          className="grid gap-4"
          onSubmit={(e) => (
            e.preventDefault(),
            submit(async () => {
              const r = await api<{ created: number }>('/settings/rooms', { body: { room_type_id: Number(typeId), numbers, floor: floor || undefined } });
              toast.success(`${r.created} room${r.created > 1 ? 's' : ''} added`);
              setNumbers('');
              onSaved();
            })
          )}
        >
          <Field label="Room type"><SelectField value={typeId} onChange={setTypeId} options={types.map((t) => ({ value: String(t.id), label: `${t.name} — ${naira(t.rate)}` }))} /></Field>
          <Field label="Room numbers" hint="Ranges and lists: 101-108, 110, 201"><Input value={numbers} onChange={(e) => setNumbers(e.target.value)} required placeholder="101-108" className="font-mono" /></Field>
          <Field label="Floor" hint="Leave empty to use the first digit (101 → floor 1)"><Input inputMode="numeric" className="tabular-nums" value={floor} onChange={(e) => setFloor(e.target.value.replace(/\D/g, ''))} /></Field>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="rooms" disabled={busy}>Add rooms</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoomDialog({ room, types, onClose, onSaved }: { room: Room | null; types: RoomType[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ room_type_id: '', floor: '', active: true });
  const [key, setKey] = useState<Room | null>(null);
  if (key !== room) (setKey(room), room && setF({ room_type_id: String(room.room_type_id), floor: String(room.floor), active: !!room.active }));
  const { busy, error, submit } = useSubmit();
  const confirm = useConfirm();
  return (
    <Dialog open={!!room} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Room {room?.number}</DialogTitle></DialogHeader>
        <form
          id="room"
          className="grid gap-4"
          onSubmit={(e) => (e.preventDefault(), submit(async () => (await api(`/settings/rooms/${room!.id}`, { method: 'PUT', body: { room_type_id: Number(f.room_type_id), floor: Number(f.floor), active: f.active } }), toast.success('Room saved'), onSaved())))}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><SelectField value={f.room_type_id} onChange={(v) => setF({ ...f, room_type_id: v })} options={types.map((t) => ({ value: String(t.id), label: t.name }))} /></Field>
            <Field label="Floor"><Input inputMode="numeric" className="tabular-nums" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value.replace(/\D/g, '') })} required /></Field>
          </div>
          <label className="flex items-center gap-3 text-sm"><Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} /> In use</label>
          <ErrorNote error={error} />
        </form>
        <DialogFooter className="sm:justify-between">
          {room?.bookings === 0 ? (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={async () => (await confirm({ title: `Delete room ${room.number}?`, description: 'It has never been booked.', confirmLabel: 'Delete', destructive: true })) && submit(async () => (await api(`/settings/rooms/${room.id}`, { method: 'DELETE' }), toast.success('Room deleted'), onSaved()))}
            >
              <Trash2 /> Delete
            </Button>
          ) : <span />}
          <Button type="submit" form="room" disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface Item { id: number; facility: Facility; name: string; price: number; active: number }

function FacilityPrices() {
  const { data, reload } = useApi<Item[]>('/settings/facility-items?all=1');
  const [f, setF] = useState({ facility: 'gym' as Facility, name: '', price: '' });
  const { busy, error, submit } = useSubmit();
  const toggle = (i: Item) => api(`/settings/facility-items/${i.id}`, { method: 'PUT', body: { ...i, active: !i.active } }).then(reload, (e) => toast.error(e.message));
  if (!data) return <LoadingRows />;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Section title="Price list" description="One-tap buttons at the front desk; the lowest prices show on the website" flush>
        {data.length === 0 ? (
          <EmptyState title="No prices yet">Add gym passes, pool passes and lounge charges.</EmptyState>
        ) : (
          <Table>
            <TableBody>
              {OUTLETS.flatMap((fac) =>
                data.filter((i) => i.facility === fac).map((i, n) => (
                  <TableRow key={i.id} className={i.active ? '' : 'opacity-50'}>
                    <TableCell className="w-36 pl-5 text-xs font-medium text-muted-foreground">{n === 0 ? OUTLET_LABELS[fac] : ''}</TableCell>
                    <TableCell>{i.name}</TableCell>
                    <TableCell className="text-right font-medium"><Money value={i.price} /></TableCell>
                    <TableCell className="pr-5 text-right"><Switch checked={!!i.active} onCheckedChange={() => toggle(i)} aria-label={`Show ${i.name}`} /></TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section title="Add a price">
        <form
          className="grid gap-4"
          onSubmit={(e) => (e.preventDefault(), submit(async () => (await api('/settings/facility-items', { body: { ...f, price: Number(f.price) } }), toast.success('Price added'), setF({ ...f, name: '', price: '' }), reload())))}
        >
          <Field label="For"><SelectField value={f.facility} onChange={(v) => setF({ ...f, facility: v as Facility })} options={OUTLETS.map((x) => ({ value: x, label: OUTLET_LABELS[x] }))} /></Field>
          <Field label="What is sold"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} placeholder="Pool day pass — adult" /></Field>
          <Field label="Price"><MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} required /></Field>
          <ErrorNote error={error} />
          <Button disabled={busy}>Add price</Button>
        </form>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Integrations() {
  const status = useApi<{ sms: boolean; online_payments: boolean }>('/messaging/status');
  const { data, reload } = useApi<HotelSettings>('/settings');
  const [pct, setPct] = useState('');
  const { busy, error, submit } = useSubmit();
  useEffect(() => {
    if (data) setPct(String(data.deposit_percent || ''));
  }, [data]);
  if (!data || !status.data) return <LoadingRows />;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Section title={<span className="flex items-center gap-2"><CreditCard className="size-4" /> Online deposits (Paystack)</span>} description="Guests pay a deposit by card, bank transfer or USSD when they book on the website.">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            Connection: {status.data.online_payments ? <StatusPill tone="success">Connected</StatusPill> : <StatusPill tone="warning">Not connected</StatusPill>}
          </div>
          {!status.data.online_payments && (
            <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              The person who runs the server sets <code className="font-mono">PAYSTACK_SECRET_KEY</code> from the hotel's Paystack dashboard, and points Paystack's webhook to <code className="font-mono">/api/paystack/webhook</code>. Keys never go in this screen or the browser.
            </p>
          )}
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => (e.preventDefault(), submit(async () => (await api('/settings', { method: 'PUT', body: { ...data, deposit_percent: Number(pct || 0) } }), toast.success(Number(pct) ? `Guests can pay ${pct}% online` : 'Online deposits turned off'), reload())))}>
            <Field label="Deposit guests pay online" hint="0 turns online payment off. 100 means full payment.">
              <div className="relative w-32">
                <Input inputMode="numeric" className="pr-7 tabular-nums" value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="0" />
                <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </Field>
            <Button disabled={busy}>Save</Button>
          </form>
          <ErrorNote error={error} />
          <p className="text-xs text-muted-foreground">A paid deposit confirms the booking automatically and appears on the guest's bill as “Paid online”.</p>
        </div>
      </Section>
      <Section title={<span className="flex items-center gap-2"><MessageCircle className="size-4" /> Guest messages</span>} description="Confirmations, reminders and thank-yous from each reservation.">
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">WhatsApp: <StatusPill tone="success">Ready</StatusPill></div>
          <p className="text-muted-foreground">Staff tap “Send on WhatsApp” and the message opens ready to send from the hotel's phone.</p>
          <div className="flex items-center gap-2 pt-2">SMS: {status.data.sms ? <StatusPill tone="success">Connected</StatusPill> : <StatusPill>Not connected</StatusPill>}</div>
          {!status.data.sms && <p className="text-xs text-muted-foreground">Connect Termii by setting <code className="font-mono">TERMII_API_KEY</code> and <code className="font-mono">TERMII_SENDER_ID</code> on the server, and messages send automatically by SMS.</p>}
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SiteImage { id: number; slot: string; alt: string }

/** The pictures the guest website sells with. Each place shows what's there and takes more. */
function WebsitePhotos() {
  const images = useApi<SiteImage[]>('/settings/images');
  const types = useApi<RoomType[]>('/settings/room-types');
  if (!images.data || !types.data) return <LoadingRows />;
  const inSlot = (slot: string) => images.data!.filter((i) => i.slot === slot);
  const places = [
    { slot: 'hero', title: 'Main banner', hint: 'The first thing visitors see. A wide, bright photo of the building or your best room. Landscape works best.', max: 1, wide: true },
    ...types.data.filter((t) => t.active).map((t) => ({ slot: `room_type:${t.id}`, title: t.name, hint: 'Up to 6 photos: the bed, the bathroom, the view. The first one leads the room card.', max: 6, wide: false })),
    ...FACILITIES.map((f) => ({ slot: `facility:${f}`, title: FACILITY_LABELS[f], hint: 'One photo for this facility.', max: 1, wide: false })),
    { slot: 'gallery', title: 'Gallery', hint: 'Up to 12 more: reception, the compound, breakfast, an event in the lounge.', max: 12, wide: false },
  ];
  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Real photos sell rooms. Photos are shrunk on your device before they upload, so taking them on a phone is fine. Until a place has a photo, the website shows a tasteful placeholder.
      </p>
      {places.map((p) => (
        <PhotoPlace key={p.slot} {...p} photos={inSlot(p.slot)} onChange={images.reload} />
      ))}
    </div>
  );
}

function PhotoPlace({ slot, title, hint, max, wide, photos, onChange }: { slot: string; title: string; hint: string; max: number; wide: boolean; photos: SiteImage[]; onChange: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList) => {
    setBusy(true);
    try {
      for (const f of [...files].slice(0, max === 1 ? 1 : max - photos.length)) {
        const photo = await shrinkPhoto(f, { maxSide: wide ? 1920 : 1400, maxBytes: 850_000 });
        await api('/settings/images', { body: { slot, ...photo, alt: '' } });
      }
      toast.success('Photo saved', { description: 'It is on the website now.' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the photo');
    } finally {
      setBusy(false);
      onChange();
    }
  };
  const full = max > 1 && photos.length >= max;
  return (
    <Section
      title={<span className="flex items-center gap-2"><ImageIcon className="size-4" /> {title}</span>}
      description={hint}
      action={
        !full && (
          <Button asChild size="sm" variant="outline" disabled={busy}>
            <label className="cursor-pointer">
              <Upload /> {busy ? 'Uploading…' : max === 1 && photos.length ? 'Replace' : 'Add photo'}
              <input type="file" accept="image/*" multiple={max > 1} className="sr-only" disabled={busy} onChange={(e) => (e.target.files?.length && upload(e.target.files), (e.target.value = ''))} />
            </label>
          </Button>
        )
      }
    >
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No photo yet.</p>
      ) : (
        <div className={cn('grid gap-3', wide ? 'grid-cols-1 sm:max-w-xl' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6')}>
          {photos.map((p, i) => (
            <figure key={p.id} className="group relative overflow-hidden rounded-lg border bg-muted">
              <img src={`/api/public/images/${p.id}`} alt={p.alt} className={cn('w-full object-cover', wide ? 'aspect-[16/7]' : 'aspect-[4/3]')} loading="lazy" />
              {i === 0 && max > 1 && <span className="absolute top-1.5 left-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold">Shown first</span>}
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                {i > 0 && (
                  <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => api(`/settings/images/${p.id}`, { method: 'PATCH', body: { first: true } }).then(onChange)}>
                    Show first
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="size-7"
                  aria-label="Remove photo"
                  onClick={async () => (await confirm({ title: 'Remove this photo from the website?', confirmLabel: 'Remove', destructive: true })) && api(`/settings/images/${p.id}`, { method: 'DELETE' }).then(onChange)}
                >
                  <Trash2 />
                </Button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

interface BackupInfo {
  backups: { name: string; bytes: number; at: string }[];
  offsite: { configured: boolean; reason: string | null };
  last: { at: string; ok: boolean; name: string; offsite: string } | null;
}

/** Backups happen by themselves every night; this shows that they did, and lets the owner take one or download it. */
function Backups() {
  const { user } = useAuth();
  const { data, reload } = useApi<BackupInfo>('/admin/backups');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  if (!data) return <LoadingRows />;
  const now = () => {
    setBusy(true);
    api<{ name: string; offsite: string }>('/admin/backups', { body: {} })
      .then((r) => toast[r.offsite.startsWith('failed') ? 'error' : 'success'](r.offsite === 'sent' ? 'Backed up, and a copy sent off-site' : r.offsite.startsWith('failed') ? 'Saved on the server, but the off-site copy failed' : 'Backed up on the server', { description: r.offsite.startsWith('failed') ? r.offsite : r.name }))
      .catch((e) => toast.error(e.message))
      .finally(() => (setBusy(false), reload()));
  };
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Section title="Copies on the server" description="One every night after 3 am, plus any you take. The newest 14 are kept." action={<Button size="sm" onClick={now} disabled={busy}>{busy ? 'Backing up…' : 'Back up now'}</Button>} flush>
        {data.backups.length === 0 ? (
          <EmptyState title="No backups yet" className="py-8">The first one is taken tonight, or now with the button above.</EmptyState>
        ) : (
          <Table>
            <TableBody>
              {data.backups.map((b) => (
                <TableRow key={b.name}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{new Date(b.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })}</div>
                    <div className="font-mono text-xs text-muted-foreground">{b.name} · {mb(b.bytes)}</div>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {user!.role === 'ceo' && <Button variant="ghost" size="sm" onClick={() => setDownloading(b.name)}>Download</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <div className="space-y-6">
        <Section title="Off-site copy" description="Only a copy kept somewhere else survives losing the server's disk.">
          {data.offsite.configured ? (
            <StatusPill tone="success">Set up — each backup is encrypted and sent off-site</StatusPill>
          ) : (
            <div className="space-y-2 text-sm">
              <StatusPill tone="warning">Not set up</StatusPill>
              <p className="text-muted-foreground">{data.offsite.reason} Any S3-compatible storage works (Cloudflare R2, Backblaze B2, AWS S3). Whoever runs the server sets it up; see the README.</p>
            </div>
          )}
          {data.last && (
            <p className={cn('mt-4 text-sm', data.last.ok ? 'text-muted-foreground' : 'text-destructive')}>
              Last backup {new Date(data.last.at.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })}: off-site {data.last.offsite}.
            </p>
          )}
        </Section>
      </div>
      <DownloadBackup name={downloading} onClose={() => setDownloading(null)} />
    </div>
  );
}

function DownloadBackup({ name, onClose }: { name: string | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const res = await fetch('/api/admin/backups/download', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-danest-request': '1' }, body: JSON.stringify({ name, password }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not download');
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement('a'), { href: url, download: name! }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setPassword('');
      onClose();
    });
  };
  return (
    <Dialog open={!!name} onOpenChange={(o) => !o && (setPassword(''), onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Download the whole database?</DialogTitle></DialogHeader>
        <form id="dl" className="grid gap-3" onSubmit={onSubmit}>
          <p className="text-sm text-muted-foreground">It holds every guest, payment and staff record. Keep it somewhere safe. The download is logged.</p>
          <Field label="Your password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></Field>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="dl" disabled={busy || !password}>{busy ? 'Preparing…' : 'Download'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
