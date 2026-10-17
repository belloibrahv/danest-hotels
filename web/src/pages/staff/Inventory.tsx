import { ArrowDownToLine, BarChart3, Camera, FileSpreadsheet, ImageOff, Package, PackageSearch, Plus, Search, ShoppingCart, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { PURCHASE_TERMS, PURCHASE_TERMS_LABELS } from '../../../../shared/constants';
import { Field, MoneyInput, SelectField, useConfirm } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDate, fmtTime, naira, nairaShort, pct } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { download, parseCsv } from '@/lib/csv';
import { shrinkPhoto } from '@/lib/photo';
import { useApi, useSubmit } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';
import { productImage, type Product } from './Pos';
import type { Supplier } from './Suppliers';

export default function Inventory() {
  const { user } = useAuth();
  const manager = can(user, 'manager');
  const books = can(user, 'manager', 'accountant', 'auditor');
  const [params, setParams] = useSearchParams();
  const tab = books && params.get('tab') === 'insights' ? 'insights' : 'items';
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Stock"
        description="Every drink and snack: what's on the shelf, what it cost, how fast it sells. Updates live as the till sells."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href="/api/products.csv"><ArrowDownToLine /> Export</a>
            </Button>
            {manager && (
              <>
                <Button variant="outline" onClick={() => setImporting(true)}><Upload /> Upload file</Button>
                <Button variant="outline" asChild><Link to="/staff/purchases"><ShoppingCart /> Purchases</Link></Button>
                <Button onClick={() => setEditing('new')}><Plus /> Add item</Button>
              </>
            )}
          </>
        }
      />
      {books ? (
        <Tabs value={tab} onValueChange={(t) => setParams(t === 'items' ? {} : { tab: t }, { replace: true })}>
          <TabsList className="mb-4 h-9">
            <TabsTrigger value="items"><Package /> Items</TabsTrigger>
            <TabsTrigger value="insights"><BarChart3 /> Insights</TabsTrigger>
          </TabsList>
          <TabsContent value="items"><Items editing={editing} setEditing={setEditing} /></TabsContent>
          <TabsContent value="insights"><Insights /></TabsContent>
        </Tabs>
      ) : (
        <Items editing={editing} setEditing={setEditing} />
      )}
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

// ---------- the catalogue ----------

function Thumb({ p, className }: { p: Product; className?: string }) {
  const src = productImage(p);
  return src ? (
    <img src={src} alt="" loading="lazy" className={cn('size-10 shrink-0 rounded-md border bg-muted object-cover', className)} />
  ) : (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground', className)}><Package className="size-4" /></span>
  );
}

function Items({ editing, setEditing }: { editing: Product | 'new' | null; setEditing: (p: Product | 'new' | null) => void }) {
  const { user } = useAuth();
  const manager = can(user, 'manager');
  const showCost = can(user, 'manager', 'accountant', 'auditor');
  const v = useLive('stock');
  const [tick, setTick] = useState(0);
  const { data, error } = useApi<Product[]>(`${showCost ? '/products?all=1&' : '/products?'}v=${v + tick}`);
  const reload = () => setTick((x) => x + 1);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [counting, setCounting] = useState<Product | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (p) =>
        (cat === 'all' ? true : cat === 'low' ? p.active && p.stock <= p.reorder_level : cat === 'off' ? !p.active : p.category === cat && p.active) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.sku?.toLowerCase().includes(needle) || p.barcode?.includes(needle) || p.supplier?.toLowerCase().includes(needle)),
    );
  }, [data, cat, q]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={8} />;
  const active = data.filter((p) => p.active);
  const low = active.filter((p) => p.stock <= p.reorder_level);
  const out = active.filter((p) => p.stock === 0);
  const value = active.reduce((a, p) => a + p.stock * (p.avg_cost ?? 0), 0);
  const retail = active.reduce((a, p) => a + p.stock * p.price, 0);

  return (
    <>
      {showCost && data.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatCard label="Items on sale" value={active.length} hint={`${active.reduce((a, p) => a + p.stock, 0).toLocaleString()} units on the shelf`} />
          <StatCard label="Stock at cost" value={nairaShort(value)} hint="What you paid for what's on the shelf" />
          <StatCard label="Stock at selling price" value={nairaShort(retail)} hint={`${nairaShort(retail - value)} margin waiting to be made`} />
          <StatCard label="Running low" value={<span className={low.length ? 'text-warning' : ''}>{low.length}</span>} hint={out.length ? `${out.length} completely out` : 'At or below reorder level'} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={cat} onValueChange={setCat}>
          <TabsList className="h-9 max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="drinks">Drinks</TabsTrigger>
            <TabsTrigger value="confectionery">Confectionery</TabsTrigger>
            <TabsTrigger value="low">Low ({low.length})</TabsTrigger>
            {showCost && data.some((p) => !p.active) && <TabsTrigger value="off">Not on sale</TabsTrigger>}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Name, SKU, barcode or supplier" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        {data.length === 0 ? (
          <EmptyState icon={Package} title="No items yet" action={manager && <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add the first item</Button>}>
            {manager ? 'Add items one by one, or upload a spreadsheet of everything you sell with its opening stock.' : 'Ask the manager to add the items you sell.'}
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon={PackageSearch} title="Nothing matches" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Item</TableHead>
                <TableHead className="hidden lg:table-cell">Supplier</TableHead>
                <TableHead className="text-right">Price</TableHead>
                {showCost && <TableHead className="hidden text-right sm:table-cell">Avg. cost</TableHead>}
                {showCost && <TableHead className="hidden text-right md:table-cell">Margin</TableHead>}
                <TableHead className="text-right">In stock</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                {manager && <TableHead className="pr-5" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className={cn('cursor-pointer', !p.active && 'opacity-50')} onClick={() => setOpen(p.id)}>
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <Thumb p={p} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          <span className="capitalize">{p.category}</span> · per {p.unit}
                          {p.sku && <span className="font-mono"> · {p.sku}</span>}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{p.supplier ?? '—'}</TableCell>
                  <TableCell className="text-right"><Money value={p.price} /></TableCell>
                  {showCost && <TableCell className="hidden text-right text-muted-foreground sm:table-cell"><Money value={p.avg_cost ?? 0} /></TableCell>}
                  {showCost && <TableCell className="hidden text-right tabular-nums md:table-cell">{p.price ? pct((p.price - (p.avg_cost ?? 0)) / p.price) : '—'}</TableCell>}
                  <TableCell className="text-right font-semibold tabular-nums">{p.stock}</TableCell>
                  <TableCell className="hidden sm:table-cell"><StockPill p={p} /></TableCell>
                  {manager && (
                    <TableCell className="pr-5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => setCounting(p)}>Count</Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>Edit</Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <ProductSheet id={open} products={data} version={v + tick} onClose={() => setOpen(null)} onEdit={setEditing} onCount={setCounting} onChange={reload} />
      <ProductDialog product={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
      <CountDialog product={counting} onClose={() => setCounting(null)} onSaved={() => (setCounting(null), reload())} />
    </>
  );
}

function StockPill({ p }: { p: Product }) {
  return !p.active ? <StatusPill>Not on sale</StatusPill> : p.stock === 0 ? <StatusPill tone="danger">Out</StatusPill> : p.stock <= p.reorder_level ? <StatusPill tone="warning">Reorder</StatusPill> : <StatusPill tone="success">OK</StatusPill>;
}

// ---------- one item: photo, details and its stock card ----------

interface Move { kind: 'received' | 'sold' | 'room_charge' | 'counted'; date: string; at: string; ref: string | null; change: number; unit_cost?: number | null; unit_price: number | null; party: string | null; by: string | null; balance: number }
const MOVE_LABEL: Record<Move['kind'], string> = { received: 'Delivery', sold: 'Sold', room_charge: 'Charged to room', counted: 'Stock count' };

function ProductSheet({ id, products, version, onClose, onEdit, onCount, onChange }: { id: number | null; products: Product[]; version: number; onClose: () => void; onEdit: (p: Product) => void; onCount: (p: Product) => void; onChange: () => void }) {
  const { user } = useAuth();
  const manager = can(user, 'manager');
  const p = products.find((x) => x.id === id);
  const { data } = useApi<{ opening_before_records: number; from: string; moves: Move[] }>(id ? `/products/${id}/card?v=${version}` : null);
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const data = await shrinkPhoto(f);
      await api(`/products/${id}/image`, { method: 'PUT', body: data });
      toast.success('Photo saved');
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the photo');
    } finally {
      setUploading(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Remove this photo?', confirmLabel: 'Remove', destructive: true }))) return;
    await api(`/products/${id}/image`, { method: 'DELETE' }).then(() => (toast.success('Photo removed'), onChange()), (e) => toast.error(e.message));
  };

  const sold30 = data?.moves.filter((m) => (m.kind === 'sold' || m.kind === 'room_charge') && m.date >= new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)).reduce((a, m) => a - m.change, 0) ?? 0;
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {!p ? (
          <LoadingRows rows={8} />
        ) : (
          <>
            <SheetHeader className="gap-4 border-b p-5">
              <div className="flex gap-4">
                <div className="relative">
                  {productImage(p) ? (
                    <img src={productImage(p)!} alt={p.name} className="size-28 rounded-lg border bg-muted object-cover" />
                  ) : (
                    <div className="flex size-28 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground"><Package className="size-8" /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-lg">{p.name}</SheetTitle>
                  <SheetDescription className="capitalize">{p.category} · per {p.unit}{p.supplier ? ` · from ${p.supplier}` : ''}</SheetDescription>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StockPill p={p} />
                    {p.sku && <StatusPill dot={false} className="font-mono">{p.sku}</StatusPill>}
                    {p.barcode && <StatusPill dot={false} className="font-mono">{p.barcode}</StatusPill>}
                  </div>
                  {p.description && <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-sm">
                <div><div className="text-xs text-muted-foreground">In stock</div><div className="text-lg font-semibold tabular-nums">{p.stock}</div></div>
                <div><div className="text-xs text-muted-foreground">Sold, last 30 days</div><div className="text-lg font-semibold tabular-nums">{sold30}</div></div>
                <div><div className="text-xs text-muted-foreground">Days of stock left</div><div className="text-lg font-semibold tabular-nums">{sold30 ? Math.floor(p.stock / (sold30 / 30)) : '—'}</div></div>
              </div>
              {manager && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(p)}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => onCount(p)}>Count</Button>
                  <Button size="sm" variant="outline" disabled={uploading} onClick={() => file.current?.click()}><Camera /> {uploading ? 'Saving…' : productImage(p) ? 'Change photo' : 'Add photo'}</Button>
                  {productImage(p) && <Button size="sm" variant="ghost" onClick={remove}><ImageOff /> Remove photo</Button>}
                  <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ''))} />
                </div>
              )}
            </SheetHeader>
            <div className="p-5">
              <h3 className="mb-1 text-sm font-semibold">Stock card</h3>
              <p className="mb-3 text-xs text-muted-foreground">Every unit in and out since {data ? fmtDate(data.from) : '…'}, newest first, with what was on the shelf after it.</p>
              {!data ? (
                <LoadingRows rows={6} />
              ) : data.moves.length === 0 ? (
                <p className="text-sm text-muted-foreground">No movement yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-0">When</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="pr-0 text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.moves.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell className="pl-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">{fmtDate(m.date)} {fmtTime(m.at)}</TableCell>
                        <TableCell>
                          <div className="text-sm">{MOVE_LABEL[m.kind]}{m.kind === 'room_charge' && m.party ? ` ${m.party}` : ''}</div>
                          <div className="max-w-[14rem] truncate text-xs text-muted-foreground">
                            {[m.kind === 'received' ? m.party : null, m.ref, m.by, m.unit_cost !== undefined && m.unit_cost !== null && m.kind === 'received' ? `@ ${naira(m.unit_cost)}` : null].filter(Boolean).join(' · ')}
                          </div>
                        </TableCell>
                        <TableCell className={cn('text-right font-medium tabular-nums', m.change > 0 ? 'text-success' : m.kind === 'counted' ? 'text-destructive' : '')}>{m.change > 0 ? '+' : ''}{m.change}</TableCell>
                        <TableCell className="pr-0 text-right tabular-nums">{m.balance}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProductDialog({ product, onClose, onSaved }: { product: Product | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const p = product && product !== 'new' ? product : null;
  const suppliers = useApi<Supplier[]>(product ? '/suppliers' : null);
  const init = () => ({
    name: p?.name ?? '', category: p?.category ?? 'drinks', unit: p?.unit ?? 'bottle', price: String(p?.price ?? ''), reorder_level: String(p?.reorder_level ?? 12), active: p ? !!p.active : true,
    sku: p?.sku ?? '', barcode: p?.barcode ?? '', description: p?.description ?? '', supplier_id: p?.supplier_id ? String(p.supplier_id) : '',
  });
  const [f, setF] = useState(init);
  const [key, setKey] = useState<typeof product>(null);
  if (key !== product) (setKey(product), setF(init()));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PATCH' : 'POST', body: { ...f, price: Number(f.price), reorder_level: Number(f.reorder_level), supplier_id: f.supplier_id ? Number(f.supplier_id) : null } });
      toast.success(p ? 'Item updated' : 'Item added', { description: p ? undefined : 'Record a purchase to put it in stock.' });
      onSaved();
    });
  };
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{p ? `Edit ${p.name}` : 'Add an item'}</DialogTitle>
        </DialogHeader>
        <form id="product" className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} /></Field>
          <Field label="Category">
            <SelectField value={f.category} onChange={(x) => setF({ ...f, category: x as Product['category'] })} options={[{ value: 'drinks', label: 'Drinks' }, { value: 'confectionery', label: 'Confectionery' }]} />
          </Field>
          <Field label="Sold per"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} required maxLength={20} placeholder="bottle, can, pack" /></Field>
          <Field label="Selling price"><MoneyInput value={f.price} onChange={(x) => setF({ ...f, price: x })} required /></Field>
          <Field label="Reorder at"><Input inputMode="numeric" className="tabular-nums" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value.replace(/\D/g, '') })} required /></Field>
          <Field label="SKU" hint="Your own code, e.g. DRK-014"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} maxLength={32} className="font-mono" /></Field>
          <Field label="Barcode" hint="Scan it into this box"><Input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} maxLength={32} inputMode="numeric" className="font-mono" /></Field>
          <Field label="Usual supplier" className="sm:col-span-2">
            <SelectField value={f.supplier_id || 'none'} onChange={(x) => setF({ ...f, supplier_id: x === 'none' ? '' : x })} options={[{ value: 'none', label: 'Not set' }, ...(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))]} />
          </Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} rows={2} placeholder="Optional — size, flavour, serving notes" /></Field>
          {p && (
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Switch checked={f.active} onCheckedChange={(x) => setF({ ...f, active: x })} /> On sale at the till
            </label>
          )}
          <div className="sm:col-span-2"><ErrorNote error={error} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="product" disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CountDialog({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState<Product | null>(null);
  if (key !== product) (setKey(product), setCounted(product ? String(product.stock) : ''), setReason(''));
  const { busy, error, submit } = useSubmit();
  const change = product ? Number(counted || 0) - product.stock : 0;
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Count {product?.name}</DialogTitle>
          <DialogDescription>For breakages, spoilage or a count that doesn't match. Logged with your name, and the auditor sees every write-off.</DialogDescription>
        </DialogHeader>
        <form
          id="count"
          className="grid gap-4"
          onSubmit={(e) => (
            e.preventDefault(),
            submit(async () => {
              await api(`/products/${product!.id}/adjust`, { body: { change, reason } });
              toast.success('Stock corrected');
              onSaved();
            })
          )}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="System says"><Input value={product?.stock ?? ''} disabled className="font-mono" /></Field>
            <Field label="Actually counted"><Input inputMode="numeric" className="tabular-nums" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} required autoFocus /></Field>
          </div>
          {change !== 0 && (
            <StatusPill tone={change < 0 ? 'danger' : 'success'}>
              {change > 0 ? '+' : ''}
              {change} · {naira(Math.abs(change) * (product?.avg_cost ?? 0))} at cost
            </StatusPill>
          )}
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={200} placeholder="2 bottles broken during delivery" /></Field>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="count" disabled={busy || change === 0}>Save count</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- bulk upload ----------

const COLUMNS = ['sku', 'name', 'category', 'unit', 'price', 'reorder_level', 'barcode', 'description', 'supplier', 'receive_qty', 'unit_cost'] as const;
/** Headings people actually type, mapped to the columns the server reads. */
const ALIASES: Record<string, (typeof COLUMNS)[number]> = {
  item: 'name', product: 'name', 'item name': 'name', 'product name': 'name', type: 'category', 'selling price': 'price', 'sale price': 'price', 'price (ngn)': 'price',
  reorder: 'reorder_level', 'reorder level': 'reorder_level', 'reorder at': 'reorder_level', ean: 'barcode', upc: 'barcode', code: 'sku', 'item code': 'sku',
  qty: 'receive_qty', quantity: 'receive_qty', 'opening stock': 'receive_qty', 'qty received': 'receive_qty', cost: 'unit_cost', 'cost price': 'unit_cost', 'unit cost': 'unit_cost',
};
const TEMPLATE = [
  COLUMNS.join(','),
  'DRK-101,Star Lager 60cl,drinks,bottle,1500,24,6151234500017,,Bodija Drinks Depot,48,1000',
  ',Plantain Chips,confectionery,pack,700,12,,Lightly salted,Mama Titi Snacks,30,400',
].join('\r\n');

interface Preview { summary: { create: number; update: number; receive_units: number; receive_value: number; errors: number }; errors: { row: number; message: string }[]; rows: { row: number; action: 'create' | 'update'; name: string; sku: string | null; changes: string[]; receive: { qty: number; unit_cost: number } | null }[] }

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [unknown, setUnknown] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [from, setFrom] = useState('Opening stock');
  const [terms, setTerms] = useState('');
  const { busy, error, setError, submit } = useSubmit();
  const reset = () => (setRows(null), setPreview(null), setFileName(''), setUnknown([]), setError(null));

  const body = (dry: boolean) => ({ rows, dry_run: dry, received_from: from, terms: terms || undefined });
  const read = async (f: File) => {
    reset();
    if (/\.xlsx?$/i.test(f.name)) return setError('That is an Excel workbook. In Excel choose File → Save As → CSV, then upload the .csv file.');
    const table = parseCsv(await f.text());
    if (table.length < 2) return setError('The file has no item rows under the heading row.');
    const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
    const keys = head.map((h) => ((COLUMNS as readonly string[]).includes(h.replace(/ /g, '_')) ? h.replace(/ /g, '_') : ALIASES[h] ?? null));
    if (!keys.includes('name') && !keys.includes('sku')) return setError('The first row must be headings, including "name" (or "sku" to update items you already have).');
    setUnknown(head.filter((_, i) => !keys[i] && head[i] && !['in_stock', 'on_sale', 'avg_cost', 'stock_value'].includes(head[i])));
    const parsed = table.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? '']).filter(([k]) => k)) as Record<string, string>);
    setFileName(f.name);
    setRows(parsed);
    submit(async () => setPreview(await api<Preview>('/products/import', { body: { rows: parsed, dry_run: true, received_from: from } })));
  };
  const commit = () =>
    submit(async () => {
      const r = await api<{ create: number; update: number; receive_units: number; purchase: { ref: string } | null }>('/products/import', { body: body(false) });
      toast.success(`${r.create} added, ${r.update} updated`, { description: r.purchase ? `${r.receive_units} units received on ${r.purchase.ref}` : undefined });
      reset();
      onClose();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && (reset(), onClose())}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload items from a spreadsheet</DialogTitle>
          <DialogDescription>
            Add new items, update prices and codes, and receive stock in one go. Items are matched by SKU, then by name; empty cells keep what's already there. Nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => download('danest-stock-template.csv', TEMPLATE)}><FileSpreadsheet /> Download the template</Button>
            <Button variant="outline" size="sm" asChild><a href="/api/products.csv"><ArrowDownToLine /> Current stock list</a></Button>
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm transition-colors hover:bg-muted/40">
            <Upload className="size-5 text-muted-foreground" />
            <span className="font-medium">{fileName || 'Choose a CSV file'}</span>
            <span className="text-xs text-muted-foreground">Columns: {COLUMNS.join(', ')}. receive_qty adds that many to the shelf at unit_cost.</span>
            <input type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only" onChange={(e) => (e.target.files?.[0] && read(e.target.files[0]), (e.target.value = ''))} />
          </label>
          {unknown.length > 0 && <p className="text-xs text-muted-foreground">Ignored columns: {unknown.join(', ')}</p>}
          {preview && preview.summary.receive_units > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Stock received from"><Input value={from} onChange={(e) => setFrom(e.target.value)} maxLength={120} /></Field>
              <Field label="Paid">
                <SelectField value={terms || 'none'} onChange={(x) => setTerms(x === 'none' ? '' : x)} options={[{ value: 'none', label: 'Opening stock (already paid)' }, ...PURCHASE_TERMS.map((t) => ({ value: t, label: PURCHASE_TERMS_LABELS[t] }))]} />
              </Field>
            </div>
          )}
          {preview && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="New items" value={preview.summary.create} />
                <Tile label="Updated" value={preview.summary.update} />
                <Tile label="Units received" value={preview.summary.receive_units} hint={preview.summary.receive_value ? naira(preview.summary.receive_value) : undefined} />
                <Tile label="Rows to fix" value={preview.summary.errors} danger={preview.summary.errors > 0} />
              </div>
              {preview.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border border-destructive/30 bg-danger-soft p-3 text-sm text-destructive">
                  {preview.errors.map((e) => <div key={e.row}>Row {e.row}: {e.message}</div>)}
                </div>
              )}
              {preview.rows.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  <Table>
                    <TableBody>
                      {preview.rows.map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="w-12 text-xs text-muted-foreground tabular-nums">{r.row}</TableCell>
                          <TableCell>
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{r.action === 'create' ? 'New item' : r.changes.length ? `Changes: ${r.changes.join(', ').replace(/_/g, ' ')}` : 'No detail changes'}</div>
                          </TableCell>
                          <TableCell className="text-right text-xs">{r.receive ? `+${r.receive.qty} @ ${naira(r.receive.unit_cost)}` : ''}</TableCell>
                          <TableCell className="text-right"><StatusPill tone={r.action === 'create' ? 'success' : 'info'}>{r.action === 'create' ? 'Add' : 'Update'}</StatusPill></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
          <ErrorNote error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => (reset(), onClose())}>Cancel</Button>
          <Button disabled={busy || !preview || preview.summary.errors > 0 || preview.rows.length === 0} onClick={commit}>
            {busy ? 'Working…' : preview ? `Save ${preview.rows.length} item${preview.rows.length === 1 ? '' : 's'}` : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ label, value, hint, danger }: { label: string; value: number; hint?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums', danger && 'text-destructive')}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ---------- insights ----------

interface InsightItem { id: number; name: string; category: string; unit: string; stock: number; reorder_level: number; price: number; avg_cost: number; sold: number; revenue: number; profit: number; per_day: number; cover_days: number | null; suggest: number; last_sold: string | null; image_v: number; supplier: string | null }
interface InsightData {
  days: number;
  totals: { items: number; value_at_cost: number; value_at_price: number; revenue: number; profit: number; units_sold: number; out_of_stock: number; to_reorder: number; turns: number | null; shrinkage_value: number };
  best: InsightItem[];
  slow: InsightItem[];
  reorder: InsightItem[];
  shrink: { id: number; name: string; units: number; value: number }[];
  daily: { date: string; units: number; revenue: number; profit: number }[];
  categories: { category: string; revenue: number; profit: number; value: number }[];
}
const salesChart = { revenue: { label: 'Bar & shop sales', color: 'var(--chart-2)' } } satisfies ChartConfig;

function Insights() {
  const { user } = useAuth();
  const manager = can(user, 'manager');
  const [days, setDays] = useState('30');
  const v = useLive('stock', 'sales');
  const { data: d, error } = useApi<InsightData>(`/stock/insights?days=${days}&v=${v}`);
  const [ordering, setOrdering] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!d) return <LoadingRows rows={10} />;
  const t = d.totals;
  const rows = d.daily.map((x) => ({ ...x, label: fmtDate(x.date) }));
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Looking at the last</span>
        <SelectField className="w-32" value={days} onChange={setDays} options={['7', '30', '90', '180'].map((x) => ({ value: x, label: `${x} days` }))} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatCard label="Sales" value={nairaShort(t.revenue)} hint={`${t.units_sold.toLocaleString()} units`} />
        <StatCard label="Profit on sales" value={nairaShort(t.profit)} hint={t.revenue ? `${pct(t.profit / t.revenue)} margin` : undefined} />
        <StatCard label="Stock turns" value={t.turns ?? '—'} hint="Times the shelf sold through, at cost" />
        <StatCard label="To reorder" value={<span className={t.to_reorder ? 'text-warning' : ''}>{t.to_reorder}</span>} hint={`${t.out_of_stock} out of stock`} />
        <StatCard label="Written off" value={<span className={t.shrinkage_value ? 'text-destructive' : ''}>{nairaShort(t.shrinkage_value)}</span>} hint="Breakages and shortfalls, at cost" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Sales each day" description={`Bar and shop, last ${d.days} days`} flush>
          <ChartContainer config={salesChart} className="aspect-auto h-64 w-full px-2 pt-4 pb-2">
            <BarChart data={rows} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} fontSize={11} />
              <YAxis tickFormatter={(x) => nairaShort(x)} tickLine={false} axisLine={false} width={56} fontSize={11} />
              <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent indicator="dot" formatter={(val, _n, item) => <span className="tabular-nums">{naira(Number(val))} · {(item.payload as { units: number }).units} units</span>} />} />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </Section>
        <Section title="Best sellers" description="By money taken" flush>
          <RankList items={d.best} value={(p) => p.revenue} sub={(p) => `${p.sold} sold · ${naira(p.profit)} profit`} empty="No sales in this period" />
        </Section>
      </div>

      <Section
        title="Reorder now"
        description="Enough for about three weeks at the recent pace, or back above the reorder level"
        className="mb-6"
        action={manager && d.reorder.length > 0 && <Button size="sm" onClick={() => setOrdering(true)}><ShoppingCart /> Place orders</Button>}
        flush
      >
        {d.reorder.length === 0 ? (
          <EmptyState icon={Package} title="Nothing needs ordering" className="py-8" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-5">Item</TableHead>
                  <TableHead className="hidden md:table-cell">Supplier</TableHead>
                  <TableHead className="text-right">On shelf</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Sells / day</TableHead>
                  <TableHead className="text-right">Lasts</TableHead>
                  <TableHead className="pr-5 text-right">Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.reorder.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-5 font-medium">{p.name}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{p.supplier ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.stock}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{p.per_day}</TableCell>
                    <TableCell className="text-right">{p.stock === 0 ? <StatusPill tone="danger">Out</StatusPill> : p.cover_days === null ? '—' : <StatusPill tone={p.cover_days < 4 ? 'danger' : p.cover_days < 8 ? 'warning' : 'neutral'}>{p.cover_days} days</StatusPill>}</TableCell>
                    <TableCell className="pr-5 text-right font-semibold tabular-nums">{p.suggest} {p.unit}{p.suggest > 1 ? 's' : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Not selling" description={`In stock, no sale in ${d.days} days`} flush>
          <RankList items={d.slow} value={(p) => p.stock * p.avg_cost} sub={(p) => `${p.stock} on the shelf${p.last_sold ? ` · last sold ${fmtDate(p.last_sold)}` : ' · never sold'}`} empty="Everything is moving" />
        </Section>
        <Section title="Written off" description="Breakages, expiries and shortfalls at stock counts" flush>
          {d.shrink.length === 0 ? (
            <EmptyState title="Nothing written off" className="py-8" />
          ) : (
            <ul className="divide-y text-sm">
              {d.shrink.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 px-5 py-2.5">
                  <span>{s.name} <span className="text-muted-foreground">× {s.units}</span></span>
                  <Money value={s.value} className="text-destructive" />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="By category">
          <div className="space-y-4">
            {d.categories.map((c) => (
              <div key={c.category} className="text-sm">
                <div className="mb-1 flex justify-between"><span className="font-medium capitalize">{c.category}</span><Money value={c.revenue} /></div>
                <div className="text-xs text-muted-foreground">{naira(c.profit)} profit · {naira(c.value)} on the shelf at cost</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
      <OrderDialog open={ordering} items={d.reorder} onClose={() => setOrdering(false)} />
    </>
  );
}

function RankList({ items, value, sub, empty }: { items: InsightItem[]; value: (p: InsightItem) => number; sub: (p: InsightItem) => string; empty: string }) {
  if (!items.length) return <EmptyState title={empty} className="py-8" />;
  const max = Math.max(1, ...items.map(value));
  return (
    <ul className="divide-y">
      {items.map((p) => (
        <li key={p.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
          <Thumb p={{ ...p, active: 1, category: p.category as Product['category'] }} className="row-span-2 size-9" />
          <span className="truncate font-medium">{p.name}</span>
          <Money value={value(p)} />
          <div className="col-span-2">
            <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-chart-2" style={{ width: `${(value(p) / max) * 100}%` }} /></div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{sub(p)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One purchase order per supplier for everything that needs reordering. Stock only rises when each delivery is received. */
function OrderDialog({ open, items, onClose }: { open: boolean; items: InsightItem[]; onClose: () => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, InsightItem[]>();
    for (const p of items) m.set(p.supplier ?? '', [...(m.get(p.supplier ?? '') ?? []), p]);
    return [...m.entries()];
  }, [items]);
  const [fallback, setFallback] = useState('');
  const { busy, error, submit } = useSubmit();
  const place = () =>
    submit(async () => {
      const refs: string[] = [];
      for (const [supplier, list] of groups) {
        const r = await api<{ ref: string }>('/purchases', {
          body: { status: 'ordered', supplier: supplier || fallback, notes: 'Reorder suggested from stock insights', items: list.map((p) => ({ product_id: p.id, qty: p.suggest, unit_cost: p.avg_cost })) },
        });
        refs.push(r.ref);
      }
      toast.success(`${refs.length} order${refs.length > 1 ? 's' : ''} placed`, { description: 'Receive each one under Purchases when it arrives.' });
      onClose();
    });
  const needsFallback = groups.some(([s]) => !s);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Place {groups.length} purchase order{groups.length > 1 ? 's' : ''}</DialogTitle>
          <DialogDescription>Grouped by each item's usual supplier, at the current average cost. You can change quantities and prices when the delivery is received.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {groups.map(([s, list]) => (
            <div key={s || 'none'} className="rounded-lg border p-3">
              <div className="mb-1 font-medium">{s || 'No usual supplier'}</div>
              <div className="text-xs text-muted-foreground">{list.map((p) => `${p.suggest} × ${p.name}`).join(', ')}</div>
              <div className="mt-1 text-xs">≈ {naira(list.reduce((a, p) => a + p.suggest * p.avg_cost, 0))}</div>
            </div>
          ))}
          {needsFallback && <Field label="Order the items with no usual supplier from"><Input value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="Supplier name" /></Field>}
          <ErrorNote error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || (needsFallback && !fallback.trim())} onClick={place}><ShoppingCart /> Place orders</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
