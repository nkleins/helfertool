import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';

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
