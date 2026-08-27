import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { createShift } from '../src/repositories/shifts.js';

async function sessionCookie(app) {
  const res = await app.inject({ method: 'GET', url: '/' });
  const raw = [].concat(res.headers['set-cookie'] ?? []);
  return raw.map((c) => c.split(';')[0]).join('; ');
}

function csrfFromDb(db) {
  return db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
}

test('GET / lists open shifts', async () => {
  const { app, db } = await makeApp();
  createShift(db, { area: 'Bar', title: 'Bar Fr', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 2, notes: null });
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.match(res.body, /Bar Fr/);
  await app.close();
});

test('POST /signup with valid data redirects to /danke', async () => {
  const { app, db } = await makeApp();
  const id = createShift(db, { area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 1, notes: null });
  const cookie = await sessionCookie(app);
  const csrf = csrfFromDb(db);
  const res = await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf, shift_id: String(id), name: 'Anna', phone: '', note: '' } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/danke');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signups').get().n, 1);
  await app.close();
});

test('POST /signup rejects missing name', async () => {
  const { app, db } = await makeApp();
  const id = createShift(db, { area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 1, notes: null });
  const cookie = await sessionCookie(app);
  const csrf = csrfFromDb(db);
  const res = await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf, shift_id: String(id), name: '', phone: '', note: '' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /erforderlich/);
  await app.close();
});

test('POST /signup rejects bad csrf', async () => {
  const { app, db } = await makeApp();
  const id = createShift(db, { area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 1, notes: null });
  const cookie = await sessionCookie(app);
  const res = await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf: 'wrong', shift_id: String(id), name: 'Anna' } });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test('POST /signup is globally rate limited (floodgate)', async () => {
  const { app, db } = await makeApp({ signupRateMax: 2 });
  const id = createShift(db, { area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 50, notes: null });
  const cookie = await sessionCookie(app);
  const csrf = csrfFromDb(db);
  const codes = [];
  for (let i = 0; i < 4; i++) {
    const res = await app.inject({ method: 'POST', url: '/signup',
      headers: { cookie }, payload: { csrf, shift_id: String(id), name: 'H' + i } });
    codes.push(res.statusCode);
  }
  assert.ok(codes.filter((c) => c === 429).length >= 1, `expected a 429, got ${codes}`);
  await app.close();
});
