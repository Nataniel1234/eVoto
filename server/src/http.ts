import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import type { DB } from './db.js';
import { sha256 } from './crypto.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, 'Dados inválidos', z.flattenError(r.error).fieldErrors);
  }
  return r.data;
};

export const SESSION_COOKIE = config.isProd ? '__Host-evoto_session' : 'evoto_session';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'voter' | 'admin';
  status: 'pending' | 'approved' | 'suspended';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      db: DB;
    }
  }
}

/** Carrega o utilizador a partir do cookie de sessão opaco (guardado como hash na BD). */
export function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token.length > 20) {
    const row = req.db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.status, s.expires_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?`,
      )
      .get(sha256(token)) as (SessionUser & { expires_at: string }) | undefined;
    if (row && row.expires_at > new Date().toISOString() && row.status !== 'suspended') {
      const { expires_at: _, ...user } = row;
      req.user = user;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Sessão inválida ou expirada'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Sessão inválida ou expirada'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Acesso reservado a administradores'));
  next();
}

/**
 * Protecção CSRF: pedidos que alteram estado têm de trazer um cabeçalho
 * personalizado (força preflight CORS) e, se existir, Origin tem de ser permitido.
 * Complementa o cookie SameSite=Strict.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'evoto') {
    return next(new HttpError(403, 'Pedido rejeitado (CSRF)'));
  }
  const origin = req.get('origin');
  if (origin && !allowedOrigins().includes(origin)) {
    return next(new HttpError(403, 'Origem não permitida'));
  }
  next();
}

export const allowedOrigins = () => config.CLIENT_ORIGIN.split(',').map((s) => s.trim());

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Pedido demasiado grande' });
    return;
  }
  req.log?.error({ err }, 'Erro não tratado');
  res.status(500).json({ error: 'Erro interno do servidor' });
};
