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

test('additive Migration ergänzt requires_phone ohne bestehende Daten zu löschen', () => {
  const db = openDb(':memory:');
  // Schema wie deployte Version: area_id + is_orga, aber ohne requires_phone.
  db.exec(`CREATE TABLE areas (id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#888888', sort_order INTEGER NOT NULL DEFAULT 0);`);
  db.exec(`CREATE TABLE shifts (id INTEGER PRIMARY KEY, area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    title TEXT, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL, notes TEXT, is_orga INTEGER NOT NULL DEFAULT 0);`);
  db.exec(`CREATE TABLE signups (id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone TEXT, note TEXT, device_token TEXT, created_at TEXT NOT NULL);`);
  db.exec(`INSERT INTO areas (id,name) VALUES (1,'Küche');`);
  db.exec(`INSERT INTO shifts (id,area_id,title,starts_at,ends_at,capacity) VALUES (1,1,'Frühdienst','2026-09-25T08:00','2026-09-25T09:00',2);`);
  db.exec(`INSERT INTO signups (shift_id,name,phone,created_at) VALUES (1,'Anna','0170','2026-01-01T00:00');`);

  initSchema(db); // darf nichts löschen, nur requires_phone ergänzen

  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signups').get().n, 1);
  const cols = db.prepare('PRAGMA table_info(shifts)').all().map((c) => c.name);
  assert.ok(cols.includes('requires_phone'));
  assert.equal(db.prepare('SELECT requires_phone FROM shifts WHERE id=1').get().requires_phone, 0);
  assert.equal(db.prepare('SELECT name FROM signups WHERE id=1').get().name, 'Anna');
});
