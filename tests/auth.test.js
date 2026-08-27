import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { hashPassword, verifyPassword, createSession, getSession, deleteSession }
  from '../src/auth.js';

test('hash + verify roundtrip', () => {
  const h = hashPassword('geheim');
  assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword('geheim', h), true);
  assert.equal(verifyPassword('falsch', h), false);
});

test('verify rejects malformed stored value', () => {
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
});

test('session create/get/delete', () => {
  const db = createDb(':memory:');
  const { id, csrf } = createSession(db, { isAdmin: true });
  assert.equal(typeof id, 'string');
  assert.equal(typeof csrf, 'string');
  const s = getSession(db, id);
  assert.equal(s.is_admin, 1);
  deleteSession(db, id);
  assert.equal(getSession(db, id), undefined);
});

test('expired session is not returned', () => {
  const db = createDb(':memory:');
  const { id } = createSession(db, {});
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
    .run('2000-01-01T00:00:00.000Z', id);
  assert.equal(getSession(db, id), undefined);
});
