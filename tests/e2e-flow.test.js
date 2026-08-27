import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { hashPassword } from '../src/auth.js';

async function login(app, db) {
  const g = await app.inject({ method: 'GET', url: '/admin/login' });
  const cookie = [].concat(g.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/admin/login', headers: { cookie }, payload: { csrf, username: 'admin', password: 'geheim' } });
  const sid = [].concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('sid='));
  const newCsrf = db.prepare('SELECT csrf FROM sessions WHERE is_admin = 1 ORDER BY rowid DESC LIMIT 1').get().csrf;
  return { cookie: sid, csrf: newCsrf };
}

test('Voller Ablauf: Bereich → Generator → öffentliche Anmeldung', async () => {
  const { app, db } = await makeApp({ adminPasswordHash: hashPassword('geheim') });
  const { cookie, csrf } = await login(app, db);

  await app.inject({ method: 'POST', url: '/admin/areas', headers: { cookie }, payload: { csrf, name: 'Küche', color: '#ff8844', sort_order: '1' } });
  const area_id = db.prepare('SELECT id FROM areas WHERE name = ?').get('Küche').id;

  const gen = await app.inject({ method: 'POST', url: '/admin/shifts/generate', headers: { cookie },
    payload: { csrf, area_id: String(area_id), title: '', date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '30', capacity: '2', notes: '' } });
  assert.equal(gen.statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 4);

  const home = await app.inject({ method: 'GET', url: '/' });
  assert.match(home.body, /Küche/);
  assert.match(home.body, /08:00/);
  await app.close();
});
