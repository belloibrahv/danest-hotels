import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSession } from './auth.ts';
import { HttpError } from './lib.ts';
import { closeDay } from './routes/closeday.ts';
import { commercial } from './routes/commercial.ts';
import { recordSuccess, validSignature } from './paystack.ts';
import { config } from './routes/config.ts';
import { finance } from './routes/finance.ts';
import { housekeeping } from './routes/housekeeping.ts';
import { inventory } from './routes/inventory.ts';
import { publicApi } from './routes/public.ts';
import { reservations } from './routes/reservations.ts';
import { team } from './routes/team.ts';

const isProd = process.env.NODE_ENV === 'production';

/** Header every state-changing request from our own UI carries. Browsers won't send it cross-site without a CORS preflight we never grant. */
export const CSRF_HEADER = 'x-danest-request';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind one reverse proxy (nginx / Render / Fly) in production so req.ip is the visitor, not the proxy.
  app.set('trust proxy', isProd ? 1 : false);

  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src https://www.google.com",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join('; '),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Paystack calls this server-to-server. It carries no browser cookies or CSRF header, so it is
  // authenticated by its HMAC signature instead, over the exact bytes received.
  app.post('/api/paystack/webhook', express.raw({ type: '*/*', limit: '100kb' }), (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!validSignature(raw, req.get('x-paystack-signature'))) return res.sendStatus(401);
    try {
      const event = JSON.parse(raw.toString('utf8')) as { event?: string; data?: { reference?: string; amount?: number } };
      if (event.event === 'charge.success' && event.data?.reference && typeof event.data.amount === 'number') {
        recordSuccess(event.data.reference, event.data.amount, event.data);
      }
    } catch (err) {
      // Unknown references and duplicates are acknowledged so Paystack stops retrying; real errors are logged.
      if (!(err instanceof HttpError)) console.error('paystack webhook', err);
    }
    res.sendStatus(200);
  });

  const api = express.Router();
  api.use(express.json({ limit: '50kb' }));
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.get(CSRF_HEADER) !== '1') return next(new HttpError(403, 'Request blocked'));
      const origin = req.get('origin');
      if (origin && new URL(origin).host !== req.get('host')) return next(new HttpError(403, 'Request blocked'));
    }
    next();
  });
  api.use(loadSession);
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/public', publicApi);
  api.use(team);
  api.use(reservations);
  api.use(inventory);
  api.use(finance);
  api.use(config);
  api.use(housekeeping);
  api.use(closeDay);
  api.use(commercial);
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  const dist = resolve(import.meta.dirname, '../dist');
  if (existsSync(dist)) {
    // redirect: false — /brand is a page as well as the folder that holds the brand images.
    app.use(express.static(dist, { index: false, redirect: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    console.error(err);
    // Never leak stack traces or SQL to the client.
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
