/**
 * TEST DATA — ~4 months of trading for a 20-room hotel, ending today: staff accounts, rooms and
 * rates, guests, bookings (past, in house and upcoming, with rooms still free to book), bar and
 * facility sales, purchases and expenses. Deterministic (seeded PRNG) so every run is the same.
 *
 *   npm run seed:demo                                   # local database, shared password
 *   node server/seed.ts --production [--reset]          # the live database (run on the server)
 *
 * On a production database it needs --production, refuses to replace existing accounts without
 * --reset, gives every account its own random password (printed once), and leaves the hotel's
 * public phone and email blank rather than inventing them.
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.ts';
import { needsSetup } from './settings.ts';
import { all, db, get, run, tx } from './db.ts';
import { addDays, today } from './lib.ts';

const DEMO_PASSWORD = 'Danest@2026!';
export const DEMO_USERS = [
  { name: 'Mrs. Folake Adeyemi', username: 'manager', role: 'manager' },
  { name: 'Tunde Bakare', username: 'frontdesk', role: 'frontdesk' },
  { name: 'Grace Okon', username: 'bar', role: 'bar' },
  { name: 'Ibrahim Musa', username: 'frontdesk2', role: 'frontdesk' },
  { name: 'Blessing Eze', username: 'housekeeping', role: 'housekeeping' },
] as const;

const ROOM_TYPES = [
  {
    name: 'Standard Room', slug: 'standard', rate: 25000, capacity: 2, rooms: ['101', '102', '103', '104', '105', '106', '107', '108'],
    description: 'A calm, well-kept room for the business traveller — queen bed, work desk and a hot shower that actually works.',
    amenities: ['Queen bed', 'Air conditioning', 'Smart TV', 'Free Wi-Fi', '24-hour power'],
  },
  {
    name: 'Deluxe Room', slug: 'deluxe', rate: 35000, capacity: 2, rooms: ['201', '202', '203', '204', '205', '206'],
    description: 'More space to unwind, a king bed, a mini-fridge and a view over the garden.',
    amenities: ['King bed', 'Mini-fridge', 'Smart TV', 'Free Wi-Fi', 'Complimentary breakfast'],
  },
  {
    name: 'Executive Suite', slug: 'executive', rate: 55000, capacity: 3, rooms: ['301', '302', '303', '304'],
    description: 'A separate lounge area for meetings or family time, with a king bed and a bathtub.',
    amenities: ['Separate lounge', 'King bed', 'Bathtub', 'Complimentary breakfast', 'Pool & gym access'],
  },
  {
    name: 'Royal Suite', slug: 'royal', rate: 85000, capacity: 4, rooms: ['305', '306'],
    description: 'Our finest: two rooms, a private sitting room and the quietest corner of the building.',
    amenities: ['Two bedrooms', 'Private sitting room', 'Bathtub', 'Breakfast for four', 'Pool, gym & lounge access'],
  },
];

// [name, category, unit, price, cost, reorder level, daily demand weight]
const PRODUCTS: [string, 'drinks' | 'confectionery', string, number, number, number, number][] = [
  ['Star Lager 60cl', 'drinks', 'bottle', 1500, 1000, 24, 10],
  ['Gulder 60cl', 'drinks', 'bottle', 1600, 1050, 24, 7],
  ['Heineken 60cl', 'drinks', 'bottle', 1800, 1250, 24, 8],
  ['Trophy Lager', 'drinks', 'bottle', 1300, 850, 24, 5],
  ['Guinness Stout', 'drinks', 'bottle', 1800, 1200, 24, 8],
  ['Legend Extra Stout', 'drinks', 'bottle', 1700, 1150, 12, 4],
  ['Origin Bitters', 'drinks', 'bottle', 1500, 1000, 12, 4],
  ['Smirnoff Ice', 'drinks', 'bottle', 1500, 1000, 12, 4],
  ['Malta Guinness', 'drinks', 'can', 1000, 650, 24, 6],
  ['Coca-Cola 50cl', 'drinks', 'bottle', 700, 450, 24, 9],
  ['Fanta 50cl', 'drinks', 'bottle', 700, 450, 24, 6],
  ['Sprite 50cl', 'drinks', 'bottle', 700, 450, 24, 5],
  ['Eva Water 75cl', 'drinks', 'bottle', 500, 300, 36, 12],
  ['Chapman', 'drinks', 'glass', 2500, 1200, 10, 4],
  ['Hollandia Yoghurt 1L', 'drinks', 'pack', 2500, 1800, 8, 2],
  ['5 Alive Juice 1L', 'drinks', 'pack', 3000, 2100, 8, 2],
  ['Four Cousins Red', 'drinks', 'bottle', 12000, 8000, 6, 1],
  ['Jameson 70cl', 'drinks', 'bottle', 45000, 33000, 3, 0.3],
  ['Hennessy VS 70cl', 'drinks', 'bottle', 95000, 72000, 2, 0.2],
  ['Meat Pie', 'confectionery', 'piece', 1500, 900, 12, 5],
  ['Gala Sausage Roll', 'confectionery', 'pack', 500, 350, 24, 6],
  ['Doughnut', 'confectionery', 'piece', 800, 450, 12, 3],
  ['Chin Chin', 'confectionery', 'pack', 1000, 600, 12, 3],
  ['Plantain Chips', 'confectionery', 'pack', 700, 400, 12, 4],
  ['Pringles Original', 'confectionery', 'can', 4500, 3300, 6, 1],
  ['Digestive Biscuits', 'confectionery', 'pack', 1500, 1000, 8, 1.5],
  ['Kit Kat', 'confectionery', 'bar', 1500, 1000, 12, 2],
  ['Popcorn', 'confectionery', 'pack', 1000, 500, 12, 3],
];

const FIRST = ['Adewale', 'Chioma', 'Emeka', 'Funmilayo', 'Ibrahim', 'Kemi', 'Oluwaseun', 'Ngozi', 'Yusuf', 'Bisi', 'Segun', 'Amaka', 'Tolu', 'Hauwa', 'Femi', 'Zainab', 'Kunle', 'Ifeoma', 'Bayo', 'Aisha', 'Dayo', 'Nneka', 'Gbenga', 'Halima', 'Jide', 'Uche', 'Remi', 'Sade', 'Tobi', 'Efe'];
const LAST = ['Adebayo', 'Okafor', 'Balogun', 'Eze', 'Ogunleye', 'Abubakar', 'Olaniyan', 'Nwosu', 'Akinola', 'Bello', 'Oyelaran', 'Danjuma', 'Afolabi', 'Obi', 'Adeleke', 'Lawal', 'Ojo', 'Uzor', 'Salami', 'Ilori'];

// Mulberry32 — tiny deterministic PRNG.
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed(opts: { live?: boolean } = {}) {
  const rand = prng(20261016);
  const between = (a: number, b: number) => Math.floor(a + rand() * (b - a + 1));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const chance = (p: number) => rand() < p;
  const round = (n: number, to: number) => Math.round(n / to) * to;
  const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const isWeekend = (d: string) => [5, 6, 0].includes(weekday(d));
  const stamp = (d: string, h: number, m: number) => `${d} ${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`; // Lagos → UTC
  const method = () => (chance(0.45) ? 'transfer' : chance(0.6) ? 'pos' : 'cash');
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const used = new Set<string>();
  const ref = (p: string): string => {
    const r = `${p}-${Array.from({ length: 6 }, () => ALPHA[Math.floor(rand() * ALPHA.length)]).join('')}`;
    return used.has(r) ? ref(p) : (used.add(r), r);
  };

  const T = today();
  const START = addDays(T, -120);

  // Locally everyone shares the documented password; on a live database each account gets its own.
  const passwords = DEMO_USERS.map(() => (opts.live ? randomBytes(12).toString('base64url') : DEMO_PASSWORD));

  tx(() => {
    for (const t of ['messages', 'refunds', 'online_payments', 'company_payments', 'reservation_nights', 'rate_rules', 'day_closures', 'maintenance_tickets', 'housekeeping_log', 'facility_items', 'settings', 'audit_log', 'sessions', 'mfa_challenges', 'recovery_codes', 'sale_items', 'sales', 'purchase_items', 'purchases', 'payments', 'facility_income', 'reservations', 'guests', 'expenses', 'products', 'rooms', 'room_types', 'companies', 'users', 'rate_limits']) {
      db.exec(`DELETE FROM ${t}`);
    }

    const userIds = DEMO_USERS.map((u, i) => run('INSERT INTO users (name, username, role, password_hash) VALUES (?,?,?,?)', u.name, u.username, u.role, hashPassword(passwords[i])).id);
    const [managerId, deskId, barId, desk2Id] = userIds;

    // The public website never shows an invented phone number or email: on a live database these stay for the owner to fill in.
    for (const [k, v] of Object.entries({ ...(!opts.live && { phone: '0803 000 0000', email: 'frontdesk@example.com' }), highlights: [
      { title: 'Gated & secure', text: 'Guarded around the clock' },
      { title: 'Power that stays on', text: 'Generator backup, day and night' },
      { title: 'Free Wi-Fi', text: 'In every room and the lounge' },
      { title: 'Pay on arrival', text: 'Cash, transfer or POS — no card to book' },
    ] })) run('INSERT INTO settings (key, value) VALUES (?, ?)', k, JSON.stringify(v));
    for (const [f, n, p] of [
      ['gym', 'Gym day pass', 3000], ['gym', 'Gym monthly membership', 25000], ['gym', 'Personal training (4 sessions)', 40000],
      ['pool', 'Pool day pass — child', 3000], ['pool', 'Pool day pass — adult', 5000], ['pool', 'Pool party booking', 120000],
      ['lounge', 'Friday karaoke night — cover', 2000], ['lounge', 'VIP table reservation', 20000], ['lounge', 'Lounge hire — private event', 200000],
    ] as const) run('INSERT INTO facility_items (facility, name, price) VALUES (?,?,?)', f, n, p);

    // ----- rooms -----
    const rooms: { id: number; typeId: number; rate: number; number: string }[] = [];
    for (const t of ROOM_TYPES) {
      const typeId = run('INSERT INTO room_types (name, slug, rate, capacity, description, amenities) VALUES (?,?,?,?,?,?)', t.name, t.slug, t.rate, t.capacity, t.description, JSON.stringify(t.amenities)).id;
      for (const n of t.rooms) rooms.push({ id: run('INSERT INTO rooms (number, room_type_id, floor) VALUES (?,?,?)', n, typeId, Number(n[0])).id, typeId, rate: t.rate, number: n });
    }

    // ----- reservations: walk each room's calendar -----
    const guestName = () => `${pick(FIRST)} ${pick(LAST)}`;
    const phone = () => `080${between(1, 9)}${String(between(0, 9999999)).padStart(7, '0')}`;
    const ID_KINDS = ['nin', 'nin', 'nin', 'drivers_licence', 'passport', 'voters_card'] as const;
    const insertGuest = (name: string) => {
      const hasId = chance(0.75);
      const kind = pick(ID_KINDS);
      const idNo = kind === 'nin' ? String(between(10000000000, 99999999999)) : kind === 'passport' ? `B${between(10000000, 99999999)}` : `${pick(['OY', 'LA', 'AB', 'FC'])}${between(100000, 999999)}`;
      return run(
        'INSERT INTO guests (name, phone, email, id_type, id_number, address) VALUES (?,?,?,?,?,?)',
        name, phone(), chance(0.5) ? `${name.split(' ')[0].toLowerCase()}${between(1, 99)}@gmail.com` : null,
        hasId ? kind : null, hasId ? idNo : null, hasId ? pick(['Bodija, Ibadan', 'Ikeja, Lagos', 'Wuse II, Abuja', 'Ring Road, Ibadan', 'Akure, Ondo', 'Lekki, Lagos', 'Osogbo, Osun']) : null,
      ).id;
    };
    // Hotels live on repeat business: about a third of stays are returning guests.
    const regulars: number[] = [];
    const guestFor = () => {
      if (regulars.length > 8 && chance(0.32)) return pick(regulars);
      const id = insertGuest(guestName());
      if (chance(0.25)) regulars.push(id);
      return id;
    };
    const stays: { id: number; checkIn: string; checkOut: string; status: string }[] = [];
    const pay = (resId: number, amount: number, date: string, by: number) => {
      if (amount > 0) run('INSERT INTO payments (reservation_id, amount, method, date, received_by) VALUES (?,?,?,?,?)', resId, amount, method(), date, by);
    };
    const maintenanceRoom = rooms.find((r) => r.number === '104')!;

    for (const room of rooms) {
      let d = addDays(START, between(0, 3));
      while (d < addDays(T, 30)) {
        const nights = pick([1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 7]);
        const checkOut = addDays(d, nights);
        const future = d > T;
        if (future && (chance(0.55) || room === maintenanceRoom)) {
          d = addDays(checkOut, between(1, 4));
          continue;
        }
        const guestId = guestFor();
        const source = future ? pick(['phone', 'phone', 'website'] as const) : pick(['walk_in', 'walk_in', 'phone', 'phone', 'website'] as const);
        const status = checkOut <= T && !(checkOut === T && chance(0.4)) ? (chance(0.04) ? 'cancelled' : 'checked_out') : d <= T ? 'checked_in' : 'confirmed';
        if (room === maintenanceRoom && status === 'checked_in') {
          d = checkOut;
          continue;
        }
        const total = room.rate * nights;
        const by = chance(0.6) ? deskId : desk2Id;
        const created = stamp(addDays(d, source === 'walk_in' ? 0 : -between(1, 10)), between(8, 20), between(0, 59));
        const resId = run(
          `INSERT INTO reservations (code, guest_id, room_type_id, room_id, check_in, check_out, nights, rate, total, adults, status, source, created_by, created_at, checked_in_at, checked_out_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ref('DH'), guestId, room.typeId, room.id, d, checkOut, nights, room.rate, total, between(1, 2), status, source, by, created,
          status === 'checked_in' || status === 'checked_out' ? stamp(d, between(13, 21), between(0, 59)).replace(' ', 'T') + '.000Z' : null,
          status === 'checked_out' ? stamp(checkOut, between(9, 12), between(0, 59)).replace(' ', 'T') + '.000Z' : null,
        ).id;
        if (status === 'checked_in' || status === 'checked_out') stays.push({ id: resId, checkIn: d, checkOut, status });
        if (status === 'checked_out') {
          if (chance(0.65)) pay(resId, total, d, by);
          else {
            const dep = round(total * 0.5, 1000);
            pay(resId, dep, d, by);
            pay(resId, total - dep, checkOut, by);
          }
        } else if (status === 'checked_in') {
          // Most in-house guests have paid; a few owe — that's what the balance alerts are for.
          pay(resId, chance(0.7) ? total : round(total * 0.5, 1000), d, by);
          run("UPDATE rooms SET status = 'occupied' WHERE id = ?", room.id);
        } else if (status === 'confirmed' && chance(0.4)) {
          const payDay = addDays(d, -between(1, 7));
          pay(resId, round(room.rate * 0.5, 1000), payDay < T ? payDay : T, by);
        }
        // A guest still in house (even one leaving today) owns the room until after today.
        d = addDays(checkOut, status === 'checked_in' ? between(1, 3) : chance(0.2) ? 0 : between(1, 4));
      }
    }
    // ----- company accounts: local firms that put their staff up on account -----
    // A separate random sequence, so the rest of the data (which the tests rely on) is unchanged.
    const crand = prng(4242);
    const companyIds = (
      [
        ['Westgate Engineering Services Ltd', 'Mrs. Adunni Coker', 'Ring Road, Ibadan', 10, 1_000_000],
        ['Bodija Agro Ventures Ltd', 'Mr. Sola Ajayi', 'Bodija Market Road, Ibadan', 5, 500_000],
        ['Crestline Pharmaceuticals Ltd', 'Accounts Department', 'Oluyole Estate, Ibadan', 15, 2_000_000],
      ] as const
    ).map(([name, contact, address, discount, limit]) =>
      run('INSERT INTO companies (name, contact_name, address, discount_pct, credit_limit) VALUES (?,?,?,?,?)', name, contact, address, discount, limit).id,
    );
    for (const x of stays) {
      if (crand() >= 0.12) continue;
      const companyId = companyIds[Math.floor(crand() * companyIds.length)];
      run('UPDATE reservations SET company_id = ?, bill_to_company = 1 WHERE id = ?', companyId, x.id);
      if (x.status === 'checked_out') {
        // The guest didn't pay at the desk: the room bill moved to the company's account at check-out.
        const total = get<{ total: number }>('SELECT total FROM reservations WHERE id = ?', x.id)!.total;
        run('DELETE FROM payments WHERE reservation_id = ?', x.id);
        run("INSERT INTO payments (reservation_id, amount, method, date, received_by) VALUES (?,?, 'company', ?, ?)", x.id, total, x.checkOut, deskId);
      }
    }
    // Companies settle what was billed more than two weeks ago, by bank transfer.
    for (const c of companyIds) {
      const due = get<{ v: number }>(
        "SELECT COALESCE(SUM(p.amount), 0) v FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.method = 'company' AND r.company_id = ? AND p.date < ?",
        c, addDays(T, -14),
      )!.v;
      if (due > 0) run("INSERT INTO company_payments (company_id, amount, method, reference, date, received_by) VALUES (?,?, 'transfer', ?, ?, ?)", c, due, `TRF-${String(c).padStart(4, '0')}`, addDays(T, -1 - Math.floor(crand() * 9)), managerId);
    }

    run("UPDATE rooms SET status = 'maintenance' WHERE id = ?", maintenanceRoom.id);
    // Two rooms turned over this morning are still being cleaned.
    for (const r of rooms.filter((r) => r !== maintenanceRoom && !get("SELECT 1 FROM reservations WHERE room_id = ? AND status = 'checked_in'", r.id)).slice(0, 2)) {
      run("UPDATE rooms SET status = 'cleaning' WHERE id = ?", r.id);
    }

    // Fresh website requests waiting for the front desk.
    for (let i = 0; i < 3; i++) {
      const t = pick(ROOM_TYPES);
      const typeId = get<{ id: number }>('SELECT id FROM room_types WHERE slug = ?', t.slug)!.id;
      const ci = addDays(T, between(i === 0 ? 0 : 2, 14));
      const n = between(1, 3);
      run(
        `INSERT INTO reservations (code, guest_id, room_type_id, check_in, check_out, nights, rate, total, adults, status, source, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'pending', 'website', ?, ?)`,
        ref('DH'), insertGuest(guestName()), typeId, ci, addDays(ci, n), n, t.rate, t.rate * n, between(1, 2),
        pick(['Arriving late, around 9pm', 'Please a quiet room', null, 'Need airport pickup from Ibadan airport']), stamp(T, between(6, 9), between(0, 59)),
      );
    }

    // ----- products, purchases & sales -----
    const products = PRODUCTS.map(([name, category, unit, price, cost, reorder, weight]) => ({
      id: run('INSERT INTO products (name, category, unit, price, avg_cost, stock, reorder_level) VALUES (?,?,?,?,?,0,?)', name, category, unit, price, cost, reorder).id,
      price, baseCost: cost, reorder, weight, stock: 0, avg: cost,
    }));
    const totalWeight = products.reduce((a, p) => a + p.weight, 0);
    const suppliers = ['Bodija Drinks Depot', 'Nigerian Breweries — Ibadan distributor', 'Guinness Nig. — Oyo dealer', 'Mama Titi Snacks', 'Dugbe Wholesale Mart'];

    const restock = (date: string, full: boolean) => {
      const inflation = 1 + (0.06 * (Date.parse(date) - Date.parse(START))) / (120 * 86_400_000);
      const lines = products
        .map((p) => ({ p, qty: Math.max(0, p.reorder * (full ? 4 : 3) - p.stock), cost: round(p.baseCost * inflation, 10) }))
        .filter((l) => l.qty > (full ? 0 : l.p.reorder));
      if (!lines.length) return;
      for (const [s, group] of [[suppliers[0], lines.filter((l) => l.p.price < 10000 && l.p.weight >= 4)], [suppliers[4], lines.filter((l) => l.p.price >= 10000 || l.p.weight < 4)]] as const) {
        if (!group.length) continue;
        const total = group.reduce((a, l) => a + l.qty * l.cost, 0);
        const pid = run('INSERT INTO purchases (ref, supplier, date, total, recorded_by, created_at) VALUES (?,?,?,?,?,?)', ref('PO'), s, date, total, managerId, stamp(date, 10, 15)).id;
        for (const l of group) {
          l.p.avg = Math.round((l.p.stock * l.p.avg + l.qty * l.cost) / (l.p.stock + l.qty));
          l.p.stock += l.qty;
          run('INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost) VALUES (?,?,?,?)', pid, l.p.id, l.qty, l.cost);
        }
      }
    };

    const inHouseOn = (d: string) => {
      const here = stays.filter((x) => x.checkIn <= d && x.checkOut > d);
      return here.length ? pick(here).id : null;
    };

    const pickProduct = () => {
      let x = rand() * totalWeight;
      for (const p of products) if ((x -= p.weight) <= 0) return p;
      return products[0];
    };

    for (let d = START; d <= T; d = addDays(d, 1)) {
      if (d === START || (weekday(d) === 1 && d < addDays(T, -5))) restock(d, true);
      else if (weekday(d) === 4 && d < addDays(T, -3)) restock(d, false);

      // ----- bar & shop -----
      const tickets = between(isWeekend(d) ? 26 : 14, isWeekend(d) ? 45 : 28) * (d === T ? 0.45 : 1);
      for (let i = 0; i < tickets; i++) {
        const basket = new Map<(typeof products)[number], number>();
        for (let k = between(1, 3); k > 0; k--) {
          const p = pickProduct();
          const q = between(1, p.price > 10000 ? 1 : 3);
          if (p.stock - (basket.get(p) ?? 0) >= q) basket.set(p, (basket.get(p) ?? 0) + q);
        }
        if (!basket.size) continue;
        let total = 0;
        let cost = 0;
        for (const [p, q] of basket) {
          total += p.price * q;
          cost += p.avg * q;
        }
        const hour = d === T ? between(9, 12) : between(10, 23);
        const guest = chance(0.14) ? inHouseOn(d) : null;
        const saleId = run(
          'INSERT INTO sales (receipt_no, date, method, reservation_id, total, cost_total, staff_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
          ref('RC'), d, guest ? 'room' : method(), guest, total, cost, barId, stamp(d, hour, between(0, 59)),
        ).id;
        for (const [p, q] of basket) {
          run('INSERT INTO sale_items (sale_id, product_id, qty, unit_price, unit_cost) VALUES (?,?,?,?,?)', saleId, p.id, q, p.price, p.avg);
          p.stock -= q;
        }
      }

      // ----- gym, pool, lounge -----
      const fac = (facility: string, item: string, amount: number, customer: string | null = null) => {
        // Hotel guests often put the pool or gym on their room bill.
        const guest = !customer && facility !== 'lounge' && chance(0.25) ? inHouseOn(d) : null;
        run(
          'INSERT INTO facility_income (facility, item, customer, amount, method, reservation_id, date, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          facility, item, customer, amount, guest ? 'room' : method(), guest, d, deskId, stamp(d, between(8, 20), between(0, 59)),
        );
      };
      const scale = d === T ? 0.5 : 1;
      for (let i = between(1, 5) * scale; i > 0; i--) fac('gym', 'Gym day pass', 3000);
      if (chance(0.18)) fac('gym', 'Gym monthly membership', 25000, guestName());
      if (chance(0.05)) fac('gym', 'Personal training (4 sessions)', 40000, guestName());
      for (let i = between(isWeekend(d) ? 6 : 1, isWeekend(d) ? 16 : 5) * scale; i > 0; i--) fac('pool', chance(0.7) ? 'Pool day pass — adult' : 'Pool day pass — child', chance(0.7) ? 5000 : 3000);
      if (weekday(d) === 6 && chance(0.35)) fac('pool', 'Pool party booking', 120000, guestName());
      if (isWeekend(d)) for (let i = between(1, 4) * scale; i > 0; i--) fac('lounge', 'VIP table reservation', pick([15000, 20000, 30000]));
      if (weekday(d) === 6 && chance(0.3)) fac('lounge', 'Lounge hire — private event', pick([150000, 200000, 250000]), guestName());
      if (weekday(d) === 5 && d !== T) fac('lounge', 'Friday karaoke night — cover', between(8, 20) * 2000);

      // ----- expenses -----
      const exp = (category: string, description: string, amount: number, paidTo: string | null = null) =>
        run('INSERT INTO expenses (date, category, description, paid_to, amount, method, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?)', d, category, description, paidTo, amount, chance(0.7) ? 'transfer' : 'cash', managerId, stamp(d, between(9, 17), between(0, 59)));
      const dom = Number(d.slice(8));
      if (d === T) continue;
      if (dom === 1) {
        // Paid in arrears for the month just ended.
        const month = new Date(`${addDays(d, -1)}T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
        exp('salaries', `${month} payroll — 18 staff`, 1_840_000, 'Staff payroll');
        exp('security', `Security guards — ${month} contract`, 260_000, 'Eagle Eye Guards Ltd');
      }
      if (dom % 3 === 0) exp('diesel', `Diesel ${between(150, 220)} litres`, round(between(150, 220) * 1300, 1000), 'Bodija filling station');
      if (weekday(d) === 2) exp('electricity', 'Prepaid electricity units (IBEDC)', round(between(80_000, 120_000), 5000), 'IBEDC');
      if (chance(0.12)) exp('repairs', pick(['Generator servicing', 'AC gas refill — room ' + pick(rooms).number, 'Plumbing repair', 'Replace bulbs & sockets', 'Fix water heater', 'Door lock replacement']), round(between(15_000, 160_000), 1000), pick(['Kola Electricals', 'Baba Sule Plumbing', 'CoolAir Services', 'Generator Doctor']));
      if (weekday(d) === 3) exp('housekeeping', 'Toiletries, detergent & laundry', round(between(45_000, 85_000), 1000), 'Dugbe Wholesale Mart');
      if (dom === 5) exp('pool_gym', 'Pool chlorine & testing kit', 65_000, 'AquaClean Ibadan');
      if (dom === 15) exp('pool_gym', 'Gym equipment servicing', 35_000);
      if (dom === 10) exp('water', 'Borehole treatment & water tanker', 45_000, 'Clearwater Services');
      if (chance(0.08)) exp('other', pick(['Printing & stationery', 'Internet subscription', 'Waste disposal (PSP)', 'Bank charges', 'Fumigation']), round(between(8_000, 60_000), 500));
    }

    for (const p of products) run('UPDATE products SET stock = ?, avg_cost = ? WHERE id = ?', p.stock, p.avg, p.id);

    // Every stay is priced per night (demo stays were sold at a flat rate).
    db.exec(`INSERT INTO reservation_nights (reservation_id, date, rate)
      WITH RECURSIVE n(id, d, out, rate) AS (
        SELECT id, check_in, check_out, rate FROM reservations
        UNION ALL SELECT id, date(d, '+1 day'), out, rate FROM n WHERE date(d, '+1 day') < out)
      SELECT id, d, rate FROM n`);

    // Departed guests settled their bar and pool charges at check-out.
    for (const x of stays.filter((x) => x.status === 'checked_out')) {
      const charges = get<{ v: number }>(
        'SELECT COALESCE((SELECT SUM(total) FROM sales WHERE reservation_id = ?1),0) + COALESCE((SELECT SUM(amount) FROM facility_income WHERE reservation_id = ?1),0) v',
        x.id,
      )!.v;
      if (charges > 0) run('INSERT INTO payments (reservation_id, amount, method, date, received_by) VALUES (?,?,?,?,?)', x.id, charges, method(), x.checkOut, deskId);
    }

    // The best customers become VIPs, with the kind of notes a good front desk keeps.
    const top = all<{ id: number }>(
      `SELECT g.id FROM guests g JOIN reservations r ON r.guest_id = g.id WHERE r.status IN ('checked_in','checked_out')
        GROUP BY g.id ORDER BY SUM(r.total) DESC LIMIT 6`,
    );
    const NOTES = ['Prefers a ground-floor room', 'Likes extra pillows; early riser', 'Corporate guest — sends company invoice', 'Always asks for room 302 if free', 'Allergic to groundnuts — tell the kitchen', 'Celebrates anniversary in December'];
    top.forEach((g, i) => run('UPDATE guests SET vip = 1, notes = ? WHERE id = ?', NOTES[i], g.id));
    run("INSERT INTO audit_log (user_id, action, entity, detail) VALUES (?, 'seed', 'system', ?)", managerId, JSON.stringify({ from: START, to: T }));
  });

  return { password: DEMO_PASSWORD, users: DEMO_USERS.map((u, i) => ({ ...u, password: passwords[i] })) };
}

if (import.meta.main || process.argv[1]?.endsWith('seed.ts')) {
  const args = process.argv.slice(2);
  const live = process.env.NODE_ENV === 'production';
  if (live && !args.includes('--production')) {
    console.error('This is a production database. To load the test data into it, run with --production.');
    process.exit(1);
  }
  if (!needsSetup() && !args.includes('--reset')) {
    console.error('This database already has accounts. Add --reset to wipe everything in it and load the test data.');
    process.exit(1);
  }
  const r = seed({ live });
  if (live) {
    console.log('Test data loaded. Each account has its own password, shown only now. Share each one privately:');
    for (const u of r.users) console.log(`  ${u.role.padEnd(13)} ${u.username.padEnd(13)} ${u.password}   (${u.name})`);
    console.log('Ask everyone to change their password under "Password & security" after signing in.');
  } else {
    console.log(`Demo data loaded. Sign in as ${r.users.map((u) => u.username).join(' / ')} with password ${r.password}`);
  }
}
