export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-danest-request': '1' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    // No answer at all: the connection dropped. Nothing was saved, so say so plainly.
    throw new ApiError(0, navigator.onLine ? 'Could not reach the hotel system. Check the connection and try again.' : "You're offline. Nothing was saved. Try again when the connection is back.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/') && !location.pathname.endsWith('/login')) {
      window.dispatchEvent(new Event('danest:signed-out'));
    }
    throw new ApiError(res.status, data.error ?? 'Something went wrong');
  }
  return data as T;
}

const ngn = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
export const naira = (n: number) => `${n < 0 ? '−' : ''}₦${ngn.format(Math.abs(Math.round(n)))}`;
export const nairaShort = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M` : a >= 1e3 ? `${Math.round(a / 1e3)}k` : String(a);
  return `${n < 0 ? '−' : ''}₦${s}`;
};
export const pct = (x: number) => `${Math.round(x * 100)}%`;

const lagos = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayISO = () => lagos.format(new Date());
export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

const dShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dLong = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtDate = (d: string) => dShort.format(new Date(`${d}T00:00:00Z`));
export const fmtDateLong = (d: string) => dLong.format(new Date(`${d}T00:00:00Z`));
/** created_at columns are UTC "YYYY-MM-DD HH:MM:SS"; show them in Lagos time. */
const tFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const dtFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
export const fmtTime = (ts: string) => tFmt.format(new Date(ts.replace(' ', 'T') + 'Z'));
export const fmtDateTime = (ts: string) => dtFmt.format(new Date(ts.replace(' ', 'T') + 'Z'));
