import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, Pencil, Rocket, Trash2, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Button, Card, Field, PhaseBadge, Spinner } from '../../components/ui';
import { api, type Candidate, type Election } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { ResultsView } from '../ElectionDetail';
import { ElectionForm } from './Admin';

export function AdminElectionEdit() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const key = ['admin', 'election', id];

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ election: Election; candidates: Candidate[] }>(`/admin/elections/${id}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
    qc.invalidateQueries({ queryKey: ['elections'] });
  };
  const addCandidate = useMutation({
    mutationFn: (b: object) => api.post(`/admin/elections/${id}/candidates`, b),
    onSuccess: invalidate,
  });
  const removeCandidate = useMutation({
    mutationFn: (cid: string) => api.del(`/admin/elections/${id}/candidates/${cid}`),
    onSuccess: invalidate,
  });
  const action = useMutation({
    mutationFn: (a: 'publish' | 'close' | 'delete') =>
      a === 'delete' ? api.del(`/admin/elections/${id}`) : api.post(`/admin/elections/${id}/${a}`),
    onSuccess: (_d, a) => {
      invalidate();
      if (a === 'delete') navigate('/admin/eleicoes');
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return null;
  const { election: e, candidates } = data;
  const isDraft = e.phase === 'draft';

  const onAdd = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    addCandidate.mutate(
      { name: f.get('name'), party: f.get('party'), description: f.get('description') },
      { onSuccess: () => form.reset() },
    );
  };

  const err = addCandidate.error ?? removeCandidate.error ?? action.error;

  return (
    <div className="space-y-6">
      <Link to="/admin/eleicoes" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400">
        <ArrowLeft className="size-4" aria-hidden /> Eleições
      </Link>

      {editing ? (
        <ElectionForm election={e} onDone={() => setEditing(false)} />
      ) : (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <PhaseBadge phase={e.phase} />
              <h1 className="mt-2 text-2xl font-bold">{e.title}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {fmtDate(e.startsAt)} → {fmtDate(e.endsAt)} · voto em branco {e.allowBlank ? 'permitido' : 'não permitido'}
              </p>
              {e.description && <p className="mt-3 whitespace-pre-line text-sm">{e.description}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {isDraft && (
                <>
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" aria-hidden /> Editar
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => confirm('Eliminar esta eleição?') && action.mutate('delete')}
                  >
                    <Trash2 className="size-4" aria-hidden /> Eliminar
                  </Button>
                  <Button
                    variant="success"
                    loading={action.isPending && action.variables === 'publish'}
                    onClick={() =>
                      confirm('Depois de publicada, a eleição e os candidatos não podem ser alterados. Publicar?') &&
                      action.mutate('publish')
                    }
                  >
                    <Rocket className="size-4" aria-hidden /> Publicar
                  </Button>
                </>
              )}
              {['scheduled', 'open', 'ended'].includes(e.phase) && (
                <Button
                  variant="danger"
                  loading={action.isPending && action.variables === 'close'}
                  onClick={() =>
                    confirm('Encerrar a votação e apurar os resultados agora? Esta acção é irreversível.') &&
                    action.mutate('close')
                  }
                >
                  <Lock className="size-4" aria-hidden /> Encerrar e apurar
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {err && <Alert>{err.message}</Alert>}

      {e.phase === 'closed' ? (
        <ResultsView electionId={e.id} />
      ) : (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Candidatos / opções ({candidates.length})</h2>
          {candidates.length === 0 && <p className="text-sm text-slate-500">Adicione pelo menos 2 opções para publicar.</p>}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {candidates.map((c, i) => (
              <li key={c.id} className="flex items-center gap-4 py-3">
                <span className="grid size-8 place-items-center rounded-full bg-slate-100 text-sm font-semibold dark:bg-slate-800">{i + 1}</span>
                <div className="flex-1">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-slate-500">{[c.party, c.description].filter(Boolean).join(' · ')}</p>
                </div>
                {isDraft && (
                  <Button
                    variant="ghost"
                    className="text-red-600"
                    aria-label={`Remover ${c.name}`}
                    onClick={() => removeCandidate.mutate(c.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {isDraft && (
            <form onSubmit={onAdd} className="mt-6 grid gap-3 border-t border-slate-200 pt-6 sm:grid-cols-3 dark:border-slate-800">
              <Field label="Nome" name="name" required minLength={2} />
              <Field label="Partido / lista" name="party" />
              <Field label="Descrição curta" name="description" />
              <div className="sm:col-span-3">
                <Button type="submit" variant="secondary" loading={addCandidate.isPending}>
                  <UserPlus className="size-4" aria-hidden /> Adicionar
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
