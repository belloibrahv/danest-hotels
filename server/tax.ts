import { TAX_GROUPS, taxesIncluded, type TaxGroup } from '../shared/constants.ts';
import { all, get } from './db.ts';
import { getSettings } from './settings.ts';

const GROUP_OF = new Map<string, TaxGroup>(TAX_GROUPS.flatMap((g) => g.streams.map((s) => [s, g.key] as const)));
/** Which tax group a revenue stream (or a folio line's kind) belongs to. */
export const groupOf = (stream: string): TaxGroup | undefined => GROUP_OF.get(stream === 'room' || stream === 'fee' ? 'rooms' : stream);

const add = (into: Partial<Record<TaxGroup, number>>, stream: string, v: number) => {
  const g = groupOf(stream);
  if (g) into[g] = (into[g] ?? 0) + v;
};

/** Tax inside one guest's bill, from what was actually charged: nights, each till item by category, each service. */
export function reservationTaxes(id: number) {
  const { taxes } = getSettings();
  if (!taxes.length) return [];
  const r = get<{ status: string; retained: number }>('SELECT status, retained FROM reservations WHERE id = ?', id);
  if (!r) return [];
  const gross: Partial<Record<TaxGroup, number>> = {};
  if (r.status === 'cancelled') add(gross, 'cancellations', r.retained);
  else add(gross, 'rooms', get<{ v: number }>('SELECT COALESCE(SUM(rate),0) v FROM reservation_nights WHERE reservation_id = ?', id)!.v);
  for (const x of all<{ category: string; v: number }>(
    'SELECT p.category, SUM(si.qty * si.unit_price) v FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE s.reservation_id = ? GROUP BY p.category',
    id,
  )) add(gross, x.category, x.v);
  for (const x of all<{ facility: string; v: number }>('SELECT facility, SUM(amount) v FROM facility_income WHERE reservation_id = ? GROUP BY facility', id)) add(gross, x.facility, x.v);
  return taxesIncluded(gross, taxes);
}

/** Tax inside one till receipt. */
export function saleTaxes(saleId: number) {
  const { taxes } = getSettings();
  if (!taxes.length) return [];
  const gross: Partial<Record<TaxGroup, number>> = {};
  for (const x of all<{ category: string; v: number }>(
    'SELECT p.category, SUM(si.qty * si.unit_price) v FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? GROUP BY p.category',
    saleId,
  )) add(gross, x.category, x.v);
  return taxesIncluded(gross, taxes);
}

/** Tax inside a period's earned revenue, per tax and per group: what is owed to government. */
export function periodTaxes(revenue: { key: string; amount: number }[]) {
  const { taxes } = getSettings();
  const gross: Partial<Record<TaxGroup, number>> = {};
  for (const r of revenue) add(gross, r.key, r.amount);
  return {
    taxes: taxesIncluded(gross, taxes),
    groups: TAX_GROUPS.map((g) => ({ key: g.key, label: g.label, gross: gross[g.key] ?? 0, taxes: taxesIncluded({ [g.key]: gross[g.key] ?? 0 }, taxes) })),
  };
}
