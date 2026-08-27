import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signupsCsv } from '../src/csv.js';

test('csv has header and escapes separators/quotes', () => {
  const csv = signupsCsv([
    { shift_area: 'Bar', shift_title: 'Bar; Freitag', starts_at: '2026-09-25T18:00',
      ends_at: '2026-09-25T20:00', name: 'A "Ace"', phone: null, note: null,
      created_at: '2026-01-01T00:00' },
  ]);
  const lines = csv.trim().split('\n');
  assert.match(lines[0], /^Bereich;Schicht;Beginn;Ende;Name;Telefon;Notiz$/);
  assert.match(lines[1], /"Bar; Freitag"/);
  assert.match(lines[1], /"A ""Ace"""/);
});

test('empty list still returns header', () => {
  assert.match(signupsCsv([]).trim(), /^Bereich;/);
});

test('csv neutralizes spreadsheet formula injection', () => {
  const csv = signupsCsv([
    { shift_area: 'Bar', shift_title: 'x', starts_at: 'a', ends_at: 'b',
      name: '=HYPERLINK("http://evil")', phone: '+49123', note: '@foo', created_at: 'c' },
  ]);
  const line = csv.trim().split('\n')[1];
  assert.match(line, /'=HYPERLINK/);
  assert.match(line, /'\+49123/);
  assert.match(line, /'@foo/);
});
