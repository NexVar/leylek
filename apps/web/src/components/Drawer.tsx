import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { cn } from '../lib/cn';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Visible drawer width on desktop; full-width on mobile. */
  width?: 'sm' | 'md' | 'lg';
  /** Accessible label for the dialog (string only — used by aria-label). */
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * Right-side slide-in panel per DESIGN.md surface hierarchy.
 *
 * - Backdrop click + Esc dismiss
 * - Body scroll frozen while open
 * - Slide-in animation on the panel, fade-up on the backdrop
 * - Mobile: full width; desktop: capped at one of three widths
 *
 * Composition: the consumer renders header/body/footer inside.
 */
export function Drawer({ open, onClose, width = 'md', ariaLabel, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths: Record<NonNullable<DrawerProps['width']>, string> = {
    sm: 'sm:max-w-[320px]',
    md: 'sm:max-w-[380px]',
    lg: 'sm:max-w-[460px]',
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={ariaLabel} className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Kapat"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-primary/40 animate-fade-up"
      />
      <aside
        className={cn(
          'absolute right-0 top-0 bottom-0 w-full bg-surface-raised',
          'border-l border-border shadow-card-lg overflow-hidden',
          'flex flex-col animate-drawer-in',
          widths[width],
        )}
      >
        {children}
      </aside>
    </div>
  );
}

interface DrawerHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
}

export function DrawerHeader({ title, subtitle, onClose }: DrawerHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border">
      <div className="flex flex-col gap-1 min-w-0">
        <h2 className="text-h3 text-ink">{title}</h2>
        {subtitle ? <p className="text-body-sm text-ink-muted leading-[1.5]">{subtitle}</p> : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Kapat"
        className="text-ink-subtle hover:text-ink-muted -mr-1 -mt-1 p-1.5 rounded-sm"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          role="img"
          aria-labelledby="drawer-close-title"
        >
          <title id="drawer-close-title">Kapat</title>
          <path
            d="M5 5l8 8M13 5l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </header>
  );
}
