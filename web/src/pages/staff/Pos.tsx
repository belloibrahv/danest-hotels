import { useMemo, useState } from 'react';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '../../../../shared/constants';
import { Card, Empty, ErrorBox, Loading, PageHead, Stat, Tabs, useSubmit, useToast } from '../../components/ui';
import { api, fmtTime, naira } from '../../lib/api';
import { useApi } from '../../lib/hooks';

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
  summary: { count: number; total: number; cash: number; transfer: number; pos: number };
  sales: { id: number; receipt_no: string; created_at: string; method: PaymentMethod; total: number; staff: string; items: { name: string; qty: number }[] }[];
}

export default function Pos() {
  const products = useApi<Product[]>('/products');
  const till = useApi<TillDay>('/sales');
  const [cat, setCat] = useState<'all' | 'drinks' | 'confectionery'>('all');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Map<number, number>>(new Map());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const { busy, error, setError, submit } = useSubmit();
  const toast = useToast();

  const list = useMemo(
    () => (products.data ?? []).filter((p) => (cat === 'all' || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase())),
    [products.data, cat, q],
  );
  const byId = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);
  const lines = [...cart.entries()].map(([id, qty]) => ({ p: byId.get(id)!, qty })).filter((l) => l.p);
  const total = lines.reduce((a, l) => a + l.p.price * l.qty, 0);

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
      const r = await api<{ receipt_no: string; total: number }>('/sales', { body: { method, items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })) } });
      toast(`${naira(r.total)} received · ${r.receipt_no}`);
      setCart(new Map());
      products.reload();
      till.reload();
    });

  return (
    <>
      <PageHead title="Bar & shop till" sub="Tap items to add them. Prices and stock come straight from the stock list." />

      <div className="pos" style={{ marginBottom: 24 }}>
        <div className="stack">
          <div className="row">
            <Tabs value={cat} onChange={setCat} options={[{ value: 'all', label: 'Everything' }, { value: 'drinks', label: 'Drinks' }, { value: 'confectionery', label: 'Confectionery' }]} />
            <span className="spacer" />
            <input className="input" style={{ width: 220 }} placeholder="Find an item…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!products.data ? (
            <Loading />
          ) : (
            <div className="prod-grid">
              {list.map((p) => {
                const inCart = cart.get(p.id) ?? 0;
                const left = p.stock - inCart;
                return (
                  <button key={p.id} className="prod" disabled={left <= 0} onClick={() => add(p)} style={inCart ? { borderColor: 'var(--gold)', background: 'var(--gold-soft)' } : undefined}>
                    <b>{p.name}</b>
                    <span className={`s${p.stock <= p.reorder_level ? ' low' : ''}`}>{p.stock === 0 ? 'Out of stock' : `${left} ${p.unit}${left === 1 ? '' : 's'} left`}</span>
                    <span className="p">{naira(p.price)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card cart">
          <div className="card-head">
            <h2>Current order</h2>
            {lines.length > 0 && (
              <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setCart(new Map())}>
                Clear
              </button>
            )}
          </div>
          <div className="card-body stack">
            {lines.length === 0 ? (
              <div className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>Nothing yet — tap an item.</div>
            ) : (
              <div>
                {lines.map(({ p, qty }) => (
                  <div className="cart-line" key={p.id}>
                    <span>{p.name}</span>
                    <span className="qty">
                      <button onClick={() => add(p, -1)} aria-label={`One less ${p.name}`}>−</button>
                      <span>{qty}</span>
                      <button onClick={() => add(p, 1)} aria-label={`One more ${p.name}`} disabled={qty >= p.stock}>+</button>
                    </span>
                    <span className="num" style={{ minWidth: 76, textAlign: 'right', fontWeight: 700 }}>{naira(p.price * qty)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 20 }}>
              <b>Total</b>
              <b className="num display">{naira(total)}</b>
            </div>
            <div className="pay-methods" role="group" aria-label="Payment method">
              {PAYMENT_METHODS.map((m) => (
                <button key={m} aria-pressed={method === m} onClick={() => setMethod(m)}>
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
            <ErrorBox error={error} />
            <button className="btn gold lg block" disabled={busy || lines.length === 0} onClick={charge}>
              {busy ? 'Saving…' : `Charge ${naira(total)}`}
            </button>
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Today's till</h2>
      {till.data && (
        <div className="cards cols-4" style={{ marginBottom: 16 }}>
          <Stat label="Total sold" value={naira(till.data.summary.total)} foot={`${till.data.summary.count} sales`} />
          <Stat label="Cash in drawer" value={naira(till.data.summary.cash)} />
          <Stat label="Transfers" value={naira(till.data.summary.transfer)} />
          <Stat label="POS / card" value={naira(till.data.summary.pos)} />
        </div>
      )}
      <Card pad={false} title="Recent sales">
        {!till.data ? (
          <Loading />
        ) : till.data.sales.length === 0 ? (
          <Empty>No sales yet today.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Time</th><th>Receipt</th><th>Items</th><th>Paid by</th><th className="r">Amount</th></tr>
              </thead>
              <tbody>
                {till.data.sales.slice(0, 25).map((s) => (
                  <tr key={s.id}>
                    <td className="num">{fmtTime(s.created_at)}</td>
                    <td className="muted">{s.receipt_no}</td>
                    <td>{s.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</td>
                    <td>{PAYMENT_LABELS[s.method]}</td>
                    <td className="r strong">{naira(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
