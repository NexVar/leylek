import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLogout } from '../api/hooks';
import { cn } from '../lib/cn';
import { useAuthStore } from '../store/auth';
import { Logo } from './Logo';

interface AppShellProps {
  children: ReactNode;
}

/**
 * Top bar + page max-width container.
 * Top bar is navy per DESIGN.md ("anchor surface"), with the Leylek mark
 * on the left and the signed-in user on the right. No coral lives here —
 * coral is reserved for the page-level CTA.
 */
export function AppShell({ children }: AppShellProps) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  const logoutMutation = useLogout();

  const onDashboard = location.pathname === '/dashboard';

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="bg-primary text-primary-foreground border-b border-primary-hover">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center" aria-label="Leylek Dashboard">
            <Logo tone="light" size="md" />
          </Link>

          <nav className="flex items-center gap-1 text-[14px]">
            <Link
              to="/dashboard"
              className={cn(
                'px-3 py-1.5 rounded-md transition-colors duration-150',
                onDashboard
                  ? 'bg-primary-hover text-primary-foreground'
                  : 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-hover/60',
              )}
            >
              Kampanyalar
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2">
                <div className="text-right hidden sm:block">
                  <div className="text-[13px] font-medium leading-tight">
                    {user.name ?? user.email}
                  </div>
                  <div className="text-[11px] text-primary-foreground/60 font-mono leading-tight">
                    {user.email}
                  </div>
                </div>
                <div className="w-9 h-9 rounded-md bg-accent text-accent-foreground font-semibold flex items-center justify-center text-[14px]">
                  {(user.name ?? user.email).slice(0, 1).toUpperCase()}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                logoutMutation.mutate(undefined, {
                  onSettled: () => navigate('/login', { replace: true }),
                });
              }}
              className="text-[13px] text-primary-foreground/70 hover:text-primary-foreground px-2 py-1 rounded-sm"
            >
              Çıkış
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-8">{children}</main>

      <footer className="max-w-[1280px] mx-auto px-6 pb-6 pt-2 text-body-sm text-ink-subtle flex items-center justify-between">
        <span>© {new Date().getFullYear()} Leylek — Otonom dijital reklam ajansı.</span>
        <span className="font-mono text-[11px]">v1.0 · sim runtime</span>
      </footer>
    </div>
  );
}
