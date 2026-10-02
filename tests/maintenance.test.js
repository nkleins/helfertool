import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../src/db.js';
import { createArea } from '../src/repositories/areas.js';
import { createShift } from '../src/repositories/shifts.js';
import { createSignup } from '../src/repositories/signups.js';
import { saveSettings } from '../src/repositories/settings.js';
import { addDays, autoDeleteDue, purgeExpiredSignups, backupDb } from '../src/maintenance.js';
import { DatabaseSync } from 'node:sqlite';

function seed(db) {
  const area_id = createArea(db, { name: 'Bar' });
  createShift(db, { area_id, title: null, starts_at: '2026-09-25T18:00', ends_at: '2026-09-25T20:00', capacity: 3, notes: null });
  const last = createShift(db, { area_id, title: null, starts_at: '2026-09-27T22:00', ends_at: '2026-09-28T02:00', capacity: 3, notes: null });
  createSignup(db, { shift_id: last, name: 'Anna', phone: '0170' });
}
const count = (db) => db.prepare('SELECT COUNT(*) n FROM signups').get().n;

test('addDays rechnet über Monatsgrenzen', () => {
  assert.equal(addDays('2026-09-28T02:00', 14), '2026-10-12T02:00');
});

test('Anmeldungen werden 14 Tage nach der letzten Schicht gelöscht', () => {
  const db = createDb(':memory:');
  seed(db);
  assert.equal(autoDeleteDue(db), '2026-10-12T02:00');
  assert.equal(purgeExpiredSignups(db, '2026-10-12T01:59'), 0);
  assert.equal(count(db), 1);
  assert.equal(purgeExpiredSignups(db, '2026-10-12T02:00'), 1);
  assert.equal(count(db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 2); // Schichten bleiben
  assert.equal(autoDeleteDue(db), null); // nichts mehr zu löschen
});

test('Automatisches Löschen lässt sich abschalten', () => {
  const db = createDb(':memory:');
  seed(db);
  saveSettings(db, { auto_delete: '0' });
  assert.equal(autoDeleteDue(db), null);
  assert.equal(purgeExpiredSignups(db, '2030-01-01T00:00'), 0);
  assert.equal(count(db), 1);
});

test('Backup ist eine lesbare Kopie, ältere Backups werden entfernt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helfer-backup-'));
  try {
    const db = createDb(':memory:');
    seed(db);
    const first = backupDb(db, dir, new Date('2026-10-01T10:00:00Z'));
    const second = backupDb(db, dir, new Date('2026-10-02T10:00:00Z'));
    assert.deepEqual(fs.readdirSync(dir), [path.basename(second)]);
    assert.ok(!fs.existsSync(first));
    const copy = new DatabaseSync(second);
    assert.equal(copy.prepare('SELECT name FROM signups').get().name, 'Anna');
    copy.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
