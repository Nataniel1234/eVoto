import { hash, verify } from '@node-rs/argon2';
import { Router, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { hmacIdentity, newId, randomToken, sha256 } from '../crypto.js';
import { HttpError, SESSION_COOKIE, parse, requireAuth } from '../http.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Parâmetros Argon2id recomendados pela OWASP (m=19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
let dummyHash: Promise<string> | undefined;

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo de 10 caracteres')
  .max(128)
  .regex(/[a-zA-Z]/, 'Deve conter letras')
  .regex(/\d/, 'Deve conter números');

const registerSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  document: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z\s-]{6,20}$/, 'Número de documento inválido'),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(128),
});

export const hashPassword = (p: string) => hash(p, ARGON);

export function authRouter() {
  const r = Router();

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.NODE_ENV === 'test' ? 1000 : 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiadas tentativas. Tente novamente mais tarde.' },
  });

  r.post('/register', authLimiter, async (req, res) => {
    const body = parse(registerSchema, req.body);
    const docClean = body.document.replace(/[\s-]/g, '');
    const documentHmac = hmacIdentity(docClean);

    const exists = req.db
      .prepare('SELECT 1 FROM users WHERE email = ? OR document_hmac = ?')
      .get(body.email, documentHmac);
    // Mensagem genérica: não revela qual dos campos já existe.
    if (exists) throw new HttpError(409, 'Não foi possível concluir o registo com estes dados');

    const id = newId();
    const passwordHash = await hashPassword(body.password);
    req.db.transaction(() => {
      req.db
        .prepare(
          `INSERT INTO users (id, name, email, document_hmac, document_hint, password_hash)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, body.name, body.email, documentHmac, `•••${docClean.slice(-3)}`, passwordHash);
      audit(req.db, { actorId: id, action: 'user.register', target: id, ip: req.ip });
    })();

    res.status(201).json({
      message: 'Registo efectuado. A sua conta aguarda validação por um administrador.',
    });
  });

  r.post('/login', authLimiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = req.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | {
          id: string;
          name: string;
          email: string;
          role: string;
          status: string;
          password_hash: string;
          failed_logins: number;
          locked_until: string | null;
        }
      | undefined;

    const now = new Date();
    if (user?.locked_until && user.locked_until > now.toISOString()) {
      throw new HttpError(423, 'Conta temporariamente bloqueada por excesso de tentativas');
    }

    // Verifica sempre um hash (mesmo inexistente) para uniformizar o tempo de resposta.
    dummyHash ??= hashPassword(randomToken());
    const ok = await verify(user?.password_hash ?? (await dummyHash), password);

    if (!user || !ok) {
      if (user) {
        const failed = user.failed_logins + 1;
        const lock = failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
        req.db
          .prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
          .run(lock ? 0 : failed, lock, user.id);
        audit(req.db, { actorId: user.id, action: lock ? 'auth.locked' : 'auth.failed', ip: req.ip });
      }
      throw new HttpError(401, 'Credenciais inválidas');
    }

    if (user.status === 'suspended') throw new HttpError(403, 'Conta suspensa');

    const token = randomToken(32);
    const expiresAt = new Date(now.getTime() + config.sessionTtlMs);
    req.db.transaction(() => {
      req.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
      req.db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(user.id, now.toISOString());
      req.db
        .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)')
        .run(sha256(token), user.id, expiresAt.toISOString(), req.get('user-agent')?.slice(0, 200) ?? null);
      audit(req.db, { actorId: user.id, action: 'auth.login', ip: req.ip });
    })();

    setSessionCookie(res, token, expiresAt);
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status },
    });
  });

  r.post('/logout', (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') req.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    res.clearCookie(SESSION_COOKIE, cookieBase());
    res.status(204).end();
  });

  // Devolve 200 com user=null quando não há sessão (evita ruído 401 no cliente).
  r.get('/me', (req, res) => {
    res.json({ user: req.user ?? null });
  });

  r.post('/change-password', requireAuth, authLimiter, async (req, res) => {
    const body = parse(z.object({ current: z.string().max(128), next: passwordSchema }), req.body);
    const row = req.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
      password_hash: string;
    };
    if (!(await verify(row.password_hash, body.current))) throw new HttpError(400, 'Palavra-passe actual incorrecta');
    const newHash = await hashPassword(body.next);
    const current = sha256(req.cookies[SESSION_COOKIE]);
    req.db.transaction(() => {
      req.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user!.id);
      // Termina todas as outras sessões.
      req.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(req.user!.id, current);
      audit(req.db, { actorId: req.user!.id, action: 'auth.password_changed', ip: req.ip });
    })();
    res.status(204).end();
  });

  return r;
}

const cookieBase = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict' as const,
  path: '/',
});

function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), expires });
}
