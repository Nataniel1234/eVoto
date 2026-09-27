import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.js';

export const BLANK = '__BLANK__';
const PLAINTEXT_SIZE = 96; // tamanho fixo: o comprimento do criptograma não revela a escolha

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const newId = () => randomUUID();
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** HMAC-SHA256 com pepper — permite verificar unicidade de um documento sem o guardar em claro. */
export const hmacIdentity = (value: string) =>
  createHmac('sha256', config.identityPepper).update(value.trim().toUpperCase()).digest('hex');

export interface EncryptedBallot {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Cifra a escolha com AES-256-GCM. O id da eleição é usado como AAD, pelo que um
 * boletim não pode ser transplantado para outra eleição sem falhar a autenticação.
 */
export function encryptBallot(electionId: string, choice: string): EncryptedBallot {
  const payload = Buffer.alloc(PLAINTEXT_SIZE, 0x20);
  const json = Buffer.from(JSON.stringify({ c: choice, n: randomBytes(8).toString('hex') }));
  if (json.length > PLAINTEXT_SIZE) throw new Error('Boletim demasiado grande');
  json.copy(payload);

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.ballotKey, iv);
  cipher.setAAD(Buffer.from(electionId));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptBallot(electionId: string, b: EncryptedBallot): string {
  const decipher = createDecipheriv('aes-256-gcm', config.ballotKey, b.iv);
  decipher.setAAD(Buffer.from(electionId));
  decipher.setAuthTag(b.authTag);
  const plain = Buffer.concat([decipher.update(b.ciphertext), decipher.final()]).toString().trim();
  return (JSON.parse(plain) as { c: string }).c;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Código de recibo legível (Crockford base32), ex.: 7K2M-9QXD-4TFA-WB3N */
export function generateReceipt(): string {
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += CROCKFORD[bytes[i]! & 31];
  return out.match(/.{4}/g)!.join('-');
}

export const normalizeReceipt = (r: string) =>
  r.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

export const receiptHash = (electionId: string, receipt: string) =>
  sha256(`${electionId}:${normalizeReceipt(receipt)}`);

/** Resumo público do quadro de boletins: hash das receitas ordenadas. */
export const bulletinDigest = (hashes: string[]) => sha256([...hashes].sort().join('\n'));
