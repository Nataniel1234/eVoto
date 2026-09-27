import type { Phase, UserStatus } from './api';

const dtf = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso: string) => dtf.format(new Date(iso));
export const fmtNumber = (n: number) => new Intl.NumberFormat('pt-PT').format(n);
export const fmtPct = (n: number) =>
  new Intl.NumberFormat('pt-PT', { style: 'percent', maximumFractionDigits: 1 }).format(n);

export const phaseLabel: Record<Phase, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  open: 'A decorrer',
  ended: 'Terminada',
  closed: 'Encerrada',
};

export const statusLabel: Record<UserStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  suspended: 'Suspenso',
};

/** Converte ISO → valor de <input type="datetime-local"> na hora local. */
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** Converte valor de <input type="datetime-local"> → ISO com fuso. */
export const fromLocalInput = (v: string) => new Date(v).toISOString();

export function relativeTime(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat('pt-PT', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  return rtf.format(Math.round(diff / 86400_000), 'day');
}
