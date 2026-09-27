import { audit } from '../audit.js';
import { BLANK, bulletinDigest, decryptBallot, sha256 } from '../crypto.js';
import type { DB } from '../db.js';

export type Phase = 'draft' | 'scheduled' | 'open' | 'ended' | 'closed';

export interface ElectionRow {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'published' | 'closed';
  allow_blank: number;
  results_json: string | null;
  results_hash: string | null;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

export interface CandidateRow {
  id: string;
  election_id: string;
  name: string;
  party: string;
  description: string;
  position: number;
}

export interface Results {
  electionId: string;
  totalBallots: number;
  eligibleVoters: number;
  participations: number;
  blank: number;
  candidates: { id: string; name: string; party: string; votes: number }[];
  bulletinDigest: string;
  talliedAt: string;
}

export function phaseOf(e: Pick<ElectionRow, 'status' | 'starts_at' | 'ends_at'>, now = new Date()): Phase {
  if (e.status === 'draft') return 'draft';
  if (e.status === 'closed') return 'closed';
  const iso = now.toISOString();
  if (iso < e.starts_at) return 'scheduled';
  if (iso < e.ends_at) return 'open';
  return 'ended';
}

export const getElection = (db: DB, id: string) =>
  db.prepare('SELECT * FROM elections WHERE id = ?').get(id) as ElectionRow | undefined;

export const getCandidates = (db: DB, electionId: string) =>
  db
    .prepare('SELECT * FROM candidates WHERE election_id = ? ORDER BY position, name')
    .all(electionId) as CandidateRow[];

export function publicElection(db: DB, e: ElectionRow, userId?: string) {
  const hasVoted = userId
    ? !!db.prepare('SELECT 1 FROM participations WHERE election_id = ? AND user_id = ?').get(e.id, userId)
    : false;
  const turnout = (db.prepare('SELECT COUNT(*) n FROM participations WHERE election_id = ?').get(e.id) as { n: number }).n;
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    status: e.status,
    phase: phaseOf(e),
    allowBlank: !!e.allow_blank,
    closedAt: e.closed_at,
    resultsHash: e.results_hash,
    turnout,
    hasVoted,
  };
}

export function receiptHashes(db: DB, electionId: string): string[] {
  return (
    db.prepare('SELECT receipt_hash FROM ballots WHERE election_id = ? ORDER BY receipt_hash').all(electionId) as {
      receipt_hash: string;
    }[]
  ).map((r) => r.receipt_hash);
}

/**
 * Apura e encerra a eleição (idempotente). Decifra todos os boletins, verifica a
 * consistência boletins ↔ participações e guarda o resultado com o respectivo hash.
 */
export function closeAndTally(db: DB, electionId: string, actorId: string | null, ip?: string): Results {
  return db.transaction(() => {
    const e = getElection(db, electionId);
    if (!e) throw new Error('Eleição inexistente');
    if (e.status === 'closed' && e.results_json) return JSON.parse(e.results_json) as Results;

    const candidates = getCandidates(db, electionId);
    const counts = new Map<string, number>(candidates.map((c) => [c.id, 0]));
    let blank = 0;

    const ballots = db
      .prepare('SELECT ciphertext, iv, auth_tag FROM ballots WHERE election_id = ?')
      .all(electionId) as { ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }[];

    for (const b of ballots) {
      const choice = decryptBallot(electionId, { ciphertext: b.ciphertext, iv: b.iv, authTag: b.auth_tag });
      if (choice === BLANK) blank++;
      else if (counts.has(choice)) counts.set(choice, counts.get(choice)! + 1);
      else throw new Error('Boletim com candidato inválido — apuramento abortado');
    }

    const participations = (
      db.prepare('SELECT COUNT(*) n FROM participations WHERE election_id = ?').get(electionId) as { n: number }
    ).n;
    if (participations !== ballots.length) {
      throw new Error(`Inconsistência: ${participations} participações vs ${ballots.length} boletins`);
    }
    const eligibleVoters = (
      db.prepare("SELECT COUNT(*) n FROM users WHERE status = 'approved'").get() as { n: number }
    ).n;

    const results: Results = {
      electionId,
      totalBallots: ballots.length,
      eligibleVoters,
      participations,
      blank,
      candidates: candidates
        .map((c) => ({ id: c.id, name: c.name, party: c.party, votes: counts.get(c.id)! }))
        .sort((a, b) => b.votes - a.votes),
      bulletinDigest: bulletinDigest(receiptHashes(db, electionId)),
      talliedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(results);
    const hash = sha256(json);
    const closedAt = new Date().toISOString();

    db.prepare(
      `UPDATE elections SET status = 'closed', results_json = ?, results_hash = ?, closed_at = ?,
              ends_at = MIN(ends_at, ?) WHERE id = ?`,
    ).run(json, hash, closedAt, closedAt, electionId);
    audit(db, {
      actorId,
      action: 'election.closed',
      target: electionId,
      details: { totalBallots: results.totalBallots, resultsHash: hash, automatic: actorId === null },
      ip,
    });
    return results;
  })();
}
