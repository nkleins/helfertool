import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createShift } from '../src/repositories/shifts.js';
import { createSignup, listSignupsByShift, deleteSignup, moveSignup, listAllSignups }
  from '../src/repositories/signups.js';

function shift(db, capacity = 2) {
  return createShift(db, {
    area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity, notes: null,
  });
}

test('createSignup succeeds until capacity, then reports full', () => {
  const db = createDb(':memory:');
  const id = shift(db, 2);
  assert.equal(createSignup(db, { shift_id: id, name: 'A' }).ok, true);
  assert.equal(createSignup(db, { shift_id: id, name: 'B' }).ok, true);
  const third = createSignup(db, { shift_id: id, name: 'C' });
  assert.deepEqual(third, { ok: false, reason: 'full' });
  assert.equal(listSignupsByShift(db, id).length, 2);
});

test('createSignup rejects unknown shift', () => {
  const db = createDb(':memory:');
  assert.deepEqual(createSignup(db, { shift_id: 999, name: 'A' }),
    { ok: false, reason: 'no_shift' });
});

test('phone/note optional and stored', () => {
  const db = createDb(':memory:');
  const id = shift(db);
  createSignup(db, { shift_id: id, name: 'A', phone: '0170', note: 'vegan' });
  const [s] = listSignupsByShift(db, id);
  assert.equal(s.phone, '0170');
  assert.equal(s.note, 'vegan');
});

test('deleteSignup frees a slot', () => {
  const db = createDb(':memory:');
  const id = shift(db, 1);
  const r = createSignup(db, { shift_id: id, name: 'A' });
  assert.equal(createSignup(db, { shift_id: id, name: 'B' }).ok, false);
  deleteSignup(db, r.id);
  assert.equal(createSignup(db, { shift_id: id, name: 'B' }).ok, true);
});

test('moveSignup respects capacity of target', () => {
  const db = createDb(':memory:');
  const a = shift(db, 1);
  const b = shift(db, 1);
  const r = createSignup(db, { shift_id: a, name: 'A' });
  createSignup(db, { shift_id: b, name: 'B' });
  assert.deepEqual(moveSignup(db, r.id, b), { ok: false, reason: 'full' });
});

test('listAllSignups joins shift info', () => {
  const db = createDb(':memory:');
  const id = shift(db);
  createSignup(db, { shift_id: id, name: 'A' });
  const [row] = listAllSignups(db);
  assert.equal(row.shift_title, 'Bar');
  assert.equal(row.name, 'A');
});
