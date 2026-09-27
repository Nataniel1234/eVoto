import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, ChevronRight, Users } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, Card, Empty, PageHeader, PhaseBadge, Spinner } from '../components/ui';
import { api, type Election } from '../lib/api';
import { useMe } from '../lib/auth';
import { fmtDate, relativeTime } from '../lib/format';

export function ElectionsPage() {
  const { data: user } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ['elections'],
    queryFn: () => api.get<{ elections: Election[] }>('/elections'),
    refetchInterval: 30_000,
  });

  const order = { open: 0, scheduled: 1, ended: 2, closed: 3, draft: 4 } as const;
  const elections = [...(data?.elections ?? [])].sort((a, b) => order[a.phase] - order[b.phase]);

  return (
    <>
      <PageHeader title="Eleições" subtitle="Consulte as eleições em curso, agendadas e os resultados apurados." />
      {user?.status === 'pending' && (
        <div className="mb-6">
          <Alert kind="info">A sua conta aguarda validação por um administrador. Poderá votar assim que for aprovada.</Alert>
        </div>
      )}
      {isLoading && <Spinner />}
      {error && <Alert>{error.message}</Alert>}
      {data && elections.length === 0 && <Empty>Ainda não existem eleições publicadas.</Empty>}
      <div className="grid gap-4 md:grid-cols-2">
        {elections.map((e) => (
          <Link key={e.id} to={`/eleicoes/${e.id}`} className="group">
            <Card className="h-full transition group-hover:ring-brand-500">
              <div className="flex items-start justify-between gap-3">
                <PhaseBadge phase={e.phase} />
                {e.hasVoted && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" aria-hidden /> Já votou
                  </span>
                )}
              </div>
              <h2 className="mt-3 text-lg font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-200">
                {e.title}
              </h2>
              {e.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{e.description}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" aria-hidden />
                  {e.phase === 'scheduled'
                    ? `Abre ${relativeTime(e.startsAt)}`
                    : e.phase === 'open'
                      ? `Fecha ${relativeTime(e.endsAt)}`
                      : `Encerrou a ${fmtDate(e.closedAt ?? e.endsAt)}`}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5" aria-hidden /> {e.turnout} votante(s)
                </span>
                <ChevronRight className="ml-auto size-4 text-slate-400 transition group-hover:translate-x-0.5" aria-hidden />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
