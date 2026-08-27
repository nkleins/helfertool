import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, seedArea } from './helpers.js';
import { hashPassword } from '../src/auth.js';

async function login(app, db, user = 'admin', pass = 'geheim') {
  const g = await app.inject({ method: 'GET', url: '/admin/login' });
  const cookie = [].concat(g.headers['set-cookie'] ?? [])
    .map((c) => c.split(';')[0]).join('; ');
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/admin/login',
    headers: { cookie }, payload: { csrf, username: user, password: pass } });
  // Login rotates the session (new admin session + cookie); pick up the
  // rotated cookie for subsequent requests, falling back to the original
  // when login failed and no new cookie was issued.
  const rotated = [].concat(res.headers['set-cookie'] ?? [])
    .map((c) => c.split(';')[0]).join('; ');
  return { res, cookie: rotated || cookie };
}

async function adminSession() {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie } = await login(app, db);
  const csrf = db.prepare("SELECT csrf FROM sessions WHERE is_admin = 1 ORDER BY rowid DESC LIMIT 1").get().csrf;
  return { app, db, cookie, csrf };
}

test('login rejects wrong password', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { res } = await login(app, db, 'admin', 'falsch');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /falsch|ungültig/i);
  await app.close();
});

test('login accepts correct credentials and reaches dashboard', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { res, cookie } = await login(app, db);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/admin');
  const dash = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
  assert.equal(dash.statusCode, 200);
  assert.match(dash.body, /Dashboard|Schichten/);
  await app.close();
});

test('GET /admin without login redirects', async () => {
  const { app } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const res = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/admin/login');
  await app.close();
});

test('admin can create a shift', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie } = await login(app, db);
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/admin/shifts', headers: { cookie },
    payload: { csrf, area: 'Bar', title: 'Bar Fr', starts_at: '2026-09-25T18:00',
      ends_at: '2026-09-25T20:00', capacity: '3', notes: '' } });
  assert.equal(res.statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 1);
  await app.close();
});

test('admin can delete a shift', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie } = await login(app, db);
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  db.prepare(`INSERT INTO shifts (area,title,starts_at,ends_at,capacity)
    VALUES ('Bar','x','2026-09-25T18:00','2026-09-25T20:00',3)`).run();
  const id = db.prepare('SELECT id FROM shifts LIMIT 1').get().id;
  const res = await app.inject({ method: 'POST', url: `/admin/shifts/${id}/delete`,
    headers: { cookie }, payload: { csrf } });
  assert.equal(res.statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 0);
  await app.close();
});

test('create shift rejects invalid time order', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie } = await login(app, db);
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/admin/shifts', headers: { cookie },
    payload: { csrf, area: 'Bar', title: 'x', starts_at: '2026-09-25T20:00',
      ends_at: '2026-09-25T18:00', capacity: '3', notes: '' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /nach dem Start/);
  await app.close();
});

test('admin adds and removes a signup on a shift', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie } = await login(app, db);
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  db.prepare(`INSERT INTO shifts (area,title,starts_at,ends_at,capacity)
    VALUES ('Bar','x','2026-09-25T18:00','2026-09-25T20:00',2)`).run();
  const id = db.prepare('SELECT id FROM shifts LIMIT 1').get().id;

  const add = await app.inject({ method: 'POST', url: `/admin/shifts/${id}/signups`,
    headers: { cookie }, payload: { csrf, name: 'Bea', phone: '', note: '' } });
  assert.equal(add.statusCode, 302);
  const sid = db.prepare('SELECT id FROM signups LIMIT 1').get().id;

  const del = await app.inject({ method: 'POST', url: `/admin/signups/${sid}/delete`,
    headers: { cookie }, payload: { csrf, shift_id: String(id) } });
  assert.equal(del.statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signups').get().n, 0);
  await app.close();
});

test('admin detail page shows signups', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie } = await login(app, db);
  db.prepare(`INSERT INTO shifts (area,title,starts_at,ends_at,capacity)
    VALUES ('Bar','x','2026-09-25T18:00','2026-09-25T20:00',2)`).run();
  const id = db.prepare('SELECT id FROM shifts LIMIT 1').get().id;
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)')
    .run(id, 'Cara', '2026-01-01T00:00');
  const res = await app.inject({ method: 'GET', url: `/admin/shifts/${id}`, headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Cara/);
  await app.close();
});

test('csv export returns text/csv with header', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie } = await login(app, db);
  db.prepare(`INSERT INTO shifts (area,title,starts_at,ends_at,capacity)
    VALUES ('Bar','x','2026-09-25T18:00','2026-09-25T20:00',2)`).run();
  const id = db.prepare('SELECT id FROM shifts LIMIT 1').get().id;
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)')
    .run(id, 'Dana', '2026-01-01T00:00');
  const res = await app.inject({ method: 'GET', url: '/admin/export.csv', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.body, /Bereich;/);
  assert.match(res.body, /Dana/);
  await app.close();
});

test('qr page renders an embedded qr image', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie } = await login(app, db);
  const res = await app.inject({ method: 'GET', url: '/admin/qr', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /data:image\/png;base64,/);
  await app.close();
});

test('qr endpoints require admin', async () => {
  const { app } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const res = await app.inject({ method: 'GET', url: '/admin/qr' });
  assert.equal(res.statusCode, 302);
  await app.close();
});

test('Admin kann Bereich anlegen und sieht ihn in der Liste', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const res = await app.inject({ method: 'POST', url: '/admin/areas',
    headers: { cookie }, payload: { csrf, name: 'Küche', color: '#ff8844', sort_order: '1' } });
  assert.equal(res.statusCode, 302);
  const list = await app.inject({ method: 'GET', url: '/admin/areas', headers: { cookie } });
  assert.match(list.body, /Küche/);
  await app.close();
});

test('GET /admin/areas ohne Login leitet um', async () => {
  const { app } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const res = await app.inject({ method: 'GET', url: '/admin/areas' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/admin/login');
  await app.close();
});

test('Anlegen mit ungültigem Namen zeigt Fehler', async () => {
  const { app, cookie, csrf } = await adminSession();
  const res = await app.inject({ method: 'POST', url: '/admin/areas',
    headers: { cookie }, payload: { csrf, name: '', color: '#ff8844', sort_order: '1' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /erforderlich/);
  await app.close();
});

test('Admin kann Bereich aktualisieren', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const id = seedArea(db, { name: 'Alt', color: '#111111', sort_order: 0 });
  const res = await app.inject({ method: 'POST', url: `/admin/areas/${id}`,
    headers: { cookie }, payload: { csrf, name: 'Neu', color: '#222222', sort_order: '3' } });
  assert.equal(res.statusCode, 302);
  const updated = db.prepare('SELECT * FROM areas WHERE id = ?').get(id);
  assert.equal(updated.name, 'Neu');
  assert.equal(updated.color, '#222222');
  assert.equal(updated.sort_order, 3);
  await app.close();
});

test('Aktualisieren eines unbekannten Bereichs liefert 404', async () => {
  const { app, cookie, csrf } = await adminSession();
  const res = await app.inject({ method: 'POST', url: '/admin/areas/999999',
    headers: { cookie }, payload: { csrf, name: 'X', color: '#222222', sort_order: '0' } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('Admin kann Bereich löschen', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const id = seedArea(db, { name: 'Löschmich', color: '#111111', sort_order: 0 });
  const res = await app.inject({ method: 'POST', url: `/admin/areas/${id}/delete`,
    headers: { cookie }, payload: { csrf } });
  assert.equal(res.statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM areas WHERE id = ?').get(id).n, 0);
  await app.close();
});
