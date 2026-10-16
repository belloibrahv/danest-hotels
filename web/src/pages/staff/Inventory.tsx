import { Package, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Field, MoneyInput, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, StatCard } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, naira, pct } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import type { Product } from './Pos';

export default function Inventory() {
  const { user } = useAuth();
  const manager = can(user, 'manager');
  const { data, error, reload } = useApi<Product[]>(manager ? '/products?all=1' : '/products');
  const [cat, setCat] = useState('all');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [counting, setCounting] = useState<Product | null>(null);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={8} />;
  const active = data.filter((p) => p.active);
  const low = active.filter((p) => p.stock <= p.reorder_level);
  const value = active.reduce((a, p) => a + p.stock * (p.avg_cost ?? 0), 0);
  const retail = active.reduce((a, p) => a + p.stock * p.price, 0);
  const rows = data.filter((p) => (cat === 'all' ? true : cat === 'low' ? p.active && p.stock <= p.reorder_level : p.category === cat));

  return (
    <>
      <PageHeader
        title="Stock"
        description="Drinks and confectionery on hand. Purchases add stock; every sale takes it away."
        actions={
          manager && (
            <>
              <Button variant="outline" asChild>
                <Link to="/staff/purchases">Record a purchase</Link>
              </Button>
              <Button onClick={() => setEditing('new')}>
                <Plus /> Add item
              </Button>
            </>
          )
        }
      />
      {manager && data.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatCard label="Items on sale" value={active.length} />
          <StatCard label="Stock at cost" value={<Money value={value} />} hint="What you paid for what's on the shelf" />
          <StatCard label="Stock at selling price" value={<Money value={retail} />} hint={`${naira(retail - value)} potential margin`} />
          <StatCard label="Running low" value={low.length} hint="At or below reorder level" />
        </div>
      )}
      <Tabs value={cat} onValueChange={setCat} className="mb-4">
        <TabsList className="h-9">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="drinks">Drinks</TabsTrigger>
          <TabsTrigger value="confectionery">Confectionery</TabsTrigger>
          <TabsTrigger value="low">Running low ({low.length})</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        {data.length === 0 ? (
          <EmptyState icon={Package} title="No items yet" action={manager && <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add the first item</Button>}>
            {manager ? 'Add each drink and snack with its selling price, then record a purchase for your opening stock.' : 'Ask the manager to add the items you sell.'}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Item</TableHead>
                <TableHead className="text-right">Price</TableHead>
                {manager && <TableHead className="text-right">Avg. cost</TableHead>}
                {manager && <TableHead className="hidden text-right md:table-cell">Margin</TableHead>}
                <TableHead className="text-right">In stock</TableHead>
                <TableHead>Status</TableHead>
                {manager && <TableHead className="pr-5" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {p.category} · per {p.unit}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={p.price} />
                  </TableCell>
                  {manager && (
                    <TableCell className="text-right text-muted-foreground">
                      <Money value={p.avg_cost ?? 0} />
                    </TableCell>
                  )}
                  {manager && <TableCell className="hidden text-right tabular-nums md:table-cell">{p.price ? pct((p.price - (p.avg_cost ?? 0)) / p.price) : '—'}</TableCell>}
                  <TableCell className="text-right font-semibold tabular-nums">{p.stock}</TableCell>
                  <TableCell>
                    {!p.active ? <StatusPill>Not on sale</StatusPill> : p.stock === 0 ? <StatusPill tone="danger">Out</StatusPill> : p.stock <= p.reorder_level ? <StatusPill tone="warning">Reorder</StatusPill> : <StatusPill tone="success">OK</StatusPill>}
                  </TableCell>
                  {manager && (
                    <TableCell className="pr-5 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setCounting(p)}>
                        Count
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <ProductDialog product={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
      <CountDialog product={counting} onClose={() => setCounting(null)} onSaved={() => (setCounting(null), reload())} />
    </>
  );
}

function ProductDialog({ product, onClose, onSaved }: { product: Product | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const p = product && product !== 'new' ? product : null;
  const init = () => ({ name: p?.name ?? '', category: p?.category ?? 'drinks', unit: p?.unit ?? 'bottle', price: String(p?.price ?? ''), reorder_level: String(p?.reorder_level ?? 12), active: p ? !!p.active : true });
  const [f, setF] = useState(init);
  const [key, setKey] = useState<typeof product>(null);
  if (key !== product) (setKey(product), setF(init()));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PATCH' : 'POST', body: { ...f, price: Number(f.price), reorder_level: Number(f.reorder_level) } });
      toast.success(p ? 'Item updated' : 'Item added', { description: p ? undefined : 'Record a purchase to put it in stock.' });
      onSaved();
    });
  };
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{p ? `Edit ${p.name}` : 'Add an item'}</DialogTitle>
        </DialogHeader>
        <form id="product" className="grid gap-4" onSubmit={onSubmit}>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <SelectField value={f.category} onChange={(v) => setF({ ...f, category: v as Product['category'] })} options={[{ value: 'drinks', label: 'Drinks' }, { value: 'confectionery', label: 'Confectionery' }]} />
            </Field>
            <Field label="Sold per"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} required maxLength={20} placeholder="bottle, can, pack" /></Field>
            <Field label="Selling price"><MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} required /></Field>
            <Field label="Reorder at"><Input inputMode="numeric" className="tabular-nums" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value.replace(/\D/g, '') })} required /></Field>
          </div>
          {p && (
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} /> On sale at the till
            </label>
          )}
          <ErrorNote error={error} />
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
          <DialogDescription>For breakages, spoilage or a count that doesn't match. Logged with your name.</DialogDescription>
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
