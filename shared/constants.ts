// Single source of truth for the business model, shared by the API and the UI.

export const ROLES = ['ceo', 'manager', 'accountant', 'auditor', 'frontdesk', 'bar', 'housekeeping'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ceo: 'Owner / CEO',
  manager: 'Manager',
  accountant: 'Accountant',
  auditor: 'Auditor',
  frontdesk: 'Front desk',
  bar: 'Bar & shop',
  housekeeping: 'Housekeeping',
};

export const ROLE_HELP: Record<Role, string> = {
  ceo: 'Everything a manager can do, plus the executive dashboard, targets and owner accounts',
  manager: 'Everything, including costs, profit, settings and closing the day',
  accountant: 'Cash book, receivables, supplier bills, expenses, budgets and the profit & loss',
  auditor: 'Reads every naira and every action, raises queries; cannot change anything',
  frontdesk: 'Reservations, guests, room bills, gym/pool/lounge takings, housekeeping',
  bar: 'Till, room charges and stock levels — never cost prices',
  housekeeping: 'Rooms to clean and maintenance reports, on a phone',
};

/** The owner/CEO can do everything a manager can; every other role gets exactly what it is named for. */
export const hasRole = (role: Role, allowed: readonly Role[]) => allowed.includes(role) || (role === 'ceo' && allowed.includes('manager'));
export const isManager = (role: Role) => role === 'manager' || role === 'ceo';

/** Roles that can read the books: costs, profit, cash and receivables. */
export const BOOKS: Role[] = ['manager', 'accountant', 'auditor'];

export const PAYMENT_METHODS = ['cash', 'transfer', 'pos'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  pos: 'POS / card',
};

/** Every way a folio can be settled, including ones staff don't key in by hand. */
export const ALL_PAYMENT_LABELS: Record<string, string> = { ...PAYMENT_LABELS, online: 'Paid online (Paystack)', company: 'Billed to company' };

export const RATE_RULE_KINDS = ['percent', 'amount', 'fixed'] as const;
export type RateRuleKind = (typeof RATE_RULE_KINDS)[number];
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MESSAGE_TEMPLATES = ['booking_received', 'booking_confirmed', 'pre_arrival', 'balance_due', 'thank_you'] as const;
export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[number];
export const MESSAGE_TEMPLATE_LABELS: Record<MessageTemplate, string> = {
  booking_received: 'Booking received',
  booking_confirmed: 'Booking confirmed',
  pre_arrival: 'Day-before reminder',
  balance_due: 'Balance reminder',
  thank_you: 'Thank you after stay',
};

/** Ways a bar or facility sale can be settled: paid now, or posted to an in-house guest's room folio. */
export const CHARGE_METHODS = [...PAYMENT_METHODS, 'room'] as const;
export type ChargeMethod = (typeof CHARGE_METHODS)[number];
export const CHARGE_LABELS: Record<ChargeMethod, string> = { ...PAYMENT_LABELS, room: 'Charge to room' };

export const ID_TYPES = ['nin', 'passport', 'drivers_licence', 'voters_card', 'other'] as const;
export type IdType = (typeof ID_TYPES)[number];
export const ID_LABELS: Record<IdType, string> = {
  nin: 'NIN slip / card',
  passport: 'International passport',
  drivers_licence: "Driver's licence",
  voters_card: "Voter's card",
  other: 'Other ID',
};

export const PRODUCT_CATEGORIES = ['drinks', 'confectionery'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const FACILITIES = ['gym', 'pool', 'lounge'] as const;
export type Facility = (typeof FACILITIES)[number];
export const FACILITY_LABELS: Record<Facility, string> = {
  gym: 'Gym',
  pool: 'Swimming pool',
  lounge: 'Lounge & bar',
};

/** Revenue streams, in the order the owner thinks about them: core first, then "other". */
export const STREAMS = [
  { key: 'rooms', label: 'Room reservations', group: 'core' },
  { key: 'drinks', label: 'Drinks', group: 'core' },
  { key: 'confectionery', label: 'Confectionery', group: 'core' },
  { key: 'cancellations', label: 'Cancellation & no-show fees', group: 'core' },
  { key: 'gym', label: 'Gym', group: 'other' },
  { key: 'pool', label: 'Swimming pool', group: 'other' },
  { key: 'lounge', label: 'Lounge & bar', group: 'other' },
] as const;
export type StreamKey = (typeof STREAMS)[number]['key'];

/**
 * Expense categories. "direct" costs sit above gross profit (they exist because a
 * room was sold), "operating" costs are the running cost of keeping the doors open.
 */
export const EXPENSE_CATEGORIES = [
  { key: 'housekeeping', label: 'Room supplies & laundry', kind: 'direct' },
  { key: 'salaries', label: 'Salaries & wages', kind: 'operating' },
  { key: 'diesel', label: 'Diesel (generator)', kind: 'operating' },
  { key: 'electricity', label: 'Electricity (NEPA) bill', kind: 'operating' },
  { key: 'repairs', label: 'Repairs & maintenance', kind: 'operating' },
  { key: 'pool_gym', label: 'Pool & gym upkeep', kind: 'operating' },
  { key: 'water', label: 'Water & sanitation', kind: 'operating' },
  { key: 'security', label: 'Security', kind: 'operating' },
  { key: 'other', label: 'Other running costs', kind: 'operating' },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['key'];
export const EXPENSE_KEYS = EXPENSE_CATEGORIES.map((c) => c.key) as ExpenseCategory[];

export const RESERVATION_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'Request',
  confirmed: 'Confirmed',
  checked_in: 'In house',
  checked_out: 'Checked out',
  cancelled: 'Cancelled',
};

export const RESERVATION_SOURCES = ['walk_in', 'phone', 'website'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];
export const SOURCE_LABELS: Record<ReservationSource, string> = {
  walk_in: 'Walk-in',
  phone: 'Phone',
  website: 'Website',
};

export const ROOM_STATUSES = ['available', 'occupied', 'cleaning', 'maintenance'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const HOTEL = {
  name: 'Danest Hotel & Suites',
  tagline: 'Experience a great comfort',
  address: '4, Beckley Street, off Adeyi-Estate, Old Bodija Road, Ibadan, Oyo State',
  timezone: 'Africa/Lagos',
} as const;

/**
 * Everything the owner can change about how the hotel presents itself. Blank values are
 * simply not shown — the website never invents a phone number or a promise.
 */
export interface HotelSettings {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  check_in_time: string;
  check_out_time: string;
  bank_details: string;
  invoice_note: string;
  highlights: { title: string; text: string }[];
  /** Real guest reviews the owner has collected (Google, WhatsApp, the guest book). Never invented. */
  reviews: { quote: string; name: string; detail: string }[];
  /** Share of the stay a guest can pay online when booking (0 = online payment off). */
  deposit_percent: number;
}

export const DEFAULT_SETTINGS: HotelSettings = {
  name: HOTEL.name,
  tagline: HOTEL.tagline,
  address: HOTEL.address,
  phone: '',
  whatsapp: '',
  email: '',
  check_in_time: '14:00',
  check_out_time: '12:00',
  bank_details: '',
  invoice_note: 'Thank you for staying with us.',
  highlights: [],
  reviews: [],
  deposit_percent: 0,
};

/** How a supplier bill was settled when stock arrived. 'credit' leaves it owing until the accountant pays it. */
export const PURCHASE_TERMS = [...PAYMENT_METHODS, 'credit'] as const;
export type PurchaseTerms = (typeof PURCHASE_TERMS)[number];
export const PURCHASE_TERMS_LABELS: Record<PurchaseTerms, string> = { ...PAYMENT_LABELS, credit: 'On credit (pay later)' };

export const PURCHASE_STATUSES = ['ordered', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** Monthly figures the owner aims for, and the accountant's budget for each running cost. */
export const TARGET_KEYS = ['revenue', 'net_profit', 'occupancy', 'adr'] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];
export const TARGET_LABELS: Record<TargetKey, string> = {
  revenue: 'Revenue',
  net_profit: 'Net profit',
  occupancy: 'Occupancy (%)',
  adr: 'Average daily rate',
};

export const QUERY_STATUSES = ['open', 'answered', 'closed'] as const;
export type QueryStatus = (typeof QUERY_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'normal', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
