import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, seedArea } from './helpers.js';
import { createShift } from '../src/repositories/shifts.js';
import { translator, messages } from '../src/i18n.js';

test('Deutsch ist Standard, englischer Browser bekommt Englisch', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db, { name: 'Bar' });
  createShift(db, { area_id, title: 'Theke', starts_at: '2099-09-25T18:00', ends_at: '2099-09-25T19:00', capacity: 2, notes: null });
  const de = await app.inject({ method: 'GET', url: '/' });
  assert.match(de.body, /<html lang="de">/);
  assert.match(de.body, /Eintragen/);
  assert.match(de.body, /2 von 2 frei/);
  const en = await app.inject({ method: 'GET', url: '/', headers: { 'accept-language': 'en-GB,en;q=0.9' } });
  assert.match(en.body, /<html lang="en">/);
  assert.match(en.body, /Sign up/);
  assert.match(en.body, /2 of 2 free/);
  assert.match(en.body, /Theke/); // Inhalte aus der DB bleiben wie eingegeben
  await app.close();
});

test('Umschalter setzt Cookie und leitet zurück', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/lang/en?back=%2Fmeine' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/meine');
  const cookie = [].concat(res.headers['set-cookie']).find((c) => c.startsWith('lang=')).split(';')[0];
  const mine = await app.inject({ method: 'GET', url: '/meine', headers: { cookie, 'accept-language': 'de' } });
  assert.match(mine.body, /My shifts/);
  assert.match(mine.body, /href="\/lang\/de\?back=%2Fmeine"/);
  await app.close();
});

test('Umschalter leitet nicht auf fremde Seiten weiter', async () => {
  const { app } = await makeApp();
  for (const back of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
    const res = await app.inject({ method: 'GET', url: `/lang/en?back=${encodeURIComponent(back)}` });
    assert.equal(res.headers.location, '/', back);
  }
  await app.close();
});

test('Fehlermeldungen beim Eintragen sind übersetzt', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2099-09-25T18:00', ends_at: '2099-09-25T19:00', capacity: 2, notes: null });
  const g = await app.inject({ method: 'GET', url: '/' });
  const cookie = [].concat(g.headers['set-cookie']).map((c) => c.split(';')[0]).concat('lang=en').join('; ');
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/signup', headers: { cookie }, payload: { csrf, shift_id: String(id), name: '' } });
  assert.match(res.body, /Name is required/);
  assert.match(res.body, /href="\/lang\/de\?back=%2F"/);
  await app.close();
});

test('Admin-Bereich ist auf Englisch umschaltbar', async () => {
  const { app } = await makeApp();
  const de = await app.inject({ method: 'GET', url: '/admin/login' });
  assert.match(de.body, /Benutzername/);
  assert.match(de.body, /class="lang-switch" href="\/lang\/en\?back=%2Fadmin%2Flogin"/);
  const en = await app.inject({ method: 'GET', url: '/admin/login', headers: { cookie: 'lang=en' } });
  assert.match(en.body, /Username/);
  assert.match(en.body, /Admin login/);
  await app.close();
});

test('Beide Sprachen haben dieselben Schlüssel', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.de).sort());
  const de = translator('de');
  const en = translator('en');
  for (const key of ['intro.public', 'mine.hint', 'slot.free', 'err.full']) {
    assert.notEqual(de(key), key);
    assert.notEqual(en(key), key);
    assert.notEqual(de(key), en(key));
  }
});

test('Englische Texte für Bereiche/Schichten mit Rückfall auf Deutsch', async () => {
  const { app, db } = await makeApp();
  const kitchen = seedArea(db, { name: 'Küche', name_en: 'Kitchen', description: 'Hinten links', description_en: 'Back left' });
  const bar = seedArea(db, { name: 'Bar' });
  createShift(db, { area_id: kitchen, title: 'Spülen', title_en: 'Dishes', starts_at: '2099-09-25T08:00', ends_at: '2099-09-25T09:00', capacity: 2, notes: 'Schürze mitbringen', notes_en: null });
  createShift(db, { area_id: bar, title: 'Theke', starts_at: '2099-09-25T18:00', ends_at: '2099-09-25T19:00', capacity: 2, notes: null });
  const en = await app.inject({ method: 'GET', url: '/', headers: { cookie: 'lang=en' } });
  assert.match(en.body, />Kitchen</);
  assert.match(en.body, /Back left/);
  assert.match(en.body, />Dishes</);
  assert.match(en.body, /Schürze mitbringen/); // keine Übersetzung → Deutsch
  assert.match(en.body, />Theke</);
  assert.match(en.body, /data-search="[^"]*küche[^"]*spülen/); // Suche findet beide Sprachen
  const de = await app.inject({ method: 'GET', url: '/', headers: { cookie: 'lang=de' } });
  assert.match(de.body, />Küche</);
  assert.match(de.body, />Spülen</);
  assert.doesNotMatch(de.body, /Back left/);
  await app.close();
});

test('Alle im Code verwendeten Übersetzungsschlüssel existieren', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'locales') walk(p); } else files.push(p);
  });
  walk('src');
  const used = new Set();
  const re = /\bt\('([a-zA-Z]+\.[a-zA-Z_.]+)'|'((?:v|err|gen|detail|settings|pw|users|reset|login|forbidden|dash|shift|qr|common|sys)\.[a-zA-Z_]+)'/g;
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(re)) used.add(m[1] || m[2]);
  const missing = [...used].filter((k) => !(k in messages.de));
  assert.deepEqual(missing, []);
});
