import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Ban, CheckCircle2, Link2, Plus, Search, ShieldAlert, ShieldCheck, UserCog } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { Alert, Badge, Button, Card, Empty, Field, PageHeader, PhaseBadge, Spinner, TextArea } from '../../components/ui';
import { api, ApiError, type AdminUser, type AuditEntry, type ChainStatus, type Election, type UserStatus } from '../../lib/api';
import { fmtDate, fmtNumber, fromLocalInput, statusLabel, toLocalInput } from '../../lib/format';

// ---------------------------------------------------------------- Layout

export function AdminLayout() {
  const tabs = [
    { to: '/admin', label: 'Painel', end: true },
    { to: '/admin/eleitores', label: 'Eleitores' },
    { to: '/admin/eleicoes', label: 'Eleições' },
    { to: '/admin/auditoria', label: 'Auditoria' },
  ];
  return (
    <>
      <div className="mb-8 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              clsx(
                '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium',
                isActive
                  ? 'border-brand-700 text-brand-800 dark:border-brand-200 dark:text-brand-100'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </>
  );
}

// ---------------------------------------------------------------- Painel

interface Stats {
  users: { total: number; pending: number; approved: number; suspended: number };
  elections: { total: number; draft: number; closed: number };
  ballots: number;
  auditChain: ChainStatus;
}

export function AdminDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<Stats>('/admin/stats'),
    refetchInterval: 15_000,
  });
  if (isLoading) return <Spinner />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return null;
  const tiles = [
    ['Eleitores aprovados', data.users.approved],
    ['A aguardar validação', data.users.pending],
    ['Eleições', data.elections.total],
    ['Boletins registados', data.ballots],
  ] as const;
  return (
    <>
      <PageHeader title="Painel de administração" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map(([k, v]) => (
          <Card key={k} className="p-5">
            <p className="text-sm text-slate-500">{k}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums">{fmtNumber(v)}</p>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ChainCard chain={data.auditChain} />
        {data.users.pending > 0 && (
          <Card>
            <h2 className="font-semibold">Validações pendentes</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Há {data.users.pending} registo(s) a aguardar aprovação.
            </p>
            <Link to="/admin/eleitores?estado=pending" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">
              Rever agora →
            </Link>
          </Card>
        )}
      </div>
    </>
  );
}

function ChainCard({ chain }: { chain: ChainStatus }) {
  return (
    <Card className={clsx(!chain.valid && 'ring-red-500')}>
      <div className="flex items-center gap-3">
        {chain.valid ? (
          <ShieldCheck className="size-8 text-emerald-600" aria-hidden />
        ) : (
          <ShieldAlert className="size-8 text-red-600" aria-hidden />
        )}
        <div>
          <h2 className="font-semibold">Cadeia de auditoria {chain.valid ? 'íntegra' : 'COMPROMETIDA'}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {chain.entries} entradas verificadas
            {!chain.valid && ` — inconsistência na entrada #${chain.brokenAt}`}
          </p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Eleitores

export function AdminUsers() {
  const qc = useQueryClient();
  const initial = new URLSearchParams(location.search).get('estado') as UserStatus | null;
  const [status, setStatus] = useState<UserStatus | ''>(initial ?? '');
  const [q, setQ] = useState('');
  const params = new URLSearchParams({ ...(status && { status }), ...(q && { q }) });
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'users', status, q],
    queryFn: () => api.get<{ users: AdminUser[] }>(`/admin/users?${params}`),
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: string; status?: UserStatus; role?: 'voter' | 'admin' }) => api.patch(`/admin/users/${id}`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });

  return (
    <>
      <PageHeader title="Eleitores" subtitle="Valide registos, suspenda contas e gira permissões." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pesquisar por nome ou email"
            aria-label="Pesquisar"
            className="w-full rounded-lg border-0 py-2.5 pl-9 pr-3 text-sm ring-1 ring-inset ring-slate-300 dark:bg-slate-900 dark:ring-slate-700"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as UserStatus | '')}
          aria-label="Filtrar por estado"
          className="rounded-lg border-0 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-300 dark:bg-slate-900 dark:ring-slate-700"
        >
          <option value="">Todos os estados</option>
          <option value="pending">Pendentes</option>
          <option value="approved">Aprovados</option>
          <option value="suspended">Suspensos</option>
        </select>
      </div>
      {update.error && (
        <div className="mb-4">
          <Alert>{update.error.message}</Alert>
        </div>
      )}
      {isLoading && <Spinner />}
      {error && <Alert>{error.message}</Alert>}
      {data && data.users.length === 0 && <Empty>Nenhum utilizador encontrado.</Empty>}
      {data && data.users.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Registo</th>
                <th className="px-4 py-3 text-right">Acções</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {u.name} {u.role === 'admin' && <Badge className="ml-1 bg-brand-100 text-brand-900">admin</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{u.documentHint}</td>
                  <td className="px-4 py-3">
                    <Badge
                      className={clsx(
                        u.status === 'approved' && 'bg-emerald-100 text-emerald-800',
                        u.status === 'pending' && 'bg-amber-100 text-amber-800',
                        u.status === 'suspended' && 'bg-red-100 text-red-800',
                      )}
                    >
                      {statusLabel[u.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(u.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {u.status !== 'approved' && (
                        <Button variant="ghost" className="px-2 py-1.5 text-emerald-700" onClick={() => update.mutate({ id: u.id, status: 'approved' })}>
                          <CheckCircle2 className="size-4" aria-hidden /> Aprovar
                        </Button>
                      )}
                      {u.status !== 'suspended' && (
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5 text-red-600"
                          onClick={() => confirm(`Suspender ${u.name}?`) && update.mutate({ id: u.id, status: 'suspended' })}
                        >
                          <Ban className="size-4" aria-hidden /> Suspender
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        className="px-2 py-1.5"
                        title={u.role === 'admin' ? 'Remover administrador' : 'Tornar administrador'}
                        onClick={() =>
                          confirm(u.role === 'admin' ? `Remover privilégios de ${u.name}?` : `Tornar ${u.name} administrador?`) &&
                          update.mutate({ id: u.id, role: u.role === 'admin' ? 'voter' : 'admin' })
                        }
                      >
                        <UserCog className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Eleições

export function AdminElections() {
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'elections'],
    queryFn: () => api.get<{ elections: Election[] }>('/admin/elections'),
  });
  return (
    <>
      <PageHeader
        title="Eleições"
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> Nova eleição
            </Button>
          )
        }
      />
      {creating && (
        <div className="mb-6">
          <ElectionForm onDone={() => setCreating(false)} />
        </div>
      )}
      {isLoading && <Spinner />}
      {error && <Alert>{error.message}</Alert>}
      {data && data.elections.length === 0 && !creating && <Empty>Crie a primeira eleição.</Empty>}
      <div className="space-y-3">
        {data?.elections.map((e) => (
          <Link key={e.id} to={`/admin/eleicoes/${e.id}`} className="block">
            <Card className="flex flex-wrap items-center gap-4 p-4 transition hover:ring-brand-500">
              <PhaseBadge phase={e.phase} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{e.title}</p>
                <p className="text-xs text-slate-500">
                  {fmtDate(e.startsAt)} → {fmtDate(e.endsAt)} · {e.candidateCount} opções · {e.turnout} votos
                </p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

export function ElectionForm({ election, onDone }: { election?: Election; onDone: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const save = useMutation({
    mutationFn: (b: object) =>
      election ? api.put(`/admin/elections/${election.id}`, b) : api.post<{ id: string }>('/admin/elections', b),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      onDone();
      if (!election && res) navigate(`/admin/eleicoes/${(res as { id: string }).id}`);
    },
  });
  const errs = save.error instanceof ApiError ? save.error.details : undefined;

  const now = new Date();
  const defStart = new Date(now.getTime() + 3600_000);
  const defEnd = new Date(now.getTime() + 8 * 86400_000);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      title: f.get('title'),
      description: f.get('description'),
      startsAt: fromLocalInput(String(f.get('startsAt'))),
      endsAt: fromLocalInput(String(f.get('endsAt'))),
      allowBlank: f.get('allowBlank') === 'on',
    });
  };

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <h2 className="text-lg font-semibold">{election ? 'Editar eleição' : 'Nova eleição'}</h2>
        {save.error && <Alert>{save.error.message}</Alert>}
        <Field label="Título" name="title" required minLength={3} defaultValue={election?.title} error={errs?.title?.[0]} />
        <TextArea label="Descrição" name="description" defaultValue={election?.description} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Início"
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={toLocalInput(election?.startsAt ?? defStart.toISOString())}
          />
          <Field
            label="Fim"
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={toLocalInput(election?.endsAt ?? defEnd.toISOString())}
            error={errs?.endsAt?.[0]}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allowBlank" defaultChecked={election?.allowBlank ?? true} className="size-4 accent-brand-700" />
          Permitir voto em branco
        </label>
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>
            Guardar
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- Auditoria

export function AdminAudit() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.get<{ entries: AuditEntry[]; chain: ChainStatus }>('/admin/audit?limit=200'),
  });
  return (
    <>
      <PageHeader
        title="Registo de auditoria"
        subtitle="Cada entrada inclui o hash da anterior — qualquer alteração à base de dados é detectada."
      />
      {isLoading && <Spinner />}
      {error && <Alert>{error.message}</Alert>}
      {data && (
        <>
          <div className="mb-4">
            <ChainCard chain={data.chain} />
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Acção</th>
                  <th className="px-4 py-3">Autor</th>
                  <th className="px-4 py-3">Detalhes</th>
                  <th className="px-4 py-3">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-xs dark:divide-slate-800">
                {data.entries.map((e) => (
                  <tr key={e.seq}>
                    <td className="px-4 py-2 text-slate-500">{e.seq}</td>
                    <td className="whitespace-nowrap px-4 py-2">{fmtDate(e.at)}</td>
                    <td className="px-4 py-2 font-semibold">{e.action}</td>
                    <td className="px-4 py-2 font-sans">{e.actorName ?? '—'}</td>
                    <td className="max-w-xs truncate px-4 py-2 text-slate-500" title={JSON.stringify(e.details)}>
                      {Object.keys(e.details).length ? JSON.stringify(e.details) : ''}
                    </td>
                    <td className="px-4 py-2 text-slate-400" title={e.hash}>
                      <Link2 className="mr-1 inline size-3" aria-hidden />
                      {e.hash.slice(0, 10)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
