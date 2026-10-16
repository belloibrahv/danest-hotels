import { Router, type Request, type Response } from 'express';
import { ROLES } from '../../shared/constants.ts';
import {
  allow,
  checkCredentials,
  clearRateLimit,
  createMfaChallenge,
  createSession,
  currentSessionId,
  currentUser,
  destroySession,
  destroyUserSessions,
  finishMfaChallenge,
  hashCode,
  hashPassword,
  passwordProblem,
  rateLimit,
  useMfaChallenge,
  verifyPassword,
} from '../auth.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, bad, body, h, oneOf, str } from '../lib.ts';
import { decrypt, encrypt } from '../secrets.ts';
import { newSecret, otpauthUri, recoveryCodes, verifyTotp } from '../totp.ts';

export const team = Router();

// ---------- sign in: password, then (if enabled) a second factor ----------

const publicUser = (id: number) =>
  get<{ id: number; name: string; username: string; role: string; totp_enabled: number }>('SELECT id, name, username, role, totp_enabled FROM users WHERE id = ?', id)!;

function me(id: number) {
  const u = publicUser(id);
  return { id: u.id, name: u.name, username: u.username, role: u.role, mfa: !!u.totp_enabled };
}

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
      audit(null, 'login_failed', 'user', null, { username, ip: req.ip });
      throw new HttpError(401, 'Incorrect username or password');
    }
    clearRateLimit(accountKey);
    if (user.mfa) {
      // Password was right, but no session yet: the browser only gets a 5-minute challenge.
      return res.json({ mfa_required: true, challenge: createMfaChallenge(user.id) });
    }
    createSession(req, res, user.id);
    audit(user.id, 'login', 'user', user.id, { ip: req.ip });
    res.json(me(user.id));
  }),
);

/** Accepts a 6-digit authenticator code or a one-time recovery code. Returns the matched kind, or null. */
function checkSecondFactor(userId: number, code: string): 'totp' | 'recovery' | null {
  const clean = code.replace(/\s/g, '');
  const u = get<{ totp_secret: string | null; totp_last_step: number }>('SELECT totp_secret, totp_last_step FROM users WHERE id = ?', userId);
  if (!u?.totp_secret) return null;
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decrypt(u.totp_secret), clean);
    // Each code works once, even inside its 30-second window.
    if (step === null || step <= u.totp_last_step) return null;
    run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, userId);
    return 'totp';
  }
  const rc = get<{ id: number }>('SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', userId, hashCode(clean));
  if (!rc) return null;
  run("UPDATE recovery_codes SET used_at = datetime('now') WHERE id = ?", rc.id);
  return 'recovery';
}

team.post(
  '/auth/login/2fa',
  h((req, res) => {
    const b = body(req);
    rateLimit(`mfa-ip:${req.ip}`, 30, 15 * 60_000);
    const challenge = typeof b.challenge === 'string' ? b.challenge : '';
    const code = str(b, 'code', { max: 20 });
    const userId = useMfaChallenge(challenge);
    if (!userId) throw new HttpError(401, 'This sign-in has expired. Enter your password again.');
    const kind = checkSecondFactor(userId, code);
    if (!kind) {
      audit(userId, 'mfa_failed', 'user', userId, { ip: req.ip });
      throw new HttpError(401, 'That code is not right. Try the newest code in your app.');
    }
    finishMfaChallenge(challenge);
    createSession(req, res, userId);
    audit(userId, kind === 'recovery' ? 'login_recovery_code' : 'login', 'user', userId, { ip: req.ip, mfa: true });
    const left = get<{ n: number }>('SELECT COUNT(*) n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', userId)!.n;
    res.json({ ...me(userId), recovery_codes_left: kind === 'recovery' ? left : undefined });
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
    res.json(me(req.user.id));
  }),
);

const anyStaff = allow('manager', 'frontdesk', 'bar');

/** Sensitive account changes re-check the password, so an unattended unlocked screen isn't enough. */
function requirePassword(req: Request, field = 'password') {
  const user = currentUser(req);
  rateLimit(`reauth:${user.id}`, 6, 15 * 60_000);
  const pw = body(req)[field];
  const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id)!;
  if (typeof pw !== 'string' || !verifyPassword(pw, row.password_hash)) throw bad('Your current password is incorrect');
  return user;
}

team.post(
  '/auth/password',
  anyStaff,
  h((req, res) => {
    const b = body(req);
    const next = typeof b.next === 'string' ? b.next : '';
    const problem = passwordProblem(next);
    if (problem) throw bad(problem);
    const user = requirePassword(req, 'current');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), user.id);
    // Everyone else using the old password is signed out; this device stays in.
    destroyUserSessions(user.id, req);
    audit(user.id, 'password_change', 'user', user.id);
    res.json({ ok: true });
  }),
);

// ---------- two-factor setup ----------

team.post(
  '/auth/2fa/setup',
  anyStaff,
  h((req, res) => {
    const user = currentUser(req);
    const u = publicUser(user.id);
    if (u.totp_enabled) throw new HttpError(409, 'Two-step sign-in is already on');
    const secret = newSecret();
    run('UPDATE users SET totp_secret = ?, totp_last_step = 0 WHERE id = ?', encrypt(secret), user.id);
    res.json({ secret, uri: otpauthUri(secret, u.username) });
  }),
);

team.post(
  '/auth/2fa/enable',
  anyStaff,
  h((req, res) => {
    const user = currentUser(req);
    rateLimit(`mfa-enable:${user.id}`, 10, 15 * 60_000);
    const code = str(body(req), 'code', { max: 10 });
    const u = get<{ totp_secret: string | null; totp_enabled: number }>('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', user.id)!;
    if (u.totp_enabled) throw new HttpError(409, 'Two-step sign-in is already on');
    if (!u.totp_secret) throw bad('Start setup first');
    const step = verifyTotp(decrypt(u.totp_secret), code.replace(/\s/g, ''));
    if (step === null) throw bad("That code didn't match. Check the time on your phone and try the newest code.");
    const codes = recoveryCodes();
    tx(() => {
      run('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', step, user.id);
      run('DELETE FROM recovery_codes WHERE user_id = ?', user.id);
      for (const c of codes) run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)', user.id, hashCode(c));
      destroyUserSessions(user.id, req);
      audit(user.id, 'mfa_enabled', 'user', user.id);
    });
    res.json({ recovery_codes: codes });
  }),
);

team.post(
  '/auth/2fa/disable',
  anyStaff,
  h((req, res) => {
    const user = requirePassword(req);
    tx(() => {
      run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?', user.id);
      run('DELETE FROM recovery_codes WHERE user_id = ?', user.id);
      audit(user.id, 'mfa_disabled', 'user', user.id);
    });
    res.json({ ok: true });
  }),
);

// ---------- sessions: see and end your own signed-in devices ----------

team.get(
  '/auth/sessions',
  anyStaff,
  h((req, res) => {
    const user = currentUser(req);
    const current = currentSessionId(req);
    const rows = all<{ id: string; created_at: string; last_seen_at: string | null; user_agent: string | null; ip: string | null }>(
      'SELECT id, created_at, last_seen_at, user_agent, ip FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_seen_at, created_at) DESC',
      user.id,
      new Date().toISOString(),
    );
    const left = get<{ n: number }>('SELECT COUNT(*) n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', user.id)!.n;
    // Never send the stored hash itself; a short prefix is enough to address a session.
    res.json({
      sessions: rows.map((s) => ({ ...s, id: s.id.slice(0, 16), current: s.id === current })),
      recovery_codes_left: left,
    });
  }),
);

team.post(
  '/auth/sessions/revoke',
  anyStaff,
  h((req, res: Response) => {
    const user = currentUser(req);
    const b = body(req);
    if (b.all_others === true) {
      destroyUserSessions(user.id, req);
      audit(user.id, 'sessions_revoked', 'user', user.id);
      return res.json({ ok: true });
    }
    const prefix = str(b, 'id', { min: 16, max: 16, pattern: /^[0-9a-f]+$/ });
    const n = run("DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ? AND id IS NOT ?", user.id, prefix, currentSessionId(req)).changes;
    if (!n) throw new HttpError(404, 'Session not found');
    audit(user.id, 'session_revoked', 'user', user.id);
    res.json({ ok: true });
  }),
);

// ---------- team management (manager only) ----------

team.get(
  '/users',
  allow('manager'),
  h((_req, res) => {
    res.json(all('SELECT id, name, username, role, active, totp_enabled, last_login_at, created_at FROM users ORDER BY active DESC, role, name'));
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
    const meUser = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    const target = get<{ id: number; role: string; active: number }>('SELECT id, role, active FROM users WHERE id = ?', id);
    if (!target) throw new HttpError(404, 'User not found');
    if (id === meUser.id && (b.active === false || (b.role && b.role !== 'manager'))) throw bad("You can't remove your own manager access");

    tx(() => {
      if (b.role !== undefined) run('UPDATE users SET role = ? WHERE id = ?', oneOf(b, 'role', ROLES), id);
      if (b.active !== undefined) run('UPDATE users SET active = ? WHERE id = ?', b.active === true ? 1 : 0, id);
      if (b.password !== undefined) {
        const pw = typeof b.password === 'string' ? b.password : '';
        const problem = passwordProblem(pw);
        if (problem) throw bad(problem);
        run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), id);
      }
      // A manager can reset a lost phone: this turns two-step sign-in off so the person can set it up again.
      if (b.reset_2fa === true) {
        run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', id);
        run('DELETE FROM recovery_codes WHERE user_id = ?', id);
      }
      // Any change to who someone is or what they can do signs them out everywhere.
      if (id !== meUser.id) destroyUserSessions(id);
      audit(meUser.id, 'update', 'user', id, { role: b.role, active: b.active, password_reset: b.password !== undefined, mfa_reset: b.reset_2fa === true });
    });
    res.json({ ok: true });
  }),
);

team.get(
  '/audit',
  allow('manager'),
  h((req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 40) : '';
    res.json(
      all(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
          WHERE (? = '' OR a.action LIKE ? OR a.entity LIKE ? OR u.name LIKE ?)
          ORDER BY a.id DESC LIMIT 300`,
        q, `%${q}%`, `%${q}%`, `%${q}%`,
      ),
    );
  }),
);
