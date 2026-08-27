import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';

test('GET / responds 200 and sets session cookie', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  const setCookie = res.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie ?? '';
  assert.match(cookieHeader, /sid=/);
  await app.close();
});

test('serves styles.css', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/styles.css' });
  assert.equal(res.statusCode, 200);
  await app.close();
});
