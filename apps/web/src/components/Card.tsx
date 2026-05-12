import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  raised?: boolean;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children?: ReactNode;
}

/**
 * Surface-raised card. 12px radius, hairline border, surface-sm shadow.
 * `interactive` lifts to shadow-md on hover for click-through cards
 * (campaign list rows).
 */
export function Card({
  raised: _raised = true,
  interactive = false,
  padding = 'lg',
  className,
  children,
  ...rest
}: CardProps) {
  const paddingClass = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  }[padding];

  return (
    <div
      className={cn(
        'bg-surface-raised border border-border rounded-md shadow-card-sm',
        paddingClass,
        interactive &&
          'cursor-pointer transition-shadow duration-150 hover:shadow-card-md focus-within:shadow-card-md',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}

export function CardHeader({
  title,
  subtitle,
  trailing,
  className,
  children,
  ...rest
}: CardHeaderProps) {
  if (children) {
    return (
      <div className={cn('flex items-start justify-between gap-4', className)} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <div className={cn('flex items-start justify-between gap-4', className)} {...rest}>
      <div className="min-w-0">
        {title ? <div className="text-h3 text-ink">{title}</div> : null}
        {subtitle ? <div className="text-body-sm text-ink-muted mt-1">{subtitle}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
