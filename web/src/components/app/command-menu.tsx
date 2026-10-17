import { BedDouble, CalendarCheck, Plus, Star, User, UserPlus, Wine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RESERVATION_STATUS_LABELS, hasRole, type ReservationStatus, type Role } from '../../../../shared/constants';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { api, fmtDate } from '@/lib/api';
import { useDesk } from '@/pages/staff/desk/Desk';
import type { NavItem } from '@/pages/staff/nav';

interface Results {
  guests: { id: number; name: string; phone: string; vip: number }[];
  reservations: { id: number; code: string; status: ReservationStatus; check_in: string; guest_name: string; room_number: string | null }[];
  rooms: { id: number; number: string; status: string; room_type: string; reservation_id: number | null }[];
}

/** ⌘K anywhere in the back office: search people, bookings and rooms, jump to pages, start tasks. */
export function CommandMenu({ nav, role, open, setOpen }: { nav: NavItem[]; role: Role; open: boolean; setOpen: (v: boolean) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const navigate = useNavigate();
  const desk = useDesk();
  const deskRole = hasRole(role, ['manager', 'frontdesk']);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || !deskRole) return setResults(null);
    let live = true;
    const t = setTimeout(() => api<Results>(`/search?q=${encodeURIComponent(term)}`).then((r) => live && setResults(r)).catch(() => {}), 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, deskRole]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search guests, bookings and rooms, or jump to a page">
      <CommandInput placeholder={deskRole ? 'Search guests, bookings, rooms…' : 'Jump to…'} value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {!!results?.reservations.length && (
          <CommandGroup heading="Bookings">
            {results.reservations.map((r) => (
              <CommandItem key={`r${r.id}`} value={`booking ${r.code} ${r.guest_name}`} onSelect={() => run(() => desk.openReservation(r.id))}>
                <CalendarCheck />
                <span>{r.guest_name}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                <CommandShortcut className="tracking-normal">
                  {RESERVATION_STATUS_LABELS[r.status]} · {fmtDate(r.check_in)}
                  {r.room_number ? ` · ${r.room_number}` : ''}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!results?.guests.length && (
          <CommandGroup heading="Guests">
            {results.guests.map((g) => (
              <CommandItem key={`g${g.id}`} value={`guest ${g.name} ${g.phone}`} onSelect={() => run(() => desk.openGuest(g.id))}>
                {g.vip ? <Star className="fill-brand text-brand" /> : <User />}
                <span>{g.name}</span>
                <CommandShortcut className="tracking-normal">{g.phone}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!results?.rooms.length && (
          <CommandGroup heading="Rooms">
            {results.rooms.map((r) => (
              <CommandItem key={`rm${r.id}`} value={`room ${r.number}`} onSelect={() => run(() => (r.reservation_id ? desk.openReservation(r.reservation_id) : navigate('/staff/front-desk')))}>
                <BedDouble />
                <span>Room {r.number}</span>
                <CommandShortcut className="tracking-normal">
                  {r.room_type} · {r.status}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results && <CommandSeparator />}
        <CommandGroup heading="Actions">
          {deskRole && (
            <>
              <CommandItem value="new reservation booking" onSelect={() => run(() => desk.newReservation())}>
                <Plus /> New reservation <CommandShortcut>N</CommandShortcut>
              </CommandItem>
              <CommandItem value="walk-in check in guest" onSelect={() => run(() => desk.newReservation({ walkIn: true }))}>
                <UserPlus /> Walk-in check-in
              </CommandItem>
            </>
          )}
          {hasRole(role, ['manager', 'bar']) && (
            <CommandItem value="open till bar sale" onSelect={() => run(() => navigate('/staff/pos'))}>
              <Wine /> Open the till
            </CommandItem>
          )}
        </CommandGroup>
        <CommandGroup heading="Go to">
          {nav
            .filter((n) => hasRole(role, n.roles))
            .map((n) => (
              <CommandItem key={n.to} value={`go ${n.label}`} onSelect={() => run(() => navigate(n.to))}>
                <n.icon /> {n.label}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
