import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, Copy, Download, ShieldCheck, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Badge, Button, Card, PhaseBadge, Spinner } from '../components/ui';
import { api, type Candidate, type Election, type Results } from '../lib/api';
import { useMe } from '../lib/auth';
import { fmtDate, fmtNumber, fmtPct } from '../lib/format';

const BLANK = 'blank';

export function ElectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['election', id],
    queryFn: () => api.get<{ election: Election; candidates: Candidate[] }>(`/elections/${id}`),
  });

  if (isLoading) return <Spinner />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return null;
  const { election: e, candidates } = data;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400">
        <ArrowLeft className="size-4" aria-hidden /> Todas as eleições
      </Link>
      <div className="mb-8">
        <PhaseBadge phase={e.phase} />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{e.title}</h1>
        {e.description && <p className="mt-2 whitespace-pre-line text-slate-600 dark:text-slate-400">{e.description}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Início</dt>
            <dd className="font-medium">{fmtDate(e.startsAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Fim</dt>
            <dd className="font-medium">{fmtDate(e.endsAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Votantes</dt>
            <dd className="font-medium">{fmtNumber(e.turnout)}</dd>
          </div>
        </dl>
      </div>

      {e.phase === 'closed' ? (
        <ResultsView electionId={e.id} />
      ) : e.phase === 'open' ? (
        <Ballot election={e} candidates={candidates} />
      ) : (
        <>
          <Alert kind="info">A votação abre a {fmtDate(e.startsAt)}.</Alert>
          <CandidateList candidates={candidates} />
        </>
      )}
    </div>
  );
}

function CandidateList({ candidates }: { candidates: Candidate[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {candidates.map((c) => (
        <li key={c.id}>
          <Card className="p-4">
            <p className="font-semibold">{c.name}</p>
            {c.party && <p className="text-sm text-slate-500">{c.party}</p>}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Ballot({ election, candidates }: { election: Election; candidates: Candidate[] }) {
  const { data: user } = useMe();
  const qc = useQueryClient();
  const [choice, setChoice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const vote = useMutation({
    mutationFn: () =>
      api.post<{ receipt: string; message: string }>(
        `/elections/${election.id}/vote`,
        choice === BLANK ? { blank: true } : { candidateId: choice },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['elections'] });
      qc.invalidateQueries({ queryKey: ['election', election.id] });
    },
  });

  if (vote.data) return <ReceiptView receipt={vote.data.receipt} election={election} />;

  if (election.hasVoted) {
    return (
      <Alert kind="success">
        Já exerceu o seu direito de voto nesta eleição. Pode confirmar que o seu boletim foi registado na página{' '}
        <Link to={`/verificar?eleicao=${election.id}`} className="font-semibold underline">
          Verificar recibo
        </Link>
        .
      </Alert>
    );
  }
  if (!user) {
    return (
      <Alert kind="info">
        <Link to="/entrar" state={{ from: `/eleicoes/${election.id}` }} className="font-semibold underline">
          Entre na sua conta
        </Link>{' '}
        para votar.
      </Alert>
    );
  }
  if (user.status !== 'approved') {
    return <Alert kind="info">A sua conta ainda não foi validada para votar.</Alert>;
  }

  const options = [
    ...candidates.map((c) => ({ id: c.id, name: c.name, sub: c.party, desc: c.description })),
    ...(election.allowBlank ? [{ id: BLANK, name: 'Voto em branco', sub: 'Não escolher nenhuma opção', desc: '' }] : []),
  ];
  const selected = options.find((o) => o.id === choice);

  return (
    <Card>
      <h2 className="text-lg font-semibold">Boletim de voto</h2>
      <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">Seleccione uma opção. O voto é secreto e não pode ser alterado.</p>

      {vote.error && (
        <div className="mb-4">
          <Alert>{vote.error.message}</Alert>
        </div>
      )}

      {!confirming ? (
        <>
          <fieldset className="space-y-3">
            <legend className="sr-only">Opções de voto</legend>
            {options.map((o) => (
              <label
                key={o.id}
                className={clsx(
                  'flex cursor-pointer items-start gap-4 rounded-xl p-4 ring-1 transition',
                  choice === o.id
                    ? 'bg-brand-50 ring-2 ring-brand-600 dark:bg-brand-900/30'
                    : 'ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800/50',
                  o.id === BLANK && 'border-t border-dashed',
                )}
              >
                <input
                  type="radio"
                  name="choice"
                  value={o.id}
                  checked={choice === o.id}
                  onChange={() => setChoice(o.id)}
                  className="mt-1 size-5 accent-brand-700"
                />
                <span>
                  <span className="block font-semibold">{o.name}</span>
                  {o.sub && <span className="block text-sm text-slate-500">{o.sub}</span>}
                  {o.desc && <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">{o.desc}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <Button className="mt-6 w-full" disabled={!choice} onClick={() => setConfirming(true)}>
            Continuar
          </Button>
        </>
      ) : (
        <div className="text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">Confirma o seu voto em</p>
          <p className="my-3 text-2xl font-bold">{selected?.name}</p>
          <p className="mb-6 text-sm text-slate-500">Depois de confirmado, o voto não pode ser alterado nem anulado.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)} disabled={vote.isPending}>
              Voltar
            </Button>
            <Button variant="success" className="flex-1" loading={vote.isPending} onClick={() => vote.mutate()}>
              <Check className="size-4" aria-hidden /> Confirmar voto
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ReceiptView({ receipt, election }: { receipt: string; election: Election }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const text = `eVoto — Recibo de voto\n\nEleição: ${election.title}\nID da eleição: ${election.id}\nRecibo: ${receipt}\nEmitido: ${new Date().toISOString()}\n\nEste recibo permite verificar que o seu boletim foi contabilizado.\nNão revela o sentido do seu voto.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `recibo-voto-${receipt}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card className="text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <ShieldCheck className="size-7" aria-hidden />
      </div>
      <h2 className="text-xl font-bold">Voto registado com sucesso</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Guarde o código abaixo. Permite confirmar que o seu boletim foi contabilizado, sem revelar em quem votou.
      </p>
      <p className="my-6 select-all rounded-xl bg-slate-100 p-4 font-mono text-2xl font-bold tracking-widest dark:bg-slate-800">
        {receipt}
      </p>
      <div className="flex flex-col justify-center gap-3 sm:flex-row">
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(receipt);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copiado' : 'Copiar'}
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download className="size-4" /> Descarregar
        </Button>
      </div>
      <div className="mt-6 text-left">
        <Alert kind="info">Este código é mostrado apenas uma vez e não é guardado em claro no servidor.</Alert>
      </div>
    </Card>
  );
}

export function ResultsView({ electionId }: { electionId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['results', electionId],
    queryFn: () => api.get<{ results: Results; resultsHash: string }>(`/elections/${electionId}/results`),
  });
  if (isLoading) return <Spinner label="A carregar resultados…" />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return null;
  const r = data.results;
  const total = r.totalBallots || 1;
  const valid = r.totalBallots - r.blank;
  const winner = r.candidates[0];
  const tie = r.candidates.length > 1 && r.candidates[1]!.votes === winner?.votes;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Boletins', fmtNumber(r.totalBallots)],
          ['Votos válidos', fmtNumber(valid)],
          ['Em branco', fmtNumber(r.blank)],
          ['Participação', r.eligibleVoters ? fmtPct(r.participations / r.eligibleVoters) : '—'],
        ].map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="text-xs text-slate-500">{k}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{v}</p>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="mb-5 text-lg font-semibold">Resultados</h2>
        <ul className="space-y-5">
          {r.candidates.map((c, i) => (
            <li key={c.id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-4">
                <span className="font-medium">
                  {i === 0 && !tie && c.votes > 0 && <Trophy className="mr-1.5 inline size-4 text-amber-500" aria-label="Vencedor" />}
                  {c.name}
                  {c.party && <span className="ml-2 text-sm font-normal text-slate-500">{c.party}</span>}
                </span>
                <span className="text-sm tabular-nums">
                  <strong>{fmtNumber(c.votes)}</strong> <span className="text-slate-500">({fmtPct(c.votes / total)})</span>
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={clsx('h-full rounded-full', i === 0 && !tie ? 'bg-brand-700' : 'bg-brand-500/60')}
                  style={{ width: `${(c.votes / total) * 100}%` }}
                />
              </div>
            </li>
          ))}
          <li>
            <div className="mb-1.5 flex justify-between text-sm text-slate-500">
              <span>Em branco</span>
              <span className="tabular-nums">
                {fmtNumber(r.blank)} ({fmtPct(r.blank / total)})
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-slate-400" style={{ width: `${(r.blank / total) * 100}%` }} />
            </div>
          </li>
        </ul>
        {tie && (
          <div className="mt-4">
            <Badge className="bg-amber-100 text-amber-800">Empate na primeira posição</Badge>
          </div>
        )}
      </Card>

      <Card className="text-xs">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="size-4" aria-hidden /> Integridade do apuramento
        </h3>
        <dl className="space-y-2 break-all font-mono text-slate-600 dark:text-slate-400">
          <div>
            <dt className="font-sans text-slate-500">Hash SHA-256 dos resultados</dt>
            <dd>{data.resultsHash}</dd>
          </div>
          <div>
            <dt className="font-sans text-slate-500">Resumo do quadro de boletins</dt>
            <dd>{r.bulletinDigest}</dd>
          </div>
          <div>
            <dt className="font-sans text-slate-500">Apurado em</dt>
            <dd>{fmtDate(r.talliedAt)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
