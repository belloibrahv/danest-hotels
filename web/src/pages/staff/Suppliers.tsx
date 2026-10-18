import { Pencil, Phone, Plus, Truck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PAYMENT_LABELS, PURCHASE_TERMS_LABELS } from '../../../../shared/constants';
import { Field } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, StatCard } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDate, naira, nairaShort } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { PayBill } from './Accounts';

export interface Supplier {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  terms_days: number;
  notes: string | null;
  active: number;
  owed: number;
  overdue: number;
  deliveries: number;
  bought_12m: number;
  last_delivery: string | null;
  open_orders: number;
}
interface Statement extends Supplier {
  bills: { id: number; ref: string; date: string; status: string; terms: string | null; invoice_no: string | null; due_date: string | null; total: number; paid: number; owed: number }[];
  payments: { id: number; date: string; amount: number; method: string; reference: string | null; purchase_ref: string; paid_by: string }[];
  products: { id: number; name: string; stock: number; reorder_level: number }[];
}

export default function Suppliers() {
  const { user } = useAuth();
  const writer = can(user, 'manager', 'accountant');
  const [tick, setTick] = useState(0);
  const v = useLive('stock', 'money');
  const { data, error } = useApi<Supplier[]>(`/suppliers?all=1&v=${v + tick}`);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const refresh = () => setTick((x) => x + 1);
  const active = data?.filter((s) => s.active) ?? [];

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who the hotel buys from, what each is owed, and their payment terms."
        actions={writer && <Button onClick={() => setEditing('new')}><Plus /> Add supplier</Button>}
      />
      {data && data.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatCard label="Active suppliers" value={active.length} />
          <StatCard label="Owed to suppliers" value={nairaShort(active.reduce((a, s) => a + s.owed, 0))} />
          <StatCard label="Overdue" value={<span className={active.some((s) => s.overdue) ? 'text-destructive' : ''}>{nairaShort(active.reduce((a, s) => a + s.overdue, 0))}</span>} />
          <StatCard label="Bought, last 12 months" value={nairaShort(active.reduce((a, s) => a + s.bought_12m, 0))} />
        </div>
      )}
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={6} />
        ) : data.length === 0 ? (
          <EmptyState icon={Truck} title="No suppliers yet" action={writer && <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add the first</Button>}>
            Suppliers are also added automatically the first time you record a purchase from them.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Supplier</TableHead>
                <TableHead className="hidden md:table-cell">Terms</TableHead>
                <TableHead className="hidden lg:table-cell">Last delivery</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Bought (12 mo)</TableHead>
                <TableHead className="pr-5 text-right">Owed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id} className={s.active ? 'cursor-pointer' : 'cursor-pointer opacity-50'} onClick={() => setOpen(s.id)}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{[s.contact_name, s.phone].filter(Boolean).join(' · ') || 'No contact saved'}{s.open_orders ? ` · ${s.open_orders} order${s.open_orders > 1 ? 's' : ''} on the way` : ''}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{s.terms_days ? `${s.terms_days} days` : 'Pay on delivery'}</TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">{s.last_delivery ? fmtDate(s.last_delivery) : '—'}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell"><Money value={s.bought_12m} /></TableCell>
                  <TableCell className="pr-5 text-right">
                    {s.owed ? <Money value={s.owed} className="font-semibold" /> : <span className="text-muted-foreground">—</span>}
                    {s.overdue > 0 && <div><StatusPill tone="danger">{naira(s.overdue)} overdue</StatusPill></div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <SupplierDialog supplier={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} />
      <SupplierSheet id={open} version={v + tick} writer={writer} onClose={() => setOpen(null)} onEdit={(s) => setEditing(s)} onChange={refresh} />
    </>
  );
}

function SupplierSheet({ id, version, writer, onClose, onEdit, onChange }: { id: number | null; version: number; writer: boolean; onClose: () => void; onEdit: (s: Supplier) => void; onChange: () => void }) {
  const { data: s } = useApi<Statement>(id ? `/suppliers/${id}?v=${version}` : null);
  const [paying, setPaying] = useState<Statement['bills'][number] | null>(null);
  const show = s && s.id === id;
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {!show ? (
          <LoadingRows rows={8} />
        ) : (
          <>
            <SheetHeader className="gap-3 border-b p-5">
              <SheetTitle className="text-lg">{s.name}</SheetTitle>
              <SheetDescription>
                {[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details'} · {s.terms_days ? `${s.terms_days} days to pay` : 'Paid on delivery'}
              </SheetDescription>
              <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Owed</div><div className="font-semibold tabular-nums">{naira(s.owed)}</div></div>
                <div><div className="text-xs text-muted-foreground">Overdue</div><div className={s.overdue ? 'font-semibold text-destructive tabular-nums' : 'font-semibold tabular-nums'}>{naira(s.overdue)}</div></div>
                <div><div className="text-xs text-muted-foreground">Bought (12 mo)</div><div className="font-semibold tabular-nums">{nairaShort(s.bought_12m)}</div></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {writer && <Button size="sm" variant="outline" onClick={() => onEdit(s)}><Pencil /> Edit</Button>}
                {s.phone && <Button size="sm" variant="outline" asChild><a href={`tel:${s.phone.replace(/\s/g, '')}`}><Phone /> Call</a></Button>}
                <Button size="sm" variant="outline" asChild><Link to="/staff/purchases">Purchases</Link></Button>
              </div>
            </SheetHeader>
            <div className="space-y-6 p-5">
              <section>
                <h3 className="mb-2 text-sm font-semibold">Deliveries & bills</h3>
                {s.bills.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing bought yet.</p>
                ) : (
                  <Table>
                    <TableBody>
                      {s.bills.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="pl-0">
                            <div className="font-mono text-xs">{b.ref}{b.invoice_no ? ` · ${b.invoice_no}` : ''}</div>
                            <div className="text-xs text-muted-foreground">{fmtDate(b.date)} · {b.status === 'ordered' ? 'Ordered, not delivered' : b.terms ? PURCHASE_TERMS_LABELS[b.terms as keyof typeof PURCHASE_TERMS_LABELS] : 'Paid'}{b.due_date && b.owed ? ` · due ${fmtDate(b.due_date)}` : ''}</div>
                          </TableCell>
                          <TableCell className="text-right"><Money value={b.total} /></TableCell>
                          <TableCell className="pr-0 text-right">
                            {b.owed > 0 ? (
                              writer ? <Button size="sm" variant="outline" onClick={() => setPaying(b)}>Pay {nairaShort(b.owed)}</Button> : <StatusPill tone="warning">Owes {nairaShort(b.owed)}</StatusPill>
                            ) : b.status === 'ordered' ? <StatusPill tone="info">On order</StatusPill> : <StatusPill tone="success">Settled</StatusPill>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>
              {s.payments.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Payments made</h3>
                  <ul className="divide-y text-sm">
                    {s.payments.map((p) => (
                      <li key={p.id} className="flex justify-between gap-3 py-2">
                        <span>{fmtDate(p.date)} · {PAYMENT_LABELS[p.method as keyof typeof PAYMENT_LABELS]} <span className="text-xs text-muted-foreground">for {p.purchase_ref}{p.reference ? ` · ${p.reference}` : ''} · {p.paid_by}</span></span>
                        <Money value={p.amount} className="font-medium" />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {s.products.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Items usually bought here</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {s.products.map((p) => (
                      <StatusPill key={p.id} tone={p.stock <= p.reorder_level ? 'warning' : 'neutral'} dot={p.stock <= p.reorder_level}>{p.name} · {p.stock}</StatusPill>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
      <PayBill bill={paying && s ? { id: paying.id, ref: paying.ref, supplier: s.name, owed: paying.owed } : null} onClose={() => setPaying(null)} onPaid={() => (setPaying(null), onChange())} />
    </Sheet>
  );
}

function SupplierDialog({ supplier, onClose, onSaved }: { supplier: Supplier | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const s = supplier && supplier !== 'new' ? supplier : null;
  const init = () => ({ name: s?.name ?? '', contact_name: s?.contact_name ?? '', phone: s?.phone ?? '', email: s?.email ?? '', address: s?.address ?? '', terms_days: String(s?.terms_days ?? 0), notes: s?.notes ?? '', active: s ? !!s.active : true });
  const [f, setF] = useState(init);
  const [key, setKey] = useState<typeof supplier>(null);
  if (key !== supplier) (setKey(supplier), setF(init()));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(s ? `/suppliers/${s.id}` : '/suppliers', { method: s ? 'PUT' : 'POST', body: { ...f, terms_days: Number(f.terms_days || 0) } });
      toast.success(s ? 'Supplier updated' : 'Supplier added');
      onSaved();
    });
  };
  return (
    <Dialog open={!!supplier} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{s ? `Edit ${s.name}` : 'Add a supplier'}</DialogTitle></DialogHeader>
        <form id="supplier" className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} /></Field>
          <Field label="Contact person"><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} maxLength={120} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={20} inputMode="tel" /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={254} /></Field>
          <Field label="Days to pay" hint="0 = paid on delivery"><Input inputMode="numeric" className="tabular-nums" value={f.terms_days} onChange={(e) => setF({ ...f, terms_days: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={200} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} rows={2} placeholder="Bank details, delivery days, minimum order" /></Field>
          {s && <label className="flex items-center gap-3 text-sm sm:col-span-2"><Switch checked={f.active} onCheckedChange={(x) => setF({ ...f, active: x })} /> Still buying from them</label>}
          <div className="sm:col-span-2"><ErrorNote error={error} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="supplier" disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
