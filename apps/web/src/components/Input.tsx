import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId } from 'react';
import { cn } from '../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: ReactNode;
  error?: string;
  leadingIcon?: ReactNode;
}

/**
 * Form input per DESIGN.md "Inputs":
 *   40px h, 12px radius, 1px border, ink-subtle placeholder.
 *   Focus: border-strong + coral focus halo.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingIcon, className, id, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2 w-full">
      {label ? (
        <label htmlFor={inputId} className="text-label text-ink-muted">
          {label}
        </label>
      ) : null}
      <div className="relative">
        {leadingIcon ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle pointer-events-none">
            {leadingIcon}
          </span>
        ) : null}
        <input
          id={inputId}
          ref={ref}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full h-10 rounded-md bg-surface-raised border',
            error ? 'border-danger' : 'border-border',
            'text-[15px] text-ink placeholder:text-ink-subtle',
            'px-3',
            leadingIcon ? 'pl-9' : null,
            'focus:outline-none focus:border-border-strong focus:shadow-focus',
            className,
          )}
          {...rest}
        />
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-[13px] text-danger leading-[1.4]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-body-sm text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
