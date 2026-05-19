import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLogout } from '../api/hooks';
import { cn } from '../lib/cn';
import { useAuthStore } from '../store/auth';
import { BellBadge } from './BellBadge';
import { Logo } from './Logo';

interface AppShellProps {
  children: ReactNode;
}

/**
 * Top bar + page max-width container.
 * Top bar is navy per DESIGN.md ("anchor surface"), with the Leylek mark
 * on the left and the signed-in user on the right. No coral lives here —
 * coral is reserved for the page-level CTA.
 *
 * The avatar acts as a dropdown trigger: hesap bağlantıları + çıkış live
 * inside. Esc + outside-click + nav both close the menu.
 */
export function AppShell({ children }: AppShellProps) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  const logoutMutation = useLogout();

  const onDashboard =
    location.pathname === '/dashboard' || location.pathname.startsWith('/campaigns');
  const onAccounts = location.pathname === '/accounts';
  const onAdmin = location.pathname === '/admin';

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="sticky top-0 z-40 bg-primary text-primary-foreground border-b border-primary-hover">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          <Link
            to="/dashboard"
            className="flex items-center shrink-0"
            aria-label="Leylek Dashboard"
          >
            <span className="sm:hidden">
              <Logo tone="light" size="sm" />
            </span>
            <span className="hidden sm:block">
              <Logo tone="light" size="md" />
            </span>
          </Link>

          {/* Nav links live in the header on `sm+`; mobile gets a bottom tab bar. */}
          <nav className="hidden sm:flex items-center gap-1 text-[14px]">
            <TopNavLink to="/dashboard" active={onDashboard}>
              Kampanyalar
            </TopNavLink>
            <TopNavLink to="/accounts" active={onAccounts}>
              Hesaplar
            </TopNavLink>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {user ? <BellBadge /> : null}
            {user ? (
              <AvatarMenu
                onLogout={() => {
                  logoutMutation.mutate(undefined, {
                    onSettled: () => navigate('/login', { replace: true }),
                  });
                }}
                onNavigate={(to) => navigate(to)}
              />
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-5 sm:py-8 pb-24 sm:pb-8">
        {children}
      </main>

      <footer className="hidden sm:flex max-w-[1280px] mx-auto px-4 sm:px-6 pb-6 pt-2 text-body-sm text-ink-subtle items-center justify-between">
        <span>© {new Date().getFullYear()} Leylek — Otonom dijital reklam ajansı.</span>
      </footer>

      <nav
        aria-label="Mobil ana gezinme"
        className="sm:hidden fixed left-0 right-0 bottom-0 z-40 border-t border-border bg-surface-raised px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-card-lg"
      >
        <div className="grid grid-cols-3 gap-2">
          <BottomNavLink to="/dashboard" active={onDashboard} icon="campaigns">
            Kampanyalar
          </BottomNavLink>
          <BottomNavLink to="/accounts" active={onAccounts} icon="accounts">
            Hesaplar
          </BottomNavLink>
          <BottomNavLink to="/admin" active={onAdmin} icon="system">
            Sistem
          </BottomNavLink>
        </div>
      </nav>
    </div>
  );
}

function TopNavLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'px-3 py-1.5 rounded-md transition-colors duration-150',
        active
          ? 'bg-primary-hover text-primary-foreground'
          : 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-hover/60',
      )}
    >
      {children}
    </Link>
  );
}

function BottomNavLink({
  to,
  active,
  icon,
  children,
}: {
  to: string;
  active: boolean;
  icon: 'campaigns' | 'accounts' | 'system';
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'h-12 rounded-md flex flex-col items-center justify-center gap-1 text-[12px] font-medium',
        'transition-colors duration-150',
        active ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:bg-surface-sunken',
      )}
    >
      <BottomNavIcon name={icon} />
      <span>{children}</span>
    </Link>
  );
}

function BottomNavIcon({ name }: { name: 'campaigns' | 'accounts' | 'system' }) {
  if (name === 'campaigns') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path
          d="M3 5.5h12M3 9h12M3 12.5h7M4.5 3h9A1.5 1.5 0 0 1 15 4.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === 'accounts') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path
          d="M3.5 13.5C3.5 11.7 5.7 10.4 9 10.4s5.5 1.3 5.5 3.1M9 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3 4h12M3 9h12M3 14h12M5 4v10M9 4v10M13 4v10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface AvatarMenuProps {
  onLogout: () => void;
  onNavigate: (to: string) => void;
}

function AvatarMenu({ onLogout, onNavigate }: AvatarMenuProps) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const initial = (user.name ?? user.email).slice(0, 1).toUpperCase();

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md pl-2 pr-2.5 py-1',
          'hover:bg-primary-hover/60 transition-colors duration-150',
        )}
      >
        <div className="text-right hidden sm:block">
          <div className="text-[13px] font-medium leading-tight">{user.name ?? user.email}</div>
          <div className="text-[11px] text-primary-foreground/60 font-mono leading-tight">
            {user.email}
          </div>
        </div>
        <div className="w-9 h-9 rounded-md bg-accent text-accent-foreground font-semibold flex items-center justify-center text-[14px]">
          {initial}
        </div>
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full mt-2 w-56 bg-surface-raised text-ink rounded-md',
            'shadow-card-lg border border-border overflow-hidden z-30 animate-fade-up',
          )}
        >
          <div className="px-3 py-2.5 border-b border-border">
            <div className="text-body-sm font-medium text-ink truncate">
              {user.name ?? user.email}
            </div>
            <div className="font-mono text-[11px] text-ink-subtle truncate">{user.email}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate('/accounts');
            }}
            className="w-full text-left px-3 py-2 text-body-sm hover:bg-surface-sunken flex items-center gap-2"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              role="img"
              aria-hidden="true"
            >
              <path
                d="M2 11.5C2 9.5 4 8 7 8s5 1.5 5 3.5M7 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Hesap bağlantıları
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate('/admin');
            }}
            className="w-full text-left px-3 py-2 text-body-sm hover:bg-surface-sunken flex items-center gap-2 border-t border-border"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              role="img"
              aria-hidden="true"
            >
              <path
                d="M2 3h10M2 7h10M2 11h10M2 3v8M5 3v8M9 3v8M12 3v8"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            Sistem durumu
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="w-full text-left px-3 py-2 text-body-sm hover:bg-surface-sunken flex items-center gap-2 border-t border-border"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              role="img"
              aria-hidden="true"
            >
              <path
                d="M5.5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.5M8 4.5 10.5 7 8 9.5M5 7h5.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Çıkış yap
          </button>
        </div>
      ) : null}
    </div>
  );
}
