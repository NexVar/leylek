import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  hint?: ReactNode;
}

interface SegmentedToggleProps<V extends string> {
  value: V;
  onChange: (next: V) => void;
  options: ReadonlyArray<SegmentedOption<V>>;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Two-or-three position pill toggle. Used for Otopilot / Co-Pilot.
 * Pill-shaped track on surface-sunken, white "thumb" with primary text on
 * the active option. Keyboard: arrow keys advance.
 */
export function SegmentedToggle<V extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
  className,
}: SegmentedToggleProps<V>) {
  return (
    <fieldset className={cn('flex flex-col gap-2 border-0 p-0 m-0 min-w-0', className)}>
      {label ? <legend className="text-label text-ink-muted mb-2">{label}</legend> : null}
      <div className="inline-flex items-center bg-surface-sunken rounded-md p-1 gap-1 self-start">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const idx = options.findIndex((o) => o.value === value);
                  const dir = e.key === 'ArrowRight' ? 1 : -1;
                  const next = options[(idx + dir + options.length) % options.length];
                  if (next) onChange(next.value);
                }
              }}
              className={cn(
                'h-8 px-3 rounded-sm text-[13px] font-medium leading-none',
                'transition-[background,color] duration-150 ease-out',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                active
                  ? 'bg-surface-raised text-primary shadow-card-sm'
                  : 'bg-transparent text-ink-muted hover:text-ink',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
