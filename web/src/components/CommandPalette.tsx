import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RESERVATION_STATUS_LABELS, type ReservationStatus, type Role } from '../../../shared/constants';
import { api, fmtDate } from '../lib/api';
import { useDesk } from './Desk';
import { Icon } from './ui';

export interface PaletteNav {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

interface Results {
  guests: { id: number; name: string; phone: string; vip: number }[];
  reservations: { id: number; code: string; status: ReservationStatus; check_in: string; check_out: string; guest_name: string; room_number: string | null }[];
  rooms: { id: number; number: string; status: string; room_type: string; reservation_id: number | null }[];
}

type Item = { key: string; group: string; icon: string; label: string; hint?: string; run: () => void };

/** ⌘K / Ctrl+K anywhere in the back office. Search people and bookings, jump to pages, start common tasks. */
export function CommandPalette({ nav, role, open, setOpen }: { nav: PaletteNav[]; role: Role; open: boolean; setOpen: (v: boolean) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const desk = useDesk();
  const listRef = useRef<HTMLDivElement>(null);

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
    if (!open) return setQ(''), setResults(null);
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || role === 'bar') return setResults(null);
    let live = true;
    const t = setTimeout(() => api<Results>(`/search?q=${encodeURIComponent(term)}`).then((r) => live && setResults(r)).catch(() => {}), 140);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, role]);

  const close = () => setOpen(false);
  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const out: Item[] = [];
    if (results) {
      for (const r of results.reservations) {
        out.push({
          key: `r${r.id}`, group: 'Bookings', icon: 'calendar', label: `${r.guest_name} · ${r.code}`,
          hint: `${RESERVATION_STATUS_LABELS[r.status]} · ${fmtDate(r.check_in)}${r.room_number ? ` · Room ${r.room_number}` : ''}`,
          run: () => (close(), desk.openReservation(r.id)),
        });
      }
      for (const g of results.guests) {
        out.push({ key: `g${g.id}`, group: 'Guests', icon: g.vip ? 'star' : 'user', label: g.name, hint: g.phone, run: () => (close(), desk.openGuest(g.id)) });
      }
      for (const rm of results.rooms) {
        out.push({
          key: `rm${rm.id}`, group: 'Rooms', icon: 'bed', label: `Room ${rm.number}`, hint: `${rm.room_type} · ${rm.status}`,
          run: () => (close(), rm.reservation_id ? desk.openReservation(rm.reservation_id) : navigate('/staff/front-desk')),
        });
      }
    }
    const actions: Item[] = [];
    if (role !== 'bar') {
      actions.push({ key: 'a-new', group: 'Actions', icon: 'plus', label: 'New reservation', hint: 'N', run: () => (close(), desk.newReservation()) });
      actions.push({ key: 'a-walk', group: 'Actions', icon: 'bed', label: 'Walk-in guest', run: () => (close(), desk.newReservation({ walkIn: true })) });
    }
    if (role !== 'frontdesk') actions.push({ key: 'a-till', group: 'Actions', icon: 'glass', label: 'Open the till', run: () => (close(), navigate('/staff/pos')) });
    for (const a of actions) if (!term || a.label.toLowerCase().includes(term)) out.push(a);
    for (const n of nav) {
      if (!n.roles.includes(role)) continue;
      if (!term || n.label.toLowerCase().includes(term)) out.push({ key: n.to, group: 'Go to', icon: n.icon, label: n.label, run: () => (close(), navigate(n.to)) });
    }
    return out;
  }, [results, q, nav, role, desk, navigate]);

  useEffect(() => setSel(0), [items.length, q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
    else if (e.key === 'Enter') (e.preventDefault(), items[sel]?.run());
    else if (e.key === 'Escape') close();
  };

  let lastGroup = '';
  return (
    <div className="cmdk-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search and commands" onKeyDown={onKey}>
        <div className="cmdk-input">
          <Icon name="search" className="muted" />
          <input
            autoFocus
            placeholder={role === 'bar' ? 'Jump to…' : 'Search guests, bookings, rooms — or jump to a page'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={items[sel]?.key}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {items.length === 0 && <div className="empty" style={{ padding: 24 }}>No matches for “{q}”.</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? ((lastGroup = it.group), <div className="cmdk-group" key={`h-${it.group}`}>{it.group}</div>) : null;
            return (
              <div key={it.key}>
                {head}
                <button id={it.key} role="option" aria-selected={i === sel} className="cmdk-item" onMouseMove={() => setSel(i)} onClick={it.run}>
                  <Icon name={it.icon} size={16} />
                  <span>{it.label}</span>
                  {it.hint && <span className="hint">{it.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span>
          <span><kbd>↵</kbd> to open</span>
          <span style={{ marginLeft: 'auto' }}><kbd>⌘</kbd> <kbd>K</kbd> anytime</span>
        </div>
      </div>
    </div>
  );
}
