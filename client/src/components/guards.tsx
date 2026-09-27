import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '../lib/auth';
import { Spinner } from './ui';

export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}
