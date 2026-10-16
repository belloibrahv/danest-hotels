import { Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CHARGE_LABELS, CHARGE_METHODS, type ChargeMethod } from '../../../../shared/constants';
import { Field, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, fmtTime, naira } from '@/lib/api';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export interface Product {
  id: number;
  name: string;
  category: 'drinks' | 'confectionery';
  unit: string;
  price: number;
  avg_cost?: number;
  stock: number;
  reorder_level: number;
  active: number;
}

interface TillDay {
  summary: { count: number; total: number; cash: number; transfer: number; pos: number; room: number };
  sales: { id: number; receipt_no: string; created_at: string; method: ChargeMethod; total: number; staff: string; room_number: string | null; items: { name: string; qty: number }[] }[];
}

/** A tap-first till: big targets, live stock, room charges for in-house guests. */
export default function Pos() {
  const products = useApi<Product[]>('/products');
  const till = useApi<TillDay>('/sales');
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Map<number, number>>(new Map());
  const [method, setMethod] = useState<ChargeMethod>('cash');
  const [guest, setGuest] = useState('');
  const inhouse = useApi<{ reservation_id: number; room_number: string; guest_name: string }[]>(method === 'room' ? '/inhouse' : null);
  const { busy, error, setError, submit } = useSubmit();

  const list = useMemo(() => (products.data ?? []).filter((p) => (cat === 'all' || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase())), [products.data, cat, q]);
  const byId = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  const lines = [...cart.entries()].map(([id, qty]) => ({ p: byId.get(id)!, qty })).filter((l) => l.p);
  const total = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  const count = lines.reduce((a, l) => a + l.qty, 0);

  const add = (p: Product, d = 1) => {
    setError(null);
    setCart((c) => {
      const n = new Map(c);
      const next = Math.min(p.stock, (n.get(p.id) ?? 0) + d);
      if (next <= 0) n.delete(p.id);
      else n.set(p.id, next);
      return n;
    });
  };

  const charge = () =>
    submit(async () => {
      const r = await api<{ receipt_no: string; total: number }>('/sales', {
        body: { method, reservation_id: method === 'room' ? Number(guest) : undefined, items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })) },
      });
      const room = inhouse.data?.find((g) => String(g.reservation_id) === guest)?.room_number;
      toast.success(method === 'room' ? `${naira(r.total)} added to room ${room}` : `${naira(r.total)} received`, { description: r.receipt_no });
      setCart(new Map());
      setGuest('');
      products.reload();
      till.reload();
    });

  return (
    <>
      <PageHeader title="Bar & shop till" description="Tap items to add them. Prices and stock come from the stock list." />
      <div className="mb-8 grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={cat} onValueChange={setCat}>
              <TabsList className="h-9">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="drinks">Drinks</TabsTrigger>
                <TabsTrigger value="confectionery">Confectionery</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {!products.data ? (
            <LoadingRows rows={6} />
          ) : products.data.length === 0 ? (
            <Section>
              <EmptyState icon={ShoppingBag} title="No items on sale">The manager adds drinks and snacks under Stock.</EmptyState>
            </Section>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
              {list.map((p) => {
                const inCart = cart.get(p.id) ?? 0;
                const left = p.stock - inCart;
                const low = p.stock <= p.reorder_level;
                return (
                  <button
                    key={p.id}
                    disabled={left <= 0}
                    onClick={() => add(p)}
                    className={cn(
                      'relative flex min-h-24 flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left shadow-xs transition-all hover:border-foreground/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45',
                      inCart > 0 && 'border-brand ring-1 ring-brand',
                    )}
                  >
                    {inCart > 0 && <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground">{inCart}</span>}
                    <span className="pr-6 text-sm leading-tight font-medium">{p.name}</span>
                    <span className={cn('text-xs', low ? 'font-medium text-destructive' : 'text-muted-foreground')}>{p.stock === 0 ? 'Out of stock' : `${left} left`}</span>
                    <span className="mt-auto text-sm font-semibold tabular-nums">{naira(p.price)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Card className="gap-0 py-0 shadow-xs lg:sticky lg:top-20">
          <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-4 [.border-b]:pb-4">
            <CardTitle className="text-sm">Current order {count > 0 && <span className="text-muted-foreground">· {count} item{count > 1 ? 's' : ''}</span>}</CardTitle>
            {lines.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setCart(new Map())}>
                <Trash2 /> Clear
              </Button>
            )}
          </CardHeader>
          <CardContent className="max-h-[38vh] overflow-y-auto px-5 py-2">
            {lines.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Tap an item to start.</p>
            ) : (
              <ul className="divide-y">
                {lines.map(({ p, qty }) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                    <div className="flex items-center rounded-md border">
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => add(p, -1)} aria-label={`One less ${p.name}`}>
                        <Minus />
                      </Button>
                      <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => add(p, 1)} disabled={qty >= p.stock} aria-label={`One more ${p.name}`}>
                        <Plus />
                      </Button>
                    </div>
                    <Money value={p.price * qty} className="w-20 text-right text-sm" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3 border-t px-5 py-4 [.border-t]:pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <Money value={total} className="text-2xl font-semibold" />
            </div>
            <ToggleGroup type="single" variant="outline" value={method} onValueChange={(v) => v && setMethod(v as ChargeMethod)} className="grid w-full grid-cols-4">
              {CHARGE_METHODS.map((m) => (
                <ToggleGroupItem key={m} value={m} className="text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  {m === 'room' ? 'Room' : m === 'pos' ? 'POS' : CHARGE_LABELS[m].split(' ')[0]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {method === 'room' && (
              <Field label="In-house guest">
                <SelectField value={guest} onChange={setGuest} placeholder={inhouse.data?.length === 0 ? 'Nobody is checked in' : 'Choose a room'} options={(inhouse.data ?? []).map((g) => ({ value: String(g.reservation_id), label: `Room ${g.room_number} — ${g.guest_name}` }))} />
              </Field>
            )}
            <ErrorNote error={error} />
            <Button size="lg" className="h-12 text-base" disabled={busy || lines.length === 0 || (method === 'room' && !guest)} onClick={charge}>
              {busy ? 'Saving…' : method === 'room' ? `Add ${naira(total)} to room bill` : `Charge ${naira(total)}`}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold">Today's till</h2>
      {till.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatCard label="Sold" value={<Money value={till.data.summary.total} />} hint={`${till.data.summary.count} sales`} />
          <StatCard label="Cash in drawer" value={<Money value={till.data.summary.cash} />} />
          <StatCard label="Transfers" value={<Money value={till.data.summary.transfer} />} />
          <StatCard label="POS / card" value={<Money value={till.data.summary.pos} />} hint={till.data.summary.room ? `+ ${naira(till.data.summary.room)} on room bills` : undefined} />
        </div>
      )}
      <Section title="Recent sales" flush>
        {!till.data ? (
          <LoadingRows rows={4} />
        ) : till.data.sales.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No sales yet today" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Time</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Paid by</TableHead>
                <TableHead className="pr-5 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {till.data.sales.slice(0, 25).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-5 tabular-nums">
                    {fmtTime(s.created_at)}
                    <div className="font-mono text-[11px] text-muted-foreground">{s.receipt_no}</div>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-sm">{s.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</TableCell>
                  <TableCell>{s.method === 'room' ? <StatusPill tone="brand">Room {s.room_number}</StatusPill> : CHARGE_LABELS[s.method]}</TableCell>
                  <TableCell className="pr-5 text-right font-medium">
                    <Money value={s.total} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  );
}
