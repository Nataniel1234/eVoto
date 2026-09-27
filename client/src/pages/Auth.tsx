import { useMutation } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert, Button, Card, Field } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useLogin } from '../lib/auth';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand-900 text-white">
          <Lock className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
      </div>
      <Card>{children}</Card>
    </div>
  );
}

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    login.mutate(
      { email: String(f.get('email')), password: String(f.get('password')) },
      { onSuccess: () => navigate(from, { replace: true }) },
    );
  };

  return (
    <AuthShell title="Entrar" subtitle="Aceda à sua conta de eleitor">
      <form onSubmit={onSubmit} className="space-y-4">
        {login.error && <Alert>{login.error.message}</Alert>}
        <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
        <Field label="Palavra-passe" name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" className="w-full" loading={login.isPending}>
          Entrar
        </Button>
        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Ainda não tem conta?{' '}
          <Link to="/registar" className="font-semibold text-brand-700 hover:underline dark:text-brand-200">
            Registe-se
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const register = useMutation({
    mutationFn: (b: Record<string, string>) => api.post<{ message: string }>('/auth/register', b),
  });
  const fieldErr = (k: string) =>
    register.error instanceof ApiError ? register.error.details?.[k]?.[0] : undefined;

  // Validação local com mensagens visíveis (nunca falhar em silêncio).
  const pwProblem =
    pw.length < 10
      ? 'Mínimo de 10 caracteres'
      : !/[a-zA-Z]/.test(pw)
        ? 'Deve conter letras'
        : !/\d/.test(pw)
          ? 'Deve conter números'
          : undefined;
  const confirmProblem = confirm !== pw ? 'As palavras-passe não coincidem' : undefined;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    if (pwProblem || confirmProblem) return; // os erros ficam visíveis junto dos campos
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const { confirm: _c, ...body } = f;
    register.mutate(body);
  };

  if (register.isSuccess) {
    return (
      <AuthShell title="Registo concluído" subtitle="Obrigado pelo seu registo">
        <Alert kind="success">{register.data.message}</Alert>
        <Link to="/entrar" className="mt-4 block text-center text-sm font-semibold text-brand-700 hover:underline">
          Ir para o login
        </Link>
      </AuthShell>
    );
  }

  const strength = [pw.length >= 10, /[a-zA-Z]/.test(pw), /\d/.test(pw), /[^a-zA-Z0-9]/.test(pw), pw.length >= 14].filter(
    Boolean,
  ).length;

  return (
    <AuthShell title="Criar conta" subtitle="A conta será validada por um administrador antes de poder votar">
      <form onSubmit={onSubmit} className="space-y-4">
        {register.error && <Alert>{register.error.message}</Alert>}
        <Field label="Nome completo" name="name" autoComplete="name" required minLength={3} error={fieldErr('name')} />
        <Field label="Email" name="email" type="email" autoComplete="email" required error={fieldErr('email')} />
        <Field
          label="Nº do documento de identificação"
          name="document"
          required
          hint="Guardado apenas como hash — garante uma conta por pessoa."
          error={fieldErr('document')}
        />
        <div>
          <Field
            label="Palavra-passe"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            hint="Mínimo 10 caracteres, com letras e números."
            error={fieldErr('password') ?? (submitted ? pwProblem : undefined)}
          />
          <div className="mt-2 flex gap-1" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded ${
                  i < strength ? (strength < 3 ? 'bg-red-500' : strength < 5 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-200 dark:bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>
        <Field
          label="Confirmar palavra-passe"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={submitted || confirm.length > 0 ? confirmProblem : undefined}
        />
        <Button type="submit" className="w-full" loading={register.isPending}>
          Criar conta
        </Button>
        <p className="text-center text-sm text-slate-600 dark:text-slate-400">
          Já tem conta?{' '}
          <Link to="/entrar" className="font-semibold text-brand-700 hover:underline dark:text-brand-200">
            Entrar
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}