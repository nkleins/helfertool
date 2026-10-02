import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, seedArea } from './helpers.js';
import { hashPassword } from '../src/auth.js';
import { createShift } from '../src/repositories/shifts.js';
import { saveSettings, getSettings } from '../src/repositories/settings.js';

const cookieOf = (res) => [].concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
const lastCsrf = (db) => db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;

async function setup() {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim123') });
  const area_id = seedArea(db, { name: 'Bar' });
  const orgaShift = createShift(db, { area_id, title: 'Orgatreffen', starts_at: '2099-09-25T10:00', ends_at: '2099-09-25T11:00', capacity: 3, notes: null, is_orga: 1 });
  saveSettings(db, { orga_password_hash: hashPassword('orga-geheim') });
  return { app, db, orgaShift };
}

test('/orga verlangt das Passwort, danach ist das Gerät freigeschaltet', async () => {
  const { app, db } = await setup();
  const first = await app.inject({ method: 'GET', url: '/orga' });
  assert.match(first.body, /passwortgeschützt/);
  assert.doesNotMatch(first.body, /Orgatreffen/);
  const cookie = cookieOf(first);
  const csrf = lastCsrf(db);

  const wrong = await app.inject({ method: 'POST', url: '/orga/login', headers: { cookie }, payload: { csrf, password: 'falsch' } });
  assert.match(wrong.body, /Passwort ist falsch/);

  const ok = await app.inject({ method: 'POST', url: '/orga/login', headers: { cookie }, payload: { csrf, password: 'orga-geheim' } });
  assert.equal(ok.headers.location, '/orga');
  const page = await app.inject({ method: 'GET', url: '/orga', headers: { cookie } });
  assert.match(page.body, /Orgatreffen/);

  // Neues Passwort sperrt das Gerät wieder aus
  saveSettings(db, { orga_password_hash: hashPassword('ganz-neu-123') });
  const again = await app.inject({ method: 'GET', url: '/orga', headers: { cookie } });
  assert.doesNotMatch(again.body, /Orgatreffen/);
  await app.close();
});

test('Ohne Freischaltung keine Anmeldung für Orga-Schichten – auch nicht über /signup', async () => {
  const { app, db, orgaShift } = await setup();
  const g = await app.inject({ method: 'GET', url: '/' });
  const cookie = cookieOf(g);
  const csrf = lastCsrf(db);
  const viaOrga = await app.inject({ method: 'POST', url: '/orga/signup', headers: { cookie }, payload: { csrf, shift_id: String(orgaShift), name: 'Eve' } });
  assert.equal(viaOrga.headers.location, '/orga');
  const viaPublic = await app.inject({ method: 'POST', url: '/signup', headers: { cookie }, payload: { csrf, shift_id: String(orgaShift), name: 'Eve' } });
  assert.match(viaPublic.body, /Schicht nicht gefunden/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signups').get().n, 0);
  await app.close();
});

test('Eingeloggte Admins sehen /orga ohne Passwort; Einstellungen setzen und entfernen den Schutz', async () => {
  const { app, db } = await setup();
  const g = await app.inject({ method: 'GET', url: '/admin/login' });
  const login = await app.inject({ method: 'POST', url: '/admin/login', headers: { cookie: cookieOf(g) },
    payload: { csrf: lastCsrf(db), username: 'admin', password: 'geheim123' } });
  const cookie = cookieOf(login);
  const csrf = db.prepare('SELECT csrf FROM sessions WHERE is_admin = 1').get().csrf;
  const page = await app.inject({ method: 'GET', url: '/orga', headers: { cookie } });
  assert.match(page.body, /Orgatreffen/);
  // Das Passwort taucht nirgends im HTML auf
  const settings = await app.inject({ method: 'GET', url: '/admin/settings', headers: { cookie } });
  assert.doesNotMatch(settings.body, /scrypt\$/);

  const base = { csrf, event_name: 'X', accent_color: '#123456' };
  const missing = await app.inject({ method: 'POST', url: '/admin/settings', headers: { cookie }, payload: { ...base } });
  assert.equal(missing.statusCode, 302);
  assert.equal(getSettings(db).orga_password_hash, ''); // Haken aus = Schutz aus
  const noPw = await app.inject({ method: 'POST', url: '/admin/settings', headers: { cookie }, payload: { ...base, orga_protect: '1' } });
  assert.match(noPw.body, /Passwort für \/orga eintragen/);
  await app.inject({ method: 'POST', url: '/admin/settings', headers: { cookie }, payload: { ...base, orga_protect: '1', orga_password: 'neues-orga-pw' } });
  assert.match(getSettings(db).orga_password_hash, /^scrypt\$/);
  await app.close();
});
