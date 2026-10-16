import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RESERVATION_STATUS_LABELS, type ReservationStatus } from '../../../shared/constants';

// ---------- icons (inline, 1.6px stroke, currentColor) ----------

const paths: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  bed: <><path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  glass: <><path d="M7 3h10l-1 8a4 4 0 0 1-8 0L7 3zM12 15v6M8 21h8" /></>,
  sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 7H6" /></>,
  receipt: <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3z" /><path d="M9 8h6M9 12h6" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 6-7" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 21a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 4 7" /></>,
  logout: <><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  download: <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />,
  check: <path d="m5 12 5 5L20 7" />,
  shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />,
  pin: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  wave: <path d="M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M7 12V5a2 2 0 0 1 4 0M13 12V5a2 2 0 0 1 4 0M7 8h10" />,
  dumbbell: <path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" />,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  wifi: <path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01" />,
  car: <><path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM5 11h14" /><circle cx="7.5" cy="16" r="1.5" /><circle cx="16.5" cy="16" r="1.5" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 3" /></>,
  grid: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v16" /><rect x="10" y="11" width="8" height="3" rx="1" fill="currentColor" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  print: <><path d="M6 9V3h12v6M6 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-2" /><rect x="6" y="14" width="12" height="7" /></>,
  swap: <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  device: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  phoneDevice: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  palette: <><circle cx="12" cy="12" r="9" /><circle cx="8" cy="10" r="1.3" fill="currentColor" /><circle cx="12" cy="7.5" r="1.3" fill="currentColor" /><circle cx="16" cy="10" r="1.3" fill="currentColor" /><path d="M12 21a2.5 2.5 0 0 1 0-5h1.5" /></>,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
};

export function Icon({ name, size = 18, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {paths[name]}
    </svg>
  );
}

// ---------- layout bits ----------

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

export function Card({ title, sub, action, children, pad = true }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="card">
      {title && (
        <div className="card-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function Stat({ label, value, foot, icon }: { label: ReactNode; value: ReactNode; foot?: ReactNode; icon?: string }) {
  return (
    <div className="card stat">
      <div className="label">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  return <SkeletonRows rows={4} />;
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? (
    <div className="error-box" role="alert">
      {error}
    </div>
  ) : null;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_TONE: Record<ReservationStatus, string> = { pending: 'gold', confirmed: 'blue', checked_in: 'green', checked_out: '', cancelled: 'red' };
export function StatusBadge({ status }: { status: ReservationStatus }) {
  return <span className={`badge ${STATUS_TONE[status]}`}>{RESERVATION_STATUS_LABELS[status]}</span>;
}

// ---------- modal ----------

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close" data-close>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- toast ----------

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/** Form submit helper: tracks busy/error state and never double-submits. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useCallback(async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy]);
  return { busy, error, setError, submit };
}

// ---------- drawer: a side sheet for records you work on (reservations, guests) ----------

export function Drawer({ title, sub, onClose, children, actions }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-back')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {sub && <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>{sub}</div>}
          </div>
          <div className="row" style={{ marginLeft: 'auto', flexWrap: 'nowrap' }}>
            {actions}
            <button className="btn ghost sm" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          </div>
        </div>
        {children}
      </aside>
    </>
  );
}

export function EmptyState({ illo, title, children }: { illo: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {illo}
      <b style={{ color: 'var(--ink)', display: 'block', marginBottom: 4 }}>{title}</b>
      {children}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="stack" style={{ padding: 20, gap: 12 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 18, width: `${90 - ((i * 13) % 35)}%` }} />
      ))}
    </div>
  );
}
