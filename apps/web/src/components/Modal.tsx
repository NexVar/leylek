import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { cn } from '../lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Disable backdrop + Esc close (e.g. while a mutation is in-flight). */
  locked?: boolean;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

/**
 * Centred-card modal per DESIGN.md "Toast / decision popover" but at full
 * modal weight: 16px radius, 24px padding, shadow-lg, dim navy backdrop.
 *
 * - Esc + backdrop click dismiss (unless `locked`).
 * - Body scroll is frozen while open.
 * - Focus halo on the close button uses the global coral ring.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  locked = false,
  size = 'md',
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, locked]);

  if (!open) return null;

  const widths: Record<NonNullable<ModalProps['size']>, string> = {
    sm: 'max-w-[420px]',
    md: 'max-w-[520px]',
    lg: 'max-w-[640px]',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
    >
      <button
        type="button"
        aria-label="Kapat"
        tabIndex={-1}
        onClick={() => {
          if (!locked) onClose();
        }}
        className="absolute inset-0 bg-primary/40 animate-fade-up"
      />
      <div
        className={cn(
          'relative w-full bg-surface-raised rounded-lg shadow-card-lg border border-border',
          'animate-toast-in p-6 flex flex-col gap-5',
          widths[size],
        )}
      >
        {(title || subtitle) && (
          <header className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5 min-w-0">
              {title ? <h2 className="text-h2 text-ink">{title}</h2> : null}
              {subtitle ? <p className="text-body-md text-ink-muted">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!locked) onClose();
              }}
              disabled={locked}
              aria-label="Kapat"
              className="text-ink-subtle hover:text-ink-muted -mr-1 -mt-1 p-1.5 rounded-sm disabled:opacity-50"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                role="img"
                aria-labelledby="modal-close-title"
              >
                <title id="modal-close-title">Kapat</title>
                <path
                  d="M5 5l8 8M13 5l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
