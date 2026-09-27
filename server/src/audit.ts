import type { DB } from './db.js';
import { sha256 } from './crypto.js';

const GENESIS = '0'.repeat(64);

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  target?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

interface AuditRow {
  seq: number;
  at: string;
  actor_id: string | null;
  action: string;
  target: string | null;
  details: string;
  ip: string | null;
  prev_hash: string;
  hash: string;
}

const entryHash = (r: Omit<AuditRow, 'seq' | 'hash'>) =>
  sha256(JSON.stringify([r.prev_hash, r.at, r.actor_id, r.action, r.target, r.details, r.ip]));

/** Acrescenta uma entrada ao registo encadeado. Deve ser chamado dentro de uma transacção quando possível. */
export function audit(db: DB, e: AuditEntry) {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as
    | { hash: string }
    | undefined;
  const row = {
    prev_hash: last?.hash ?? GENESIS,
    at: new Date().toISOString(),
    actor_id: e.actorId ?? null,
    action: e.action,
    target: e.target ?? null,
    details: JSON.stringify(e.details ?? {}),
    ip: e.ip ?? null,
  };
  db.prepare(
    `INSERT INTO audit_log (at, actor_id, action, target, details, ip, prev_hash, hash)
     VALUES (@at, @actor_id, @action, @target, @details, @ip, @prev_hash, @hash)`,
  ).run({ ...row, hash: entryHash(row) });
}

/** Recalcula a cadeia inteira e devolve a primeira entrada inconsistente, se existir. */
export function verifyAuditChain(db: DB): { valid: boolean; entries: number; brokenAt?: number } {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as AuditRow[];
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || entryHash(r) !== r.hash) {
      return { valid: false, entries: rows.length, brokenAt: r.seq };
    }
    prev = r.hash;
  }
  return { valid: true, entries: rows.length };
}
