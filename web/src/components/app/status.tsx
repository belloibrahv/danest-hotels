import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { RESERVATION_STATUS_LABELS, type ReservationStatus, type RoomStatus } from '../../../../shared/constants';
import { cn } from '@/lib/utils';

/** Quiet status pill: tinted background, coloured dot, readable text. Never colour alone. */
const pill = cva('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      danger: 'bg-danger-soft text-destructive',
      info: 'bg-info-soft text-info',
      brand: 'bg-brand-soft text-brand-ink',
      solid: 'bg-primary text-primary-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export type Tone = NonNullable<VariantProps<typeof pill>['tone']>;

export function StatusPill({ tone, dot = true, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn(pill({ tone }), className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </span>
  );
}

const RES_TONE: Record<ReservationStatus, Tone> = { pending: 'brand', confirmed: 'info', checked_in: 'success', checked_out: 'neutral', cancelled: 'danger' };
export function ReservationStatusPill({ status }: { status: ReservationStatus }) {
  return <StatusPill tone={RES_TONE[status]}>{RESERVATION_STATUS_LABELS[status]}</StatusPill>;
}

export const ROOM_LABEL: Record<RoomStatus, string> = { available: 'Ready', occupied: 'Occupied', cleaning: 'To clean', maintenance: 'Out of order' };
export const ROOM_TONE: Record<RoomStatus, Tone> = { available: 'success', occupied: 'info', cleaning: 'warning', maintenance: 'danger' };
export function RoomStatusPill({ status }: { status: RoomStatus }) {
  return <StatusPill tone={ROOM_TONE[status]}>{ROOM_LABEL[status]}</StatusPill>;
}

export function VipBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded border border-brand/40 bg-brand-soft px-1.5 text-[10px] font-semibold tracking-wider text-brand-ink uppercase', className)}>
      VIP
    </span>
  );
}
