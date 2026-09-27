import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const hexKey = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'deve ser uma chave hexadecimal de 32 bytes (64 caracteres)');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_PATH: z.string().default('./data/evoto.db'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  /** Chave AES-256-GCM usada para cifrar os boletins em repouso. */
  BALLOT_ENCRYPTION_KEY: hexKey.optional(),
  /** Pepper HMAC usado para guardar números de documento de forma não reversível. */
  IDENTITY_PEPPER: hexKey.optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SERVE_CLIENT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuração inválida:', z.prettifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;
const isProd = env.NODE_ENV === 'production';

type KeyName = 'BALLOT_ENCRYPTION_KEY' | 'IDENTITY_PEPPER';

/**
 * Em desenvolvimento, se as chaves não estiverem definidas, são geradas uma vez e
 * guardadas junto da base de dados (para que reiniciar o servidor não torne os
 * boletins ilegíveis). Em produção são obrigatórias.
 */
function requireKey(name: KeyName): Buffer {
  const value = env[name];
  if (value) return Buffer.from(value, 'hex');
  if (isProd) {
    console.error(`${name} é obrigatório em produção. Gere com: openssl rand -hex 32`);
    process.exit(1);
  }
  if (env.NODE_ENV === 'test' || env.DATABASE_PATH === ':memory:') return randomBytes(32);

  const file = join(dirname(env.DATABASE_PATH), '.dev-keys.json');
  let keys: Partial<Record<KeyName, string>> = {};
  if (existsSync(file)) keys = JSON.parse(readFileSync(file, 'utf8'));
  if (!keys[name]) {
    keys[name] = randomBytes(32).toString('hex');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
    console.warn(`[aviso] ${name} não definido — gerada chave de desenvolvimento em ${file}`);
  }
  return Buffer.from(keys[name]!, 'hex');
}

export const config = {
  ...env,
  isProd,
  ballotKey: requireKey('BALLOT_ENCRYPTION_KEY'),
  identityPepper: requireKey('IDENTITY_PEPPER'),
  sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
} as const;
