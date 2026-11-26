import Database from "better-sqlite3";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE members (
    id INTEGER PRIMARY KEY,
    login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    roles TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    status_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE device_tokens (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id),
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE TABLE web_sessions (
    id_hash TEXT PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    member_id INTEGER NOT NULL REFERENCES members(id),
    tool TEXT NOT NULL,
    id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    last_event_at TEXT NOT NULL,
    last_kind TEXT NOT NULL,
    branch TEXT,
    PRIMARY KEY (member_id, tool, id)
  );
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    member_id INTEGER NOT NULL REFERENCES members(id),
    tool TEXT NOT NULL,
    session TEXT NOT NULL,
    kind TEXT NOT NULL,
    at TEXT NOT NULL,
    cwd TEXT,
    branch TEXT,
    data TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE (member_id, id)
  );
  CREATE INDEX events_session ON events (member_id, tool, session, kind);
  CREATE INDEX events_kind ON events (kind, seq);
  CREATE TABLE changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    at TEXT NOT NULL
  );
  `,
];

export type Db = Database.Database;

export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
