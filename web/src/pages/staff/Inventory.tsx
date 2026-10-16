import { useState, type FormEvent } from 'react';
import { EmptyIllo } from '../../components/illustrations';
import { Card, EmptyState, ErrorBox, Field, Icon, Loading, Modal, PageHead, Stat, Tabs, useSubmit, useToast } from '../../components/kit';
import { api, naira, pct } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import type { Product } from './Pos';

export default function Inventory() {
  const { user } = useAuth();
  const isManager = can(user, 'manager');
  const { data, error, reload } = useApi<Product[]>(isManager ? '/products?all=1' : '/products');
  const [cat, setCat] = useState<'all' | 'drinks' | 'confectionery' | 'low'>('all');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const rows = data.filter((p) => (cat === 'all' ? true : cat === 'low' ? p.active && p.stock <= p.reorder_level : p.category === cat));
  const active = data.filter((p) => p.active);
  const value = active.reduce((a, p) => a + p.stock * (p.avg_cost ?? 0), 0);
  const retail = active.reduce((a, p) => a + p.stock * p.price, 0);
  const low = active.filter((p) => p.stock <= p.reorder_level).length;

  return (
    <>
      <PageHead title="Stock" sub="Drinks and confectionery on hand. Stock goes up with purchases and down with every sale.">
        {isManager && (
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> Add item
          </button>
        )}
      </PageHead>

      {isManager && (
        <div className="cards cols-4" style={{ marginBottom: 16 }}>
          <Stat label="Items on sale" value={active.length} />
          <Stat label="Stock value at cost" value={naira(value)} foot="What you paid for what's on the shelf" />
          <Stat label="Stock value at selling price" value={naira(retail)} foot={`${naira(retail - value)} potential gross profit`} />
          <Stat label="Running low" value={low} foot="At or below reorder level" />
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <Tabs value={cat} onChange={setCat} options={[{ value: 'all', label: 'All' }, { value: 'drinks', label: 'Drinks' }, { value: 'confectionery', label: 'Confectionery' }, { value: 'low', label: `Running low (${low})` }]} />
      </div>

      <Card pad={false}>
        {data.length === 0 ? (
          <EmptyState illo={<EmptyIllo kind="glass" />} title="No bar or shop items yet">
            {isManager ? <>Add each drink and snack with its selling price, then record a <a href="/staff/purchases">purchase</a> to put your opening stock on the shelf.</> : 'Ask the manager to add the items you sell.'}
          </EmptyState>
        ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Item</th>
                <th className="r">Selling price</th>
                {isManager && <th className="r">Avg. cost</th>}
                {isManager && <th className="r">Margin</th>}
                <th className="r">In stock</th>
                <th>Status</th>
                {isManager && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <div className="strong">{p.name}</div>
                    <div className="muted" style={{ fontSize: 12.5, textTransform: 'capitalize' }}>{p.category} · per {p.unit}</div>
                  </td>
                  <td className="r">{naira(p.price)}</td>
                  {isManager && <td className="r">{naira(p.avg_cost ?? 0)}</td>}
                  {isManager && <td className="r">{p.price ? pct((p.price - (p.avg_cost ?? 0)) / p.price) : '—'}</td>}
                  <td className="r strong">{p.stock}</td>
                  <td>
                    {!p.active ? <span className="badge">Not on sale</span> : p.stock === 0 ? <span className="badge red">Out of stock</span> : p.stock <= p.reorder_level ? <span className="badge amber">Reorder</span> : <span className="badge green">OK</span>}
                  </td>
                  {isManager && (
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm ghost" onClick={() => setAdjusting(p)}>Adjust</button>
                      <button className="btn sm ghost" onClick={() => setEditing(p)}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </Card>

      {editing && <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />}
      {adjusting && <AdjustForm product={adjusting} onClose={() => setAdjusting(null)} onSaved={() => (setAdjusting(null), reload())} />}
    </>
  );
}

function ProductForm({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: product?.name ?? '',
    category: product?.category ?? 'drinks',
    unit: product?.unit ?? 'bottle',
    price: String(product?.price ?? ''),
    reorder_level: String(product?.reorder_level ?? 12),
    active: product ? !!product.active : true,
  });
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const body = { ...f, price: Number(f.price), reorder_level: Number(f.reorder_level) };
      await api(product ? `/products/${product.id}` : '/products', { method: product ? 'PATCH' : 'POST', body });
      toast(product ? 'Item updated' : 'Item added — record a purchase to put it in stock');
      onSaved();
    });
  };
  return (
    <Modal title={product ? `Edit ${product.name}` : 'Add an item'} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} /></Field>
        <div className="grid-2">
          <Field label="Category">
            <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Product['category'] })}>
              <option value="drinks">Drinks</option>
              <option value="confectionery">Confectionery</option>
            </select>
          </Field>
          <Field label="Sold per"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} required maxLength={20} placeholder="bottle, can, pack…" /></Field>
        </div>
        <div className="grid-2">
          <Field label="Selling price (₦)"><input className="input num" inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/\D/g, '') })} required /></Field>
          <Field label="Reorder when stock reaches"><input className="input num" inputMode="numeric" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value.replace(/\D/g, '') })} required /></Field>
        </div>
        {product && (
          <label className="row" style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> On sale at the till
          </label>
        )}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustForm({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const [counted, setCounted] = useState(String(product.stock));
  const [reason, setReason] = useState('');
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const change = Number(counted || 0) - product.stock;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(`/products/${product.id}/adjust`, { body: { change, reason } });
      toast('Stock corrected and logged');
      onSaved();
    });
  };
  return (
    <Modal title={`Count ${product.name}`} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <p className="muted">For breakages, spoilage or a stock count that doesn't match. Every adjustment is logged with your name.</p>
        <div className="grid-2">
          <Field label="System says"><input className="input num" value={product.stock} disabled /></Field>
          <Field label="Actually counted"><input className="input num" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} required /></Field>
        </div>
        {change !== 0 && (
          <div className={`badge ${change < 0 ? 'red' : 'green'}`} style={{ justifySelf: 'start' }}>
            {change > 0 ? '+' : ''}{change} · {naira(Math.abs(change) * (product.avg_cost ?? 0))} at cost
          </div>
        )}
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={200} placeholder="e.g. 2 bottles broken during delivery" /></Field>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || change === 0}>Save adjustment</button>
        </div>
      </form>
    </Modal>
  );
}
