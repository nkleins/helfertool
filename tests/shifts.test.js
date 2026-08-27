import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createShift, getShift, listShifts, updateShift, deleteShift }
  from '../src/repositories/shifts.js';

const sample = {
  area: 'Bar', title: 'Bar Freitag', starts_at: '2026-09-25T18:00',
  ends_at: '2026-09-25T20:00', capacity: 3, notes: null,
};

test('create + get shift', () => {
  const db = createDb(':memory:');
  const id = createShift(db, sample);
  assert.equal(typeof id, 'number');
  const s = getShift(db, id);
  assert.equal(s.title, 'Bar Freitag');
  assert.equal(s.capacity, 3);
});

test('listShifts computes taken/free', () => {
  const db = createDb(':memory:');
  const id = createShift(db, sample);
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)')
    .run(id, 'Anna', '2026-01-01T00:00');
  const [s] = listShifts(db);
  assert.equal(s.taken, 1);
  assert.equal(s.free, 2);
});

test('listShifts clamps free at zero when overfilled', () => {
  const db = createDb(':memory:');
  const id = createShift(db, { area: 'Bar', title: 'x', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 1, notes: null });
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)').run(id, 'A', 't');
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)').run(id, 'B', 't');
  const [s] = listShifts(db);
  assert.equal(s.taken, 2);
  assert.equal(s.free, 0);
});

test('update + delete shift', () => {
  const db = createDb(':memory:');
  const id = createShift(db, sample);
  updateShift(db, id, { ...sample, title: 'Bar Samstag', capacity: 5 });
  assert.equal(getShift(db, id).title, 'Bar Samstag');
  deleteShift(db, id);
  assert.equal(getShift(db, id), undefined);
});
