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
| **Light, dark or automatic** | Follows the phone or computer's setting by default; anyone can pick Light, Dark or Match device from the header. Printed invoices are always dark ink on white. Every screen is laid out for phones, tablets and desktops, and an open reservation or guest has its own link (shareable, survives a refresh, closed by the back gesture) |

---

## Going live for a real hotel

The live system **starts empty**: no sample bookings, no sample sales, and no invented staff. Every number on every report is the hotel's real business.

1. Deploy, setting `DANEST_SECRET` and `DANEST_SETUP_CODE` (both long random strings).
2. Open `/setup`, enter the setup code, and create the **owner's account with their real name**. Setup then closes permanently.
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

A fresh local database also starts empty and prints a one-time setup code in the terminal. To explore with sample data instead, load the **demo data**. This is for development only. It invents four months of trading and fictional staff, and it refuses to run when `NODE_ENV=production`.

```bash
npm run seed:demo    # wipes the local database, then signs you in as manager / frontdesk / bar / housekeeping (password Danest@2026!)
```

Production-style (one process serves the API and the built site on :4000):

```bash
npm run build && npm start
```

Other scripts: `npm test` (64 end-to-end API tests, including a complete real-hotel run from an empty database and Paystack and SMS flows against mock servers) and `npm run typecheck`.

Environment variables:

| Variable | Purpose |
|---|---|
| `DANEST_DB` | Path to the SQLite file (default `data/danest.db`; on Railway `/data/danest.db` on a volume) |
| `DANEST_SETUP_CODE` | One-time code for creating the owner account at `/setup`. If it isn't set, a code is generated at boot and printed to the server log |
| `DANEST_SECRET` | Key for encrypting two-factor secrets and recovery-code hashes. **Set this in production** and keep it out of the database volume. Without it, a key file is generated next to the database |
| `PAYSTACK_SECRET_KEY` | Turns on online deposits. In Paystack, set the webhook URL to `https://<your-domain>/api/paystack/webhook`. The deposit percentage is set in Settings → Payments & messages |
| `PUBLIC_URL` | The site's public address, used for Paystack's return link (on Railway, `RAILWAY_PUBLIC_DOMAIN` is used automatically) |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | Turns on SMS guest messages. Without them, staff send each message on WhatsApp with one tap |
| `VITE_SHOW_DEMO_LOGINS=1` | At build time, shows one-click demo accounts on the sign-in page |

Schema changes are versioned migrations in `server/db.ts` (`PRAGMA user_version`). They run automatically on start and are safe on existing data.

### Demo accounts (local demo data only)

Password for all: `Danest@2026!`. In dev builds, the sign-in page has one-click buttons for them. These accounts never exist in production.

| Username | Role | Sees |
|---|---|---|
| `manager` | Manager / owner | Everything, including costs and profit |
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
