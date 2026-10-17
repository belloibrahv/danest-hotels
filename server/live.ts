import type { Request, Response } from 'express';
import { get, onAudit } from './db.ts';
import { currentSessionId } from './auth.ts';

/**
 * Live updates over server-sent events. An event names only what changed ("sales", "stock"…),
 * never the data itself: each open screen refetches through its own role-checked API, so a
 * bar till can hear that money moved without ever being told how much.
 */
export const TOPICS = ['reservations', 'rooms', 'sales', 'stock', 'money', 'activity', 'queries'] as const;
export type Topic = (typeof TOPICS)[number];

/** What each audited entity touches. Everything audited is also new activity. */
const ENTITY_TOPICS: Record<string, Topic[]> = {
  reservation: ['reservations', 'rooms', 'money'],
  room: ['rooms'],
  room_type: ['rooms'],
  maintenance: ['rooms'],
  sale: ['sales', 'stock', 'money'],
  product: ['stock'],
  purchase: ['stock', 'money'],
  supplier: ['stock'],
  expense: ['money'],
  facility_income: ['money'],
  company: ['money'],
  day: ['money', 'reservations'],
  target: ['money'],
  audit_query: ['queries'],
};

interface Client {
  res: Response;
  userId: number;
  sid: string;
}

const clients = new Set<Client>();
const MAX_CLIENTS = 400;
const MAX_PER_USER = 8;

let pending = new Set<Topic>();
let timer: NodeJS.Timeout | null = null;

/** Queue topics. Sent shortly after, once: the transaction that raised them has committed, and a busy till sends one event, not twenty. */
export function publish(...topics: Topic[]) {
  for (const t of topics) pending.add(t);
  if (timer || clients.size === 0) {
    if (clients.size === 0) pending.clear();
    return;
  }
  timer = setTimeout(flush, 150);
  timer.unref();
}

export function publishEntity(entity: string) {
  publish('activity', ...(ENTITY_TOPICS[entity] ?? []));
}
onAudit(publishEntity);

function flush() {
  timer = null;
  if (!pending.size) return;
  const frame = `event: change\ndata: ${JSON.stringify({ topics: [...pending] })}\n\n`;
  pending = new Set();
  for (const c of clients) c.res.write(frame);
}

const stillSignedIn = (c: Client) =>
  !!get('SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.active = 1', c.sid, new Date().toISOString());

// One heartbeat for everyone: keeps proxies from closing idle streams, and drops anyone signed out or deactivated since.
setInterval(() => {
  for (const c of clients) {
    if (!stillSignedIn(c)) {
      c.res.end();
      clients.delete(c);
    } else c.res.write(': ping\n\n');
  }
}, 25_000).unref();

export function stream(req: Request, res: Response) {
  const user = req.user!;
  const sid = currentSessionId(req)!;
  const mine = [...clients].filter((c) => c.userId === user.id);
  if (clients.size >= MAX_CLIENTS) return res.status(503).json({ error: 'Too many live screens open' });
  // A user with many old tabs: the oldest stream makes way for the newest.
  if (mine.length >= MAX_PER_USER) {
    mine[0].res.end();
    clients.delete(mine[0]);
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ topics: TOPICS })}\n\n`);
  const client: Client = { res, userId: user.id, sid };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

/** For tests and shutdown: end every open stream. */
export function closeAll() {
  for (const c of clients) c.res.end();
  clients.clear();
}
