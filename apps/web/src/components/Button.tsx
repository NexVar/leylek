import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '../lib/cn';
import { SpinnerInline } from './SpinnerInline';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  block?: boolean;
}

/**
 * Buttons per DESIGN.md:
 *   primary (coral)      — single accent CTA per screen
 *   secondary (outline)  — reversible secondaries (İptal, Geri, Duraklat)
 *   ghost                — toolbar / overflow
 *   destructive (red)    — irreversible removals only
 *
 * Loading swaps the label for a spinner; the click target stays the same.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    block = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium select-none ' +
    'rounded-md transition-[background,color,border,transform] duration-150 ease-out ' +
    'focus-visible:outline-none active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0 ' +
    'whitespace-nowrap';

  const sizes: Record<ButtonSize, string> = {
    md: 'h-10 px-4 text-[15px]',
    lg: 'h-11 px-5 text-[15px]',
  };

  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-accent text-accent-foreground hover:bg-accent-hover ' +
      'disabled:hover:bg-accent shadow-[0_1px_2px_rgba(11,15,26,0.04)]',
    secondary:
      'bg-transparent text-primary border border-primary ' +
      'hover:bg-primary/[0.04] disabled:hover:bg-transparent',
    ghost: 'bg-transparent text-ink hover:bg-surface-sunken disabled:hover:bg-transparent',
    destructive: 'bg-danger text-white hover:bg-danger/90 disabled:hover:bg-danger',
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, sizes[size], variants[variant], block && 'w-full', className)}
      {...rest}
    >
      {loading ? (
        <>
          <SpinnerInline size={16} className="text-current" />
          <span className="opacity-60">{children}</span>
        </>
      ) : (
        <>
          {leadingIcon ? <span className="-ml-0.5">{leadingIcon}</span> : null}
          <span>{children}</span>
          {trailingIcon ? <span className="-mr-0.5">{trailingIcon}</span> : null}
        </>
      )}
    </button>
  );
});
