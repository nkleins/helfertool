import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, openDb, initSchema } from '../src/db.js';

test('createDb initialises all tables', () => {
  const db = createDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(names.includes('shifts'));
  assert.ok(names.includes('signups'));
  assert.ok(names.includes('sessions'));
});

test('initSchema is idempotent', () => {
  const db = createDb(':memory:');
  assert.doesNotThrow(() => createDb(':memory:'));
  db.exec('SELECT 1');
});

test('frisches Schema hat shifts.area_id und areas-Tabelle', () => {
  const db = createDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(shifts)').all().map((c) => c.name);
  assert.ok(cols.includes('area_id'));
  assert.ok(!cols.includes('area'));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  assert.ok(tables.includes('areas'));
});

test('Migration überführt alte shifts.area-Textspalte nach areas/area_id', () => {
  const db = openDb(':memory:');
  // altes Schema nachbauen
  db.exec(`CREATE TABLE shifts (id INTEGER PRIMARY KEY, area TEXT NOT NULL, title TEXT NOT NULL,
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL, notes TEXT);`);
  db.exec(`CREATE TABLE signups (id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone TEXT, note TEXT, created_at TEXT NOT NULL);`);
  db.prepare(`INSERT INTO shifts (area,title,starts_at,ends_at,capacity,notes)
    VALUES (?,?,?,?,?,?)`).run('Küche', 'Frühdienst', '2026-09-25T08:00', '2026-09-25T09:00', 3, null);
  initSchema(db);
  const cols = db.prepare('PRAGMA table_info(shifts)').all().map((c) => c.name);
  assert.ok(cols.includes('area_id'));
  const row = db.prepare(`SELECT s.title, a.name AS area FROM shifts s JOIN areas a ON a.id = s.area_id`).get();
  assert.equal(row.area, 'Küche');
  assert.equal(row.title, 'Frühdienst');
  assert.ok(db.prepare('PRAGMA table_info(signups)').all().map((c) => c.name).includes('device_token'));
});
