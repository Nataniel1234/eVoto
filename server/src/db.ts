import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

/**
 * Migrações versionadas (PRAGMA user_version). Nunca editar uma migração já
 * aplicada — acrescentar sempre uma nova entrada.
 */
const migrations: string[] = [
  /* 1 — esquema inicial */ `
  CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    document_hmac   TEXT NOT NULL UNIQUE,
    document_hint   TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'voter' CHECK (role IN ('voter','admin')),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
    failed_logins   INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) WITHOUT ROWID;
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE elections (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    starts_at    TEXT NOT NULL,
    ends_at      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
    allow_blank  INTEGER NOT NULL DEFAULT 1,
    results_json TEXT,
    results_hash TEXT,
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    closed_at    TEXT
  );

  CREATE TABLE candidates (
    id           TEXT PRIMARY KEY,
    election_id  TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    party        TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    position     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_candidates_election ON candidates(election_id);

  -- Quem votou (sem data/hora, para não permitir correlação com os boletins).
  CREATE TABLE participations (
    election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (election_id, user_id)
  ) WITHOUT ROWID;

  -- Boletins anónimos e cifrados. WITHOUT ROWID + chave aleatória: a ordem de
  -- armazenamento não revela a ordem de votação.
  CREATE TABLE ballots (
    id           TEXT PRIMARY KEY,
    election_id  TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    receipt_hash TEXT NOT NULL UNIQUE,
    ciphertext   BLOB NOT NULL,
    iv           BLOB NOT NULL,
    auth_tag     BLOB NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX idx_ballots_election ON ballots(election_id);

  -- Registo de auditoria encadeado por hash (evidência de adulteração).
  CREATE TABLE audit_log (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    actor_id   TEXT,
    action     TEXT NOT NULL,
    target     TEXT,
    details    TEXT NOT NULL DEFAULT '{}',
    ip         TEXT,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
  );
  `,
];

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
