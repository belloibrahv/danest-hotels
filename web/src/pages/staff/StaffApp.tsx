import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_LABELS, type Role } from '../../../../shared/constants';
import { CommandPalette } from '../../components/CommandPalette';
import { DeskProvider, useDesk } from '../../components/Desk';
import { Icon, Loading } from '../../components/kit';
import { useAuth, homeFor } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import Account from './Account';
import Calendar from './Calendar';
import CloseDay from './CloseDay';
import Dashboard from './Dashboard';
import Expenses from './Expenses';
import FrontDesk from './FrontDesk';
import Guests from './Guests';
import Housekeeping from './Housekeeping';
import Inventory from './Inventory';
import Invoice from './Invoice';
import Login from './Login';
import OtherIncome from './OtherIncome';
import Pos from './Pos';
import Purchases from './Purchases';
import Reports from './Reports';
import Reservations from './Reservations';
import Settings from './Settings';
import Team from './Team';

type NavItem = { to: string; label: string; icon: string; roles: Role[]; el: ReactNode; group: string; end?: boolean };

const NAV: NavItem[] = [
  { to: '/staff', label: 'Overview', icon: 'dashboard', roles: ['manager', 'frontdesk'], el: <Dashboard />, group: 'Front office', end: true },
  { to: '/staff/calendar', label: 'Tape chart', icon: 'grid', roles: ['manager', 'frontdesk'], el: <Calendar />, group: 'Front office' },
  { to: '/staff/front-desk', label: 'Room board', icon: 'bed', roles: ['manager', 'frontdesk'], el: <FrontDesk />, group: 'Front office' },
  { to: '/staff/reservations', label: 'Reservations', icon: 'calendar', roles: ['manager', 'frontdesk'], el: <Reservations />, group: 'Front office' },
  { to: '/staff/guests', label: 'Guests', icon: 'user', roles: ['manager', 'frontdesk'], el: <Guests />, group: 'Front office' },
  { to: '/staff/housekeeping', label: 'Housekeeping', icon: 'sparkle', roles: ['manager', 'frontdesk', 'housekeeping'], el: <Housekeeping />, group: 'Front office' },
  { to: '/staff/pos', label: 'Bar & shop till', icon: 'glass', roles: ['manager', 'bar'], el: <Pos />, group: 'Sell' },
  { to: '/staff/other-income', label: 'Gym, pool & lounge', icon: 'wave', roles: ['manager', 'frontdesk'], el: <OtherIncome />, group: 'Sell' },
  { to: '/staff/inventory', label: 'Stock', icon: 'box', roles: ['manager', 'bar'], el: <Inventory />, group: 'Costs' },
  { to: '/staff/purchases', label: 'Purchases', icon: 'cart', roles: ['manager'], el: <Purchases />, group: 'Costs' },
  { to: '/staff/expenses', label: 'Expenses', icon: 'receipt', roles: ['manager'], el: <Expenses />, group: 'Costs' },
  { to: '/staff/close-day', label: 'Close the day', icon: 'moon', roles: ['manager'], el: <CloseDay />, group: 'Owner' },
  { to: '/staff/reports', label: 'Profit & loss', icon: 'chart', roles: ['manager'], el: <Reports />, group: 'Owner' },
  { to: '/staff/team', label: 'Team & activity', icon: 'users', roles: ['manager'], el: <Team />, group: 'Owner' },
  { to: '/staff/settings', label: 'Settings', icon: 'palette', roles: ['manager'], el: <Settings />, group: 'Owner' },
  { to: '/staff/account', label: 'My account', icon: 'lock', roles: ['manager', 'frontdesk', 'bar', 'housekeeping'], el: <Account />, group: 'You' },
];

export default function StaffApp() {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  return (
    <Routes>
      <Route path="login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Login />} />
      <Route path="invoice/:id" element={user && (user.role === 'manager' || user.role === 'frontdesk') ? <Invoice /> : <Navigate to="/staff/login" replace />} />
      <Route
        path="*"
        element={
          user ? (
            <DeskProvider>
              <Shell />
            </DeskProvider>
          ) : (
            <Navigate to="/staff/login" replace />
          )
        }
      />
    </Routes>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const desk = useDesk();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  const isDesk = user!.role === 'manager' || user!.role === 'frontdesk';
  const pending = useApi<{ id: number }[]>(isDesk ? `/reservations?status=pending&v=${desk.version}&p=${loc.pathname}` : null);
  useEffect(() => setOpen(false), [loc.pathname]);

  // "N" starts a new reservation from anywhere (when not typing in a field).
  useEffect(() => {
    if (!isDesk) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      if (document.querySelector('.modal-back, .drawer, .cmdk-back')) return;
      e.preventDefault();
      desk.newReservation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesk, desk]);

  const items = NAV.filter((n) => n.roles.includes(user!.role));
  const groups = [...new Set(items.map((i) => i.group))];
  const initials = user!.name.replace(/^(Mrs?|Ms|Dr)\.?\s+/, '').split(' ').map((p) => p[0]).slice(0, 2).join('');
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="app">
      <div className="topbar-mobile">
        <button className="btn sm" onClick={() => setOpen(true)} aria-label="Open menu">
          <Icon name="menu" />
        </button>
        <b>Danest</b>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setPalette(true)} aria-label="Search">
          <Icon name="search" />
        </button>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Staff navigation">
        <NavLink to={homeFor(user!.role)} className="brand">
          <img src="/brand/crest-128.png" alt="" />
          <span>
            <b>Danest</b>
            <small>Back office</small>
          </span>
        </NavLink>
        <button className="search-trigger" onClick={() => setPalette(true)}>
          <Icon name="search" size={15} /> Search or jump to…
          <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        {groups.map((g) => (
          <div key={g}>
            <div className="nav-group">{g}</div>
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <Icon name={i.icon} />
                  {i.label}
                  {i.to === '/staff/reservations' && !!pending.data?.length && <span className="count">{pending.data.length}</span>}
                </NavLink>
              ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <NavLink to="/staff/account" className="who" style={{ textDecoration: 'none' }}>
            <div className="avatar">{initials}</div>
            <div>
              <b>{user!.name}</b>
              <small>
                {ROLE_LABELS[user!.role]}
                {user!.mfa ? ' · 2-step on' : ''}
              </small>
            </div>
          </NavLink>
          <a className="btn ghost sm" href="/" target="_blank" rel="noopener">
            <Icon name="arrow" size={16} /> View guest website
          </a>
          <button className="btn ghost sm" onClick={logout}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="main" key={loc.pathname}>
        <Routes>
          {items.map((i) => {
            const path = i.to.replace(/^\/staff\/?/, '');
            return path ? <Route key={i.to} path={path} element={i.el} /> : <Route key={i.to} index element={i.el} />;
          })}
          <Route path="*" element={<Navigate to={homeFor(user!.role)} replace />} />
        </Routes>
      </main>
      <CommandPalette nav={NAV} role={user!.role} open={palette} setOpen={setPalette} />
    </div>
  );
}
