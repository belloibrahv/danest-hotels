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
import { dayReport } from './routes/closeday.ts';

const DEMO_PASSWORD = 'Danest@2026!';
export const DEMO_USERS = [
  { name: 'Mrs. Folake Adeyemi', username: 'manager', role: 'manager' },
  { name: 'Tunde Bakare', username: 'frontdesk', role: 'frontdesk' },
  { name: 'Grace Okon', username: 'bar', role: 'bar' },
  { name: 'Ibrahim Musa', username: 'frontdesk2', role: 'frontdesk' },
  { name: 'Blessing Eze', username: 'housekeeping', role: 'housekeeping' },
  { name: 'Chief Adebayo Danesi', username: 'owner', role: 'ceo' },
  { name: 'Mrs. Ronke Alabi', username: 'accountant', role: 'accountant' },
  { name: 'Mr. Chinedu Okeke', username: 'auditor', role: 'auditor' },
  { name: 'Kemi Adeyinka', username: 'kitchen', role: 'kitchen' },
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

// The kitchen's menu: made to order, so no stock count; [name, price, food cost per plate]
const MENU: [string, number, number][] = [
  ['Jollof rice & chicken', 4500, 2200],
  ['Fried rice & turkey', 5500, 2800],
  ['Pounded yam & egusi', 5000, 2300],
  ['Amala & ewedu with beef', 4000, 1800],
  ['Peppered goat meat', 3500, 1700],
  ['Chicken suya platter', 6000, 3000],
  ['Full English breakfast', 4500, 2000],
];

// 18 staff whose pay adds up to the ₦1,840,000 monthly payroll in the test data. [name, position, department, salary, username]
const STAFF: [string, string, string, number, string | null][] = [
  ['Mrs. Folake Adeyemi', 'General manager', 'management', 350000, 'manager'],
  ['Mrs. Ronke Alabi', 'Accountant', 'management', 200000, 'accountant'],
  ['Tunde Bakare', 'Front desk officer', 'front_office', 100000, 'frontdesk'],
  ['Ibrahim Musa', 'Front desk officer', 'front_office', 100000, 'frontdesk2'],
  ['Sade Ogunleye', 'Night auditor / front desk', 'front_office', 100000, null],
  ['Grace Okon', 'Bar attendant', 'bar', 80000, 'bar'],
  ['Femi Lawal', 'Bar attendant', 'bar', 80000, null],
  ['Kemi Adeyinka', 'Cook', 'kitchen', 130000, 'kitchen'],
  ['Ifeoma Nwosu', 'Kitchen assistant', 'kitchen', 70000, null],
  ['Blessing Eze', 'Housekeeper', 'housekeeping', 60000, 'housekeeping'],
  ['Halima Bello', 'Housekeeper', 'housekeeping', 60000, null],
  ['Nneka Obi', 'Housekeeper', 'housekeeping', 60000, null],
  ['Zainab Salami', 'Housekeeper', 'housekeeping', 60000, null],
  ['Musa Danjuma', 'Security guard', 'security', 70000, null],
  ['Kunle Ojo', 'Security guard', 'security', 70000, null],
  ['Jide Afolabi', 'Maintenance technician', 'maintenance', 120000, null],
  ['Tobi Akinola', 'Pool & gym attendant', 'facilities', 70000, null],
  ['Efe Uzor', 'Laundry attendant', 'housekeeping', 60000, null],
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
    for (const t of ['shifts', 'pay_lines', 'pay_runs', 'employees', 'audit_queries', 'targets', 'supplier_payments', 'product_images', 'messages', 'refunds', 'online_payments', 'company_payments', 'reservation_nights', 'rate_rules', 'day_closures', 'maintenance_tickets', 'housekeeping_log', 'facility_items', 'settings', 'audit_log', 'sessions', 'mfa_challenges', 'recovery_codes', 'sale_items', 'sales', 'purchase_items', 'purchases', 'payments', 'facility_income', 'reservations', 'guests', 'expenses', 'products', 'suppliers', 'rooms', 'room_types', 'companies', 'users', 'rate_limits']) {
      db.exec(`DELETE FROM ${t}`);
    }

    const userIds = DEMO_USERS.map((u, i) => run('INSERT INTO users (name, username, role, password_hash) VALUES (?,?,?,?)', u.name, u.username, u.role, hashPassword(passwords[i])).id);
    const [managerId, deskId, barId, desk2Id, , ownerId, accountantId, auditorId] = userIds;
    const userByName = new Map(DEMO_USERS.map((u, i) => [u.username, userIds[i]] as const));
    const staff = STAFF.map(([name, position, department, salary, username]) => ({
      id: run(
        'INSERT INTO employees (name, position, department, phone, bank_name, account_number, start_date, monthly_salary, pension, user_id) VALUES (?,?,?,?,?,?,?,?,1,?)',
        name, position, department, `080${String(31000000 + name.length * 7919).slice(0, 8)}`, pick(['GTBank', 'Access Bank', 'First Bank', 'UBA', 'Zenith Bank', 'Opay']),
        String(1000000000 + name.length * 104729).slice(0, 10), addDays(T, -between(200, 1500)), salary, username ? userByName.get(username as never) ?? null : null,
      ).id,
      salary,
    }));

    // The public website never shows an invented phone number or email: on a live database these stay for the owner to fill in.
    for (const [k, v] of Object.entries({
      ...(!opts.live && { phone: '0803 000 0000', email: 'frontdesk@example.com' }),
      // The test data is Danest's: its name, place, wording and the crest that ships with the app.
      name: 'Danest Hotel & Suites', short_name: 'Danest', tagline: 'Experience a great comfort',
      address: '4, Beckley Street, off Adeyi-Estate, Old Bodija Road, Ibadan, Oyo State', location_label: 'Old Bodija · Ibadan',
      hero_title: 'Rest easy in the heart of Bodija.', hero_text: 'Comfortable rooms and suites, a pool, a gym and a lounge, all inside one gated compound. Book directly with the hotel.',
      location_title: 'On a quiet street off Old Bodija Road.', builtin_brand: true,
      highlights: [
      { title: 'Gated & secure', text: 'Guarded around the clock' },
      { title: 'Power that stays on', text: 'Generator backup, day and night' },
      { title: 'Free Wi-Fi', text: 'In every room and the lounge' },
      { title: 'Pay on arrival', text: 'Cash, transfer or POS — no card to book' },
    ] })) run('INSERT INTO settings (key, value) VALUES (?, ?)', k, JSON.stringify(v));
    for (const [f, n, p] of [
      ['gym', 'Gym day pass', 3000], ['gym', 'Gym monthly membership', 25000], ['gym', 'Personal training (4 sessions)', 40000],
      ['pool', 'Pool day pass — child', 3000], ['pool', 'Pool day pass — adult', 5000], ['pool', 'Pool party booking', 120000],
      ['lounge', 'Friday karaoke night — cover', 2000], ['lounge', 'VIP table reservation', 20000], ['lounge', 'Lounge hire — private event', 200000],
      ['laundry', 'Laundry — 5 pieces', 2500], ['laundry', 'Laundry — suit, dry clean', 4000], ['room_service', 'Room service delivery', 1000],
      ['transport', 'Airport pickup (Ibadan)', 15000], ['extras', 'Extra bed per night', 7500],
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
    // Bodija sells on 14 days' credit; Dugbe is paid on delivery.
    const SUPPLIERS: [string, string, string, number][] = [
      ['Bodija Drinks Depot', 'Alhaji Lateef', '0803 111 2201', 14],
      ['Nigerian Breweries — Ibadan distributor', 'Mr. Femi Oke', '0805 221 3302', 30],
      ['Guinness Nig. — Oyo dealer', 'Mrs. Kemi Ade', '0807 331 4403', 21],
      ['Mama Titi Snacks', 'Mama Titi', '0809 441 5504', 0],
      ['Dugbe Wholesale Mart', 'Sales desk', '0802 551 6605', 0],
    ];
    const supplierIds = SUPPLIERS.map(([name, contact, phone, terms]) => run('INSERT INTO suppliers (name, contact_name, phone, terms_days) VALUES (?,?,?,?)', name, contact, phone, terms).id);
    const suppliers = SUPPLIERS.map((s) => s[0]);
    const products = PRODUCTS.map(([name, category, unit, price, cost, reorder, weight], i) => ({
      id: run(
        'INSERT INTO products (name, category, unit, price, avg_cost, stock, reorder_level, sku, barcode, supplier_id) VALUES (?,?,?,?,?,0,?,?,?,?)',
        name, category, unit, price, cost, reorder, `${category === 'drinks' ? 'DRK' : 'SNK'}-${String(i + 1).padStart(3, '0')}`,
        // Nigerian EAN-13 prefix (615) with a stable item number; check digit left off, as many local labels do.
        `615${String(1000000000 + i * 7919).slice(0, 9)}`, supplierIds[price < 10000 && weight >= 4 ? 0 : 4],
      ).id,
      price, baseCost: cost, reorder, weight, stock: 0, avg: cost,
    }));
    const totalWeight = products.reduce((a, p) => a + p.weight, 0);
    const menu = MENU.map(([name, price, cost], i) => ({
      id: run("INSERT INTO products (name, category, unit, price, avg_cost, stock, reorder_level, track_stock, sku) VALUES (?, 'food', 'plate', ?, ?, 0, 0, 0, ?)", name, price, cost, `FD-${String(i + 1).padStart(3, '0')}`).id,
      price, cost,
    }));
    const credit: { id: number; total: number; date: string }[] = [];

    const restock = (date: string, full: boolean) => {
      const inflation = 1 + (0.06 * (Date.parse(date) - Date.parse(START))) / (120 * 86_400_000);
      const lines = products
        .map((p) => ({ p, qty: Math.max(0, p.reorder * (full ? 4 : 3) - p.stock), cost: round(p.baseCost * inflation, 10) }))
        .filter((l) => l.qty > (full ? 0 : l.p.reorder));
      if (!lines.length) return;
      for (const [s, group] of [[suppliers[0], lines.filter((l) => l.p.price < 10000 && l.p.weight >= 4)], [suppliers[4], lines.filter((l) => l.p.price >= 10000 || l.p.weight < 4)]] as const) {
        if (!group.length) continue;
        const total = group.reduce((a, l) => a + l.qty * l.cost, 0);
        const onCredit = s === suppliers[0];
        const pid = run(
          `INSERT INTO purchases (ref, supplier, supplier_id, date, total, recorded_by, created_at, status, terms, due_date, invoice_no, received_at, received_by)
           VALUES (?,?,?,?,?,?,?, 'received', ?,?,?,?,?)`,
          ref('PO'), s, supplierIds[suppliers.indexOf(s)], date, total, managerId, stamp(date, 10, 15), onCredit ? 'credit' : method(), onCredit ? addDays(date, 14) : null,
          `INV-${between(10000, 99999)}`, stamp(date, 10, 15), managerId,
        ).id;
        if (onCredit) credit.push({ id: pid, total, date });
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

      // ----- kitchen: lunch and dinner orders, some to rooms -----
      for (let i = between(isWeekend(d) ? 8 : 4, isWeekend(d) ? 16 : 9) * (d === T ? 0.4 : 1); i > 0; i--) {
        const dish = pick(menu);
        const qty = between(1, 2);
        const guest = chance(0.3) ? inHouseOn(d) : null;
        const hour = d === T ? between(8, 12) : pick([8, 13, 13, 14, 19, 19, 20, 21]);
        // Today's orders are still moving through the kitchen; past ones were served.
        const status = d === T ? pick(['new', 'preparing', 'ready', 'served', 'served']) : 'served';
        const saleId = run(
          'INSERT INTO sales (receipt_no, date, method, reservation_id, total, cost_total, staff_id, created_at, kitchen_status, kitchen_note, ready_at, served_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          ref('RC'), d, guest ? 'room' : method(), guest, dish.price * qty, dish.cost * qty, barId, stamp(d, hour, between(0, 59)), status,
          guest ? null : pick(['Table 2', 'Table 5', 'Poolside', 'Takeaway', 'Lounge']), status === 'ready' || status === 'served' ? stamp(d, hour, 59) : null, status === 'served' ? stamp(d, hour, 59) : null,
        ).id;
        run('INSERT INTO sale_items (sale_id, product_id, qty, unit_price, unit_cost) VALUES (?,?,?,?,?)', saleId, dish.id, qty, dish.price, dish.cost);
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
      // Services go on the guest's bill.
      for (let i = between(0, 3) * scale; i > 0; i--) {
        const guest = inHouseOn(d);
        if (!guest) break;
        const [service, item, amount] = pick([['laundry', 'Laundry — 5 pieces', 2500], ['laundry', 'Laundry — suit, dry clean', 4000], ['room_service', 'Room service delivery', 1000], ['transport', 'Airport pickup (Ibadan)', 15000]] as const);
        run('INSERT INTO facility_income (facility, item, amount, method, reservation_id, date, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?)', service, item, amount, 'room', guest, d, deskId, stamp(d, between(8, 20), between(0, 59)));
      }

      // ----- expenses -----
      const exp = (category: string, description: string, amount: number, paidTo: string | null = null) =>
        run('INSERT INTO expenses (date, category, description, paid_to, amount, method, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?)', d, category, description, paidTo, amount, chance(0.7) ? 'transfer' : 'cash', managerId, stamp(d, between(9, 17), between(0, 59)));
      const dom = Number(d.slice(8));
      if (d === T) continue;
      if (dom === 1) {
        // Paid in arrears for the month just ended.
        const month = new Date(`${addDays(d, -1)}T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
        const payExpense = exp('salaries', `${month} payroll — 18 staff`, 1_840_000, 'Staff payroll').id;
        // The same payroll as a pay run, so payslips exist for it (test figures: pension 8%, PAYE as a flat 5%).
        const runId = run("INSERT INTO pay_runs (month, status, created_by, approved_by, approved_at, paid_by, paid_on, method, expense_id) VALUES (?, 'paid', ?, ?, ?, ?, ?, 'transfer', ?)",
          addDays(d, -1).slice(0, 7), accountantId, ownerId, stamp(addDays(d, -1), 16, 0), accountantId, d, payExpense).id;
        for (const e of staff) run('INSERT INTO pay_lines (pay_run_id, employee_id, basic, pension, paye) VALUES (?,?,?,?,?)', runId, e.id, e.salary, Math.round(e.salary * 0.08), Math.round(e.salary * 0.05));
        exp('security', `Security guards — ${month} contract`, 260_000, 'Eagle Eye Guards Ltd');
      }
      if (dom % 3 === 0) exp('diesel', `Diesel ${between(150, 220)} litres`, round(between(150, 220) * 1300, 1000), 'Bodija filling station');
      if (weekday(d) === 2) exp('electricity', 'Prepaid electricity units (IBEDC)', round(between(80_000, 120_000), 5000), 'IBEDC');
      if (chance(0.12)) exp('repairs', pick(['Generator servicing', 'AC gas refill — room ' + pick(rooms).number, 'Plumbing repair', 'Replace bulbs & sockets', 'Fix water heater', 'Door lock replacement']), round(between(15_000, 160_000), 1000), pick(['Kola Electricals', 'Baba Sule Plumbing', 'CoolAir Services', 'Generator Doctor']));
      if (weekday(d) === 1 || weekday(d) === 4) exp('kitchen', pick(['Bodija market: rice, beans, peppers, oil', 'Meat & chicken (Bodija abattoir)', 'Cooking gas refill', 'Fish, yam & plantain']), round(between(55_000, 110_000), 1000), pick(['Bodija market', 'Iya Bisi provisions', 'Gas plant, Agodi']));
      if (weekday(d) === 3) exp('housekeeping', 'Toiletries, detergent & laundry', round(between(45_000, 85_000), 1000), 'Dugbe Wholesale Mart');
      if (dom === 5) exp('pool_gym', 'Pool chlorine & testing kit', 65_000, 'AquaClean Ibadan');
      if (dom === 15) exp('pool_gym', 'Gym equipment servicing', 35_000);
      if (dom === 10) exp('water', 'Borehole treatment & water tanker', 45_000, 'Clearwater Services');
      if (chance(0.08)) exp('other', pick(['Printing & stationery', 'Internet subscription', 'Waste disposal (PSP)', 'Bank charges', 'Fumigation']), round(between(8_000, 60_000), 500));
    }

    for (const p of products) run('UPDATE products SET stock = ?, avg_cost = ? WHERE id = ?', p.stock, p.avg, p.id);

    // ----- supplier bills: older ones paid around their due date (one paid in two parts); the last few still owed -----
    for (const b of credit) {
      const due = addDays(b.date, 14);
      if (due > addDays(T, -3)) continue;
      const paidOn = addDays(due, between(-2, 6));
      if (chance(0.2)) {
        const half = round(b.total / 2, 1000);
        run('INSERT INTO supplier_payments (purchase_id, amount, method, reference, date, paid_by, created_at) VALUES (?,?,?,?,?,?,?)', b.id, half, 'transfer', `TRF-${between(100000, 999999)}`, paidOn, accountantId, stamp(paidOn, 11, 0));
        if (addDays(paidOn, 7) < T) run('INSERT INTO supplier_payments (purchase_id, amount, method, reference, date, paid_by, created_at) VALUES (?,?,?,?,?,?,?)', b.id, b.total - half, 'transfer', `TRF-${between(100000, 999999)}`, addDays(paidOn, 7), accountantId, stamp(addDays(paidOn, 7), 11, 0));
      } else run('INSERT INTO supplier_payments (purchase_id, amount, method, reference, date, paid_by, created_at) VALUES (?,?,?,?,?,?,?)', b.id, b.total, 'transfer', `TRF-${between(100000, 999999)}`, paidOn, accountantId, stamp(paidOn, 11, 0));
    }

    // ----- an order placed with the brewery, not yet delivered -----
    {
      const lines = products.filter((p) => p.price < 3000).slice(0, 4).map((p) => ({ p, qty: p.reorder * 2, cost: round(p.baseCost * 1.06, 10) }));
      const total = lines.reduce((a, l) => a + l.qty * l.cost, 0);
      const pid = run("INSERT INTO purchases (ref, supplier, supplier_id, date, total, recorded_by, created_at, status, notes) VALUES (?,?,?,?,?,?,?, 'ordered', ?)",
        ref('PO'), suppliers[1], supplierIds[1], addDays(T, -1), total, managerId, stamp(addDays(T, -1), 15, 30), 'Delivery promised for Friday').id;
      for (const l of lines) run('INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost) VALUES (?,?,?,?)', pid, l.p.id, l.qty, l.cost);
    }

    // ----- stock counts: a few breakages and a shortfall the auditor will want explained -----
    for (const [i, change, reason, daysAgo] of [[0, -3, '3 bottles broken during delivery', 40], [12, -2, 'Expired — removed from shelf', 25], [14, -1, 'Count short at stock-take', 9], [4, -4, 'Count short at stock-take', 4]] as const) {
      const p = products[i];
      const take = Math.min(-change, p.stock);
      if (!take) continue;
      p.stock -= take;
      run('UPDATE products SET stock = ? WHERE id = ?', p.stock, p.id);
      const d = addDays(T, -daysAgo);
      run("INSERT INTO audit_log (user_id, action, entity, entity_id, detail, created_at) VALUES (?, 'stock_adjust', 'product', ?, ?, ?)", managerId, p.id, JSON.stringify({ change: -take, reason, value: -take * p.avg }), stamp(d, 18, 20));
    }

    // ----- the owner's targets and the accountant's budgets, this month and the last three -----
    for (let m = 0; m < 4; m++) {
      const key = new Date(Date.UTC(Number(T.slice(0, 4)), Number(T.slice(5, 7)) - 1 - m, 1)).toISOString().slice(0, 7);
      for (const [k, v] of [['revenue', 21_000_000], ['net_profit', 6_500_000], ['occupancy', 65], ['adr', 40_000],
        ['expense:salaries', 1_840_000], ['expense:diesel', 4_200_000], ['expense:electricity', 450_000], ['expense:repairs', 600_000],
        ['expense:housekeeping', 300_000], ['expense:security', 260_000], ['expense:pool_gym', 100_000], ['expense:water', 45_000], ['expense:other', 150_000]] as const) {
        run('INSERT OR REPLACE INTO targets (month, key, amount, set_by) VALUES (?,?,?,?)', key, k, v, k.startsWith('expense:') ? accountantId : ownerId);
      }
    }

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
    // ----- the rota: this week and next, with a day off each -----
    {
      const monday = addDays(T, -((new Date(`${T}T00:00:00Z`).getUTCDay() + 6) % 7));
      staff.forEach((e, i) => {
        for (let k = 0; k < 14; k++) {
          const day = addDays(monday, k);
          const shift = (k + i) % 7 === 6 ? 'off' : STAFF[i][2] === 'security' || (STAFF[i][2] === 'front_office' && i % 3 === 2) ? 'night' : (k + i) % 2 ? 'morning' : 'afternoon';
          run('INSERT INTO shifts (employee_id, date, shift) VALUES (?,?,?)', e.id, day, STAFF[i][2] === 'management' && (k % 7) >= 5 ? 'off' : shift);
        }
      });
    }

    // ----- the night audit: every day closed up to two weeks ago, the drawer short or over now and then -----
    const closeTo = addDays(T, -14);
    for (let d = START; d <= closeTo; d = addDays(d, 1)) {
      const report = dayReport(d);
      const expected = report.collections.byMethod;
      const variance = chance(0.08) ? -round(between(500, 12_000), 500) : chance(0.03) ? round(between(500, 3000), 500) : 0;
      const notes = variance ? (variance < 0 ? pick(['Short — change given wrongly at the bar', 'Short — cashier to explain', 'POS reversal paid back in cash']) : 'Over — customer left change') : null;
      run(
        `INSERT INTO day_closures (date, closed_by, closed_at, expected_cash, counted_cash, expected_transfer, expected_pos, variance, notes, summary) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        d, managerId, stamp(addDays(d, 1), 1, 30), report.expected_cash, report.expected_cash + variance, expected.transfer ?? 0, expected.pos ?? 0, variance, notes, JSON.stringify(report),
      );
      run('INSERT INTO audit_log (user_id, action, entity, detail, created_at) VALUES (?,?,?,?,?)', managerId, variance ? 'close_day_with_variance' : 'close_day', 'day', JSON.stringify({ date: d, variance }), stamp(addDays(d, 1), 1, 30));
    }

    // ----- the auditor's questions: one answered and closed, one waiting on management -----
    const variance = get<{ date: string; variance: number }>('SELECT date, variance FROM day_closures WHERE variance < 0 ORDER BY date DESC LIMIT 1');
    if (variance) {
      const q = run("INSERT INTO audit_queries (kind, ref_label, amount, question, status, raised_by, raised_at, answer, answered_by, answered_at) VALUES ('cash_variance', ?, ?, ?, 'answered', ?, ?, ?, ?, ?)",
        variance.date, variance.variance, `The drawer was short on ${variance.date}. Who was on the till, and has the money been recovered?`, auditorId, stamp(addDays(variance.date, 2), 10, 0),
        'Grace was on the bar till. The shortfall was deducted from her salary with her agreement; the deduction is on the payroll sheet.', managerId, stamp(addDays(variance.date, 3), 9, 0)).id;
      if (chance(0.5)) run("UPDATE audit_queries SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?", auditorId, stamp(addDays(variance.date, 4), 9, 0), q);
    }
    const short = products[4];
    run("INSERT INTO audit_queries (kind, ref_id, ref_label, amount, question, raised_by, raised_at) VALUES ('shrinkage', ?, NULL, ?, ?, ?, ?)",
      short.id, 4 * short.avg, 'Four bottles of Guinness Stout were written off as "count short" this week, after one short count earlier in the month. Please explain, and say who holds the bar store key.', auditorId, stamp(addDays(T, -2), 11, 30));

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
