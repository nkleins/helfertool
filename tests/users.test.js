import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, seedArea } from './helpers.js';
import { hashPassword } from '../src/auth.js';
import { createShift } from '../src/repositories/shifts.js';
import { createUser, getUserByName } from '../src/repositories/users.js';

const cookieOf = (res) => [].concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
const csrfOf = (db, cookie) => {
  const sid = /sid=([^;]+)/.exec(cookie)[1];
  return db.prepare('SELECT csrf FROM sessions WHERE id = ?').get(decodeURIComponent(sid).split('.')[0])?.csrf
    ?? db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
};

async function login(app, db, username, password) {
  const g = await app.inject({ method: 'GET', url: '/admin/login' });
  const c0 = cookieOf(g);
  const csrf0 = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/admin/login', headers: { cookie: c0 },
    payload: { csrf: csrf0, username, password } });
  const cookie = cookieOf(res) || c0;
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  return { res, cookie, csrf };
}

test('Frische Installation: admin/admin muss zuerst das Passwort ändern', async () => {
  const { app, db } = await makeApp();
  const { res, cookie, csrf } = await login(app, db, 'admin', 'admin');
  assert.equal(res.headers.location, '/admin/password');
  const dash = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
  assert.equal(dash.headers.location, '/admin/password');

  const bad = await app.inject({ method: 'POST', url: '/admin/password', headers: { cookie },
    payload: { csrf, current: 'admin', password: 'kurz', password2: 'kurz' } });
  assert.match(bad.body, /mindestens 8/);

  const ok = await app.inject({ method: 'POST', url: '/admin/password', headers: { cookie },
    payload: { csrf, current: 'admin', password: 'neues-passwort', password2: 'neues-passwort' } });
  assert.equal(ok.statusCode, 302);
  const dash2 = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
  assert.equal(dash2.statusCode, 200);
  assert.match(dash2.body, /href="\/admin\/users"/);

  const relog = await login(app, db, 'admin', 'admin');
  assert.equal(relog.res.statusCode, 200); // altes Passwort geht nicht mehr
  await app.close();
});

test('Bestehende Installation: Hauptadmin kommt aus ADMIN_USER/ADMIN_PASSWORD_HASH', async () => {
  const { app, db } = await makeApp({ adminUser: 'chef', adminPasswordHash: hashPassword('geheim123') });
  const { res } = await login(app, db, 'chef', 'geheim123');
  assert.equal(res.headers.location, '/admin');
  assert.equal(getUserByName(db, 'chef').is_owner, true);
  await app.close();
});

test('Passwort ändern verlangt das aktuelle Passwort', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim123') });
  const { cookie, csrf } = await login(app, db, 'admin', 'geheim123');
  const res = await app.inject({ method: 'POST', url: '/admin/password', headers: { cookie },
    payload: { csrf, current: 'falsch', password: 'neues-passwort', password2: 'neues-passwort' } });
  assert.match(res.body, /Aktuelles Passwort ist falsch/);
  await app.close();
});

async function teamSetup(perms, areaScope = 'some') {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim123') });
  const bar = seedArea(db, { name: 'Bar' });
  const kueche = seedArea(db, { name: 'Küche' });
  const barShift = createShift(db, { area_id: bar, title: 'Theke', starts_at: '2026-09-25T18:00', ends_at: '2026-09-25T19:00', capacity: 3, notes: null });
  const kuecheShift = createShift(db, { area_id: kueche, title: 'Spülen', starts_at: '2026-09-25T08:00', ends_at: '2026-09-25T09:00', capacity: 3, notes: null });

  const owner = await login(app, db, 'admin', 'geheim123');
  const created = await app.inject({ method: 'POST', url: '/admin/users', headers: { cookie: owner.cookie },
    payload: { csrf: owner.csrf, username: 'barteam', password: 'start-passwort', perms, area_scope: areaScope, areas: [String(bar)] } });
  assert.equal(created.statusCode, 302);

  const first = await login(app, db, 'barteam', 'start-passwort');
  assert.equal(first.res.headers.location, '/admin/password');
  await app.inject({ method: 'POST', url: '/admin/password', headers: { cookie: first.cookie },
    payload: { csrf: first.csrf, current: 'start-passwort', password: 'eigenes-passwort', password2: 'eigenes-passwort' } });
  return { app, db, bar, kueche, barShift, kuecheShift, owner, team: first };
}

test('Team-Account sieht nur freigegebene Bereiche', async () => {
  const { app, team } = await teamSetup(['signups']);
  const dash = await app.inject({ method: 'GET', url: '/admin', headers: { cookie: team.cookie } });
  assert.equal(dash.statusCode, 200);
  assert.match(dash.body, /Theke/);
  assert.doesNotMatch(dash.body, /Spülen/);
  assert.doesNotMatch(dash.body, /href="\/admin\/users"/);
  assert.doesNotMatch(dash.body, /href="\/admin\/settings"/);
  await app.close();
});

test('Team-Account ohne Rechte bekommt 403 auf geschützte Seiten', async () => {
  const { app, team, kuecheShift, barShift } = await teamSetup(['signups']);
  const h = { cookie: team.cookie };
  for (const url of ['/admin/users', '/admin/settings', '/admin/areas', '/admin/shifts/new', '/admin/export.csv',
    `/admin/shifts/${barShift}/edit`, `/admin/shifts/${kuecheShift}`]) {
    const r = await app.inject({ method: 'GET', url, headers: h });
    assert.equal(r.statusCode, 403, url);
  }
  const del = await app.inject({ method: 'POST', url: `/admin/shifts/${barShift}/delete`, headers: h, payload: { csrf: team.csrf } });
  assert.equal(del.statusCode, 403);
  const reset = await app.inject({ method: 'POST', url: '/admin/reset', headers: h, payload: { csrf: team.csrf, confirm: 'ALLES LÖSCHEN' } });
  assert.equal(reset.statusCode, 403);
  await app.close();
});

test('Team-Account mit Recht "signups" darf nur in eigenen Bereichen eintragen', async () => {
  const { app, db, team, barShift, kuecheShift } = await teamSetup(['signups']);
  const h = { cookie: team.cookie };
  const ok = await app.inject({ method: 'POST', url: `/admin/shifts/${barShift}/signups`, headers: h,
    payload: { csrf: team.csrf, name: 'Anna' } });
  assert.equal(ok.statusCode, 302);
  const no = await app.inject({ method: 'POST', url: `/admin/shifts/${kuecheShift}/signups`, headers: h,
    payload: { csrf: team.csrf, name: 'Bob' } });
  assert.equal(no.statusCode, 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signups').get().n, 1);
  await app.close();
});

test('Einstellungen ansehen ≠ ändern', async () => {
  const { app, team } = await teamSetup(['settings_view']);
  const view = await app.inject({ method: 'GET', url: '/admin/settings', headers: { cookie: team.cookie } });
  assert.equal(view.statusCode, 200);
  assert.match(view.body, /nur ansehen/);
  assert.doesNotMatch(view.body, /ALLES LÖSCHEN/);
  const edit = await app.inject({ method: 'POST', url: '/admin/settings', headers: { cookie: team.cookie },
    payload: { csrf: team.csrf, event_name: 'Hack' } });
  assert.equal(edit.statusCode, 403);
  await app.close();
});

test('Neu angelegter Bereich wird für eingeschränkten Account freigeschaltet', async () => {
  const { app, db, team } = await teamSetup(['areas']);
  await app.inject({ method: 'POST', url: '/admin/areas', headers: { cookie: team.cookie },
    payload: { csrf: team.csrf, name: 'Kasse', color: '#123456', sort_order: '0' } });
  const page = await app.inject({ method: 'GET', url: '/admin/areas', headers: { cookie: team.cookie } });
  assert.match(page.body, /Kasse/);
  assert.doesNotMatch(page.body, /value="Küche"/);
  assert.equal(getUserByName(db, 'barteam').areaIds.length, 2);
  await app.close();
});

test('Gelöschter Account ist sofort ausgeloggt', async () => {
  const { app, db, team, owner } = await teamSetup(['signups']);
  const id = getUserByName(db, 'barteam').id;
  await app.inject({ method: 'POST', url: `/admin/users/${id}/delete`, headers: { cookie: owner.cookie }, payload: { csrf: owner.csrf } });
  const dash = await app.inject({ method: 'GET', url: '/admin', headers: { cookie: team.cookie } });
  assert.equal(dash.statusCode, 302);
  assert.equal(dash.headers.location, '/admin/login');
  await app.close();
});

test('Hauptadmin kann nicht gelöscht werden und Benutzernamen sind eindeutig', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim123') });
  const owner = await login(app, db, 'admin', 'geheim123');
  const ownerId = getUserByName(db, 'admin').id;
  await app.inject({ method: 'POST', url: `/admin/users/${ownerId}/delete`, headers: { cookie: owner.cookie }, payload: { csrf: owner.csrf } });
  assert.ok(getUserByName(db, 'admin'));
  createUser(db, { username: 'anna', password: 'passwort123' });
  const dup = await app.inject({ method: 'POST', url: '/admin/users', headers: { cookie: owner.cookie },
    payload: { csrf: owner.csrf, username: 'Anna', password: 'passwort123', area_scope: 'all' } });
  assert.match(dup.body, /gibt es schon/);
  const page = await app.inject({ method: 'GET', url: '/admin/users', headers: { cookie: owner.cookie } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Hauptadmin/);
  await app.close();
});

test('Hauptadmin kann Rechte und Bereiche nachträglich ändern', async () => {
  const { app, db, owner, team, bar, kueche, kuecheShift } = await teamSetup(['signups']);
  const id = getUserByName(db, 'barteam').id;
  // Rechte erweitern: Schichten + Küche dazu
  const r = await app.inject({ method: 'POST', url: `/admin/users/${id}`, headers: { cookie: owner.cookie },
    payload: { csrf: owner.csrf, username: 'barteam', perms: ['signups', 'shifts'], area_scope: 'some', areas: [String(bar), String(kueche)] } });
  assert.equal(r.statusCode, 302);
  const edit = await app.inject({ method: 'GET', url: `/admin/shifts/${kuecheShift}/edit`, headers: { cookie: team.cookie } });
  assert.equal(edit.statusCode, 200); // gilt sofort, ohne neu einloggen
  // Rechte wieder entziehen
  await app.inject({ method: 'POST', url: `/admin/users/${id}`, headers: { cookie: owner.cookie },
    payload: { csrf: owner.csrf, username: 'barteam', area_scope: 'some', areas: String(bar) } });
  const u = getUserByName(db, 'barteam');
  assert.deepEqual(u.perms, []);
  assert.deepEqual(u.areaIds, [bar]);
  const again = await app.inject({ method: 'GET', url: `/admin/shifts/${kuecheShift}/edit`, headers: { cookie: team.cookie } });
  assert.equal(again.statusCode, 403);
  await app.close();
});
