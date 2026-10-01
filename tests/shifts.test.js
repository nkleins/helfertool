import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { seedArea } from './helpers.js';
import {
  createShift, getShift, listShifts, updateShift, deleteShift,
  areaStats, deleteShiftsByAreaDay, generateShifts,
} from '../src/repositories/shifts.js';

const sampleShift = {
  title: 'Bar Freitag', starts_at: '2026-09-25T18:00',
  ends_at: '2026-09-25T20:00', capacity: 3, notes: null,
};

test('create + get shift', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, ...sampleShift });
  assert.equal(typeof id, 'number');
  const s = getShift(db, id);
  assert.equal(s.title, 'Bar Freitag');
  assert.equal(s.capacity, 3);
});

test('listShifts computes taken/free', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, ...sampleShift });
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)')
    .run(id, 'Anna', '2026-01-01T00:00');
  const [s] = listShifts(db);
  assert.equal(s.taken, 1);
  assert.equal(s.free, 2);
});

test('listShifts clamps free at zero when overfilled', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: 'x', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 1, notes: null });
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)').run(id, 'A', 't');
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)').run(id, 'B', 't');
  const [s] = listShifts(db);
  assert.equal(s.taken, 2);
  assert.equal(s.free, 0);
});

test('listShifts liefert area_name und area_color aus dem Join', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db, { name: 'Küche', color: '#ff0000', sort_order: 2 });
  createShift(db, { area_id, ...sampleShift });
  const [s] = listShifts(db);
  assert.equal(s.area_name, 'Küche');
  assert.equal(s.area_color, '#ff0000');
});

test('update + delete shift', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, ...sampleShift });
  updateShift(db, id, { area_id, ...sampleShift, title: 'Bar Samstag', capacity: 5 });
  assert.equal(getShift(db, id).title, 'Bar Samstag');
  deleteShift(db, id);
  assert.equal(getShift(db, id), undefined);
});

test('areaStats zählt Kapazität, Belegung und Lücken', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  generateShifts(db, { area_id, title: null, date: '2026-09-25', from: '10:00', to: '12:00', slotMinutes: 60, capacity: 2, notes: null });
  const stats = areaStats(db).find((s) => s.area_id === area_id);
  assert.equal(stats.capacity, 4);
  assert.equal(stats.taken, 0);
  assert.equal(stats.gaps, 2);
});

test('deleteShiftsByAreaDay löscht nur den passenden Tag', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  generateShifts(db, { area_id, title: null, date: '2026-09-25', from: '10:00', to: '12:00', slotMinutes: 60, capacity: 1, notes: null });
  generateShifts(db, { area_id, title: null, date: '2026-09-26', from: '10:00', to: '11:00', slotMinutes: 60, capacity: 1, notes: null });
  const { count } = deleteShiftsByAreaDay(db, area_id, '2026-09-25');
  assert.equal(count, 2);
  assert.equal(listShifts(db).length, 1);
});
