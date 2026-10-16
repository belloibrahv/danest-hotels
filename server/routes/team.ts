import { Router } from 'express';
import { ROLES } from '../../shared/constants.ts';
import {
  allow,
  checkCredentials,
  clearRateLimit,
  createSession,
  currentUser,
  destroySession,
  destroyUserSessions,
  hashPassword,
  passwordProblem,
  rateLimit,
  verifyPassword,
} from '../auth.ts';
import { all, audit, get, run } from '../db.ts';
import { HttpError, bad, body, h, oneOf, str } from '../lib.ts';

export const team = Router();

// ---------- sign in / out ----------

team.post(
  '/auth/login',
  h((req, res) => {
    const b = body(req);
    const username = str(b, 'username', { max: 40 }).toLowerCase();
    const password = typeof b.password === 'string' ? b.password.slice(0, 128) : '';
    // Two limits: one per account (stops guessing a known username), one per address (stops spraying).
    const accountKey = `login:${username}`;
    rateLimit(accountKey, 8, 15 * 60_000);
    rateLimit(`login-ip:${req.ip}`, 30, 15 * 60_000);
    const user = checkCredentials(username, password);
    if (!user) {
      audit(null, 'login_failed', 'user', null, { username });
      throw new HttpError(401, 'Incorrect username or password');
    }
    clearRateLimit(accountKey);
    createSession(res, user.id);
    audit(user.id, 'login', 'user', user.id);
    res.json(user);
  }),
);

team.post(
  '/auth/logout',
  h((req, res) => {
    destroySession(req, res);
    res.json({ ok: true });
  }),
);

team.get(
  '/auth/me',
  h((req, res) => {
    if (!req.user) throw new HttpError(401, 'Not signed in');
    res.json(req.user);
  }),
);

team.post(
  '/auth/password',
  allow('manager', 'frontdesk', 'bar'),
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const current = typeof b.current === 'string' ? b.current : '';
    const next = typeof b.next === 'string' ? b.next : '';
    const problem = passwordProblem(next);
    if (problem) throw bad(problem);
    rateLimit(`pw:${user.id}`, 5, 15 * 60_000);
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id)!;
    if (!verifyPassword(current, row.password_hash)) throw bad('Current password is incorrect');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), user.id);
    destroyUserSessions(user.id);
    createSession(res, user.id);
    audit(user.id, 'password_change', 'user', user.id);
    res.json({ ok: true });
  }),
);

// ---------- team management (manager only) ----------

team.get(
  '/users',
  allow('manager'),
  h((_req, res) => {
    res.json(all('SELECT id, name, username, role, active, created_at FROM users ORDER BY active DESC, role, name'));
  }),
);

team.post(
  '/users',
  allow('manager'),
  h((req, res) => {
    const b = body(req);
    const name = str(b, 'name', { max: 80 });
    const username = str(b, 'username', { max: 32, min: 3, pattern: /^[a-z0-9._-]+$/i }).toLowerCase();
    const role = oneOf(b, 'role', ROLES);
    const password = typeof b.password === 'string' ? b.password : '';
    const problem = passwordProblem(password);
    if (problem) throw bad(problem);
    if (get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'That username is taken');
    const { id } = run('INSERT INTO users (name, username, role, password_hash) VALUES (?,?,?,?)', name, username, role, hashPassword(password));
    audit(currentUser(req).id, 'create', 'user', id, { username, role });
    res.status(201).json({ id });
  }),
);

team.patch(
  '/users/:id',
  allow('manager'),
  h((req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    const target = get<{ id: number; role: string; active: number }>('SELECT id, role, active FROM users WHERE id = ?', id);
    if (!target) throw new HttpError(404, 'User not found');
    if (id === me.id && (b.active === false || (b.role && b.role !== 'manager'))) throw bad("You can't remove your own manager access");

    if (b.role !== undefined) run('UPDATE users SET role = ? WHERE id = ?', oneOf(b, 'role', ROLES), id);
    if (b.active !== undefined) run('UPDATE users SET active = ? WHERE id = ?', b.active === true ? 1 : 0, id);
    if (b.password !== undefined) {
      const pw = typeof b.password === 'string' ? b.password : '';
      const problem = passwordProblem(pw);
      if (problem) throw bad(problem);
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), id);
    }
    // Any change to who someone is or what they can do signs them out everywhere.
    if (id !== me.id) destroyUserSessions(id);
    audit(me.id, 'update', 'user', id, { role: b.role, active: b.active, password_reset: b.password !== undefined });
    res.json({ ok: true });
  }),
);

team.get(
  '/audit',
  allow('manager'),
  h((_req, res) => {
    res.json(
      all(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`,
      ),
    );
  }),
);
