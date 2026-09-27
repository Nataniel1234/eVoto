/**
 * Cria o administrador inicial (e, opcionalmente, dados de demonstração).
 *
 *   ADMIN_EMAIL=admin@exemplo.pt ADMIN_PASSWORD='...' npm run seed
 *   npm run seed -- --demo      # também cria eleitores e uma eleição de exemplo
 */
import { audit } from './audit.js';
import { config } from './config.js';
import { hmacIdentity, newId } from './crypto.js';
import { openDatabase } from './db.js';
import { hashPassword, passwordSchema } from './routes/auth.js';

const db = openDatabase(config.DATABASE_PATH);
const demo = process.argv.includes('--demo');

const email = (process.env.ADMIN_EMAIL ?? 'admin@evoto.local').toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? (config.isProd ? '' : 'Admin12345!');
const check = passwordSchema.safeParse(password);
if (!check.success) {
  console.error('ADMIN_PASSWORD inválida:', check.error.issues.map((i) => i.message).join(', '));
  process.exit(1);
}

async function upsertUser(name: string, mail: string, doc: string, pass: string, role: 'admin' | 'voter') {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(mail) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, name, email, document_hmac, document_hint, password_hash, role, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')`,
  ).run(id, name, mail, hmacIdentity(doc), `•••${doc.slice(-3)}`, await hashPassword(pass), role);
  audit(db, { action: 'seed.user', target: id, details: { role } });
  console.log(`✔ ${role} criado: ${mail}`);
  return id;
}

const adminId = await upsertUser('Administrador', email, `ADMIN${Date.now()}`, password, 'admin');

if (demo) {
  for (let i = 1; i <= 3; i++) {
    await upsertUser(`Eleitor ${i}`, `eleitor${i}@evoto.local`, `1000000${i}ZZ`, 'Eleitor12345', 'voter');
  }
  const has = db.prepare('SELECT 1 FROM elections LIMIT 1').get();
  if (!has) {
    const id = newId();
    const now = Date.now();
    db.prepare(
      `INSERT INTO elections (id, title, description, starts_at, ends_at, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'published', ?)`,
    ).run(
      id,
      'Eleição da Direcção da Associação 2026',
      'Escolha da lista que irá dirigir a associação no próximo mandato.',
      new Date(now - 60_000).toISOString(),
      new Date(now + 7 * 24 * 3600_000).toISOString(),
      adminId,
    );
    const lists = [
      ['Lista A — Renovar', 'Movimento Renovar', 'Transparência e modernização dos serviços.'],
      ['Lista B — Unidos', 'Movimento Unidos', 'Mais proximidade com os associados.'],
      ['Lista C — Futuro', 'Independentes', 'Sustentabilidade financeira e inovação.'],
    ];
    lists.forEach(([name, party, desc], i) =>
      db
        .prepare('INSERT INTO candidates (id, election_id, name, party, description, position) VALUES (?, ?, ?, ?, ?, ?)')
        .run(newId(), id, name, party, desc, i),
    );
    audit(db, { actorId: adminId, action: 'seed.election', target: id });
    console.log('✔ Eleição de demonstração criada (aberta durante 7 dias)');
  }
  console.log('  Eleitores de demonstração: eleitor1..3@evoto.local / Eleitor12345');
}

if (!config.isProd && !process.env.ADMIN_PASSWORD) {
  console.log(`  Admin de desenvolvimento: ${email} / ${password}  (altere em produção!)`);
}
db.close();
