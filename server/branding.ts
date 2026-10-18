import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSettings } from './settings.ts';
import { publicImages } from './routes/website.ts';

/**
 * The hotel's identity outside the app's own screens: the browser tab, search results, link
 * previews and the installed app on a phone. All of it comes from Settings, so the same build
 * serves any hotel. Danest keeps the crest that ships with the app.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function identity() {
  const s = getSettings();
  const name = s.name || 'Hotel';
  const short = s.short_name || name.split(/\s+/)[0];
  const logo = publicImages().logo;
  const icon = logo ? `/api/public/images/${logo.id}` : s.builtin_brand ? '/brand/crest-128.png' : '/api/public/monogram.svg';
  const title = s.location_label ? `${name} — ${s.location_label.replace(/\s*·\s*/g, ', ')}` : name;
  const description = s.hero_text || `${name}${s.address ? `, ${s.address}` : ''}. Comfortable rooms and suites. Book direct with the hotel.`;
  return { s, name, short, logo, icon, title, description };
}

/** index.html with the hotel's own title, description and icon. */
export function renderIndex(template: string) {
  const { short, icon, title, description } = identity();
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${esc(description)}"`)
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"/, `<meta name="apple-mobile-web-app-title" content="${esc(short)}"`)
    .replace(/<link rel="icon" type="image\/png" href="[^"]*"/, `<link rel="icon" href="${esc(icon)}"`);
}

const base = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/manifest.webmanifest'), 'utf8')) as Record<string, unknown> & { icons: unknown[] };

/** The installable staff app: named after the hotel, with its logo, Danest's crest, or a monogram. */
export function manifest() {
  const { s, name, short, logo } = identity();
  const icons = logo
    ? [{ src: `/api/public/images/${logo.id}`, sizes: 'any', purpose: 'any' }, { src: '/api/public/monogram.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }]
    : s.builtin_brand
      ? base.icons
      : [{ src: '/api/public/monogram.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }];
  return { ...base, name, short_name: short, description: `Front desk, bar, housekeeping and the books for ${name}.`, icons };
}

/** The hotel's initials in its colour: the icon until a logo is uploaded. */
export function monogramSvg() {
  const { s, name } = identity();
  const initials = name.replace(/&/g, ' ').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(hotel|and|suites?|the)$/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || name.slice(0, 1).toUpperCase();
  const color = /^#[0-9a-f]{6}$/i.test(s.brand_color) ? s.brand_color : '#B8862B';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${color}"/><text x="256" y="256" dy=".35em" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${initials.length > 1 ? 220 : 280}" fill="#fff">${esc(initials)}</text></svg>`;
}
