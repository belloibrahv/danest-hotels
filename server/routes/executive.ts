import { Router } from 'express';
import { SOURCE_LABELS, STREAMS, type ReservationSource } from '../../shared/constants.ts';
import { allow } from '../auth.ts';
import { lastClosedDate } from '../days.ts';
import { all, get } from '../db.ts';
import { addDays, bad, daysBetween, h, today } from '../lib.ts';
import { monthOf, monthRange, receivables, targetsFor } from './accounts.ts';
import { profitAndLoss } from './finance.ts';
import { payables } from './purchasing.ts';
import { exceptionSummary, exceptions } from './review.ts';

/**
 * The owner's view of the business: how this month is going against last month, last year
 * and the targets; where it will land at the current pace; and what needs the owner's eye.
 * Comparisons are like-for-like: the first 12 days of this month against the first 12 of last.
 */
export const executive = Router();

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

/** The same number of days into another month (capped at that month's end). */
function likeForLike(month: string, days: number) {
  const { from, to } = monthRange(month);
  const end = addDays(from, days - 1);
  return profitAndLoss(from, end < to ? end : to);
}

const brief = (p: ReturnType<typeof profitAndLoss>) => ({
  from: p.from,
  to: p.to,
  revenue: p.totalRevenue,
  costs: p.totalCostOfSales + p.totalOperating,
  gross_profit: p.grossProfit,
  net_profit: p.netProfit,
  margin: p.totalRevenue ? p.netProfit / p.totalRevenue : 0,
  kpis: p.kpis,
  collected: p.collections.total,
  streams: Object.fromEntries(p.revenue.map((r) => [r.key, r.amount])),
});

executive.get(
  '/executive',
  allow('manager'),
  h((req, res) => {
    const t = today();
    const month = monthOf(req.query.month);
    if (month > t.slice(0, 7)) throw bad('That month has not started yet');
    const { from, to: monthEnd } = monthRange(month);
    const current = month === t.slice(0, 7);
    const to = current ? t : monthEnd;
    const elapsed = daysBetween(from, to) + 1;
    const monthDays = daysBetween(from, monthEnd) + 1;
    const rooms = get<{ n: number }>('SELECT COUNT(*) n FROM rooms WHERE active = 1')!.n;

    const cur = profitAndLoss(from, to);
    const prev = likeForLike(shiftMonth(month, -1), elapsed);
    const ly = likeForLike(shiftMonth(month, -12), elapsed);

    // Where the month lands: what's earned, plus for the days left either the room nights already
    // booked or this month's pace (whichever is more: walk-ins and late bookings still come), plus
    // everything else at this month's daily pace.
    const otb = get<{ nights: number; revenue: number }>(
      `SELECT COUNT(*) nights, COALESCE(SUM(rn.rate), 0) revenue FROM reservation_nights rn JOIN reservations r ON r.id = rn.reservation_id
        WHERE r.status IN ('confirmed','checked_in') AND rn.date > ? AND rn.date <= ?`,
      to,
      monthEnd,
    )!;
    const roomRevenue = cur.revenue.find((r) => r.key === 'rooms')!.amount;
    const remaining = monthDays - elapsed;
    const paceNights = Math.round((cur.kpis.roomNightsSold / elapsed) * remaining);
    const restNights = Math.max(otb.nights, paceNights);
    const restRooms = Math.max(otb.revenue, Math.round((roomRevenue / elapsed) * remaining));
    const otherPerDay = (cur.totalRevenue - roomRevenue) / elapsed;
    const costPerDay = (cur.totalCostOfSales + cur.totalOperating) / elapsed;
    const projectedRevenue = Math.round(cur.totalRevenue + restRooms + otherPerDay * remaining);
    const projection = {
      remaining_days: remaining,
      on_the_books: otb,
      basis: otb.nights >= paceNights ? 'booked' : 'pace',
      revenue: projectedRevenue,
      costs: Math.round(costPerDay * monthDays),
      net_profit: Math.round(projectedRevenue - costPerDay * monthDays),
      occupancy: rooms ? (cur.kpis.roomNightsSold + restNights) / (rooms * monthDays) : 0,
    };

    const targets = targetsFor(month);
    const goal = (key: string, actual: number, projected: number | null) =>
      targets[key] === undefined ? null : { key, target: targets[key], actual, projected, progress: targets[key] ? actual / targets[key] : null };
    const goals = [
      goal('revenue', cur.totalRevenue, current ? projection.revenue : cur.totalRevenue),
      goal('net_profit', cur.netProfit, current ? projection.net_profit : cur.netProfit),
      goal('occupancy', Math.round(cur.kpis.occupancy * 100), current ? Math.round(projection.occupancy * 100) : Math.round(cur.kpis.occupancy * 100)),
      goal('adr', cur.kpis.adr, null),
    ].filter(Boolean);

    // Twelve months, oldest first.
    const trend = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11)).map((m) => {
      const r = monthRange(m);
      if (r.from > t) return null;
      const p = profitAndLoss(r.from, r.to > t ? t : r.to);
      const s = Object.fromEntries(p.revenue.map((x) => [x.key, x.amount]));
      return {
        month: m,
        revenue: p.totalRevenue,
        rooms: s.rooms + s.cancellations,
        bar: s.drinks + s.confectionery + s.food,
        other: s.gym + s.pool + s.lounge + s.laundry + s.room_service + s.transport + s.extras,
        costs: p.totalCostOfSales + p.totalOperating,
        net_profit: p.netProfit,
        occupancy: p.kpis.occupancy,
        adr: p.kpis.adr,
      };
    }).filter(Boolean);

    const channels = all<{ source: ReservationSource; bookings: number; nights: number; revenue: number }>(
      `SELECT r.source, COUNT(*) bookings, SUM(r.nights) nights, SUM(r.total) revenue FROM reservations r
        WHERE date(r.created_at, '+1 hour') BETWEEN ? AND ? AND r.status <> 'cancelled' GROUP BY r.source ORDER BY revenue DESC`,
      from,
      to,
    ).map((c) => ({ ...c, label: SOURCE_LABELS[c.source] }));

    const staff = all<{ id: number; name: string; role: string; till: number; receipts: number; collected: number; check_ins: number }>(
      `SELECT u.id, u.name, u.role,
              COALESCE((SELECT SUM(total) FROM sales s WHERE s.staff_id = u.id AND s.date BETWEEN :from AND :to), 0) AS till,
              (SELECT COUNT(*) FROM sales s WHERE s.staff_id = u.id AND s.date BETWEEN :from AND :to) AS receipts,
              COALESCE((SELECT SUM(amount) FROM payments p WHERE p.received_by = u.id AND p.method IN ('cash','transfer','pos') AND p.date BETWEEN :from AND :to), 0)
                + COALESCE((SELECT SUM(amount) FROM facility_income f WHERE f.recorded_by = u.id AND f.method <> 'room' AND f.date BETWEEN :from AND :to), 0) AS collected,
              (SELECT COUNT(*) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'check_in' AND date(a.created_at, '+1 hour') BETWEEN :from AND :to) AS check_ins
         FROM users u WHERE u.active = 1 AND u.role IN ('ceo','manager','frontdesk','bar')`,
      { from, to },
    )
      .filter((s) => s.till || s.collected || s.check_ins)
      .sort((a, b) => b.till + b.collected - (a.till + a.collected));

    const topProducts = all<{ name: string; units: number; revenue: number; profit: number }>(
      `SELECT p.name, SUM(si.qty) units, SUM(si.qty * si.unit_price) revenue, SUM(si.qty * (si.unit_price - si.unit_cost)) profit
         FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
        WHERE s.date BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC LIMIT 5`,
      from,
      to,
    );

    const ex = exceptionSummary(exceptions(from, to));
    const rec = receivables();
    const pay = payables();
    const last = lastClosedDate();
    const risks = {
      exceptions: ex,
      open_queries: get<{ n: number }>("SELECT COUNT(*) n FROM audit_queries WHERE status = 'open'")!.n,
      cash_variance: get<{ n: number; v: number; abs: number }>('SELECT COUNT(*) n, COALESCE(SUM(variance),0) v, COALESCE(SUM(ABS(variance)),0) abs FROM day_closures WHERE variance <> 0 AND date BETWEEN ? AND ?', from, to)!,
      receivables: { total: rec.total, overdue: rec.total - (rec.buckets.current ?? 0) },
      payables: { total: pay.total, overdue: pay.total - (pay.buckets.current ?? 0) },
      unclosed_days: last ? Math.max(0, daysBetween(last, addDays(t, -1))) : null,
      low_stock: get<{ n: number }>('SELECT COUNT(*) n FROM products WHERE active = 1 AND track_stock = 1 AND stock <= reorder_level')!.n,
      out_of_order: get<{ n: number }>("SELECT COUNT(*) n FROM rooms WHERE active = 1 AND status = 'maintenance'")!.n,
      no_two_step: all<{ name: string; role: string }>("SELECT name, role FROM users WHERE active = 1 AND totp_enabled = 0 AND role IN ('ceo','manager','accountant','auditor')"),
    };

    res.json({
      month,
      from,
      to,
      current,
      elapsed,
      month_days: monthDays,
      rooms,
      streams: STREAMS.map(({ key, label, group }) => ({ key, label, group })),
      now: brief(cur),
      previous: brief(prev),
      last_year: brief(ly),
      projection: current ? projection : null,
      targets,
      goals,
      trend,
      channels,
      staff,
      top_products: topProducts,
      risks,
    });
  }),
);
