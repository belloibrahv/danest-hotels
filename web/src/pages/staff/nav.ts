import {
  BedDouble,
  Building2,
  CalendarCheck,
  CalendarRange,
  LayoutDashboard,
  LineChart,
  Moon,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  SprayCan,
  Tags,
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
  roles: Role[];
  group: string;
  end?: boolean;
}

const desk: Role[] = ['manager', 'frontdesk'];

export const NAV: NavItem[] = [
  { to: '/staff', label: 'Overview', icon: LayoutDashboard, roles: desk, group: 'Front office', end: true },
  { to: '/staff/calendar', label: 'Tape chart', icon: CalendarRange, roles: desk, group: 'Front office' },
  { to: '/staff/front-desk', label: 'Room board', icon: BedDouble, roles: desk, group: 'Front office' },
  { to: '/staff/reservations', label: 'Reservations', icon: CalendarCheck, roles: desk, group: 'Front office' },
  { to: '/staff/guests', label: 'Guests', icon: Users, roles: desk, group: 'Front office' },
  { to: '/staff/housekeeping', label: 'Housekeeping', icon: SprayCan, roles: ['manager', 'frontdesk', 'housekeeping'], group: 'Front office' },
  { to: '/staff/pos', label: 'Bar & shop till', icon: Wine, roles: ['manager', 'bar'], group: 'Sales' },
  { to: '/staff/other-income', label: 'Gym, pool & lounge', icon: Waves, roles: desk, group: 'Sales' },
  { to: '/staff/rates', label: 'Rates & seasons', icon: Tags, roles: ['manager'], group: 'Sales' },
  { to: '/staff/companies', label: 'Company accounts', icon: Building2, roles: desk, group: 'Sales' },
  { to: '/staff/inventory', label: 'Stock', icon: Package, roles: ['manager', 'bar'], group: 'Costs' },
  { to: '/staff/purchases', label: 'Purchases', icon: ShoppingCart, roles: ['manager'], group: 'Costs' },
  { to: '/staff/expenses', label: 'Expenses', icon: Receipt, roles: ['manager'], group: 'Costs' },
  { to: '/staff/close-day', label: 'Close the day', icon: Moon, roles: ['manager'], group: 'Owner' },
  { to: '/staff/reports', label: 'Profit & loss', icon: LineChart, roles: ['manager'], group: 'Owner' },
  { to: '/staff/team', label: 'Team & activity', icon: UserCog, roles: ['manager'], group: 'Owner' },
  { to: '/staff/settings', label: 'Settings', icon: Settings, roles: ['manager'], group: 'Owner' },
];
