import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { seedArea } from './helpers.js';
import { planSlots, generateShifts, listShifts } from '../src/repositories/shifts.js';

test('planSlots erzeugt lückenlose 60-min-Blöcke', () => {
  const slots = planSlots({ date: '2026-09-25', from: '10:00', to: '13:00', slotMinutes: 60 });
  assert.deepEqual(slots, [
    { starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00' },
    { starts_at: '2026-09-25T11:00', ends_at: '2026-09-25T12:00' },
    { starts_at: '2026-09-25T12:00', ends_at: '2026-09-25T13:00' },
  ]);
});

test('planSlots überspringt unvollständigen Rest', () => {
  const slots = planSlots({ date: '2026-09-25', from: '10:00', to: '11:30', slotMinutes: 60 });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].ends_at, '2026-09-25T11:00');
});

test('planSlots mit 90-min-Blöcken', () => {
  const slots = planSlots({ date: '2026-09-25', from: '08:00', to: '11:00', slotMinutes: 90 });
  assert.deepEqual(slots.map((s) => s.starts_at + '/' + s.ends_at), [
    '2026-09-25T08:00/2026-09-25T09:30',
    '2026-09-25T09:30/2026-09-25T11:00',
  ]);
});

test('planSlots liefert leer, wenn Fenster kürzer als Schichtlänge', () => {
  assert.deepEqual(planSlots({ date: '2026-09-25', from: '10:00', to: '10:20', slotMinutes: 30 }), []);
});

test('generateShifts legt alle Schichten mit Kapazität an', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  const { count } = generateShifts(db, {
    area_id, title: 'Frühdienst', date: '2026-09-25', from: '08:00', to: '10:00',
    slotMinutes: 30, capacity: 3, notes: null,
  });
  assert.equal(count, 4);
  const shifts = listShifts(db);
  assert.equal(shifts.length, 4);
  assert.ok(shifts.every((s) => s.capacity === 3 && s.title === 'Frühdienst'));
  assert.equal(shifts[0].area_name, 'Bar');
});
