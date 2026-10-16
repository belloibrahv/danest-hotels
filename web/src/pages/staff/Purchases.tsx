import { useState, type FormEvent } from 'react';
import { DateRange, useRange } from '../../components/DateRange';
import { Card, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Stat, useSubmit, useToast } from '../../components/kit';
import { api, fmtDate, naira, todayISO } from '../../lib/api';
import { useApi } from '../../lib/hooks';
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
  const { data, error, reload } = useApi<{ purchases: Purchase[] }>(`/purchases?${range.qs}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const total = data?.purchases.reduce((a, p) => a + p.total, 0) ?? 0;

  return (
    <>
      <PageHead title="Purchases" sub="Restocking drinks and confectionery. Each purchase adds to stock and updates the cost of every item sold after it.">
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> Record a purchase
        </button>
      </PageHead>
      <div className="row" style={{ marginBottom: 16 }}>
        <DateRange state={range} />
      </div>
      <div className="cards cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Spent on stock" value={naira(total)} foot={`${data?.purchases.length ?? 0} purchases`} />
      </div>
      <Card pad={false}>
        <ErrorBox error={error} />
        {!data ? <Loading /> : data.purchases.length === 0 ? <Empty>No purchases in this period.</Empty> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th>Recorded by</th><th className="r">Total</th></tr></thead>
              <tbody>
                {data.purchases.map((p) => (
                  <tr key={p.id} className="click" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <td className="num">{fmtDate(p.date)}</td>
                    <td><div className="strong">{p.supplier}</div><div className="muted" style={{ fontSize: 12.5 }}>{p.ref}</div></td>
                    <td style={{ maxWidth: 420 }}>
                      {open === p.id
                        ? p.items.map((i) => <div key={i.name}>{i.qty} × {i.name} @ {naira(i.unit_cost)}</div>)
                        : <span className="muted">{p.items.length} item{p.items.length > 1 ? 's' : ''} — {p.items.slice(0, 3).map((i) => i.name).join(', ')}{p.items.length > 3 ? '…' : ''}</span>}
                    </td>
                    <td className="muted">{p.recorded_by}</td>
                    <td className="r strong">{naira(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <NewPurchase onClose={() => setCreating(false)} onSaved={() => (setCreating(false), reload())} />}
    </>
  );
}

function NewPurchase({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const products = useApi<Product[]>('/products');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ product_id: number | ''; qty: string; unit_cost: string }[]>([{ product_id: '', qty: '', unit_cost: '' }]);
  const { busy, error, submit } = useSubmit();
  const toast = useToast();

  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.unit_cost || 0), 0);
  const lowItems = (products.data ?? []).filter((p) => p.stock <= p.reorder_level);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const items = lines.filter((l) => l.product_id && l.qty).map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_cost: Number(l.unit_cost || 0) }));
      await api('/purchases', { body: { supplier, date, notes, items } });
      toast(`Purchase of ${naira(total)} saved — stock updated`);
      onSaved();
    });
  };

  return (
    <Modal title="Record a purchase" onClose={onClose} wide>
      <form className="stack" onSubmit={onSubmit}>
        <div className="grid-2">
          <Field label="Supplier"><input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} required maxLength={120} placeholder="e.g. Bodija Drinks Depot" /></Field>
          <Field label="Date"><input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        </div>
        {lowItems.length > 0 && (
          <button
            type="button"
            className="btn sm"
            style={{ justifySelf: 'start' }}
            onClick={() => setLines(lowItems.map((p) => ({ product_id: p.id, qty: String(p.reorder_level * 3 - p.stock), unit_cost: String(p.avg_cost ?? '') })))}
          >
            Fill in the {lowItems.length} items running low
          </button>
        )}
        <div className="stack" style={{ gap: 8 }}>
          {lines.map((l, i) => (
            <div key={i} className="row" style={{ alignItems: 'end', flexWrap: 'nowrap' }}>
              <div style={{ flex: 3, minWidth: 0 }}>
                <Field label={i === 0 ? 'Item' : ''}>
                  <select className="input" value={l.product_id} onChange={(e) => {
                    const p = products.data?.find((x) => x.id === Number(e.target.value));
                    setLine(i, { product_id: e.target.value ? Number(e.target.value) : '', unit_cost: l.unit_cost || String(p?.avg_cost ?? '') });
                  }} required>
                    <option value="">Choose…</option>
                    {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock} in stock)</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ flex: 1 }}><Field label={i === 0 ? 'Qty' : ''}><input className="input num" inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/\D/g, '') })} required /></Field></div>
              <div style={{ flex: 1.3 }}><Field label={i === 0 ? 'Unit cost (₦)' : ''}><input className="input num" inputMode="numeric" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value.replace(/\D/g, '') })} required /></Field></div>
              <button type="button" className="btn ghost sm" aria-label="Remove line" style={{ height: 40 }} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}><Icon name="x" size={14} /></button>
            </div>
          ))}
          <button type="button" className="btn sm" style={{ justifySelf: 'start' }} onClick={() => setLines([...lines, { product_id: '', qty: '', unit_cost: '' }])}>
            <Icon name="plus" size={14} /> Add line
          </button>
        </div>
        <Field label="Notes (optional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Invoice number, delivery notes…" /></Field>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 18 }}><b>Total</b><b className="num">{naira(total)}</b></div>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || total === 0}>Save purchase</button>
        </div>
      </form>
    </Modal>
  );
}
