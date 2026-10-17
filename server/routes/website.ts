import { Router } from 'express';
import { FACILITIES } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { readPhoto } from '../images.ts';
import { HttpError, bad, body, h, str } from '../lib.ts';

/**
 * The guest website's own photos. A hotel sells on its pictures, so the owner uploads them here:
 * one main banner, a gallery, photos for each room type and one per facility. Photos are served
 * publicly by id; an id is never reused, so browsers can keep them for good.
 */
export const website = Router();

const MAX_PHOTO = 900 * 1024;
const SLOT_LIMIT = (slot: string) => (slot === 'hero' || slot.startsWith('facility:') ? 1 : slot === 'gallery' ? 12 : 6);

function checkSlot(slot: string) {
  if (slot === 'hero' || slot === 'gallery') return;
  const [kind, key] = slot.split(':');
  if (kind === 'facility' && (FACILITIES as readonly string[]).includes(key)) return;
  if (kind === 'room_type' && /^\d+$/.test(key) && get('SELECT 1 FROM room_types WHERE id = ?', Number(key))) return;
  throw bad('Unknown place for this photo');
}

export type SiteImage = { id: number; slot: string; alt: string };
export const siteImages = () => all<SiteImage>('SELECT id, slot, alt FROM site_images ORDER BY slot, sort, id');

/** The photos the public site needs, grouped by where they go. */
export function publicImages() {
  const rows = siteImages();
  const pick = (slot: string) => rows.filter((r) => r.slot === slot).map(({ id, alt }) => ({ id, alt }));
  return {
    hero: pick('hero')[0] ?? null,
    gallery: pick('gallery'),
    facilities: Object.fromEntries(FACILITIES.map((f) => [f, pick(`facility:${f}`)[0] ?? null])),
    rooms: (typeId: number) => pick(`room_type:${typeId}`),
  };
}

website.get(
  '/public/images/:id',
  h((req, res) => {
    const img = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM site_images WHERE id = ?', Number(req.params.id));
    if (!img) throw new HttpError(404, 'No such photo');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.type(img.mime).send(Buffer.from(img.data));
  }),
);

website.get(
  '/settings/images',
  allow('manager'),
  h((_req, res) => {
    res.json(siteImages());
  }),
);

website.post(
  '/settings/images',
  allow('manager'),
  h((req, res) => {
    const b = body(req);
    const slot = str(b, 'slot', { max: 40 });
    checkSlot(slot);
    const alt = str(b, 'alt', { max: 160, optional: true });
    const { bytes, mime } = readPhoto(b.data, MAX_PHOTO);
    const id = tx(() => {
      const limit = SLOT_LIMIT(slot);
      // A single-photo place (the banner, a facility) is replaced; a full gallery says so.
      if (limit === 1) run('DELETE FROM site_images WHERE slot = ?', slot);
      else if (get<{ n: number }>('SELECT COUNT(*) n FROM site_images WHERE slot = ?', slot)!.n >= limit) throw bad(`Up to ${limit} photos here. Remove one first.`);
      const sort = get<{ s: number }>('SELECT COALESCE(MAX(sort), -1) + 1 s FROM site_images WHERE slot = ?', slot)!.s;
      const { id } = run('INSERT INTO site_images (slot, mime, data, alt, sort) VALUES (?,?,?,?,?)', slot, mime, bytes, alt, sort);
      audit(currentUser(req).id, 'photo', 'website', id, { slot, bytes: bytes.length });
      return id;
    });
    res.status(201).json({ id });
  }),
);

website.patch(
  '/settings/images/:id',
  allow('manager'),
  h((req, res) => {
    const b = body(req);
    const id = Number(req.params.id);
    const img = get<{ slot: string; sort: number }>('SELECT slot, sort FROM site_images WHERE id = ?', id);
    if (!img) throw new HttpError(404, 'No such photo');
    tx(() => {
      if (b.alt !== undefined) run('UPDATE site_images SET alt = ? WHERE id = ?', str(b, 'alt', { max: 160, optional: true }), id);
      // "first": make this the photo shown first in its place.
      if (b.first === true) run('UPDATE site_images SET sort = CASE WHEN id = ? THEN -1 ELSE sort END WHERE slot = ?', id, img.slot);
      if (b.first === true) {
        const ids = all<{ id: number }>('SELECT id FROM site_images WHERE slot = ? ORDER BY sort, id', img.slot);
        ids.forEach((r, i) => run('UPDATE site_images SET sort = ? WHERE id = ?', i, r.id));
      }
    });
    res.json({ ok: true });
  }),
);

website.delete(
  '/settings/images/:id',
  allow('manager'),
  h((req, res) => {
    const id = Number(req.params.id);
    const n = run('DELETE FROM site_images WHERE id = ?', id).changes;
    if (!n) throw new HttpError(404, 'No such photo');
    audit(currentUser(req).id, 'photo_removed', 'website', id);
    res.json({ ok: true });
  }),
);
