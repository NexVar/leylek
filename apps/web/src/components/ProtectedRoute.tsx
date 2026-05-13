import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMe } from '../api/hooks';
import { useAuthStore } from '../store/auth';
import { Logo } from './Logo';
import { SpinnerInline } from './SpinnerInline';

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Calls GET /api/auth/me. The gateway now returns 200 + `{user: null}` when
 * no valid session exists (no devtools-red 401 on first paint), so the auth
 * check collapses to a single `meQuery.data?.user` test.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation();
  const meQuery = useMe();
  const setUser = useAuthStore((s) => s.setUser);
  const clearUser = useAuthStore((s) => s.clearUser);

  useEffect(() => {
    if (meQuery.data?.user) {
      setUser(meQuery.data.user);
    } else if (meQuery.data && meQuery.data.user === null) {
      clearUser();
    }
  }, [meQuery.data, setUser, clearUser]);

  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface">
        <Logo size="md" />
        <div className="flex items-center gap-2 text-ink-muted text-body-sm">
          <SpinnerInline className="text-accent" />
          Oturum doğrulanıyor…
        </div>
      </div>
    );
  }

  if (!meQuery.data?.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
