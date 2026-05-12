import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface MetricNumberProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: 'default' | 'danger' | 'success' | 'muted';
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Tabular-num metric block. Used in ad cards and the campaign header.
 * Right-align numbers when stacked in a column for visual scanning.
 */
export function MetricNumber({
  label,
  value,
  hint,
  emphasis = 'default',
  align = 'left',
  className,
}: MetricNumberProps) {
  const valueColor = {
    default: 'text-ink',
    danger: 'text-danger',
    success: 'text-success',
    muted: 'text-ink-muted',
  }[emphasis];

  return (
    <div className={cn('flex flex-col gap-1', align === 'right' && 'items-end', className)}>
      <span className="text-label text-ink-muted uppercase tracking-[0.04em]">{label}</span>
      <span className={cn('text-h3 tabular-nums leading-none', valueColor)}>{value}</span>
      {hint ? <span className="text-body-sm text-ink-subtle tabular-nums">{hint}</span> : null}
    </div>
  );
}
