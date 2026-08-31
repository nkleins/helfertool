import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function migrateShiftsToAreaId(db) {
  // FK vor dem Tabellentausch aus (signups.shift_id verweist auf shifts.id).
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    const oldAreas = db.prepare('SELECT DISTINCT area FROM shifts').all();
    const findArea = db.prepare('SELECT id FROM areas WHERE name = ?');
    const insertArea = db.prepare('INSERT INTO areas (name) VALUES (?)');
    for (const { area } of oldAreas) {
      const name = area ?? 'Ohne Bereich';
      if (!findArea.get(name)) insertArea.run(name);
    }
    db.exec(`
      CREATE TABLE shifts_new (
        id        INTEGER PRIMARY KEY,
        area_id   INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
        title     TEXT,
        starts_at TEXT NOT NULL,
        ends_at   TEXT NOT NULL,
        capacity  INTEGER NOT NULL,
        notes     TEXT
      );`);
    db.exec(`
      INSERT INTO shifts_new (id, area_id, title, starts_at, ends_at, capacity, notes)
      SELECT s.id, a.id, s.title, s.starts_at, s.ends_at, s.capacity, s.notes
      FROM shifts s JOIN areas a ON a.name = COALESCE(s.area, 'Ohne Bereich');`);
    db.exec('DROP TABLE shifts;');
    db.exec('ALTER TABLE shifts_new RENAME TO shifts;');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON;');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS areas (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#888888',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      csrf       TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signups (
      id           INTEGER PRIMARY KEY,
      shift_id     INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      phone        TEXT,
      note         TEXT,
      device_token TEXT,
      created_at   TEXT NOT NULL
    );
  `);

  const shiftCols = columnNames(db, 'shifts');
  if (shiftCols.length === 0) {
    db.exec(`
      CREATE TABLE shifts (
        id        INTEGER PRIMARY KEY,
        area_id   INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
        title     TEXT,
        starts_at TEXT NOT NULL,
        ends_at   TEXT NOT NULL,
        capacity  INTEGER NOT NULL,
        notes     TEXT,
        is_orga   INTEGER NOT NULL DEFAULT 0
      );`);
  } else if (!shiftCols.includes('area_id')) {
    migrateShiftsToAreaId(db);
  }

  if (!columnNames(db, 'shifts').includes('is_orga')) {
    db.exec('ALTER TABLE shifts ADD COLUMN is_orga INTEGER NOT NULL DEFAULT 0;');
  }

  if (!columnNames(db, 'signups').includes('device_token')) {
    db.exec('ALTER TABLE signups ADD COLUMN device_token TEXT;');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_signups_shift ON signups(shift_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_signups_token ON signups(device_token);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_shifts_area ON shifts(area_id);');
}

export function createDb(path) {
  const db = openDb(path);
  initSchema(db);
  return db;
}
