import { useState } from 'react';
import { useGlobalNotifications } from '../api/hooks';
import { cn } from '../lib/cn';
import { InboxDrawer } from './InboxDrawer';

/**
 * Header bell — surfaces the cross-campaign Co-Pilot inbox.
 *
 * The badge polls `/api/notifications?status=pending` every 30 s while
 * mounted (see `useGlobalNotifications`). When `pendingCount > 0` a coral
 * dot sits over the bell and a numeric badge anchors to the top-right.
 * Click toggles the slide-in `InboxDrawer`; the drawer reads the same
 * cached query, so opening it is a zero-roundtrip operation.
 */
export function BellBadge() {
  const [open, setOpen] = useState(false);
  const { data } = useGlobalNotifications('pending', true);
  const pendingCount = data?.pendingCount ?? 0;
  const hasPending = pendingCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={hasPending ? `${pendingCount} bekleyen öneri — incele` : 'Co-Pilot inbox'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'relative w-9 h-9 rounded-md flex items-center justify-center',
          'text-primary-foreground/80 hover:text-primary-foreground',
          'hover:bg-primary-hover/60 transition-colors duration-150',
        )}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" role="img" aria-hidden="true">
          <path
            d="M9 1.5v1M4.25 7.5a4.75 4.75 0 0 1 9.5 0c0 4 1.75 5.25 1.75 5.25H2.5s1.75-1.25 1.75-5.25ZM7.25 14.5a1.75 1.75 0 0 0 3.5 0"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {hasPending ? (
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1',
              'rounded-full bg-accent text-accent-foreground',
              'text-[11px] font-semibold leading-none',
              'flex items-center justify-center tabular-nums',
              'ring-2 ring-primary animate-pulse-coral',
            )}
            aria-hidden="true"
          >
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        ) : null}
      </button>

      <InboxDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
