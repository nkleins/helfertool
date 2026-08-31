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

test('Orga-Schichten erscheinen nur auf /orga, nicht auf /', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db, { name: 'Küche' });
  createShift(db, { area_id, title: 'Helferdienst', starts_at: '2026-09-25T08:00', ends_at: '2026-09-25T09:00', capacity: 2, notes: null, is_orga: 0 });
  createShift(db, { area_id, title: 'Orgatreffen', starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00', capacity: 2, notes: null, is_orga: 1 });
  const home = await app.inject({ method: 'GET', url: '/' });
  assert.match(home.body, /Helferdienst/);
  assert.doesNotMatch(home.body, /Orgatreffen/);
  const orga = await app.inject({ method: 'GET', url: '/orga' });
  assert.match(orga.body, /Orgatreffen/);
  assert.doesNotMatch(orga.body, /Helferdienst/);
  await app.close();
});

test('Bereiche ohne passende Schicht werden je Board ausgeblendet', async () => {
  const { app, db } = await makeApp();
  const kueche = seedArea(db, { name: 'Küche', sort_order: 1 });
  const orgaBereich = seedArea(db, { name: 'Orgabüro', sort_order: 2 });
  createShift(db, { area_id: kueche, title: null, starts_at: '2026-09-25T08:00', ends_at: '2026-09-25T09:00', capacity: 1, notes: null, is_orga: 0 });
  createShift(db, { area_id: orgaBereich, title: null, starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00', capacity: 1, notes: null, is_orga: 1 });
  const home = await app.inject({ method: 'GET', url: '/' });
  assert.match(home.body, /Küche/);
  assert.doesNotMatch(home.body, /Orgabüro/); // hat nur Orga-Schichten
  const orga = await app.inject({ method: 'GET', url: '/orga' });
  assert.match(orga.body, /Orgabüro/);
  assert.doesNotMatch(orga.body, /Küche/); // hat nur normale Schichten
  await app.close();
});

test('/orga zeigt Telefonnummer, / nicht', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db, { name: 'Küche' });
  const helferId = createShift(db, { area_id, title: 'Helferdienst', starts_at: '2026-09-25T08:00', ends_at: '2026-09-25T09:00', capacity: 2, notes: null, is_orga: 0 });
  const orgaId = createShift(db, { area_id, title: 'Orgatreffen', starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00', capacity: 2, notes: null, is_orga: 1 });
  const cookie = await sessionCookie(app);
  const csrf = csrfFromDb(db);
  await app.inject({ method: 'POST', url: '/signup', headers: { cookie },
    payload: { csrf, shift_id: String(helferId), name: 'Anna Schmidt', phone: '0170111', note: '' } });
  await app.inject({ method: 'POST', url: '/orga/signup', headers: { cookie },
    payload: { csrf, shift_id: String(orgaId), name: 'Bea Krug', phone: '0170222', note: '' } });
  const home = await app.inject({ method: 'GET', url: '/' });
  assert.doesNotMatch(home.body, /0170111/); // Telefon auf / versteckt
  assert.match(home.body, /Anna S\./);
  const orga = await app.inject({ method: 'GET', url: '/orga' });
  assert.match(orga.body, /0170222/); // Telefon auf /orga sichtbar
  assert.match(orga.body, /Bea Krug/); // voller Name auf /orga
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
