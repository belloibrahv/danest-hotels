import { Plus, ShoppingCart, Sparkles, X } from 'lucide-react';
import { Fragment, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { DateRangePicker, useRange } from '@/components/app/date-range';
import { DateInput, Field, MoneyInput, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, StatCard } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDate, naira, todayISO } from '@/lib/api';
import { useApi, useSubmit } from '@/lib/hooks';
import type { Product } from './Pos';

interface Purchase {
  id: number;
  ref: string;
  supplier: string;
  date: string;
  total: number;
  notes: string | null;
  recorded_by: string;
  items: { name: string; qty: number; unit_cost: number }[];
}

export default function Purchases() {
  const range = useRange('month');
  const [v, setV] = useState(0);
  const { data, error } = useApi<{ purchases: Purchase[] }>(`/purchases?${range.qs}&v=${v}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const total = data?.purchases.reduce((a, p) => a + p.total, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Restocking drinks and confectionery. Each purchase adds stock and updates the cost of what's sold after it."
        actions={
          <>
            <DateRangePicker state={range} />
            <Button onClick={() => setCreating(true)}>
              <Plus /> Record purchase
            </Button>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Spent on stock" value={<Money value={total} />} hint={`${data?.purchases.length ?? 0} purchases`} />
      </div>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={5} />
        ) : data.purchases.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="No purchases in this period" action={<Button size="sm" onClick={() => setCreating(true)}><Plus /> Record one</Button>} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="hidden md:table-cell">By</TableHead>
                <TableHead className="pr-5 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.purchases.map((p) => (
                <Fragment key={p.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <TableCell className="pl-5 tabular-nums">{fmtDate(p.date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{p.supplier}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.ref}</div>
                    </TableCell>
                    <TableCell className="max-w-sm truncate text-muted-foreground">
                      {p.items.length} item{p.items.length > 1 ? 's' : ''} — {p.items.slice(0, 3).map((i) => i.name).join(', ')}
                      {p.items.length > 3 ? '…' : ''}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{p.recorded_by}</TableCell>
                    <TableCell className="pr-5 text-right font-medium">
                      <Money value={p.total} />
                    </TableCell>
                  </TableRow>
                  {open === p.id && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={5} className="px-5 py-3">
                        <div className="grid gap-1 text-sm sm:grid-cols-2">
                          {p.items.map((i) => (
                            <div key={i.name} className="flex justify-between gap-4">
                              <span>
                                {i.qty} × {i.name}
                              </span>
                              <span className="text-muted-foreground tabular-nums">@ {naira(i.unit_cost)}</span>
                            </div>
                          ))}
                        </div>
                        {p.notes && <p className="mt-2 text-xs text-muted-foreground">{p.notes}</p>}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <NewPurchase open={creating} onClose={() => setCreating(false)} onSaved={() => (setCreating(false), setV((x) => x + 1))} />
    </>
  );
}

function NewPurchase({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const products = useApi<Product[]>(open ? '/products' : null);
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ product_id: '', qty: '', unit_cost: '' }]);
  const { busy, error, submit } = useSubmit();
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.unit_cost || 0), 0);
  const low = (products.data ?? []).filter((p) => p.stock <= p.reorder_level);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const items = lines.filter((l) => l.product_id && l.qty).map((l) => ({ product_id: Number(l.product_id), qty: Number(l.qty), unit_cost: Number(l.unit_cost || 0) }));
      await api('/purchases', { body: { supplier, date, notes, items } });
      toast.success(`Purchase of ${naira(total)} saved`, { description: 'Stock updated.' });
      setSupplier('');
      setNotes('');
      setLines([{ product_id: '', qty: '', unit_cost: '' }]);
      onSaved();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record a purchase</DialogTitle>
          <DialogDescription>Enter what arrived and what each unit cost.</DialogDescription>
        </DialogHeader>
        <form id="purchase" className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} required maxLength={120} placeholder="Bodija Drinks Depot" /></Field>
            <Field label="Date"><DateInput value={date} max={todayISO()} onChange={setDate} /></Field>
          </div>
          {low.length > 0 && (
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setLines(low.map((p) => ({ product_id: String(p.id), qty: String(Math.max(1, p.reorder_level * 3 - p.stock)), unit_cost: String(p.avg_cost ?? '') })))}>
              <Sparkles /> Fill in the {low.length} items running low
            </Button>
          )}
          <div className="grid gap-2">
            <div className="grid grid-cols-[1fr_80px_130px_32px] gap-2 text-xs font-medium text-muted-foreground">
              <span>Item</span>
              <span>Qty</span>
              <span>Unit cost</span>
              <span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_130px_32px] items-center gap-2">
                <SelectField
                  value={l.product_id}
                  onChange={(v) => {
                    const p = products.data?.find((x) => String(x.id) === v);
                    setLine(i, { product_id: v, unit_cost: l.unit_cost || String(p?.avg_cost ?? '') });
                  }}
                  placeholder="Choose item"
                  options={(products.data ?? []).map((p) => ({ value: String(p.id), label: `${p.name} (${p.stock})` }))}
                />
                <Input inputMode="numeric" className="tabular-nums" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/\D/g, '') })} required />
                <MoneyInput value={l.unit_cost} onChange={(v) => setLine(i, { unit_cost: v })} required />
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}>
                  <X />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setLines([...lines, { product_id: '', qty: '', unit_cost: '' }])}>
              <Plus /> Add line
            </Button>
          </div>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Invoice number, delivery notes" /></Field>
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <Money value={total} className="text-xl font-semibold" />
          </div>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="purchase" disabled={busy || total === 0}>Save purchase</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
