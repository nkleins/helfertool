import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateShiftInput, validateSignupInput } from '../src/validate.js';

test('signup requires name', () => {
  const r = validateSignupInput({ name: '  ', phone: '', note: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
});

test('signup phone/note optional -> null', () => {
  const r = validateSignupInput({ name: 'Anna', phone: '', note: '' });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Anna');
  assert.equal(r.value.phone, null);
  assert.equal(r.value.note, null);
});

test('shift needs valid time order and positive capacity', () => {
  const bad = validateShiftInput({
    area: 'Bar', title: 'x', starts_at: '2026-09-25T20:00',
    ends_at: '2026-09-25T18:00', capacity: '0',
  });
  assert.equal(bad.ok, false);

  const good = validateShiftInput({
    area: 'Bar', title: 'x', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: '3', notes: '',
  });
  assert.equal(good.ok, true);
  assert.equal(good.value.capacity, 3);
  assert.equal(good.value.notes, null);
});
