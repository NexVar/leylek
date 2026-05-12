import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' | 'navy';

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  dot?: boolean;
  children: ReactNode;
}

/**
 * Status pill — h-6, 8px x-padding, 6px radius, 12px font, weight 500.
 * Background = color/16, text = color (per DESIGN.md "Status pills").
 * `dot` adds a left-side 6px dot for timeline rows.
 */
export function Pill({ tone = 'neutral', dot = false, className, children, ...rest }: PillProps) {
  const tones: Record<PillTone, { bg: string; text: string; dot: string }> = {
    success: {
      bg: 'bg-[color-mix(in_srgb,var(--color-success)_16%,transparent)]',
      text: 'text-success',
      dot: 'bg-success',
    },
    warning: {
      bg: 'bg-[color-mix(in_srgb,var(--color-warning)_16%,transparent)]',
      text: 'text-warning',
      dot: 'bg-warning',
    },
    danger: {
      bg: 'bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)]',
      text: 'text-danger',
      dot: 'bg-danger',
    },
    info: {
      bg: 'bg-[color-mix(in_srgb,var(--color-info)_16%,transparent)]',
      text: 'text-info',
      dot: 'bg-info',
    },
    neutral: {
      bg: 'bg-surface-sunken',
      text: 'text-ink-muted',
      dot: 'bg-ink-subtle',
    },
    accent: {
      bg: 'bg-accent-tint',
      text: 'text-accent-hover',
      dot: 'bg-accent',
    },
    navy: {
      bg: 'bg-primary',
      text: 'text-primary-foreground',
      dot: 'bg-primary-foreground',
    },
  };

  const t = tones[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 px-2 rounded-sm text-[12px] font-medium leading-none whitespace-nowrap',
        t.bg,
        t.text,
        className,
      )}
      {...rest}
    >
      {dot ? <span className={cn('w-1.5 h-1.5 rounded-full', t.dot)} aria-hidden /> : null}
      {children}
    </span>
  );
}
