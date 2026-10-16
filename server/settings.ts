import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DEFAULT_SETTINGS, type HotelSettings } from '../shared/constants.ts';
import { all, get, run } from './db.ts';

export function getSettings(): HotelSettings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    if (r.key in DEFAULT_SETTINGS) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        /* ignore a corrupt value and keep the default */
      }
    }
  }
  return out as unknown as HotelSettings;
}

export function saveSettings(patch: Partial<HotelSettings>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
  }
}

// ---------- first-run setup ----------

/**
 * The very first account (the owner) can only be created with a setup code. In production the
 * code comes from DANEST_SETUP_CODE; otherwise one is generated at boot and printed to the
 * server log — which only the person running the server can read. Once any user exists,
 * setup is closed for good.
 */
let bootCode: string | null = null;

export const needsSetup = () => !get('SELECT 1 FROM users LIMIT 1');

export function setupCode(): string {
  if (process.env.DANEST_SETUP_CODE) return process.env.DANEST_SETUP_CODE;
  if (!bootCode) bootCode = randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-');
  return bootCode;
}

export function checkSetupCode(given: string): boolean {
  const want = Buffer.from(setupCode().replace(/[^A-Z0-9]/gi, '').toUpperCase());
  const got = Buffer.from(given.replace(/[^A-Z0-9]/gi, '').toUpperCase());
  return want.length === got.length && timingSafeEqual(want, got);
}
