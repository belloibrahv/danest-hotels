// Single source of truth for the business model, shared by the API and the UI.

export const ROLES = ['manager', 'frontdesk', 'bar'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  manager: 'Manager',
  frontdesk: 'Front desk',
  bar: 'Bar & shop',
};

export const PAYMENT_METHODS = ['cash', 'transfer', 'pos'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  pos: 'POS / card',
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
