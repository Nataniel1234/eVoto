import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { RequireAuth } from './components/guards';
import { Layout } from './components/Layout';
import './index.css';
import { ApiError } from './lib/api';
import { AccountPage } from './pages/Account';
import { AdminAudit, AdminDashboard, AdminElections, AdminLayout, AdminUsers } from './pages/admin/Admin';
import { AdminElectionEdit } from './pages/admin/ElectionEdit';
import { LoginPage, RegisterPage } from './pages/Auth';
import { ElectionDetailPage } from './pages/ElectionDetail';
import { ElectionsPage } from './pages/Elections';
import { VerifyPage } from './pages/Verify';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-6xl font-bold text-slate-300">404</p>
      <p className="mt-4 text-slate-600">Página não encontrada.</p>
      <Link to="/" className="mt-4 inline-block font-semibold text-brand-700 hover:underline">
        Voltar ao início
      </Link>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <ElectionsPage /> },
      { path: 'eleicoes/:id', element: <ElectionDetailPage /> },
      { path: 'verificar', element: <VerifyPage /> },
      { path: 'entrar', element: <LoginPage /> },
      { path: 'registar', element: <RegisterPage /> },
      {
        path: 'conta',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
      {
        path: 'admin',
        element: (
          <RequireAuth admin>
            <AdminLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <AdminDashboard /> },
          { path: 'eleitores', element: <AdminUsers /> },
          { path: 'eleicoes', element: <AdminElections /> },
          { path: 'eleicoes/:id', element: <AdminElectionEdit /> },
          { path: 'auditoria', element: <AdminAudit /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
