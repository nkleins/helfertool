import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, seedArea } from './helpers.js';
import { createShift } from '../src/repositories/shifts.js';

async function sessionCookie(app) {
  const res = await app.inject({ method: 'GET', url: '/' });
  const raw = [].concat(res.headers['set-cookie'] ?? []);
  return raw.map((c) => c.split(';')[0]).join('; ');
}

function csrfFromDb(db) {
  return db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
}

test('GET / zeigt Bereichs-Tab und Schicht', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db, { name: 'Küche' });
  createShift(db, { area_id, title: null, starts_at: '2026-09-25T08:00', ends_at: '2026-09-25T09:00', capacity: 2, notes: null });
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.match(res.body, /Küche/);
  assert.match(res.body, /08:00/);
  await app.close();
});

test('POST /signup setzt htoken-Cookie und zeigt Namen gekürzt', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2026-09-25T18:00', ends_at: '2026-09-25T19:00', capacity: 2, notes: null });
  const cookie = await sessionCookie(app);
  const csrf = csrfFromDb(db);
  const res = await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf, shift_id: String(id), name: 'Kolja Kleinschmidt', phone: '', note: '' } });
  assert.equal(res.statusCode, 302);
  const setCookies = [].concat(res.headers['set-cookie'] ?? []).join(';');
  assert.match(setCookies, /htoken=/);
  const home = await app.inject({ method: 'GET', url: '/' });
  assert.match(home.body, /Kolja K\./);
  assert.doesNotMatch(home.body, /Kleinschmidt/);
  await app.close();
});

test('POST /signup with valid data redirects to /danke', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2026-09-25T18:00',
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
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2026-09-25T18:00',
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
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 1, notes: null });
  const cookie = await sessionCookie(app);
  const res = await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf: 'wrong', shift_id: String(id), name: 'Anna' } });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test('POST /signup is globally rate limited (floodgate)', async () => {
  const { app, db } = await makeApp({ signupRateMax: 2 });
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2026-09-25T18:00',
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

test('Volle Schicht zeigt "Voll" statt Anmeldeformular', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2026-09-25T10:00',
    ends_at: '2026-09-25T11:00', capacity: 1, notes: null });
  const cookie = await sessionCookie(app);
  const csrf = csrfFromDb(db);
  await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf, shift_id: String(id), name: 'Max', phone: '', note: '' } });
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.match(res.body, /Voll/);
  await app.close();
});
