import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useMe } from '../api/hooks';
import { useAuthStore } from '../store/auth';
import { Logo } from './Logo';
import { SpinnerInline } from './SpinnerInline';

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Calls GET /api/auth/me and redirects to /login on 401.
 * On 200, populates the auth store so synchronous consumers see the user.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation();
  const meQuery = useMe();
  const setUser = useAuthStore((s) => s.setUser);
  const clearUser = useAuthStore((s) => s.clearUser);

  useEffect(() => {
    if (meQuery.data?.user) {
      setUser(meQuery.data.user);
    }
  }, [meQuery.data, setUser]);

  useEffect(() => {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      clearUser();
    }
  }, [meQuery.error, clearUser]);

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

  const isAuthError = meQuery.error instanceof ApiError && meQuery.error.status === 401;

  if (isAuthError || !meQuery.data?.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
