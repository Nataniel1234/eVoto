import clsx from 'clsx';
import { LogOut, Menu, ShieldCheck, Vote, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useLogout, useMe } from '../lib/auth';

export function Layout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const links = [
    { to: '/', label: 'Eleições', end: true },
    { to: '/verificar', label: 'Verificar recibo' },
    ...(user ? [{ to: '/conta', label: 'A minha conta' }] : []),
    ...(user?.role === 'admin' ? [{ to: '/admin', label: 'Administração' }] : []),
  ];

  const navCls = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'rounded-lg px-3 py-2 text-sm font-medium transition',
      isActive
        ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white',
    );

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50">
        Saltar para o conteúdo
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-brand-900 dark:text-white">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-900 text-white">
              <Vote className="size-5" aria-hidden />
            </span>
            eVoto
          </Link>
          <nav className="hidden flex-1 gap-1 md:flex" aria-label="Principal">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navCls}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 md:flex">
            {user ? (
              <>
                <span className="text-sm text-slate-600 dark:text-slate-400">{user.name}</span>
                <button
                  onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/entrar') })}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <LogOut className="size-4" aria-hidden /> Sair
                </button>
              </>
            ) : (
              <>
                <NavLink to="/entrar" className={navCls}>
                  Entrar
                </NavLink>
                <Link
                  to="/registar"
                  className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800"
                >
                  Registar
                </Link>
              </>
            )}
          </div>
          <button
            className="ml-auto rounded-lg p-2 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={open}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open && (
          <nav className="flex flex-col gap-1 border-t border-slate-200 p-4 md:hidden dark:border-slate-800" aria-label="Móvel">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navCls} onClick={() => setOpen(false)}>
                {l.label}
              </NavLink>
            ))}
            {user ? (
              <button
                className="rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600"
                onClick={() => {
                  setOpen(false);
                  logout.mutate(undefined, { onSettled: () => navigate('/entrar') });
                }}
              >
                Sair
              </button>
            ) : (
              <>
                <NavLink to="/entrar" className={navCls} onClick={() => setOpen(false)}>
                  Entrar
                </NavLink>
                <NavLink to="/registar" className={navCls} onClick={() => setOpen(false)}>
                  Registar
                </NavLink>
              </>
            )}
          </nav>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800">
        <p className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden />
          Voto secreto · Boletins cifrados (AES-256-GCM) · Registo de auditoria verificável
        </p>
      </footer>
    </div>
  );
}
