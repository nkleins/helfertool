import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAreaInput, validateGenerateInput, validateShiftInput, validateSignupInput } from '../src/validate.js';

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
    area_id: '1', title: 'x', starts_at: '2026-09-25T20:00',
    ends_at: '2026-09-25T18:00', capacity: '0',
  });
  assert.equal(bad.ok, false);

  const good = validateShiftInput({
    area_id: '1', title: 'x', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: '3', notes: '',
  });
  assert.equal(good.ok, true);
  assert.equal(good.value.capacity, 3);
  assert.equal(good.value.notes, null);
});

test('validateAreaInput verlangt Name, setzt Farb-Default', () => {
  assert.equal(validateAreaInput({ name: '' }).ok, false);
  const v = validateAreaInput({ name: 'Küche', color: '', sort_order: '' });
  assert.equal(v.ok, true);
  assert.equal(v.value.name, 'Küche');
  assert.equal(v.value.color, '#888888');
  assert.equal(v.value.sort_order, 0);
});

test('validateShiftInput akzeptiert leeren Titel als null', () => {
  const v = validateShiftInput({ area_id: '3', title: '', starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00', capacity: '2' });
  assert.equal(v.ok, true);
  assert.equal(v.value.area_id, 3);
  assert.equal(v.value.title, null);
});

test('validateShiftInput lehnt fehlenden Bereich und Ende<=Start ab', () => {
  assert.equal(validateShiftInput({ area_id: '', starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00', capacity: '1' }).ok, false);
  assert.equal(validateShiftInput({ area_id: '1', starts_at: '2026-09-25T11:00', ends_at: '2026-09-25T10:00', capacity: '1' }).ok, false);
});

test('validateGenerateInput prüft Zeitfenster, Länge und Kapazität', () => {
  const v = validateGenerateInput({ area_id: '2', title: 'Frühdienst', date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '30', capacity: '3' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value, { area_id: 2, title: 'Frühdienst', date: '2026-09-25', from: '08:00', to: '10:00', slotMinutes: 30, capacity: 3, notes: null, is_orga: 0, requires_phone: 0, title_en: null, notes_en: null });
  assert.equal(validateGenerateInput({ area_id: '2', date: '2026-09-25', from: '10:00', to: '10:00', slot_minutes: '30', capacity: '3' }).ok, false);
  assert.equal(validateGenerateInput({ area_id: '2', date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '45', capacity: '3' }).ok, false);
});

test('validateGenerateInput übernimmt is_orga aus der Checkbox', () => {
  const base = { area_id: '2', date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '60', capacity: '2' };
  assert.equal(validateGenerateInput(base).value.is_orga, 0);
  assert.equal(validateGenerateInput({ ...base, is_orga: '1' }).value.is_orga, 1);
});

test('validateGenerateInput erlaubt Schichtlängen bis 8 h, lehnt Zwischenwerte ab', () => {
  const base = { area_id: '2', date: '2026-09-25', from: '08:00', to: '10:00', capacity: '2' };
  assert.equal(validateGenerateInput({ ...base, slot_minutes: '480' }).ok, true);
  assert.equal(validateGenerateInput({ ...base, slot_minutes: '240' }).ok, true);
  assert.equal(validateGenerateInput({ ...base, slot_minutes: '150' }).ok, false);
  assert.equal(validateGenerateInput({ ...base, slot_minutes: '540' }).ok, false);
});

test('validateAreaInput übernimmt optionale Beschreibung', () => {
  assert.equal(validateAreaInput({ name: 'Küche' }).value.description, null);
  assert.equal(validateAreaInput({ name: 'Küche', description: 'Am Zelt hinten' }).value.description, 'Am Zelt hinten');
});

test('validateGenerateInput übernimmt requires_phone aus der Checkbox', () => {
  const base = { area_id: '2', date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '60', capacity: '2' };
  assert.equal(validateGenerateInput(base).value.requires_phone, 0);
  assert.equal(validateGenerateInput({ ...base, requires_phone: '1' }).value.requires_phone, 1);
});

test('validateGenerateInput erlaubt Über-Mitternacht (Bis vor Von), aber nicht Bis == Von', () => {
  const base = { area_id: '2', date: '2026-09-25', slot_minutes: '60', capacity: '3' };
  assert.equal(validateGenerateInput({ ...base, from: '22:00', to: '02:00' }).ok, true);
  const equal = validateGenerateInput({ ...base, from: '10:00', to: '10:00' });
  assert.equal(equal.ok, false);
  assert.ok(equal.errors.includes('v.sameTime'));
});

test('validateGenerateInput erlaubt nur volle/halbe Stunden für von/bis', () => {
  const base = { area_id: '2', date: '2026-09-25', slot_minutes: '30', capacity: '3' };
  assert.equal(validateGenerateInput({ ...base, from: '08:00', to: '10:30' }).ok, true);
  const bad = validateGenerateInput({ ...base, from: '08:15', to: '10:00' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('v.halfHour'));
  assert.equal(validateGenerateInput({ ...base, from: '08:00', to: '10:45' }).ok, false);
});
