import {
  BedDouble,
  Building2,
  CalendarCheck,
  CalendarRange,
  ChefHat,
  Crown,
  Landmark,
  LayoutDashboard,
  LineChart,
  Moon,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SprayCan,
  Tags,
  Truck,
  UserCog,
  Users,
  Waves,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '../../../../shared/constants';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Who sees it. The owner/CEO sees everything listed for 'manager'. */
  roles: Role[];
  group: string;
  end?: boolean;
}

const desk: Role[] = ['manager', 'frontdesk'];
const books: Role[] = ['manager', 'accountant', 'auditor'];

export const NAV: NavItem[] = [
  { to: '/staff/executive', label: 'Executive', icon: Crown, roles: ['manager'], group: 'Business' },
  { to: '/staff/accounts', label: 'Accounts', icon: Landmark, roles: books, group: 'Business' },
  { to: '/staff/audit', label: 'Audit & controls', icon: ShieldCheck, roles: books, group: 'Business' },
  { to: '/staff/reports', label: 'Profit & loss', icon: LineChart, roles: books, group: 'Business' },
  { to: '/staff', label: 'Overview', icon: LayoutDashboard, roles: desk, group: 'Front office', end: true },
  { to: '/staff/calendar', label: 'Tape chart', icon: CalendarRange, roles: desk, group: 'Front office' },
  { to: '/staff/front-desk', label: 'Room board', icon: BedDouble, roles: desk, group: 'Front office' },
  { to: '/staff/reservations', label: 'Reservations', icon: CalendarCheck, roles: desk, group: 'Front office' },
  { to: '/staff/guests', label: 'Guests', icon: Users, roles: desk, group: 'Front office' },
  { to: '/staff/housekeeping', label: 'Housekeeping', icon: SprayCan, roles: ['manager', 'frontdesk', 'housekeeping'], group: 'Front office' },
  { to: '/staff/pos', label: 'Bar & shop till', icon: Wine, roles: ['manager', 'bar'], group: 'Sales' },
  { to: '/staff/other-income', label: 'Facilities & services', icon: Waves, roles: desk, group: 'Sales' },
  { to: '/staff/kitchen', label: 'Kitchen', icon: ChefHat, roles: ['manager', 'bar', 'kitchen'], group: 'Sales' },
  { to: '/staff/rates', label: 'Rates & seasons', icon: Tags, roles: ['manager'], group: 'Sales' },
  { to: '/staff/companies', label: 'Company accounts', icon: Building2, roles: [...desk, 'accountant', 'auditor'], group: 'Sales' },
  { to: '/staff/inventory', label: 'Stock', icon: Package, roles: ['manager', 'bar', 'accountant', 'auditor'], group: 'Stock & costs' },
  { to: '/staff/purchases', label: 'Purchases', icon: ShoppingCart, roles: books, group: 'Stock & costs' },
  { to: '/staff/suppliers', label: 'Suppliers', icon: Truck, roles: books, group: 'Stock & costs' },
  { to: '/staff/expenses', label: 'Expenses', icon: Receipt, roles: books, group: 'Stock & costs' },
  { to: '/staff/close-day', label: 'Close the day', icon: Moon, roles: ['manager'], group: 'Admin' },
  { to: '/staff/team', label: 'Team & activity', icon: UserCog, roles: ['manager'], group: 'Admin' },
  { to: '/staff/settings', label: 'Settings', icon: Settings, roles: ['manager'], group: 'Admin' },
];
