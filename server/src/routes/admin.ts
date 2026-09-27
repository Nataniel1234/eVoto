import { Router } from 'express';
import { z } from 'zod';
import { audit, verifyAuditChain } from '../audit.js';
import { newId } from '../crypto.js';
import { HttpError, parse, requireAdmin } from '../http.js';
import {
  closeAndTally,
  getCandidates,
  getElection,
  phaseOf,
  publicElection,
  type ElectionRow,
} from '../services/elections.js';

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString());

const electionSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(4000).default(''),
    startsAt: isoDate,
    endsAt: isoDate,
    allowBlank: z.boolean().default(true),
  })
  .refine((d) => d.endsAt > d.startsAt, { message: 'O fim tem de ser posterior ao início', path: ['endsAt'] });

const candidateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  party: z.string().trim().max(120).default(''),
  description: z.string().trim().max(1000).default(''),
});

export function adminRouter() {
  const r = Router();
  r.use(requireAdmin);

  const draftOr404 = (db: Parameters<typeof getElection>[0], id: string) => {
    const e = getElection(db, id);
    if (!e) throw new HttpError(404, 'Eleição não encontrada');
    if (e.status !== 'draft') throw new HttpError(409, 'Só é possível alterar eleições em rascunho');
    return e;
  };

  // ---------- Estatísticas ----------
  r.get('/stats', (req, res) => {
    const count = (sql: string) => (req.db.prepare(sql).get() as { n: number }).n;
    res.json({
      users: {
        total: count('SELECT COUNT(*) n FROM users'),
        pending: count("SELECT COUNT(*) n FROM users WHERE status = 'pending'"),
        approved: count("SELECT COUNT(*) n FROM users WHERE status = 'approved'"),
        suspended: count("SELECT COUNT(*) n FROM users WHERE status = 'suspended'"),
      },
      elections: {
        total: count('SELECT COUNT(*) n FROM elections'),
        draft: count("SELECT COUNT(*) n FROM elections WHERE status = 'draft'"),
        closed: count("SELECT COUNT(*) n FROM elections WHERE status = 'closed'"),
      },
      ballots: count('SELECT COUNT(*) n FROM ballots'),
      auditChain: verifyAuditChain(req.db),
    });
  });

  // ---------- Eleitores ----------
  r.get('/users', (req, res) => {
    const { status, q } = parse(
      z.object({
        status: z.enum(['pending', 'approved', 'suspended']).optional(),
        q: z.string().trim().max(100).optional(),
      }),
      req.query,
    );
    const where: string[] = [];
    const params: string[] = [];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (q) {
      where.push('(name LIKE ? OR email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const users = req.db
      .prepare(
        `SELECT id, name, email, document_hint AS documentHint, role, status, created_at AS createdAt
           FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY created_at DESC LIMIT 500`,
      )
      .all(...params);
    res.json({ users });
  });

  r.patch('/users/:id', (req, res) => {
    const body = parse(
      z
        .object({ status: z.enum(['pending', 'approved', 'suspended']), role: z.enum(['voter', 'admin']) })
        .partial()
        .refine((b) => b.status || b.role, 'Nada para actualizar'),
      req.body,
    );
    if (req.params.id === req.user!.id) throw new HttpError(400, 'Não pode alterar a sua própria conta');
    const exists = req.db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!exists) throw new HttpError(404, 'Utilizador não encontrado');

    req.db.transaction(() => {
      if (body.status) req.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(body.status, req.params.id);
      if (body.role) req.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, req.params.id);
      if (body.status === 'suspended') req.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
      audit(req.db, { actorId: req.user!.id, action: 'user.updated', target: req.params.id, details: body, ip: req.ip });
    })();
    res.status(204).end();
  });

  // ---------- Eleições ----------
  r.get('/elections', (req, res) => {
    const rows = req.db.prepare('SELECT * FROM elections ORDER BY created_at DESC').all() as ElectionRow[];
    res.json({
      elections: rows.map((e) => ({
        ...publicElection(req.db, e),
        candidateCount: getCandidates(req.db, e.id).length,
      })),
    });
  });

  r.get('/elections/:id', (req, res) => {
    const e = getElection(req.db, req.params.id);
    if (!e) throw new HttpError(404, 'Eleição não encontrada');
    res.json({ election: publicElection(req.db, e), candidates: getCandidates(req.db, e.id) });
  });

  r.post('/elections', (req, res) => {
    const b = parse(electionSchema, req.body);
    const id = newId();
    req.db.transaction(() => {
      req.db
        .prepare(
          `INSERT INTO elections (id, title, description, starts_at, ends_at, allow_blank, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, b.title, b.description, b.startsAt, b.endsAt, b.allowBlank ? 1 : 0, req.user!.id);
      audit(req.db, { actorId: req.user!.id, action: 'election.created', target: id, details: { title: b.title }, ip: req.ip });
    })();
    res.status(201).json({ id });
  });

  r.put('/elections/:id', (req, res) => {
    const e = draftOr404(req.db, req.params.id);
    const b = parse(electionSchema, req.body);
    req.db.transaction(() => {
      req.db
        .prepare(
          `UPDATE elections SET title = ?, description = ?, starts_at = ?, ends_at = ?, allow_blank = ? WHERE id = ?`,
        )
        .run(b.title, b.description, b.startsAt, b.endsAt, b.allowBlank ? 1 : 0, e.id);
      audit(req.db, { actorId: req.user!.id, action: 'election.updated', target: e.id, ip: req.ip });
    })();
    res.status(204).end();
  });

  r.delete('/elections/:id', (req, res) => {
    const e = draftOr404(req.db, req.params.id);
    req.db.transaction(() => {
      req.db.prepare('DELETE FROM elections WHERE id = ?').run(e.id);
      audit(req.db, { actorId: req.user!.id, action: 'election.deleted', target: e.id, details: { title: e.title }, ip: req.ip });
    })();
    res.status(204).end();
  });

  r.post('/elections/:id/candidates', (req, res) => {
    const e = draftOr404(req.db, req.params.id);
    const b = parse(candidateSchema, req.body);
    const id = newId();
    const pos = (
      req.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM candidates WHERE election_id = ?').get(e.id) as {
        p: number;
      }
    ).p;
    req.db.transaction(() => {
      req.db
        .prepare('INSERT INTO candidates (id, election_id, name, party, description, position) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, e.id, b.name, b.party, b.description, pos);
      audit(req.db, { actorId: req.user!.id, action: 'candidate.added', target: e.id, details: { id, name: b.name }, ip: req.ip });
    })();
    res.status(201).json({ id });
  });

  r.delete('/elections/:id/candidates/:cid', (req, res) => {
    const e = draftOr404(req.db, req.params.id);
    const info = req.db.prepare('DELETE FROM candidates WHERE id = ? AND election_id = ?').run(req.params.cid, e.id);
    if (!info.changes) throw new HttpError(404, 'Candidato não encontrado');
    audit(req.db, { actorId: req.user!.id, action: 'candidate.removed', target: e.id, details: { id: req.params.cid }, ip: req.ip });
    res.status(204).end();
  });

  r.post('/elections/:id/publish', (req, res) => {
    const e = draftOr404(req.db, req.params.id);
    if (getCandidates(req.db, e.id).length < 2) throw new HttpError(400, 'São necessários pelo menos 2 candidatos');
    if (e.ends_at <= new Date().toISOString()) throw new HttpError(400, 'A data de fim já passou');
    req.db.transaction(() => {
      req.db.prepare("UPDATE elections SET status = 'published' WHERE id = ?").run(e.id);
      audit(req.db, { actorId: req.user!.id, action: 'election.published', target: e.id, ip: req.ip });
    })();
    res.status(204).end();
  });

  r.post('/elections/:id/close', (req, res) => {
    const e = getElection(req.db, req.params.id);
    if (!e) throw new HttpError(404, 'Eleição não encontrada');
    const phase = phaseOf(e);
    if (phase === 'draft') throw new HttpError(409, 'Eleição em rascunho não pode ser encerrada');
    if (phase === 'closed') throw new HttpError(409, 'Eleição já encerrada');
    const results = closeAndTally(req.db, e.id, req.user!.id, req.ip);
    res.json({ results });
  });

  // ---------- Auditoria ----------
  r.get('/audit', (req, res) => {
    const { limit, before } = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: z.coerce.number().int().positive().optional(),
      }),
      req.query,
    );
    const rows = req.db
      .prepare(
        `SELECT a.seq, a.at, a.action, a.target, a.details, a.ip, a.hash, u.name AS actorName
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE (? IS NULL OR a.seq < ?)
          ORDER BY a.seq DESC LIMIT ?`,
      )
      .all(before ?? null, before ?? null, limit) as { details: string }[];
    res.json({
      entries: rows.map((r) => ({ ...r, details: JSON.parse(r.details) })),
      chain: verifyAuditChain(req.db),
    });
  });

  return r;
}
