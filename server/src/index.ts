import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db.js';

const db = openDatabase(config.DATABASE_PATH);
const app = createApp(db);

// Limpeza periódica de sessões expiradas.
const cleanup = setInterval(
  () => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()),
  60 * 60 * 1000,
);
cleanup.unref();

const server = app.listen(config.PORT, () => {
  console.log(`🗳️  eVoto API a correr em http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

function shutdown(signal: string) {
  console.log(`${signal} recebido — a encerrar…`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
