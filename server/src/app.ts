import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import type { DB } from './db.js';
import { HttpError, allowedOrigins, csrfGuard, errorHandler, loadSession } from './http.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { electionsRouter } from './routes/elections.js';

export function createApp(db: DB) {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use(
    cors({
      origin: allowedOrigins(),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Requested-With'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );
  if (config.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        // Não registar o healthcheck do Docker (a cada 30 s).
        autoLogging: { ignore: (req) => req.url === '/api/health' },
        // Registar apenas o essencial: sem cabeçalhos nem cookies.
        serializers: {
          req: (req) => ({ id: req.id, method: req.method, url: req.url }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        // 4xx → warn, 5xx/excepções → error: os problemas destacam-se no log.
        customLogLevel: (_req, res, err) =>
          err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        ...(config.isProd ? {} : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
      }),
    );
  }
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(loadSession);
  api.use(csrfGuard);
  api.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  api.use('/auth', authRouter());
  api.use('/elections', electionsRouter());
  api.use('/admin', adminRouter());
  api.use((_req, _res, next) => next(new HttpError(404, 'Recurso não encontrado')));
  app.use('/api', api);

  // Em produção o Express serve também o frontend compilado (SPA).
  if (config.SERVE_CLIENT) {
    const here = dirname(fileURLToPath(import.meta.url));
    const dist = resolve(here, '../../client/dist');
    if (existsSync(dist)) {
      app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true }));
      app.get('/{*splat}', (_req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile(join(dist, 'index.html'));
      });
    }
  }

  app.use(errorHandler);
  return app;
}