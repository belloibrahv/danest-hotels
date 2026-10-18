import { Router } from 'express';
import { allow, currentUser, rateLimit, verifyPassword } from '../auth.ts';
import { audit, get } from '../db.ts';
import { backupNow, backupPath, lastBackup, listBackups, offsiteStatus } from '../backup.ts';
import { HttpError, bad, body, h, str } from '../lib.ts';

/** Backups for the owner and managers: see that they are happening, take one now, and (owner only) download one. */
export const backups = Router();

backups.get(
  '/admin/backups',
  allow('manager'),
  h((_req, res) => {
    const last = lastBackup();
    res.json({ backups: listBackups(), offsite: offsiteStatus(), last: last ? { at: last.created_at, ok: last.action === 'backup', ...JSON.parse(last.detail) } : null });
  }),
);

backups.post(
  '/admin/backups',
  allow('manager'),
  h(async (req, res) => {
    const user = currentUser(req);
    rateLimit(`backup:${user.id}`, 6, 60 * 60_000);
    res.status(201).json(await backupNow('manual', user.id));
  }),
);

/**
 * The whole database leaves the building here, so: owner only, password re-checked, logged.
 * POST so the password travels in the body, never in a link.
 */
backups.post(
  '/admin/backups/download',
  allow('ceo'),
  h((req, res) => {
    const user = currentUser(req);
    rateLimit(`reauth:${user.id}`, 6, 15 * 60_000);
    const b = body(req);
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id)!;
    if (typeof b.password !== 'string' || !verifyPassword(b.password, row.password_hash)) throw bad('Your password is incorrect');
    const path = backupPath(str(b, 'name', { max: 60 }));
    if (!path) throw new HttpError(404, 'No such backup');
    audit(user.id, 'download', 'backup', null, { name: b.name, ip: req.ip });
    res.download(path);
  }),
);
