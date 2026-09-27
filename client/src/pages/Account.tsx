import { useMutation } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, PageHeader } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/auth';
import { statusLabel } from '../lib/format';

export function AccountPage() {
  const { data: user } = useMe();
  const change = useMutation({
    mutationFn: (b: { current: string; next: string }) => api.post('/auth/change-password', b),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    change.mutate(
      { current: String(f.get('current')), next: String(f.get('next')) },
      { onSuccess: () => form.reset() },
    );
  };
  if (!user) return null;
  const nextErr = change.error instanceof ApiError ? change.error.details?.next?.[0] : undefined;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="A minha conta" />
      <Card>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Nome</dt>
            <dd className="font-medium">{user.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Perfil</dt>
            <dd className="font-medium">{user.role === 'admin' ? 'Administrador' : 'Eleitor'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Estado</dt>
            <dd>
              <Badge
                className={
                  user.status === 'approved'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }
              >
                {statusLabel[user.status]}
              </Badge>
            </dd>
          </div>
        </dl>
      </Card>
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Alterar palavra-passe</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          {change.isSuccess && <Alert kind="success">Palavra-passe alterada. As outras sessões foram terminadas.</Alert>}
          {change.error && !nextErr && <Alert>{change.error.message}</Alert>}
          <Field label="Palavra-passe actual" name="current" type="password" autoComplete="current-password" required />
          <Field
            label="Nova palavra-passe"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            error={nextErr}
          />
          <Button type="submit" loading={change.isPending}>
            Guardar
          </Button>
        </form>
      </Card>
    </div>
  );
}
