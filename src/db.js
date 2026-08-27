import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id         INTEGER PRIMARY KEY,
      area       TEXT NOT NULL,
      title      TEXT NOT NULL,
      starts_at  TEXT NOT NULL,
      ends_at    TEXT NOT NULL,
      capacity   INTEGER NOT NULL,
      notes      TEXT
    );
    CREATE TABLE IF NOT EXISTS signups (
      id         INTEGER PRIMARY KEY,
      shift_id   INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      phone      TEXT,
      note       TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_signups_shift ON signups(shift_id);
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      csrf       TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
}

export function createDb(path) {
  const db = openDb(path);
  initSchema(db);
  return db;
}
