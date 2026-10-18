# Danest Hotel & Suites — Guest website + Back office

**Client:** Danest Hotel & Suites, 4 Beckley Street, off Adeyi-Estate, Old Bodija Road, Ibadan, Oyo State
**Status:** v2. A hotel management system (PMS) built to the standard of Opera Cloud, Mews and Cloudbeds, scaled to a 20-room hotel in Ibadan.

One system that runs the hotel the way the owner described it:

| The owner said | Where it lives |
|---|---|
| Main income: **room reservations** | Guest website booking → Reservations → Room board → payments |
| Main income: **drinks and confectionery** | Bar & shop till (stock-aware, prices from the database) |
| Other income: **gym, swimming pool, lounge & bar** | Gym, pool & lounge (passes, memberships, VIP tables, event hire) |
| **Purchases** of items become a cost of operations | Purchases → stock rises → cost of each sale is recorded at weighted-average cost |
| **Maintenance, salaries, diesel, NEPA bill, repairs** as running costs | Expenses (categorised) |
| "All those things should just reflect" | Profit & loss: revenue by stream − cost of sales − running costs = net profit, for any date range, exportable to Excel |

### What's in v2

| Area | Capability |
|---|---|
| **Front office** | Tape chart (rooms × days, click a night to book), room board, reservations, walk-ins, early check-out (re-priced to the nights used), extend or shorten a stay, room moves, ⌘K command palette, `N` for a new booking |
| **Guest folios** | Bar and gym/pool charges post to the guest's room. One itemised bill. Settle at check-out. Printable invoice/receipt (A4, save as PDF). A late arrival is billed from the night they arrive; a guest who stays past departure is billed for the extra nights at check-out |
| **Refunds & corrections** | Cancelling or no-showing a paid booking keeps the deposit as a cancellation fee (its own revenue line), or a manager gives some or all of it back. Managers refund overpaid stays (e.g. after leaving early) and void till or gym/pool/lounge mistakes on open days; stock goes back on the shelf. Every refund and void needs a reason and is kept in the activity log |
| **Guests (CRM)** | One profile per phone number. Stay history, lifetime spend, favourite room, VIP flag, preference notes, ID capture (NIN, passport, driver's licence, voter's card). Returning guests are recognised as you type their number |
| **Owner reporting** | Room revenue earned night by night (night-audit style). **Occupancy, ADR, RevPAR**, each compared with the previous period. 14-day on-the-books forecast. Cash collected by method. P&L export for Excel |
| **Security** | Two-step sign-in (authenticator app, single-use recovery codes, replay protection). Secrets encrypted at rest. Device and session management. Re-authentication for sensitive changes |
| **Guest website** | Live availability, illustrated rooms and facilities, "a day at Danest" story, FAQ, and **Manage booking** (`/booking`) for guests to check their reservation |
| **Rates & seasons** | Every night is priced on its own. Rules raise or lower the base rate for weekends, seasons and promotions (by percentage, by a naira amount, or a fixed price), and a 14-night price grid shows the result. Past nights never change |
| **Company accounts** | Negotiated discounts, credit limits, and "bill to company" at check-out, which moves the balance to the company's account (city ledger). Statements with a running balance; payments on account |
| **Online deposits** | Paystack hosted checkout from the website and Manage booking. Payments are verified on the server, webhooks are signature-checked, each payment is recorded exactly once, and a paid deposit confirms the booking if a room is still free (otherwise the money is kept on the request for the front desk) |
| **Guest messages** | Confirmation, reminder, balance and thank-you messages from each reservation. Sent by SMS when Termii is connected, otherwise opened ready to send on WhatsApp. Every message is logged |
| **Interface** | shadcn/ui on Tailwind CSS v4 (Radix), Geist type, light and dark mode, collapsible sidebar, ⌘K command palette, side sheets for reservations, guests and companies, recharts charts with a palette checked for colour-blindness. Design language at `/brand` |
| **App & devices** | Installable as an app on the reception PC, a tablet or a housekeeper's phone (Install Danest app in the account menu; Share → Add to Home Screen on iPhone), with shortcuts to the room board, till, housekeeping and closing the day. Opens instantly and still loads on a weak connection; says clearly when offline so nobody thinks something was saved. Guest, money and staff data is never stored on the device. New versions are offered with a Reload prompt, never forced mid-task |
| **Owner / CEO dashboard** | Executive view: revenue, profit, occupancy, ADR and RevPAR compared like-for-like with the same days last month and last year; monthly targets with a month-end projection (bookings already made, or this month's pace); 12-month trends; where bookings come from; team performance; a live feed of what's happening; and the signals that need the owner's eye (serious exceptions, unanswered audit queries, cash shortfalls, overdue money, unclosed days, rooms out of order, money-seeing accounts without two-step sign-in) |
| **Accountant** | Cash book of every naira in and out (cash drawer vs bank, by payment method, exportable), receivables aged 0–90+ days (guest folios, and company accounts with payments cleared oldest-first), supplier bills aged by due date and paid in part or full, a monthly budget for each running cost against what's been spent, and every night-audit cash count |
| **Auditor** | Read-only access to every naira and every action. Exceptions in one list (voids, refunds, guests let out owing, cash differences, reopened days, stock write-offs, deleted expenses, hand-set prices, back-dated entries, delivery shortfalls, access changes, repeated failed sign-ins) with a risk score; the full trail, filterable and exportable (the export itself is logged); and queries to management that stay on record until the auditor closes them |
| **Stock & buying** | A catalogue with SKUs, barcodes (scan at the till), photos, descriptions and usual suppliers. Upload a spreadsheet to add items, change prices and receive opening stock in one go — checked row by row and saved all-or-nothing; export in the same columns. A stock card per item (every unit in and out, with the running balance). Insights: best sellers, items not selling, days of stock left, turnover, write-offs, and one-click purchase orders grouped by supplier. Purchases go ordered → received (only then do stock and average cost change; differences from the order are flagged for the auditor) → paid on delivery or on credit with a due date |
| **Live** | Every screen updates by itself when something happens anywhere in the hotel (a sale at the till, a check-in, a delivery, a payment). Only the kind of change is broadcast, never amounts or names: each screen refetches through its own role-checked API |
| **Light, dark or automatic** | Follows the phone or computer's setting by default; anyone can pick Light, Dark or Match device from the header. Printed invoices are always dark ink on white. Every screen is laid out for phones, tablets and desktops, and an open reservation or guest has its own link (shareable, survives a refresh, closed by the back gesture) |

---

## Going live for a real hotel

The live system **starts empty**: no sample bookings, no sample sales, and no invented staff. Every number on every report is the hotel's real business.

1. Deploy, setting `DANEST_SECRET` and `DANEST_SETUP_CODE` (both long random strings).
2. Open `/setup`, enter the setup code, and create the **owner's account with their real name**. This account is the Owner / CEO. Setup then closes permanently. Only an owner can create or change another owner account (a hotel upgraded from an earlier version can promote its first owner from Team).
3. Follow the checklist on the dashboard:
   - hotel details (phone, address, check-in times, bank details for invoices)
   - room types and rates
   - room numbers (`101-108` adds a floor at once)
   - bar and shop items, then a purchase for the opening stock
   - gym, pool and lounge prices
   - staff accounts, each with their real name and role
   - two-step sign-in for every manager
4. Each night, the manager uses **Close the day**: clear no-shows and late departures (the day can't close until they are sorted), count the cash drawer, and lock the day.

## Run it locally

Requires **Node.js 22.18 or newer** (it uses Node's built-in SQLite and runs TypeScript directly, so there is no database server and no compile step for the API).

```bash
npm install
npm run dev          # API on :4000 + web on http://localhost:5173
```

A fresh local database also starts empty and prints a one-time setup code in the terminal. To work with a full hotel instead, load the **test data**: four months of trading, five staff accounts, 20 rooms, company accounts, and bookings past, in house and upcoming (with rooms still free to book).

```bash
npm run seed:demo    # wipes the local database, then signs you in as owner / manager / accountant / auditor / frontdesk / bar / housekeeping (password Danest@2026!)
```

To load the same test data into the **live** database (for testing on the real system), run it on the server:

```bash
railway ssh -- node --disable-warning=ExperimentalWarning server/seed.ts --production          # empty database
railway ssh -- node --disable-warning=ExperimentalWarning server/seed.ts --production --reset  # replace everything in it
```

On a live database every account gets its own random password, printed once in that terminal: share each one privately and have people change it after signing in. The hotel's public phone and email are left blank for the owner to fill in. Without `--production` it refuses; without `--reset` it never touches a database that already has accounts.

Production-style (one process serves the API and the built site on :4000):

```bash
npm run build && npm start
```

Other scripts: `npm test` (87 end-to-end API tests, including a complete real-hotel run from an empty database and Paystack and SMS flows against mock servers) and `npm run typecheck`.

Environment variables:

| Variable | Purpose |
|---|---|
| `DANEST_DB` | Path to the SQLite file (default `data/danest.db`; on Railway `/data/danest.db` on a volume) |
| `DANEST_SETUP_CODE` | One-time code for creating the owner account at `/setup`. If it isn't set, a code is generated at boot and printed to the server log |
| `DANEST_SECRET` | Key for encrypting two-factor secrets and recovery-code hashes. **Set this in production** and keep it out of the database volume. Without it, a key file is generated next to the database |
| `PAYSTACK_SECRET_KEY` | Turns on online deposits. In Paystack, set the webhook URL to `https://<your-domain>/api/paystack/webhook`. The deposit percentage is set in Settings → Payments & messages |
| `PUBLIC_URL` | The site's public address, used for Paystack's return link (on Railway, `RAILWAY_PUBLIC_DOMAIN` is used automatically) |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | Turns on SMS guest messages. Without them, staff send each message on WhatsApp with one tap |
| `RESEND_API_KEY`, `EMAIL_FROM` | Turns on email ([resend.com](https://resend.com)): booking emails to guests who give an address, an Email button on each reservation, and the owner's daily summary. `EMAIL_FROM` must be on a domain verified with Resend, e.g. `Danest Hotel <bookings@danesthotels.com>` |
| `VITE_SHOW_DEMO_LOGINS=1` | At build time, shows one-click demo accounts on the sign-in page |

Schema changes are versioned migrations in `server/db.ts` (`PRAGMA user_version`). They run automatically on start and are safe on existing data.

### Demo accounts (local demo data only)

Password for all: `Danest@2026!`. In dev builds, the sign-in page has one-click buttons for them. These accounts never exist in production.

| Username | Role | Sees |
|---|---|---|
| `owner` | Owner / CEO | Everything a manager sees, plus the executive dashboard, targets and owner accounts |
| `manager` | Manager | Everything, including costs and profit |
| `accountant` | Accountant | Accounts, purchases, suppliers, expenses, P&L, company accounts; records expenses, supplier and company payments, budgets |
| `auditor` | Auditor | Reads everything financial, the full activity trail and the team list; raises queries; changes nothing |
| `frontdesk` | Front desk | Rooms, reservations, guest payments, gym/pool/lounge takings. No profit or cost figures |
| `bar` | Bar & shop | Till and stock levels. No cost prices |
| `housekeeping` | Housekeeping | Rooms to clean and repair reports, on a phone |

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
  routes/          reservations · inventory (products/till) · purchasing (suppliers/orders/bills) · catalog (photos/upload/stock card/insights) · finance (other income/expenses/P&L/dashboard) · accounts (cash book/receivables/budgets) · review (exceptions/trail/queries/activity) · executive · team · public
  live.ts          live updates over server-sent events (topic names only, never data)
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

Built against OWASP ASVS / Top 10:2025 and verified by `npm test`:

- **Two-step sign-in.** TOTP (RFC 6238) with ±30 s drift tolerance. Each code works once (replay protection), and the second step uses a 5-minute challenge that allows 5 attempts. Eight single-use recovery codes are stored as keyed HMACs. TOTP secrets are AES-256-GCM encrypted at rest. A manager can reset two-step sign-in for a lost phone, and that reset is logged.
- **Sessions.** Each person can see their signed-in devices and sign them out. Changing a password or turning on two-step sign-in signs out every other device.

- **Access control, deny by default.** Every staff route names its allowed roles. Cost prices, P&L and expenses are manager-only. Only a manager can change a room rate or check out a guest who still owes money.
- **Sessions.** A 256-bit random token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production), scoped to `/api`. Only its SHA-256 is stored. Sessions expire after 12 hours and are revoked when a user's role or password changes.
- **Passwords.** scrypt (N=2¹⁵) with per-user salt, minimum 10 characters, constant-time compare, and the same response time for unknown users.
- **CSRF.** Every state-changing request needs a custom header and a same-origin `Origin` check.
- **Brute force.** Login is rate limited per account and per IP. Public booking requests are rate limited and have a honeypot field.
- **Injection.** All SQL is parameterised. Input is validated by allow-list on the server. Prices always come from the database, never from the till. CSV export neutralises spreadsheet formulas.
- **Headers.** Strict CSP (no inline scripts, no third-party scripts, fonts self-hosted), `frame-ancestors 'none'`, `nosniff`, a strict referrer policy, and HSTS in production. JSON bodies are capped at 50 KB. Errors never leak stack traces or SQL.
- **Audit trail.** Every security and money event is logged and searchable in Team & activity: sign-ins (including failed attempts, wrong codes and recovery-code use), payments, room charges, check-outs with a balance, date changes, room moves, stock adjustments, rate changes and deletions (with the full deleted row).
- **Least privilege.** The bar sees in-house guests' names and room numbers only, never phone numbers, balances or cost prices. Guest booking lookup needs both the reference and the phone number, and gives the same answer for either mistake.

**Before going live:**
- Change every demo password.
- Hide the demo sign-in buttons. They only appear in dev builds or when `VITE_SHOW_DEMO_LOGINS=1`.
- Run behind HTTPS (nginx or a PaaS) with `NODE_ENV=production`.
- Schedule daily off-site backups of `data/danest.db`.

## Content to confirm with the client

Room types, rates and the 20-room layout; facility prices; the drinks list; 24-hour power, Wi-Fi and parking claims; check-in and check-out times. Then add the front-desk phone number and real photography or video of the rooms, pool and lounge (the illustrations are designed to sit beside real photos).

## Workflows added in Phase 2

- **Housekeeping** (`/staff/housekeeping`): checked-out rooms appear as "to clean". A supervisor assigns them, and housekeepers mark them clean on their phones.
- **Repairs**: anyone can report a problem in a room or around the hotel. A repair can take a room out of order, and that room drops out of availability straight away. When it's fixed, the room goes back to housekeeping and any cost is booked as a repairs expense.
- **Close the day** (`/staff/close-day`): a review of no-shows, guests past their departure date, unpaid bills and dirty rooms. Every booking must be sorted first (checked in, marked no-show, extended or checked out), so no room night is ever posted to a locked day. The manager then counts the cash against what the system expects (cash refunds come out of it), and any difference must be explained. A closed day is **locked**: no payment, sale, purchase or expense can be dated on or before it. Days close in order, and reopening the latest one needs a reason that's logged.
- **Settings**: hotel details, room types and rates, rooms, and the facility price list. The website, booking engine, invoices and front desk all read from these settings.

## Roadmap — next

- Automatic pre-arrival and thank-you messages on a schedule (they're manual today).
- Emailed company statements and invoices as PDF.
- Channel manager links (Booking.com, Expedia) once the hotel lists there.
- Supplier accounts and purchase orders; payroll detail; budget versus actual.
- Multi-property support.

## Backups

Every night after 3 am (Lagos time) the app copies the whole database to a `backups` folder beside it and keeps the newest 14. Owners and managers see them under **Settings → Backups**, can take one at any time, and the owner can download one (password required, logged).

A copy on the same disk does not survive losing the disk. To also send each backup, **encrypted**, to off-site storage, set these on the server (any S3-compatible service: Cloudflare R2, Backblaze B2, AWS S3):

| Variable | Value |
|---|---|
| `BACKUP_S3_ENDPOINT` | e.g. `https://<account-id>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | the bucket name |
| `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` | an access key that can write to that bucket |
| `BACKUP_S3_REGION` | `auto` for R2 (the default); the bucket's region elsewhere |
| `BACKUP_PASSPHRASE` | encrypts the off-site copies (falls back to `DANEST_SECRET`). **Store it somewhere other than the server**: it is the only way to read them |

To restore, stop the app, then `node server/restore.ts <file>` (a `.db` from the backups folder) or `BACKUP_PASSPHRASE=… node server/restore.ts <file>.enc` (an off-site copy). It checks the backup's integrity first and keeps the current database beside it.
