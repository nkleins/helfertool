import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = {
  ADMIN_USER: 'admin', ADMIN_PASSWORD_HASH: 'scrypt$aa$bb',
  SESSION_SECRET: 's', BASE_URL: 'https://helfer.example.org',
};

test('loads and derives values', () => {
  const c = loadConfig({ ...base, PORT: '8080', DB_PATH: '/data/app.db' });
  assert.equal(c.adminUser, 'admin');
  assert.equal(c.port, 8080);
  assert.equal(c.secureCookie, true);
  assert.equal(c.dbPath, '/data/app.db');
});

test('throws when required missing', () => {
  assert.throws(() => loadConfig({ ADMIN_USER: 'admin' }));
  assert.doesNotThrow(() => loadConfig({ SESSION_SECRET: 's', BASE_URL: 'http://x' }));
});

test('http base -> insecure cookie', () => {
  const c = loadConfig({ ...base, BASE_URL: 'http://localhost:8080' });
  assert.equal(c.secureCookie, false);
});
