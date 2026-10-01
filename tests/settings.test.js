import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { hashPassword } from '../src/auth.js';
import { getSettings, getLogo, detectImageMime } from '../src/repositories/settings.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

async function adminSession() {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const g = await app.inject({ method: 'GET', url: '/admin/login' });
  const cookie0 = [].concat(g.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
  const csrf0 = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/admin/login', headers: { cookie: cookie0 },
    payload: { csrf: csrf0, username: 'admin', password: 'geheim' } });
  const cookie = [].concat(res.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ');
  const csrf = db.prepare('SELECT csrf FROM sessions WHERE is_admin = 1 ORDER BY rowid DESC LIMIT 1').get().csrf;
  return { app, db, cookie, csrf };
}

function multipart(fields, file) {
  const boundary = '----testboundary';
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="logo"; filename="logo.png"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    chunks.push(file, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

test('Standard-Branding erscheint im Kopfbereich', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.match(res.body, /Arbeitsbeschaffungsmaßnahmen · Kölnvention/);
  await app.close();
});

test('Einstellungen erfordern Login', async () => {
  const { app } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const res = await app.inject({ method: 'GET', url: '/admin/settings' });
  assert.equal(res.statusCode, 302);
  await app.close();
});

test('Admin ändert Name und lädt Logo hoch', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const mp = multipart({ csrf, event_name: 'Disco-Dienste', org_name: 'Discocon', motto: '', footer: 'Disco e.V.',
    accent_color: '#ff00aa', show_logo: '1' }, PNG);
  const res = await app.inject({ method: 'POST', url: '/admin/settings',
    headers: { cookie, ...mp.headers }, payload: mp.payload });
  assert.equal(res.statusCode, 302);
  assert.equal(getSettings(db).event_name, 'Disco-Dienste');
  assert.equal(getLogo(db).mime, 'image/png');

  const page = await app.inject({ method: 'GET', url: '/' });
  assert.match(page.body, /Disco-Dienste · Discocon/);
  assert.match(page.body, /#ff00aa/);
  assert.doesNotMatch(page.body, /class="motto"/);

  const logo = await app.inject({ method: 'GET', url: '/logo' });
  assert.equal(logo.headers['content-type'], 'image/png');
  assert.equal(logo.rawPayload.length, PNG.length);
  await app.close();
});

test('Kein Bild (z.B. SVG/HTML) wird als Logo abgelehnt', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const mp = multipart({ csrf, event_name: 'X', accent_color: '#123456' }, Buffer.from('<svg onload="alert(1)"></svg>'));
  const res = await app.inject({ method: 'POST', url: '/admin/settings',
    headers: { cookie, ...mp.headers }, payload: mp.payload });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /PNG-, JPG-/);
  assert.equal(getLogo(db), undefined);
  await app.close();
});

test('Einstellungen ohne gültiges CSRF werden abgelehnt', async () => {
  const { app, db, cookie } = await adminSession();
  const mp = multipart({ csrf: 'falsch', event_name: 'X' });
  const res = await app.inject({ method: 'POST', url: '/admin/settings',
    headers: { cookie, ...mp.headers }, payload: mp.payload });
  assert.equal(res.statusCode, 403);
  assert.equal(getSettings(db).event_name, 'Arbeitsbeschaffungsmaßnahmen');
  await app.close();
});

test('detectImageMime erkennt gängige Formate', () => {
  assert.equal(detectImageMime(PNG), 'image/png');
  assert.equal(detectImageMime(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12)])), 'image/jpeg');
  assert.equal(detectImageMime(Buffer.from('<svg xmlns="x"></svg>')), null);
});

test('Zu großes Logo zeigt Fehlermeldung', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
  const mp = multipart({ csrf, event_name: 'X', accent_color: '#123456' }, big);
  const res = await app.inject({ method: 'POST', url: '/admin/settings',
    headers: { cookie, ...mp.headers }, payload: mp.payload });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /zu groß/);
  assert.equal(getLogo(db), undefined);
  await app.close();
});

test('Einstellungsseite rendert Formular', async () => {
  const { app, cookie } = await adminSession();
  const res = await app.inject({ method: 'GET', url: '/admin/settings', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /enctype="multipart\/form-data"/);
  assert.match(res.body, /value="Arbeitsbeschaffungsmaßnahmen"/);
  await app.close();
});

test('Credit steht immer in der Fußzeile, auch ohne eigene Fußzeile', async () => {
  const { app, db } = await makeApp();
  db.prepare("INSERT INTO settings (key, value) VALUES ('footer', '')").run();
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.match(res.body, /Helfertool © \d{4} Nikolai Kleinschmidt/);
  await app.close();
});

async function seedData(db) {
  const { createArea } = await import('../src/repositories/areas.js');
  const { createShift } = await import('../src/repositories/shifts.js');
  const { createSignup } = await import('../src/repositories/signups.js');
  const area_id = createArea(db, { name: 'Bar' });
  const shift_id = createShift(db, { area_id, title: null, starts_at: '2026-09-25T08:00', ends_at: '2026-09-25T09:00', capacity: 2, notes: null });
  createSignup(db, { shift_id, name: 'Anna' });
}
const count = (db, t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;

test('Zurücksetzen ohne richtige Bestätigung löscht nichts', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  await seedData(db);
  const res = await app.inject({ method: 'POST', url: '/admin/reset', headers: { cookie },
    payload: { csrf, confirm: 'ja' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /ALLES LÖSCHEN/);
  assert.equal(count(db, 'shifts'), 1);
  assert.equal(count(db, 'signups'), 1);
  await app.close();
});

test('Zurücksetzen löscht Schichten und Anmeldungen, behält Bereiche und Branding', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  await seedData(db);
  db.prepare("INSERT INTO settings (key, value) VALUES ('event_name', 'Disco-Dienste')").run();
  const res = await app.inject({ method: 'POST', url: '/admin/reset', headers: { cookie },
    payload: { csrf, confirm: ' alles löschen ' } });
  assert.equal(res.statusCode, 302);
  assert.equal(count(db, 'shifts'), 0);
  assert.equal(count(db, 'signups'), 0);
  assert.equal(count(db, 'areas'), 1);
  assert.equal(getSettings(db).event_name, 'Disco-Dienste');
  await app.close();
});

test('Zurücksetzen mit Haken löscht auch Bereiche', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  await seedData(db);
  await app.inject({ method: 'POST', url: '/admin/reset', headers: { cookie },
    payload: { csrf, confirm: 'ALLES LÖSCHEN', include_areas: '1' } });
  assert.equal(count(db, 'areas'), 0);
  await app.close();
});

test('Zurücksetzen erfordert Login und CSRF', async () => {
  const { app, db, cookie } = await adminSession();
  await seedData(db);
  const r1 = await app.inject({ method: 'POST', url: '/admin/reset', payload: { confirm: 'ALLES LÖSCHEN' } });
  assert.equal(r1.statusCode, 302);
  const r2 = await app.inject({ method: 'POST', url: '/admin/reset', headers: { cookie }, payload: { csrf: 'x', confirm: 'ALLES LÖSCHEN' } });
  assert.equal(r2.statusCode, 403);
  assert.equal(count(db, 'shifts'), 1);
  await app.close();
});
