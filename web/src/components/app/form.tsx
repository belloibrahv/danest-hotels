import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** Label + control + hint. Pass `id` through to the control via the render prop. */
export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-foreground/80">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Whole-naira amounts: digits only, ₦ prefix, tabular figures. */
export function MoneyInput({ value, onChange, className, ...rest }: { value: string; onChange: (v: string) => void; className?: string } & Omit<React.ComponentProps<'input'>, 'value' | 'onChange'>) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <span className="pointer-events-none absolute left-3 text-sm leading-none text-muted-foreground">₦</span>
      <Input inputMode="numeric" className="pl-7 tabular-nums" value={value ? Number(value).toLocaleString('en-NG') : ''} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} {...rest} />
    </div>
  );
}

export interface Option {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** shadcn Select with a simple options array. Empty string means "nothing chosen". */
export function SelectField({ value, onChange, options, placeholder, className, id, disabled }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; className?: string; id?: string; disabled?: boolean }) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={cn('w-full', className)}>
        <SelectValue placeholder={placeholder ?? 'Choose…'} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const toDate = (iso: string) => new Date(`${iso}T12:00:00`);
const toIso = (d: Date) => format(d, 'yyyy-MM-dd');

/** Date picker that speaks ISO dates ("2026-10-16"), with optional min/max. */
export function DateInput({ value, onChange, min, max, className, id, placeholder = 'Pick a date' }: { value: string; onChange: (v: string) => void; min?: string; max?: string; className?: string; id?: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" className={cn('w-full justify-start px-3 font-normal', !value && 'text-muted-foreground', className)}>
          <CalendarIcon className="size-4 opacity-60" />
          {value ? format(toDate(value), 'EEE d MMM yyyy') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? toDate(value) : undefined}
          defaultMonth={value ? toDate(value) : min ? toDate(min) : undefined}
          onSelect={(d) => {
            if (d) onChange(toIso(d));
            setOpen(false);
          }}
          disabled={[...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])]}
        />
      </PopoverContent>
    </Popover>
  );
}

// ---------- confirm dialog (replaces window.confirm) ----------

type ConfirmOptions = { title: string; description?: ReactNode; confirmLabel?: string; destructive?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});
  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const close = (v: boolean) => {
    resolver.current(v);
    setOpts(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{opts?.title}</DialogTitle>
            {opts?.description && <DialogDescription>{opts.description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={opts?.destructive ? 'destructive' : 'default'} onClick={() => close(true)} autoFocus>
              {opts?.confirmLabel ?? 'Continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export function useFieldId() {
  return useId();
}

// ---------- void with a reason (till and takings mistakes) ----------

/** A small "Void" action that asks why before it removes an entry. The reason goes to the activity log. */
export function VoidButton({ label, onVoid, verb = 'Void' }: { label: string; onVoid: (reason: string) => Promise<unknown>; verb?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" aria-label={`${verb} ${label}`}>
          {verb}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await onVoid(reason.trim());
              setOpen(false);
              setReason('');
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="text-sm font-medium">{verb} {label}?</div>
          <Field label="Why" htmlFor={id} hint="Kept in the activity log.">
            <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Rang up twice" autoFocus />
          </Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" variant="destructive" size="sm" disabled={busy || reason.trim().length < 3}>
            {verb}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
