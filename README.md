# Danest Hotel & Suites — Guest website + Back office

**Client:** Danest Hotel & Suites, 4 Beckley Street, off Adeyi-Estate, Old Bodija Road, Ibadan, Oyo State
**Status:** Demo build. It shows the client the full model of the business and is ready to extend once they approve it.

One system that runs the hotel the way the owner described it:

| The owner said | Where it lives |
|---|---|
| Main income: **room reservations** | Guest website booking → Reservations → Room board → payments |
| Main income: **drinks and confectionery** | Bar & shop till (stock-aware, prices from the database) |
| Other income: **gym, swimming pool, lounge & bar** | Gym, pool & lounge (passes, memberships, VIP tables, event hire) |
| **Purchases** of items become a cost of operations | Purchases → stock rises → cost of each sale is recorded at weighted-average cost |
| **Maintenance, salaries, diesel, NEPA bill, repairs** as running costs | Expenses (categorised) |
| "All those things should just reflect" | Profit & loss: revenue by stream − cost of sales − running costs = net profit, for any date range, exportable to Excel |

---

## Run it

Requires **Node.js 22.18 or newer** (it uses Node's built-in SQLite and runs TypeScript directly, so there is no database server and no compile step for the API).

```bash
npm install
npm run dev          # API on :4000 + web on http://localhost:5173
```

The first start loads ~4 months of realistic demo trading that ends today. To reset it:

```bash
npm run seed
```

Production-style (one process serves the API and the built site on :4000):

```bash
npm run build && npm start
```

Other scripts: `npm test` (API tests against an in-memory database) and `npm run typecheck`.

### Demo accounts

Password for all: `Danest@2026!`. The sign-in page shows one-click buttons for these in dev builds.

| Username | Role | Sees |
|---|---|---|
| `manager` | Manager / owner | Everything, including costs and profit |
| `frontdesk` | Front desk | Rooms, reservations, guest payments, gym/pool/lounge takings. No profit or cost figures |
| `bar` | Bar & shop | Till and stock levels. No cost prices |

---

## Demo script for the client meeting (about 10 minutes)

1. **Guest website** (`/`). Pick dates. Each room type shows live availability. Choose a room, fill in the form, and send. Note the reference code.
2. Sign in as **front desk**. The Overview shows the new request under *Needs attention*. Open it, assign a room, and **Confirm**. On the day of arrival, choose **Check in now**.
3. **Room board**. Tap a free room and choose *Walk-in guest* to show a walk-in. Tap a room being cleaned and choose *Mark ready*.
4. **Check out** a guest who still owes money. It is refused until the balance is recorded. A manager can override, and the override is logged.
5. Sign in as **bar**. Ring up a few drinks on the **till**, then watch the stock count drop.
6. Sign in as **manager**:
   - **Purchases**: "Fill in the items running low" → save. Stock goes up and the average cost updates.
   - **Expenses**: record diesel, the NEPA bill or a repair.
   - **Gym, pool & lounge**: record a pool day pass.
   - **Profit & loss**: everything above appears in it. Switch to *Last month* for a full month including payroll, then **Download for Excel**.
   - **Team & activity**: every check-in, payment, deletion and stock correction is logged with a name.

---

## How it's built

```
server/            Node + Express 5, built-in node:sqlite, TypeScript run natively
  app.ts           security headers, CSRF guard, routing, error handling
  auth.ts          scrypt passwords, hashed session tokens, role guard, rate limiting
  db.ts            schema (money in whole naira, dates in Lagos time)
  routes/          reservations · inventory (products/till/purchases) · finance (other income/expenses/P&L/dashboard) · team · public
  seed.ts          deterministic demo data
  test/            end-to-end API tests
shared/constants.ts  the business model (streams, expense categories, roles): one list used by API and UI
web/src/           React 19 + Vite; guest site in the main bundle, back office lazy-loaded
public/brand/      web-sized crest and building art (originals in brand-source/)
```

**Accounting rules (shown in the app as well):**
- Room revenue = payments actually received in the period (deposits, part payments, balances).
- Drinks and confectionery cost of sales = units sold × weighted-average cost *at the time of sale*. A big restock doesn't make one month look bad. Stock purchased and closing stock value appear as memo lines.
- *Room supplies & laundry* is a direct cost (above gross profit). Salaries, diesel, NEPA, repairs, pool and gym upkeep, water, security and other costs are running costs.

## Security

Built against OWASP ASVS / Top 10:2025 basics and verified by `npm test`:

- **Access control, deny by default.** Every staff route names its allowed roles. Cost prices, P&L and expenses are manager-only. Only a manager can change a room rate or check out a guest who still owes money.
- **Sessions.** A 256-bit random token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production), scoped to `/api`. Only its SHA-256 is stored. Sessions expire after 12 hours and are revoked when a user's role or password changes.
- **Passwords.** scrypt (N=2¹⁵) with per-user salt, minimum 10 characters, constant-time compare, and the same response time for unknown users.
- **CSRF.** Every state-changing request needs a custom header and a same-origin `Origin` check.
- **Brute force.** Login is rate limited per account and per IP. Public booking requests are rate limited and have a honeypot field.
- **Injection.** All SQL is parameterised. Input is validated by allow-list on the server. Prices always come from the database, never from the till. CSV export neutralises spreadsheet formulas.
- **Headers.** Strict CSP (no inline scripts, no third-party scripts, fonts self-hosted), `frame-ancestors 'none'`, `nosniff`, a strict referrer policy, and HSTS in production. JSON bodies are capped at 50 KB. Errors never leak stack traces or SQL.
- **Audit trail.** Sign-ins, failed sign-ins, payments, check-outs with a balance, stock adjustments, rate changes and deletions (with the full deleted row) are all logged.

**Before going live:**
- Change every demo password.
- Hide the demo sign-in buttons. They only appear in dev builds or when `VITE_SHOW_DEMO_LOGINS=1`.
- Run behind HTTPS (nginx or a PaaS) with `NODE_ENV=production`.
- Schedule daily off-site backups of `data/danest.db`.

## Roadmap (after the client approves the demo)

- Guest folios: charge bar items to a room and settle at check-out.
- Paystack/Flutterwave deposits on the website, plus SMS/WhatsApp confirmation to guests.
- Housekeeping task list, and night audit / end-of-day till reconciliation.
- Supplier list, purchase orders, and accounts payable.
- Payroll detail per staff member, and a monthly budget versus actual.
- Multi-property support if Danest opens a second site.
