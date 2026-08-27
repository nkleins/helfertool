import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, formatTime, formatDay } from '../src/display.js';

test('displayName kürzt Nachnamen zu Initial', () => {
  assert.equal(displayName('Kolja Kleinschmidt'), 'Kolja K.');
});
test('displayName ohne Nachname bleibt unverändert', () => {
  assert.equal(displayName('Kolja'), 'Kolja');
});
test('displayName nimmt letztes Wort als Nachname-Initial', () => {
  assert.equal(displayName('Anna Maria Schmidt'), 'Anna S.');
});
test('displayName mit leerer Eingabe ist leer', () => {
  assert.equal(displayName('   '), '');
});
test('formatTime schneidet HH:MM aus ISO', () => {
  assert.equal(formatTime('2026-09-25T18:30'), '18:30');
});
test('formatDay gibt TT.MM.JJJJ', () => {
  assert.equal(formatDay('2026-09-25T18:30'), '25.09.2026');
});
