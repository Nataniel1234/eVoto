import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { verifyAuditChain } from './audit.js';
import { decryptBallot, encryptBallot, hmacIdentity, newId } from './crypto.js';
import { openDatabase, type DB } from './db.js';
import { hashPassword } from './routes/auth.js';

const H = { 'X-Requested-With': 'evoto' };
let db: DB;
let app: ReturnType<typeof createApp>;

async function makeUser(email: string, role: 'admin' | 'voter', status = 'approved') {
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, name, email, document_hmac, document_hint, password_hash, role, status)
     VALUES (?, ?, ?, ?, '•••', ?, ?, ?)`,
  ).run(id, email, email, hmacIdentity(email), await hashPassword('Password123'), role, status);
  return id;
}

async function login(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(H).send({ email, password: 'Password123' });
  expect(res.status).toBe(200);
  return agent;
}

async function openElection(admin: ReturnType<typeof request.agent>) {
  const now = Date.now();
  const { body } = await admin
    .post('/api/admin/elections')
    .set(H)
    .send({
      title: 'Eleição de teste',
      startsAt: new Date(now - 1000).toISOString(),
      endsAt: new Date(now + 3600_000).toISOString(),
    })
    .expect(201);
  const a = await admin.post(`/api/admin/elections/${body.id}/candidates`).set(H).send({ name: 'Ana' }).expect(201);
  await admin.post(`/api/admin/elections/${body.id}/candidates`).set(H).send({ name: 'Bruno' }).expect(201);
  await admin.post(`/api/admin/elections/${body.id}/publish`).set(H).expect(204);
  return { electionId: body.id as string, candA: a.body.id as string };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp(db);
});

describe('autenticação', () => {
  it('regista um eleitor em estado pendente e não revela duplicados', async () => {
    const payload = { name: 'Maria Silva', email: 'maria@x.pt', document: '12345678', password: 'SenhaForte123' };
    await request(app).post('/api/auth/register').set(H).send(payload).expect(201);
    const dup = await request(app).post('/api/auth/register').set(H).send({ ...payload, email: 'outra@x.pt' });
    expect(dup.status).toBe(409);
    const row = db.prepare('SELECT status, password_hash FROM users WHERE email = ?').get('maria@x.pt') as {
      status: string;
      password_hash: string;
    };
    expect(row.status).toBe('pending');
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('rejeita palavras-passe fracas', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set(H)
      .send({ name: 'Zé', email: 'z@x.pt', document: '12345678', password: 'curta' });
    expect(res.status).toBe(400);
  });

  it('bloqueia a conta após 5 tentativas falhadas', async () => {
    await makeUser('v@x.pt', 'voter');
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').set(H).send({ email: 'v@x.pt', password: 'errada' }).expect(401);
    }
    const res = await request(app).post('/api/auth/login').set(H).send({ email: 'v@x.pt', password: 'Password123' });
    expect(res.status).toBe(423);
  });

  it('exige cabeçalho anti-CSRF em pedidos que alteram estado', async () => {
    await request(app).post('/api/auth/login').send({ email: 'a', password: 'b' }).expect(403);
  });

  it('bloqueia acesso de eleitores à área de administração', async () => {
    await makeUser('v@x.pt', 'voter');
    const voter = await login('v@x.pt');
    await voter.get('/api/admin/stats').expect(403);
    await request(app).get('/api/admin/stats').expect(401);
  });
});

describe('votação', () => {
  it('fluxo completo: votar, impedir voto duplo, verificar recibo e apurar', async () => {
    await makeUser('admin@x.pt', 'admin');
    await makeUser('v1@x.pt', 'voter');
    await makeUser('v2@x.pt', 'voter');
    await makeUser('p@x.pt', 'voter', 'pending');
    const admin = await login('admin@x.pt');
    const { electionId, candA } = await openElection(admin);

    const v1 = await login('v1@x.pt');
    const vote = await v1.post(`/api/elections/${electionId}/vote`).set(H).send({ candidateId: candA }).expect(201);
    expect(vote.body.receipt).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);

    await v1.post(`/api/elections/${electionId}/vote`).set(H).send({ candidateId: candA }).expect(409);

    const v2 = await login('v2@x.pt');
    await v2.post(`/api/elections/${electionId}/vote`).set(H).send({ blank: true }).expect(201);

    const pending = await login('p@x.pt');
    await pending.post(`/api/elections/${electionId}/vote`).set(H).send({ blank: true }).expect(403);

    // Resultados escondidos enquanto a votação decorre.
    await request(app).get(`/api/elections/${electionId}/results`).expect(403);

    // O boletim guardado está cifrado e não contém o id do candidato em claro.
    const stored = db.prepare('SELECT ciphertext FROM ballots').all() as { ciphertext: Buffer }[];
    expect(stored).toHaveLength(2);
    for (const b of stored) expect(b.ciphertext.toString()).not.toContain(candA);

    const ok = await request(app)
      .post(`/api/elections/${electionId}/verify-receipt`)
      .set(H)
      .send({ receipt: vote.body.receipt.toLowerCase() })
      .expect(200);
    expect(ok.body.included).toBe(true);
    const bad = await request(app)
      .post(`/api/elections/${electionId}/verify-receipt`)
      .set(H)
      .send({ receipt: 'AAAA-BBBB-CCCC-DDDD' });
    expect(bad.body.included).toBe(false);

    const closed = await admin.post(`/api/admin/elections/${electionId}/close`).set(H).expect(200);
    expect(closed.body.results.totalBallots).toBe(2);
    expect(closed.body.results.blank).toBe(1);
    expect(closed.body.results.candidates.find((c: { id: string }) => c.id === candA).votes).toBe(1);

    const pub = await request(app).get(`/api/elections/${electionId}/results`).expect(200);
    expect(pub.body.resultsHash).toHaveLength(64);

    // Após o encerramento já não é possível votar.
    const v3id = await makeUser('v3@x.pt', 'voter');
    expect(v3id).toBeTruthy();
    const v3 = await login('v3@x.pt');
    await v3.post(`/api/elections/${electionId}/vote`).set(H).send({ blank: true }).expect(409);
  });

  it('não permite alterar eleições já publicadas', async () => {
    await makeUser('admin@x.pt', 'admin');
    const admin = await login('admin@x.pt');
    const { electionId } = await openElection(admin);
    await admin.post(`/api/admin/elections/${electionId}/candidates`).set(H).send({ name: 'Intruso' }).expect(409);
    await admin.delete(`/api/admin/elections/${electionId}`).set(H).expect(409);
  });

  it('suporta votos concorrentes do mesmo eleitor sem duplicar', async () => {
    await makeUser('admin@x.pt', 'admin');
    await makeUser('v@x.pt', 'voter');
    const admin = await login('admin@x.pt');
    const { electionId, candA } = await openElection(admin);
    const v = await login('v@x.pt');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => v.post(`/api/elections/${electionId}/vote`).set(H).send({ candidateId: candA })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((db.prepare('SELECT COUNT(*) n FROM ballots').get() as { n: number }).n).toBe(1);
  });
});

describe('criptografia e auditoria', () => {
  it('um boletim cifrado não pode ser movido para outra eleição (AAD)', () => {
    const enc = encryptBallot('eleicao-1', 'cand-x');
    expect(decryptBallot('eleicao-1', enc)).toBe('cand-x');
    expect(() => decryptBallot('eleicao-2', enc)).toThrow();
  });

  it('boletins têm tamanho constante independentemente da escolha', () => {
    expect(encryptBallot('e', '__BLANK__').ciphertext.length).toBe(encryptBallot('e', newId()).ciphertext.length);
  });

  it('detecta adulteração do registo de auditoria', async () => {
    await makeUser('v@x.pt', 'voter');
    await login('v@x.pt');
    await login('v@x.pt');
    expect(verifyAuditChain(db).valid).toBe(true);
    db.prepare("UPDATE audit_log SET action = 'forjado' WHERE seq = 1").run();
    expect(verifyAuditChain(db)).toMatchObject({ valid: false, brokenAt: 1 });
  });
});
