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

test('Admin-Bereich bleibt Deutsch ohne Umschalter', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/admin/login', headers: { cookie: 'lang=en' } });
  assert.doesNotMatch(res.body, /lang-switch/);
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
