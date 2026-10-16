import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_LABELS, type Role } from '../../../../shared/constants';
import { Icon, Loading } from '../../components/ui';
import { useAuth, homeFor } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import Dashboard from './Dashboard';
import Expenses from './Expenses';
import FrontDesk from './FrontDesk';
import Inventory from './Inventory';
import Login from './Login';
import OtherIncome from './OtherIncome';
import Pos from './Pos';
import Purchases from './Purchases';
import Reports from './Reports';
import Reservations from './Reservations';
import Team from './Team';

type NavItem = { to: string; label: string; icon: string; roles: Role[]; el: ReactNode; group: string; end?: boolean };

const NAV: NavItem[] = [
  { to: '/staff', label: 'Overview', icon: 'dashboard', roles: ['manager', 'frontdesk'], el: <Dashboard />, group: 'Today', end: true },
  { to: '/staff/front-desk', label: 'Room board', icon: 'bed', roles: ['manager', 'frontdesk'], el: <FrontDesk />, group: 'Today' },
  { to: '/staff/reservations', label: 'Reservations', icon: 'calendar', roles: ['manager', 'frontdesk'], el: <Reservations />, group: 'Today' },
  { to: '/staff/pos', label: 'Bar & shop till', icon: 'glass', roles: ['manager', 'bar'], el: <Pos />, group: 'Sell' },
  { to: '/staff/other-income', label: 'Gym, pool & lounge', icon: 'sparkle', roles: ['manager', 'frontdesk'], el: <OtherIncome />, group: 'Sell' },
  { to: '/staff/inventory', label: 'Stock', icon: 'box', roles: ['manager', 'bar'], el: <Inventory />, group: 'Costs' },
  { to: '/staff/purchases', label: 'Purchases', icon: 'cart', roles: ['manager'], el: <Purchases />, group: 'Costs' },
  { to: '/staff/expenses', label: 'Expenses', icon: 'receipt', roles: ['manager'], el: <Expenses />, group: 'Costs' },
  { to: '/staff/reports', label: 'Profit & loss', icon: 'chart', roles: ['manager'], el: <Reports />, group: 'Owner' },
  { to: '/staff/team', label: 'Team & activity', icon: 'users', roles: ['manager'], el: <Team />, group: 'Owner' },
];

export default function StaffApp() {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;
  return (
    <Routes>
      <Route path="login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Login />} />
      <Route path="*" element={user ? <Shell /> : <Navigate to="/staff/login" replace />} />
    </Routes>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const isDesk = user!.role !== 'bar';
  const pending = useApi<{ id: number }[]>(isDesk ? `/reservations?status=pending&_=${loc.pathname}` : null);
  useEffect(() => setOpen(false), [loc.pathname]);

  const items = NAV.filter((n) => n.roles.includes(user!.role));
  const groups = [...new Set(items.map((i) => i.group))];
  const initials = user!.name.replace(/^(Mrs?|Ms|Dr)\.?\s+/, '').split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <div className="app">
      <div className="topbar-mobile">
        <button className="btn sm" onClick={() => setOpen(true)} aria-label="Open menu">
          <Icon name="menu" />
        </button>
        <b>Danest</b>
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
          <div className="who">
            <div className="avatar">{initials}</div>
            <div>
              <b>{user!.name}</b>
              <small>{ROLE_LABELS[user!.role]}</small>
            </div>
          </div>
          <a className="btn ghost sm" href="/" target="_blank" rel="noopener">
            <Icon name="arrow" size={16} /> View guest website
          </a>
          <button className="btn ghost sm" onClick={logout}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          {items.map((i) => {
            const path = i.to.replace(/^\/staff\/?/, '');
            return path ? <Route key={i.to} path={path} element={i.el} /> : <Route key={i.to} index element={i.el} />;
          })}
          <Route path="*" element={<Navigate to={homeFor(user!.role)} replace />} />
        </Routes>
      </main>
    </div>
  );
}
