import { ChevronsUpDown, ExternalLink, KeyRound, LogOut, MonitorDown, Search } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_LABELS, hasRole, isManager } from '../../../../shared/constants';
import { CommandMenu } from '@/components/app/command-menu';
import { Crest } from '@/components/app/letterhead';
import { ThemeMenu } from '@/components/app/theme';
import { LoadingRows } from '@/components/app/page';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { can, homeFor, useAuth } from '@/lib/auth';
import { LiveBadge, LiveProvider } from '@/lib/live';
import { useApi } from '@/lib/hooks';
import { useHotel } from '@/lib/hotel';
import { useInstall } from '@/lib/pwa';
import { DeskProvider, useDesk } from './desk/Desk';
import Login from './Login';
import { NAV } from './nav';

const pages: Record<string, React.LazyExoticComponent<() => React.JSX.Element>> = {
  '': lazy(() => import('./Dashboard')),
  calendar: lazy(() => import('./Calendar')),
  'front-desk': lazy(() => import('./FrontDesk')),
  reservations: lazy(() => import('./Reservations')),
  guests: lazy(() => import('./Guests')),
  housekeeping: lazy(() => import('./Housekeeping')),
  pos: lazy(() => import('./Pos')),
  'other-income': lazy(() => import('./OtherIncome')),
  rates: lazy(() => import('./Rates')),
  companies: lazy(() => import('./Companies')),
  inventory: lazy(() => import('./Inventory')),
  purchases: lazy(() => import('./Purchases')),
  expenses: lazy(() => import('./Expenses')),
  'close-day': lazy(() => import('./CloseDay')),
  reports: lazy(() => import('./Reports')),
  team: lazy(() => import('./Team')),
  executive: lazy(() => import('./Executive')),
  accounts: lazy(() => import('./Accounts')),
  audit: lazy(() => import('./Audit')),
  suppliers: lazy(() => import('./Suppliers')),
  kitchen: lazy(() => import('./Kitchen')),
  people: lazy(() => import('./People')),
  settings: lazy(() => import('./Settings')),
};
const Account = lazy(() => import('./Account'));
const Invoice = lazy(() => import('./Invoice'));
const Receipt = lazy(() => import('./Receipt'));
const Statement = lazy(() => import('./Statement'));
const Payslips = lazy(() => import('./Payslips'));

/** The staff app is the installable one: its manifest is only offered on staff pages, never to guests. */
function useStaffManifest() {
  useEffect(() => {
    if (document.querySelector('link[rel="manifest"]')) return;
    const link = Object.assign(document.createElement('link'), { rel: 'manifest', href: '/manifest.webmanifest' });
    document.head.append(link);
  }, []);
}

export default function StaffApp() {
  const { user } = useAuth();
  useStaffManifest();
  if (user === undefined) return <LoadingRows />;
  return (
    <Suspense fallback={<LoadingRows />}>
      <Routes>
        <Route path="login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <Login />} />
        <Route path="invoice/:id" element={can(user, 'manager', 'frontdesk', 'accountant', 'auditor') ? <Invoice /> : <Navigate to="/staff/login" replace />} />
        <Route path="statement/:id" element={can(user, 'manager', 'frontdesk', 'accountant', 'auditor') ? <Statement /> : <Navigate to="/staff/login" replace />} />
        <Route path="payslips/:month" element={can(user, 'manager', 'accountant', 'auditor') ? <Payslips /> : <Navigate to="/staff/login" replace />} />
        <Route path="receipt/:id" element={can(user, 'manager', 'bar', 'accountant', 'auditor') ? <Receipt /> : <Navigate to="/staff/login" replace />} />
        <Route
          path="*"
          element={
            user ? (
              <LiveProvider>
                <DeskProvider>
                  <Shell />
                </DeskProvider>
              </LiveProvider>
            ) : (
              <Navigate to="/staff/login" replace />
            )
          }
        />
      </Routes>
    </Suspense>
  );
}

function Shell() {
  const { user } = useAuth();
  const hotel = useHotel();
  const desk = useDesk();
  const loc = useLocation();
  const [palette, setPalette] = useState(false);
  const isDesk = isManager(user!.role) || user!.role === 'frontdesk';
  const pending = useApi<{ id: number }[]>(isDesk ? `/reservations?status=pending&v=${desk.version}&p=${loc.pathname}` : null);
  const items = NAV.filter((n) => hasRole(user!.role, n.roles));
  const current = [...items].sort((a, b) => b.to.length - a.to.length).find((n) => loc.pathname === n.to || loc.pathname.startsWith(`${n.to}/`));

  // "N" starts a new booking from anywhere, unless typing.
  useEffect(() => {
    if (!isDesk) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      desk.newReservation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesk, desk]);

  return (
    <SidebarProvider>
      <AppSidebar items={items} pending={pending.data?.length ?? 0} />
      {/* min-w-0: wide content (the tape chart) scrolls inside its card instead of stretching the page. */}
      <SidebarInset className="min-w-0">
        <header data-app-chrome className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <SidebarTrigger className="-ml-1" />
          <NavLink to={homeFor(user!.role)} className="md:hidden" aria-label={`${hotel?.name ?? "Hotel"}, home`}>
            <Crest className="size-9" />
          </NavLink>
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <span className="truncate text-sm font-medium">{current?.label ?? (loc.pathname.endsWith('/account') ? 'My account' : '')}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="hidden w-64 justify-start gap-2 text-muted-foreground sm:flex" onClick={() => setPalette(true)}>
              <Search className="size-4" />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">⌘K</kbd>
            </Button>
            <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setPalette(true)} aria-label="Search">
              <Search />
            </Button>
            <LiveBadge />
            <ThemeMenu />
          </div>
        </header>
        <LicenceBanner />
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6 lg:p-8" key={loc.pathname}>
          <Suspense fallback={<LoadingRows />}>
            <Routes>
              {items.map((i) => {
                const path = i.to.replace(/^\/staff\/?/, '');
                const Page = pages[path];
                return path ? <Route key={i.to} path={path} element={<Page />} /> : <Route key={i.to} index element={<Page />} />;
              })}
              <Route path="account" element={<Account />} />
              <Route path="*" element={<Navigate to={homeFor(user!.role)} replace />} />
            </Routes>
          </Suspense>
        </main>
      </SidebarInset>
      <CommandMenu nav={NAV} role={user!.role} open={palette} setOpen={setPalette} />
    </SidebarProvider>
  );
}

function AppSidebar({ items, pending }: { items: typeof NAV; pending: number }) {
  const { user, logout } = useAuth();
  const hotel = useHotel();
  const install = useInstall();
  const { isMobile, setOpenMobile } = useSidebar();
  const loc = useLocation();
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [loc.pathname, isMobile, setOpenMobile]);
  const groups = [...new Set(items.map((i) => i.group))];
  const initials = user!.name.replace(/^(Mrs?|Ms|Dr)\.?\s+/, '').split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <NavLink
          to={homeFor(user!.role)}
          aria-label={`${hotel?.name ?? "Hotel"}, home`}
          className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        >
          <Crest className="size-12 transition-[width,height] group-data-[collapsible=icon]:size-8" />
          <div className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-[15px] font-semibold tracking-tight">{hotel?.short_name}</span>
            <span className="truncate text-xs text-muted-foreground">{hotel?.location_label || hotel?.name.replace(hotel.short_name, "").trim()}</span>
          </div>
        </NavLink>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g}>
            <SidebarGroupLabel>{g}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items
                  .filter((i) => i.group === g)
                  .map((i) => {
                    const active = i.end ? loc.pathname === i.to : loc.pathname === i.to || loc.pathname.startsWith(`${i.to}/`);
                    return (
                      <SidebarMenuItem key={i.to}>
                        <SidebarMenuButton asChild isActive={active} tooltip={i.label}>
                          <NavLink to={i.to} end={i.end}>
                            <i.icon />
                            <span>{i.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                        {i.to === '/staff/reservations' && pending > 0 && <SidebarMenuBadge className="bg-brand text-brand-foreground">{pending}</SidebarMenuBadge>}
                      </SidebarMenuItem>
                    );
                  })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg text-xs font-semibold">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">{user!.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {ROLE_LABELS[user!.role]}
                      {user!.mfa ? ' · 2-step on' : ''}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" side="top" align="start">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{user!.name}</div>
                  <div className="text-xs text-muted-foreground">@{user!.username}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <NavLink to="/staff/account">
                    <KeyRound /> Password & security
                  </NavLink>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/" target="_blank" rel="noopener">
                    <ExternalLink /> Guest website
                  </a>
                </DropdownMenuItem>
                {install && (
                  <DropdownMenuItem onSelect={() => install()}>
                    <MonitorDown /> Install {hotel?.short_name} app
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logout()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}


interface Licence { state: 'not_required' | 'valid' | 'expiring' | 'grace' | 'expired' | 'missing' | 'invalid'; days: number | null; read_only_from: string | null; licence: { expires: string } | null }

/** Warns managers before the licence runs out; tells everyone plainly when the system is read-only. */
function LicenceBanner() {
  const { user } = useAuth();
  const { data } = useApi<Licence>('/licence');
  if (!data || data.state === 'valid' || data.state === 'not_required') return null;
  const manager = isManager(user!.role);
  const readOnly = data.state === 'expired' || data.state === 'missing' || data.state === 'invalid';
  if (!readOnly && !manager) return null;
  const text = readOnly
    ? data.state === 'expired'
      ? 'The licence has run out, so the system is read-only: everything can be seen, nothing new can be recorded. Renew it to carry on.'
      : 'This system has no valid licence, so it is read-only. Ask whoever installed it for a licence key.'
    : data.state === 'grace'
      ? `The licence ended on ${data.licence?.expires}. The system becomes read-only on ${data.read_only_from} unless it is renewed.`
      : `The licence runs out on ${data.licence?.expires} (${data.days} day${data.days === 1 ? '' : 's'}). Renew it to avoid interruption.`;
  return (
    <div role="status" className={readOnly || data.state === 'grace' ? 'border-b bg-danger-soft px-4 py-2 text-sm text-destructive' : 'border-b bg-warning-soft px-4 py-2 text-sm text-warning'}>
      {text}
    </div>
  );
}
