import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { naira } from '@/lib/api';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="mb-1 text-xs font-medium text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A titled card section. `flush` removes body padding for tables and lists. */
export function Section({ title, description, action, children, flush, className }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <Card className={cn('gap-0 py-0 shadow-xs', className)}>
      {title && (
        <CardHeader className="border-b px-5 py-4 [.border-b]:pb-4">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={cn(flush ? 'p-0' : 'p-5')}>{children}</CardContent>
    </Card>
  );
}

export function StatCard({ label, value, hint, icon: Icon, trend, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; trend?: { value: number; label?: string } | null; className?: string }) {
  return (
    <Card className={cn('gap-0 py-0 shadow-xs', className)}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {(hint || trend) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {trend && trend.value !== 0 && Number.isFinite(trend.value) && (
              <span className={cn('font-medium tabular-nums', trend.value > 0 ? 'text-success' : 'text-destructive')}>
                {trend.value > 0 ? '↑' : '↓'} {Math.abs(Math.round(trend.value * 100))}%
              </span>
            )}
            {trend?.label && <span>{trend.label}</span>}
            {hint && <span className="min-w-0">{hint}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
          <Icon className="size-5" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Money({ value, className, signed }: { value: number; className?: string; signed?: boolean }) {
  return <span className={cn('tabular-nums', signed && value < 0 && 'text-destructive', className)}>{naira(value)}</span>;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${92 - ((i * 13) % 34)}%` }} />
      ))}
    </div>
  );
}

export function KeyValue({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/20 bg-danger-soft px-3 py-2 text-sm text-destructive">
      {error}
    </div>
  );
}
