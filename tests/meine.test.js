import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, seedArea } from './helpers.js';
import { createShift } from '../src/repositories/shifts.js';

async function sessionCookie(app) {
  const res = await app.inject({ method: 'GET', url: '/' });
  return [].concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
}
function csrfFromDb(db) {
  return db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
}

test('Eintragen → /meine zeigt eigene Schicht; Abmelden entfernt sie', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db, { name: 'Küche' });
  const id = createShift(db, { area_id, title: 'Frühdienst', starts_at: '2026-09-25T08:00', ends_at: '2026-09-25T09:00', capacity: 2, notes: null });
  const cookie = await sessionCookie(app);
  const csrf = csrfFromDb(db);
  const signup = await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf, shift_id: String(id), name: 'Anna Meyer', phone: '', note: '' } });
  const htoken = [].concat(signup.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('htoken='));
  const full = `${cookie}; ${htoken}`;
  const mine = await app.inject({ method: 'GET', url: '/meine', headers: { cookie: full } });
  assert.match(mine.body, /Frühdienst/);
  assert.match(mine.body, /Küche/);
  const sid = db.prepare('SELECT id FROM signups LIMIT 1').get().id;
  const cancel = await app.inject({ method: 'POST', url: `/signup/${sid}/cancel`, headers: { cookie: full }, payload: { csrf } });
  assert.equal(cancel.statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signups').get().n, 0);
  await app.close();
});

test('/meine ohne htoken zeigt Leerzustand', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/meine' });
  assert.match(res.body, /noch nicht eingetragen|keine/i);
  await app.close();
});
