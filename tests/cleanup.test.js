import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, seedArea } from './helpers.js';
import { createShift } from '../src/repositories/shifts.js';
import { createDb } from '../src/db.js';
import { createSession, hashPassword } from '../src/auth.js';

const count = (db, t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;

test('Statische Dateien legen keine Session an', async () => {
  const { app, db } = await makeApp();
  const before = count(db, 'sessions');
  for (const url of ['/styles.css', '/logo', '/assets/Logo_weiss-1_2.png']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, url);
    assert.equal(res.headers['set-cookie'], undefined, url);
  }
  assert.equal(count(db, 'sessions'), before);
  await app.close();
});

test('Abgelaufene Sessions werden beim Anlegen neuer Sessions entfernt', () => {
  const db = createDb(':memory:');
  const { id } = createSession(db);
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id);
  createSession(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE id = ?').get(id).n, 0);
});

test('Fehler beim Eintragen erscheint an der Schicht, Eingaben bleiben erhalten', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: 'Kasse', starts_at: '2099-09-25T18:00', ends_at: '2099-09-25T19:00', capacity: 2, notes: null, requires_phone: 1 });
  const g = await app.inject({ method: 'GET', url: '/' });
  const cookie = [].concat(g.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/signup', headers: { cookie },
    payload: { csrf, shift_id: String(id), name: 'Anna', phone: '' } });
  const slot = res.body.slice(res.body.indexOf('has-error'));
  assert.match(slot, /Telefonnummer Pflicht/);
  assert.match(slot, /value="Anna"/);
  // nicht zusätzlich oben über der Liste
  assert.equal(res.body.split('class="errors"').length - 1, 1);
  await app.close();
});

test('Admin: ungültiger manueller Eintrag zeigt Fehlermeldung', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim123') });
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2099-09-25T18:00', ends_at: '2099-09-25T19:00', capacity: 2, notes: null });
  const g = await app.inject({ method: 'GET', url: '/admin/login' });
  const c0 = [].concat(g.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
  const csrf0 = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const login = await app.inject({ method: 'POST', url: '/admin/login', headers: { cookie: c0 }, payload: { csrf: csrf0, username: 'admin', password: 'geheim123' } });
  const cookie = [].concat(login.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
  const csrf = db.prepare('SELECT csrf FROM sessions WHERE is_admin = 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: `/admin/shifts/${id}/signups`, headers: { cookie }, payload: { csrf, name: '  ' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Name ist erforderlich/);
  // Eingeloggt: Login-Seite leitet aufs Dashboard
  const again = await app.inject({ method: 'GET', url: '/admin/login', headers: { cookie } });
  assert.equal(again.headers.location, '/admin');
  await app.close();
});
