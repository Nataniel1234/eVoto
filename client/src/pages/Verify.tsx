import { useMutation, useQuery } from '@tanstack/react-query';
import { SearchCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Button, Card, Field, PageHeader } from '../components/ui';
import { api, type Election } from '../lib/api';

export function VerifyPage() {
  const [params] = useSearchParams();
  const [electionId, setElectionId] = useState(params.get('eleicao') ?? '');
  const { data } = useQuery({
    queryKey: ['elections'],
    queryFn: () => api.get<{ elections: Election[] }>('/elections'),
  });
  const elections = (data?.elections ?? []).filter((e) => e.phase !== 'scheduled');

  const verify = useMutation({
    mutationFn: (b: { electionId: string; receipt: string }) =>
      api.post<{ included: boolean; receiptHash: string }>(`/elections/${b.electionId}/verify-receipt`, {
        receipt: b.receipt,
      }),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    verify.mutate({ electionId, receipt: String(f.get('receipt')) });
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Verificar recibo"
        subtitle="Confirme que o seu boletim consta do quadro público de boletins, sem revelar o sentido do voto."
      />
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="el" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Eleição
            </label>
            <select
              id="el"
              required
              value={electionId}
              onChange={(e) => setElectionId(e.target.value)}
              className="block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-300 dark:bg-slate-950 dark:ring-slate-700"
            >
              <option value="">Seleccione…</option>
              {elections.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Código do recibo"
            name="receipt"
            required
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="block w-full rounded-lg border-0 bg-white px-3 py-2.5 font-mono uppercase tracking-widest ring-1 ring-inset ring-slate-300 dark:bg-slate-950 dark:ring-slate-700"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" className="w-full" loading={verify.isPending}>
            <SearchCheck className="size-4" aria-hidden /> Verificar
          </Button>
        </form>
        <div className="mt-5 space-y-3">
          {verify.error && <Alert>{verify.error.message}</Alert>}
          {verify.data &&
            (verify.data.included ? (
              <Alert kind="success">
                <strong>Boletim encontrado.</strong> O seu voto consta do quadro de boletins desta eleição e será/foi contabilizado.
              </Alert>
            ) : (
              <Alert>
                <strong>Recibo não encontrado</strong> nesta eleição. Confirme o código e a eleição seleccionada.
              </Alert>
            ))}
          {verify.data && (
            <p className="break-all font-mono text-xs text-slate-500">Hash do recibo: {verify.data.receiptHash}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
