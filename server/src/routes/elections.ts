import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { audit } from '../audit.js';
import { config } from '../config.js';
import {
  BLANK,
  bulletinDigest,
  encryptBallot,
  generateReceipt,
  newId,
  normalizeReceipt,
  receiptHash,
} from '../crypto.js';
import { HttpError, parse, requireAuth } from '../http.js';
import {
  closeAndTally,
  getCandidates,
  getElection,
  phaseOf,
  publicElection,
  receiptHashes,
  type ElectionRow,
} from '../services/elections.js';

const voteSchema = z.union([
  z.object({ candidateId: z.uuid() }).strict(),
  z.object({ blank: z.literal(true) }).strict(),
]);

export function electionsRouter() {
  const r = Router();

  const voteLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === 'test' ? 1000 : 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiados pedidos' },
  });

  const verifyLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === 'test' ? 1000 : 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiados pedidos' },
  });

  const loadVisible = (id: string | string[], db: Parameters<typeof getElection>[0]) => {
    const e = typeof id === 'string' ? getElection(db, id) : undefined;
    if (!e || e.status === 'draft') throw new HttpError(404, 'Eleição não encontrada');
    return e;
  };

  /** Encerra automaticamente eleições cujo prazo terminou. */
  const settle = (db: Parameters<typeof getElection>[0], e: ElectionRow) => {
    if (phaseOf(e) === 'ended') {
      closeAndTally(db, e.id, null);
      return getElection(db, e.id)!;
    }
    return e;
  };

  // ---------- Público ----------

  r.get('/', (req, res) => {
    const rows = req.db
      .prepare("SELECT * FROM elections WHERE status <> 'draft' ORDER BY starts_at DESC")
      .all() as ElectionRow[];
    res.json({ elections: rows.map((e) => publicElection(req.db, settle(req.db, e), req.user?.id)) });
  });

  r.get('/:id', (req, res) => {
    const e = settle(req.db, loadVisible(req.params.id, req.db));
    res.json({
      election: publicElection(req.db, e, req.user?.id),
      candidates: getCandidates(req.db, e.id).map((c) => ({
        id: c.id,
        name: c.name,
        party: c.party,
        description: c.description,
      })),
    });
  });

  r.get('/:id/results', (req, res) => {
    const e = settle(req.db, loadVisible(req.params.id, req.db));
    if (e.status !== 'closed' || !e.results_json) {
      throw new HttpError(403, 'Os resultados só são divulgados após o encerramento da votação');
    }
    res.json({ results: JSON.parse(e.results_json), resultsHash: e.results_hash });
  });

  /** Quadro público de boletins: apenas hashes dos recibos, sem conteúdo. */
  r.get('/:id/bulletin', (req, res) => {
    const e = settle(req.db, loadVisible(req.params.id, req.db));
    if (phaseOf(e) === 'scheduled') throw new HttpError(403, 'A votação ainda não começou');
    const hashes = receiptHashes(req.db, e.id);
    res.json({ electionId: e.id, count: hashes.length, digest: bulletinDigest(hashes), receiptHashes: hashes });
  });

  /** Permite a qualquer eleitor confirmar que o seu boletim foi registado. */
  r.post('/:id/verify-receipt', verifyLimiter, (req, res) => {
    const { receipt } = parse(z.object({ receipt: z.string().min(10).max(40) }), req.body);
    const e = loadVisible(req.params.id, req.db);
    if (normalizeReceipt(receipt).length !== 16) throw new HttpError(400, 'Formato de recibo inválido');
    const hash = receiptHash(e.id, receipt);
    const found = !!req.db.prepare('SELECT 1 FROM ballots WHERE election_id = ? AND receipt_hash = ?').get(e.id, hash);
    res.json({ included: found, receiptHash: hash });
  });

  // ---------- Votação ----------

  r.post('/:id/vote', requireAuth, voteLimiter, (req, res) => {
    const user = req.user!;
    if (user.status !== 'approved') {
      throw new HttpError(403, 'A sua conta ainda não foi validada para votar');
    }
    const body = parse(voteSchema, req.body);
    const e = loadVisible(req.params.id, req.db);
    if (phaseOf(e) !== 'open') throw new HttpError(409, 'Esta eleição não está aberta para votação');

    let choice: string;
    if ('blank' in body) {
      if (!e.allow_blank) throw new HttpError(400, 'Esta eleição não permite voto em branco');
      choice = BLANK;
    } else {
      const ok = req.db
        .prepare('SELECT 1 FROM candidates WHERE id = ? AND election_id = ?')
        .get(body.candidateId, e.id);
      if (!ok) throw new HttpError(400, 'Candidato inválido');
      choice = body.candidateId;
    }

    const receipt = generateReceipt();
    const enc = encryptBallot(e.id, choice);

    try {
      req.db.transaction(() => {
        // PK (election_id, user_id) garante um único voto por eleitor, mesmo com pedidos concorrentes.
        req.db.prepare('INSERT INTO participations (election_id, user_id) VALUES (?, ?)').run(e.id, user.id);
        req.db
          .prepare(
            'INSERT INTO ballots (id, election_id, receipt_hash, ciphertext, iv, auth_tag) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(newId(), e.id, receiptHash(e.id, receipt), enc.ciphertext, enc.iv, enc.authTag);
        // Sem actor nem IP: o registo de auditoria não pode ligar o eleitor ao boletim.
        audit(req.db, { action: 'ballot.cast', target: e.id });
      })();
    } catch (err) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new HttpError(409, 'Já votou nesta eleição');
      }
      throw err;
    }

    res.status(201).json({
      receipt,
      message: 'Voto registado com sucesso. Guarde o seu recibo para verificação posterior.',
    });
  });

  return r;
}
