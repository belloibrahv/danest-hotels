import { PackageCheck, Plus, ShoppingCart, Sparkles, Truck, X } from 'lucide-react';
import { Fragment, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PURCHASE_TERMS, PURCHASE_TERMS_LABELS, type PurchaseTerms } from '../../../../shared/constants';
import { DateRangePicker, useRange } from '@/components/app/date-range';
import { DateInput, Field, MoneyInput, SelectField, VoidButton } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, StatCard } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, fmtDate, naira, nairaShort, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { PayBill } from './Accounts';
import type { Product } from './Pos';
import type { Supplier } from './Suppliers';

interface Purchase {
  id: number;
  ref: string;
  supplier: string;
  supplier_id: number | null;
  date: string;
  total: number;
  notes: string | null;
  status: 'ordered' | 'received' | 'cancelled';
  terms: PurchaseTerms | null;
  invoice_no: string | null;
  due_date: string | null;
  recorded_by: string;
  received_by: string | null;
  paid: number;
  owed: number;
  items: { product_id: number; name: string; unit: string; qty: number; unit_cost: number }[];
}

export default function Purchases() {
  const { user } = useAuth();
  const buyer = can(user, 'manager');
  const payer = can(user, 'manager', 'accountant');
  const range = useRange('month');
  const [view, setView] = useState<'received' | 'ordered'>('received');
  const [tick, setTick] = useState(0);
  const v = useLive('stock', 'money');
  const { data, error } = useApi<{ purchases: Purchase[]; open_orders: { n: number; v: number } }>(`/purchases?${range.qs}${view === 'ordered' ? '&status=ordered' : ''}&v=${v + tick}`);
  const refresh = () => setTick((x) => x + 1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const list = data?.purchases ?? [];
  const delivered = list.filter((p) => p.status === 'received');
  const total = delivered.reduce((a, p) => a + p.total, 0);
  const onCredit = delivered.filter((p) => p.terms === 'credit').reduce((a, p) => a + p.total, 0);
  const owed = delivered.reduce((a, p) => a + p.owed, 0);

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Order stock, receive what arrives, and pay the bill now or on credit. Stock and the cost of what's sold change only when a delivery is received."
        actions={
          <>
            {view === 'received' && <DateRangePicker state={range} />}
            {buyer && <Button onClick={() => setCreating(true)}><Plus /> New purchase</Button>}
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Stock received" value={nairaShort(total)} hint={`${delivered.length} deliveries in this period`} />
        <StatCard label="Bought on credit" value={nairaShort(onCredit)} hint={`${nairaShort(owed)} of it still owed`} />
        <StatCard label="On order" value={data?.open_orders.n ?? '—'} hint={data ? `${nairaShort(data.open_orders.v)} not yet delivered` : undefined} />
        <StatCard label="Suppliers used" value={new Set(delivered.map((p) => p.supplier_id ?? p.supplier)).size} />
      </div>
      <Tabs value={view} onValueChange={(x) => setView(x as typeof view)} className="mb-4">
        <TabsList className="h-9">
          <TabsTrigger value="received"><PackageCheck /> Deliveries</TabsTrigger>
          <TabsTrigger value="ordered"><Truck /> On order {data?.open_orders.n ? `(${data.open_orders.n})` : ''}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={5} />
        ) : list.length === 0 ? (
          <EmptyState icon={view === 'ordered' ? Truck : ShoppingCart} title={view === 'ordered' ? 'Nothing on order' : 'No purchases in this period'} action={buyer && <Button size="sm" onClick={() => setCreating(true)}><Plus /> New purchase</Button>} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="hidden lg:table-cell">Items</TableHead>
                <TableHead>{view === 'ordered' ? 'Status' : 'Payment'}</TableHead>
                <TableHead className="pr-5 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((p) => (
                <Fragment key={p.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <TableCell className="pl-5 tabular-nums">{fmtDate(p.date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{p.supplier}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.ref}{p.invoice_no ? ` · ${p.invoice_no}` : ''}</div>
                    </TableCell>
                    <TableCell className="hidden max-w-sm truncate text-muted-foreground lg:table-cell">
                      {p.items.length} item{p.items.length > 1 ? 's' : ''} — {p.items.slice(0, 3).map((i) => i.name).join(', ')}{p.items.length > 3 ? '…' : ''}
                    </TableCell>
                    <TableCell><PaymentPill p={p} /></TableCell>
                    <TableCell className="pr-5 text-right font-medium"><Money value={p.total} /></TableCell>
                  </TableRow>
                  {open === p.id && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={5} className="px-5 py-3">
                        <div className="grid gap-1 text-sm sm:grid-cols-2">
                          {p.items.map((i) => (
                            <div key={i.product_id} className="flex justify-between gap-4">
                              <span>{i.qty} × {i.name}</span>
                              <span className="text-muted-foreground tabular-nums">@ {naira(i.unit_cost)} = {naira(i.qty * i.unit_cost)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Recorded by {p.recorded_by}</span>
                          {p.received_by && <span>Received by {p.received_by}</span>}
                          {p.due_date && p.owed > 0 && <span>Due {fmtDate(p.due_date)}</span>}
                          {p.paid > 0 && <span>Paid so far {naira(p.paid)}</span>}
                          {p.notes && <span>“{p.notes}”</span>}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                          {buyer && p.status === 'ordered' && <Button size="sm" onClick={() => setReceiving(p)}><PackageCheck /> Receive delivery</Button>}
                          {buyer && p.status === 'ordered' && (
                            <VoidButton verb="Cancel" label="this order" onVoid={(reason) => api(`/purchases/${p.id}/cancel`, { body: { reason } }).then(() => (toast.success('Order cancelled'), refresh()))} />
                          )}
                          {payer && p.owed > 0 && <Button size="sm" variant="outline" onClick={() => setPaying(p)}>Pay {naira(p.owed)}</Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <NewPurchase open={creating} onClose={() => setCreating(false)} onSaved={(status) => (setCreating(false), setView(status), refresh())} />
      <Receive order={receiving} onClose={() => setReceiving(null)} onSaved={() => (setReceiving(null), setView('received'), refresh())} />
      <PayBill bill={paying} onClose={() => setPaying(null)} onPaid={() => (setPaying(null), refresh())} />
    </>
  );
}

function PaymentPill({ p }: { p: Purchase }) {
  if (p.status === 'ordered') return <StatusPill tone="info">Awaiting delivery</StatusPill>;
  if (p.status === 'cancelled') return <StatusPill>Cancelled</StatusPill>;
  if (p.terms === 'credit') {
    if (p.owed <= 0) return <StatusPill tone="success">Credit · paid</StatusPill>;
    const late = p.due_date && p.due_date < todayISO();
    return <StatusPill tone={late ? 'danger' : 'warning'}>{late ? 'Overdue' : 'Owed'} {nairaShort(p.owed)}</StatusPill>;
  }
  return <StatusPill tone="success">{p.terms ? `Paid · ${PURCHASE_TERMS_LABELS[p.terms]}` : 'Paid'}</StatusPill>;
}

type Line = { product_id: string; qty: string; unit_cost: string };
const blank = (): Line => ({ product_id: '', qty: '', unit_cost: '' });

function LinesEditor({ lines, setLines, products }: { lines: Line[]; setLines: (fn: (ls: Line[]) => Line[]) => void; products: Product[] }) {
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[1fr_72px_120px_32px] gap-2 text-xs font-medium text-muted-foreground">
        <span>Item</span>
        <span>Qty</span>
        <span>Unit cost</span>
        <span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_72px_120px_32px] items-center gap-2">
          <SelectField
            value={l.product_id}
            onChange={(x) => {
              const p = products.find((y) => String(y.id) === x);
              setLine(i, { product_id: x, unit_cost: l.unit_cost || String(p?.avg_cost ?? '') });
            }}
            placeholder="Choose item"
            options={products.filter((p) => p.track_stock !== 0).map((p) => ({ value: String(p.id), label: `${p.name} (${p.stock})` }))}
          />
          <Input inputMode="numeric" className="tabular-nums" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/\D/g, '') })} required />
          <MoneyInput value={l.unit_cost} onChange={(x) => setLine(i, { unit_cost: x })} required />
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}>
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setLines((ls) => [...ls, blank()])}>
        <Plus /> Add line
      </Button>
    </div>
  );
}

const toItems = (lines: Line[]) => lines.filter((l) => l.product_id && l.qty).map((l) => ({ product_id: Number(l.product_id), qty: Number(l.qty), unit_cost: Number(l.unit_cost || 0) }));
const sum = (lines: Line[]) => lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.unit_cost || 0), 0);

function NewPurchase({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (status: 'received' | 'ordered') => void }) {
  const products = useApi<Product[]>(open ? '/products' : null);
  const suppliers = useApi<Supplier[]>(open ? '/suppliers' : null);
  const [status, setStatus] = useState<'received' | 'ordered'>('received');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayISO());
  const [terms, setTerms] = useState<PurchaseTerms>('cash');
  const [invoice, setInvoice] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const { busy, error, submit } = useSubmit();
  const total = sum(lines);
  const known = suppliers.data?.find((s) => s.name.toLowerCase() === supplier.trim().toLowerCase());
  const low = (products.data ?? []).filter((p) => p.track_stock !== 0 && p.stock <= p.reorder_level && (!known || p.supplier_id === known.id));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/purchases', { body: { status, supplier, date, notes, invoice_no: invoice, terms: status === 'received' ? terms : undefined, items: toItems(lines) } });
      toast.success(status === 'ordered' ? `Order of ${naira(total)} placed with ${supplier}` : `Delivery of ${naira(total)} received`, { description: status === 'ordered' ? 'Stock will rise when you receive it.' : terms === 'credit' ? 'Added to supplier bills to pay.' : 'Stock updated.' });
      setSupplier('');
      setNotes('');
      setInvoice('');
      setLines([blank()]);
      onSaved(status);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase</DialogTitle>
          <DialogDescription>Place an order to receive later, or record a delivery that has just arrived.</DialogDescription>
        </DialogHeader>
        <form id="purchase" className="grid gap-4" onSubmit={onSubmit}>
          <ToggleGroup type="single" variant="outline" value={status} onValueChange={(x) => x && setStatus(x as typeof status)} className="grid w-full grid-cols-2">
            <ToggleGroupItem value="received" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"><PackageCheck /> Arrived now</ToggleGroupItem>
            <ToggleGroupItem value="ordered" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"><Truck /> Place an order</ToggleGroupItem>
          </ToggleGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier" hint={known ? (known.terms_days ? `${known.terms_days} days to pay` : 'Paid on delivery') : supplier ? 'New supplier — added automatically' : undefined}>
              <Input list="supplier-list" value={supplier} onChange={(e) => setSupplier(e.target.value)} required maxLength={120} placeholder="Bodija Drinks Depot" />
              <datalist id="supplier-list">{suppliers.data?.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </Field>
            <Field label={status === 'ordered' ? 'Ordered on' : 'Delivered on'}><DateInput value={date} max={todayISO()} onChange={setDate} /></Field>
            {status === 'received' && (
              <>
                <Field label="Paid">
                  <SelectField value={terms} onChange={(x) => setTerms(x as PurchaseTerms)} options={PURCHASE_TERMS.map((t) => ({ value: t, label: PURCHASE_TERMS_LABELS[t] }))} />
                </Field>
                <Field label="Supplier's invoice no."><Input value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={60} placeholder="Optional" /></Field>
              </>
            )}
          </div>
          {low.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setLines(low.map((p) => ({ product_id: String(p.id), qty: String(Math.max(1, p.reorder_level * 3 - p.stock)), unit_cost: String(p.avg_cost ?? '') })))}
            >
              <Sparkles /> Fill in the {low.length} items running low{known ? ` from ${known.name}` : ''}
            </Button>
          )}
          <LinesEditor lines={lines} setLines={setLines} products={products.data ?? []} />
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Delivery notes" /></Field>
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <Money value={total} className="text-xl font-semibold" />
          </div>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="purchase" disabled={busy || total === 0}>{status === 'ordered' ? 'Place order' : 'Save delivery'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Receive an order: change any quantity or price to what actually came, then choose how it was paid. */
function Receive({ order, onClose, onSaved }: { order: Purchase | null; onClose: () => void; onSaved: () => void }) {
  const products = useApi<Product[]>(order ? '/products' : null);
  const [lines, setLines] = useState<Line[]>([]);
  const [terms, setTerms] = useState<PurchaseTerms>('credit');
  const [invoice, setInvoice] = useState('');
  const [date, setDate] = useState(todayISO());
  const [key, setKey] = useState<number | null>(null);
  if (order && key !== order.id) {
    setKey(order.id);
    setLines(order.items.map((i) => ({ product_id: String(i.product_id), qty: String(i.qty), unit_cost: String(i.unit_cost) })));
    setTerms('credit');
    setInvoice('');
    setDate(todayISO());
  }
  const { busy, error, submit } = useSubmit();
  const total = sum(lines);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(`/purchases/${order!.id}/receive`, { body: { items: toItems(lines), terms, invoice_no: invoice, date } });
      toast.success(`${order!.ref} received`, { description: total !== order!.total ? `Booked at ${naira(total)} (ordered ${naira(order!.total)})` : 'Stock updated.' });
      onSaved();
    });
  };
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive {order?.ref} from {order?.supplier}</DialogTitle>
          <DialogDescription>Count what arrived. Change any line that differs from the order; the difference is noted for the auditor.</DialogDescription>
        </DialogHeader>
        <form id="receive" className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Delivered on"><DateInput value={date} max={todayISO()} onChange={setDate} /></Field>
            <Field label="Paid"><SelectField value={terms} onChange={(x) => setTerms(x as PurchaseTerms)} options={PURCHASE_TERMS.map((t) => ({ value: t, label: PURCHASE_TERMS_LABELS[t] }))} /></Field>
            <Field label="Invoice no."><Input value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={60} placeholder="Optional" /></Field>
          </div>
          <LinesEditor lines={lines} setLines={setLines} products={products.data ?? []} />
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Received total {order && total !== order.total && <span className="text-warning">(ordered {naira(order.total)})</span>}</span>
            <Money value={total} className="text-xl font-semibold" />
          </div>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="receive" disabled={busy || total === 0}><PackageCheck /> Receive into stock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
