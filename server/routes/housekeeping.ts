import { Router } from 'express';
import { PAYMENT_METHODS, TICKET_PRIORITIES, TICKET_STATUSES } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { assertOpen } from '../days.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, bad, body, h, int, oneOf, str, today } from '../lib.ts';

/** Housekeeping board and maintenance tickets: the back-of-house side of every room. */
export const housekeeping = Router();
const hk = allow('manager', 'frontdesk', 'housekeeping');

export function logRoom(roomId: number, action: 'dirty' | 'assigned' | 'cleaned' | 'out_of_order' | 'back_in_service', userId: number | null, note?: string) {
  run('INSERT INTO housekeeping_log (room_id, action, user_id, note) VALUES (?,?,?,?)', roomId, action, userId, note ?? null);
}

housekeeping.get(
  '/housekeeping',
  hk,
  h((req, res) => {
    const t = today();
    const me = currentUser(req);
    const rooms = all(
      `SELECT r.id, r.number, r.floor, r.status, t.name AS room_type, r.assigned_to, u.name AS assigned_name,
              (SELECT MAX(created_at) FROM housekeeping_log l WHERE l.room_id = r.id AND l.action = 'cleaned') AS last_cleaned,
              (SELECT x.check_out FROM reservations x WHERE x.room_id = r.id AND x.status = 'checked_in' LIMIT 1) AS guest_leaves,
              (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id AND x.status = 'confirmed' AND x.check_in = ?) AS arrival_today,
              (SELECT COUNT(*) FROM maintenance_tickets m WHERE m.room_id = r.id AND m.status <> 'resolved') AS open_tickets
         FROM rooms r JOIN room_types t ON t.id = r.room_type_id LEFT JOIN users u ON u.id = r.assigned_to
        WHERE r.active = 1
        ORDER BY (r.status = 'cleaning') DESC, arrival_today DESC, r.number`,
      t,
    );
    // Housekeepers see their own rooms first; supervisors see everything.
    res.json({
      rooms: me.role === 'housekeeping' ? rooms.sort((a, b) => Number(b.assigned_to === me.id) - Number(a.assigned_to === me.id)) : rooms,
      staff: all("SELECT id, name FROM users WHERE active = 1 AND role = 'housekeeping' ORDER BY name"),
      cleaned_today: get<{ n: number }>("SELECT COUNT(*) n FROM housekeeping_log WHERE action = 'cleaned' AND date(created_at, '+1 hour') = ?", t)!.n,
    });
  }),
);

housekeeping.post(
  '/rooms/:id/assign',
  allow('manager', 'frontdesk'),
  h((req, res) => {
    const id = Number(req.params.id);
    const b = body(req);
    const userId = b.user_id === null || b.user_id === '' ? null : int(b, 'user_id', { min: 1 });
    if (userId && !get("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role = 'housekeeping'", userId)) throw bad('Choose a housekeeper');
    if (!run('UPDATE rooms SET assigned_to = ? WHERE id = ?', userId, id).changes) throw new HttpError(404, 'Room not found');
    logRoom(id, 'assigned', currentUser(req).id, userId ? get<{ name: string }>('SELECT name FROM users WHERE id = ?', userId)!.name : 'unassigned');
    res.json({ ok: true });
  }),
);

housekeeping.post(
  '/rooms/:id/clean',
  hk,
  h((req, res) => {
    const id = Number(req.params.id);
    const user = currentUser(req);
    tx(() => {
      const room = get<{ status: string; number: string; assigned_to: number | null }>('SELECT status, number, assigned_to FROM rooms WHERE id = ?', id);
      if (!room) throw new HttpError(404, 'Room not found');
      if (room.status !== 'cleaning') throw new HttpError(409, `Room ${room.number} is not waiting for cleaning`);
      if (get("SELECT 1 FROM maintenance_tickets WHERE room_id = ? AND blocks_room = 1 AND status <> 'resolved'", id)) {
        throw new HttpError(409, `Room ${room.number} has an open repair that keeps it out of order`);
      }
      run("UPDATE rooms SET status = 'available', assigned_to = NULL WHERE id = ?", id);
      logRoom(id, 'cleaned', user.id);
    });
    res.json({ ok: true });
  }),
);

// ---------- maintenance ----------

const TICKET_SQL = `
  SELECT m.*, r.number AS room_number, rep.name AS reported_by_name, res.name AS resolved_by_name
    FROM maintenance_tickets m LEFT JOIN rooms r ON r.id = m.room_id
    LEFT JOIN users rep ON rep.id = m.reported_by LEFT JOIN users res ON res.id = m.resolved_by`;

housekeeping.get(
  '/maintenance',
  hk,
  h((req, res) => {
    const open = req.query.status !== 'resolved';
    res.json(
      all(
        `${TICKET_SQL} WHERE ${open ? "m.status <> 'resolved'" : "m.status = 'resolved'"}
          ORDER BY ${open ? "CASE m.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, m.id" : 'm.resolved_at DESC'} LIMIT 200`,
      ),
    );
  }),
);

housekeeping.post(
  '/maintenance',
  hk,
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const roomId = b.room_id ? int(b, 'room_id', { min: 1 }) : null;
    const area = roomId ? null : str(b, 'area', { max: 60 });
    const title = str(b, 'title', { max: 120 });
    const details = str(b, 'details', { max: 1000, optional: true });
    const priority = oneOf(b, 'priority', TICKET_PRIORITIES);
    const blocks = roomId !== null && b.blocks_room === true;
    const id = tx(() => {
      if (roomId) {
        const room = get<{ status: string; number: string }>('SELECT status, number FROM rooms WHERE id = ? AND active = 1', roomId);
        if (!room) throw bad('Room not found');
        if (blocks && room.status === 'occupied') throw new HttpError(409, `A guest is in room ${room.number}. Move them before taking it out of order.`);
        if (blocks) {
          run("UPDATE rooms SET status = 'maintenance' WHERE id = ?", roomId);
          logRoom(roomId, 'out_of_order', user.id, title);
        }
      }
      const { id } = run(
        'INSERT INTO maintenance_tickets (room_id, area, title, details, priority, blocks_room, reported_by) VALUES (?,?,?,?,?,?,?)',
        roomId, area, title, details || null, priority, blocks ? 1 : 0, user.id,
      );
      audit(user.id, 'create', 'maintenance', id, { title, priority, blocks });
      return id;
    });
    res.status(201).json({ id });
  }),
);

housekeeping.patch(
  '/maintenance/:id',
  hk,
  h((req, res) => {
    const id = Number(req.params.id);
    const status = oneOf(body(req), 'status', TICKET_STATUSES.filter((s) => s !== 'resolved'));
    if (!run("UPDATE maintenance_tickets SET status = ? WHERE id = ? AND status <> 'resolved'", status, id).changes) throw new HttpError(404, 'Open ticket not found');
    audit(currentUser(req).id, 'update', 'maintenance', id, { status });
    res.json({ ok: true });
  }),
);

/** Fixing something: the room comes back (via housekeeping), and any cost becomes a repairs expense. */
housekeeping.post(
  '/maintenance/:id/resolve',
  hk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    const resolution = str(b, 'resolution', { max: 500 });
    const cost = b.cost === undefined || b.cost === '' || b.cost === 0 ? 0 : int(b, 'cost', { min: 1, max: 50_000_000 });
    if (cost && user.role !== 'manager') throw new HttpError(403, 'Only a manager can record what a repair cost');
    const method = cost ? oneOf(b, 'method', PAYMENT_METHODS) : 'cash';
    const paidTo = str(b, 'paid_to', { max: 120, optional: true });
    tx(() => {
      const t = get<{ status: string; room_id: number | null; blocks_room: number; title: string }>('SELECT status, room_id, blocks_room, title FROM maintenance_tickets WHERE id = ?', id);
      if (!t) throw new HttpError(404, 'Ticket not found');
      if (t.status === 'resolved') throw new HttpError(409, 'Already resolved');
      let expenseId: number | null = null;
      if (cost) {
        assertOpen(today());
        expenseId = run(
          "INSERT INTO expenses (date, category, description, paid_to, amount, method, recorded_by) VALUES (?, 'repairs', ?, ?, ?, ?, ?)",
          today(), `Repair: ${t.title}`, paidTo || null, cost, method, user.id,
        ).id;
      }
      run(
        "UPDATE maintenance_tickets SET status = 'resolved', resolution = ?, cost = ?, expense_id = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?",
        resolution, cost || null, expenseId, user.id, id,
      );
      // A repaired room still needs a clean before the next guest.
      if (t.room_id && t.blocks_room && !get("SELECT 1 FROM maintenance_tickets WHERE room_id = ? AND blocks_room = 1 AND status <> 'resolved'", t.room_id)) {
        run("UPDATE rooms SET status = 'cleaning' WHERE id = ? AND status = 'maintenance'", t.room_id);
        logRoom(t.room_id, 'back_in_service', user.id, resolution);
      }
      audit(user.id, 'resolve', 'maintenance', id, { cost: cost || undefined });
    });
    res.json({ ok: true });
  }),
);
