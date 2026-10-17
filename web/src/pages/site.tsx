import { Menu } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Crest } from '@/components/app/letterhead';
import { ThemeMenu, ThemeSwitch } from '@/components/app/theme';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useHotel } from '@/lib/hotel';
import { cn } from '@/lib/utils';

const LINKS = [
  ['/#rooms', 'Rooms'],
  ['/#facilities', 'Facilities'],
  ['/#location', 'Location'],
];

/** Shared chrome for the public website. */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const hotel = useHotel();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={cn('sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur transition-colors', scrolled && 'border-border')}>
      <div className="mx-auto flex h-18 max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <Crest className="size-12" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold">{hotel?.name ?? 'Danest Hotel & Suites'}</span>
            <span className="block text-[11px] text-muted-foreground">Old Bodija, Ibadan</span>
          </span>
        </Link>
        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map(([to, label]) => (
            <a key={to} href={to} className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              {label}
            </a>
          ))}
          <Link to="/booking" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            Manage booking
          </Link>
          <ThemeMenu />
        </nav>
        <Button asChild className="ml-auto md:ml-2">
          <a href="/#book">Book a room</a>
        </Button>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-64">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <nav className="grid gap-1 px-4">
              {LINKS.map(([to, label]) => (
                <a key={to} href={to} className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                  {label}
                </a>
              ))}
              <Link to="/booking" className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                Manage booking
              </Link>
            </nav>
            <div className="mt-auto space-y-2 border-t p-4">
              <div className="text-xs font-medium text-muted-foreground">Appearance</div>
              <ThemeSwitch />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const hotel = useHotel();
  return (
    <footer className="border-t bg-muted/40">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <Crest className="size-14" />
            <span className="text-sm font-semibold">{hotel?.name}</span>
          </div>
          {hotel?.tagline && <p className="text-sm text-muted-foreground italic">{hotel.tagline}</p>}
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="font-medium">Visit</div>
          <p className="text-muted-foreground">{hotel?.address}</p>
          {hotel?.phone && (
            <a href={`tel:${hotel.phone}`} className="block text-muted-foreground hover:text-foreground">
              {hotel.phone}
            </a>
          )}
          {hotel?.email && (
            <a href={`mailto:${hotel.email}`} className="block text-muted-foreground hover:text-foreground">
              {hotel.email}
            </a>
          )}
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="font-medium">Guests</div>
          <a href="/#book" className="block text-muted-foreground hover:text-foreground">Book a room</a>
          <Link to="/booking" className="block text-muted-foreground hover:text-foreground">Manage booking</Link>
          <Link to="/staff/login" className="block text-muted-foreground hover:text-foreground">Staff sign-in</Link>
        </div>
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} {hotel?.name}</div>
    </footer>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold tracking-[0.18em] text-brand-ink uppercase">{children}</p>;
}
