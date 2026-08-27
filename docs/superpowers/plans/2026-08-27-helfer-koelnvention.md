# Helfertool Kölnvention – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schlankes, self-contained Web-Tool, mit dem sich Helfer:innen ohne Account für vorab angelegte Schichten eintragen; ein Admin verwaltet alles im Backend; Deploy per `git pull` + `docker compose`.

**Architecture:** Ein einzelner Node-24-Prozess (Fastify) rendert HTML serverseitig und speichert alles in einer SQLite-Datei (`node:sqlite`, kein natives Modul) in einem Docker-Volume. Repositories kapseln DB-Zugriff, Routes kapseln HTTP, `eta`-Templates die Darstellung. nginx terminiert TLS und proxied auf `127.0.0.1:8080`.

**Tech Stack:** Node 24, Fastify, `node:sqlite`, `eta`, `qrcode`, `node:crypto` (scrypt), `node:test`.

## Global Constraints

- Node **≥ 24** (built-in `node:sqlite` ohne Flag). Alle Dependencies **pure JS** – keine nativen Build-Schritte (umgeht lokale Windows/MSVC/postinstall-Probleme).
- **ES Modules** (`"type": "module"` in package.json), Import-Stil `import ... from 'node:...'`.
- Sprache der Oberfläche: **komplett Deutsch**.
- **Einziges Helfer-Pflichtfeld: `name`.** `phone` optional, `note` optional. Kein E-Mail-Feld.
- **Genau ein Admin**, Credentials nur via ENV (`ADMIN_USER`, `ADMIN_PASSWORD_HASH`). Passwort nie im Klartext im Repo.
- Kein SMTP, keine Helfer-Accounts, keine Helfer-Selbstverwaltung.
- Kein Overbooking: Kapazitätsprüfung transaktional.
- Cookie: `httpOnly`, `sameSite=lax`, `secure` (wenn `BASE_URL` mit `https`).
- Alle POST-Formulare mit CSRF-Token. Rate-Limit auf `POST /admin/login` und `POST /signup`.
- Assets liegen bereits in `public/assets/`: `Logo_schwarz.png`, `Logo_weiss-1_2.png`, `Kolnvention_Sticker_263.png`.
- `BASE_URL=https://helfer.example.org`, App lauscht auf `PORT=8080` an `0.0.0.0` im Container.

---

## File Structure

```
package.json              # ESM, scripts: start/test/hash, deps
Dockerfile                # node:24-slim, npm ci, start
docker-compose.yml        # service app, port 127.0.0.1:8080, volume ./data, env_file
.env.example              # ADMIN_USER, ADMIN_PASSWORD_HASH, SESSION_SECRET, BASE_URL, PORT
.gitignore                # node_modules, .env, data/  (bereits vorhanden – erweitern)
README.md                 # Server-Anleitung
nginx/helfer.example.org.conf
scripts/hash-password.mjs # erzeugt scrypt-Hash aus Passwort-Arg
src/
  config.js               # loadConfig(env) -> validiertes config-Objekt
  db.js                   # openDb/initSchema/createDb
  auth.js                 # hashPassword/verifyPassword, Session-CRUD (inkl. CSRF)
  validate.js             # validateShiftInput / validateSignupInput
  csv.js                  # signupsCsv(rows)
  repositories/
    shifts.js             # Shift CRUD + Kapazität
    signups.js            # Signup create (transaktional) / list / delete / move
  routes/
    public.js             # GET / , POST /signup , GET /danke
    admin.js              # login/logout, dashboard, shift-CRUD, signup-mgmt, csv, qr
  server.js               # buildApp(config, db) + Start am Dateiende
  views/
    layout.eta
    public-list.eta
    confirm.eta
    admin-login.eta
    admin-dashboard.eta
    admin-shift-form.eta
    admin-shift-detail.eta
    admin-qr.eta
public/
  assets/ (Logos, vorhanden)
  styles.css              # Punk/DIY-Branding
tests/
  db.test.js
  shifts.test.js
  signups.test.js
  validate.test.js
  csv.test.js
  auth.test.js
  public-routes.test.js
  admin-routes.test.js
  helpers.js              # test-DB + app-Factory Helpers
```

---

### Task 1: Projekt-Scaffold (package.json, Test-Runner-Smoke)

**Files:**
- Create: `package.json`
- Create: `tests/smoke.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nichts
- Produces: lauffähiges ESM-Projekt; `npm test` läuft `node --test`.

- [ ] **Step 1: Write the failing test**

`tests/smoke.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find package` / kein `package.json` bzw. `"type"` fehlt (Runner läuft noch nicht sauber als ESM).

- [ ] **Step 3: Write package.json + .gitignore**

`package.json`:
```json
{
  "name": "helfer-koelnvention",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test",
    "hash": "node scripts/hash-password.mjs"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.2",
    "@fastify/formbody": "^8.0.2",
    "@fastify/rate-limit": "^10.2.2",
    "@fastify/static": "^8.0.4",
    "eta": "^3.5.0",
    "fastify": "^5.2.1",
    "qrcode": "^1.5.4"
  }
}
```

`.gitignore` (Endzustand):
```
node_modules/
.env
data/
```

- [ ] **Step 4: Install & run**

Run: `npm install` dann `node --test`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore tests/smoke.test.js
git commit -m "chore: project scaffold + test runner"
```

---

### Task 2: DB-Modul + Schema-Init

**Files:**
- Create: `src/db.js`
- Create: `tests/db.test.js`

**Interfaces:**
- Consumes: nichts
- Produces:
  - `openDb(path)` → `DatabaseSync`
  - `initSchema(db)` → void (idempotent, `CREATE TABLE IF NOT EXISTS`)
  - `createDb(path)` → `DatabaseSync` (openDb + initSchema). `path=':memory:'` erlaubt.

- [ ] **Step 1: Write the failing test**

`tests/db.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';

test('createDb initialises all tables', () => {
  const db = createDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(names.includes('shifts'));
  assert.ok(names.includes('signups'));
  assert.ok(names.includes('sessions'));
});

test('initSchema is idempotent', () => {
  const db = createDb(':memory:');
  assert.doesNotThrow(() => createDb(':memory:'));
  db.exec('SELECT 1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.test.js`
Expected: FAIL — `Cannot find module '../src/db.js'`.

- [ ] **Step 3: Write src/db.js**

```js
import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id         INTEGER PRIMARY KEY,
      area       TEXT NOT NULL,
      title      TEXT NOT NULL,
      starts_at  TEXT NOT NULL,
      ends_at    TEXT NOT NULL,
      capacity   INTEGER NOT NULL,
      notes      TEXT
    );
    CREATE TABLE IF NOT EXISTS signups (
      id         INTEGER PRIMARY KEY,
      shift_id   INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      phone      TEXT,
      note       TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_signups_shift ON signups(shift_id);
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      csrf       TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
}

export function createDb(path) {
  const db = openDb(path);
  initSchema(db);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: sqlite db module + schema init"
```

---

### Task 3: Shifts-Repository (CRUD + Kapazität)

**Files:**
- Create: `src/repositories/shifts.js`
- Create: `tests/shifts.test.js`

**Interfaces:**
- Consumes: `createDb` (Task 2).
- Produces:
  - `createShift(db, {area,title,starts_at,ends_at,capacity,notes})` → `number` (id)
  - `getShift(db, id)` → row `{id,area,title,starts_at,ends_at,capacity,notes}` | `undefined`
  - `listShifts(db)` → array von rows + `taken` (number) + `free` (number), sortiert nach `starts_at, area`
  - `updateShift(db, id, fields)` → void
  - `deleteShift(db, id)` → void

- [ ] **Step 1: Write the failing test**

`tests/shifts.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createShift, getShift, listShifts, updateShift, deleteShift }
  from '../src/repositories/shifts.js';

const sample = {
  area: 'Bar', title: 'Bar Freitag', starts_at: '2026-09-25T18:00',
  ends_at: '2026-09-25T20:00', capacity: 3, notes: null,
};

test('create + get shift', () => {
  const db = createDb(':memory:');
  const id = createShift(db, sample);
  assert.equal(typeof id, 'number');
  const s = getShift(db, id);
  assert.equal(s.title, 'Bar Freitag');
  assert.equal(s.capacity, 3);
});

test('listShifts computes taken/free', () => {
  const db = createDb(':memory:');
  const id = createShift(db, sample);
  db.prepare('INSERT INTO signups (shift_id,name,created_at) VALUES (?,?,?)')
    .run(id, 'Anna', '2026-01-01T00:00');
  const [s] = listShifts(db);
  assert.equal(s.taken, 1);
  assert.equal(s.free, 2);
});

test('update + delete shift', () => {
  const db = createDb(':memory:');
  const id = createShift(db, sample);
  updateShift(db, id, { ...sample, title: 'Bar Samstag', capacity: 5 });
  assert.equal(getShift(db, id).title, 'Bar Samstag');
  deleteShift(db, id);
  assert.equal(getShift(db, id), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/shifts.test.js`
Expected: FAIL — `Cannot find module '../src/repositories/shifts.js'`.

- [ ] **Step 3: Write src/repositories/shifts.js**

```js
export function createShift(db, { area, title, starts_at, ends_at, capacity, notes }) {
  const info = db
    .prepare(
      `INSERT INTO shifts (area,title,starts_at,ends_at,capacity,notes)
       VALUES (?,?,?,?,?,?)`
    )
    .run(area, title, starts_at, ends_at, capacity, notes ?? null);
  return Number(info.lastInsertRowid);
}

export function getShift(db, id) {
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
}

export function listShifts(db) {
  return db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM signups g WHERE g.shift_id = s.id) AS taken
       FROM shifts s
       ORDER BY s.starts_at, s.area`
    )
    .all()
    .map((s) => ({ ...s, free: s.capacity - s.taken }));
}

export function updateShift(db, id, { area, title, starts_at, ends_at, capacity, notes }) {
  db.prepare(
    `UPDATE shifts SET area=?, title=?, starts_at=?, ends_at=?, capacity=?, notes=?
     WHERE id=?`
  ).run(area, title, starts_at, ends_at, capacity, notes ?? null, id);
}

export function deleteShift(db, id) {
  db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/shifts.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/shifts.js tests/shifts.test.js
git commit -m "feat: shifts repository with capacity"
```

---

### Task 4: Signups-Repository (transaktionale Kapazitätsprüfung)

**Files:**
- Create: `src/repositories/signups.js`
- Create: `tests/signups.test.js`

**Interfaces:**
- Consumes: `createDb`, `createShift`.
- Produces:
  - `createSignup(db, {shift_id,name,phone,note})` → `{ok:true, id}` | `{ok:false, reason:'full'}` | `{ok:false, reason:'no_shift'}`
  - `listSignupsByShift(db, shiftId)` → array `{id,name,phone,note,created_at}` (nach `created_at`)
  - `deleteSignup(db, id)` → void
  - `moveSignup(db, id, newShiftId)` → `{ok:true}` | `{ok:false, reason:'full'|'no_shift'|'no_signup'}`
  - `listAllSignups(db)` → array `{shift_area,shift_title,starts_at,ends_at,name,phone,note,created_at}` für CSV, sortiert `starts_at, area, created_at`

- [ ] **Step 1: Write the failing test**

`tests/signups.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createShift } from '../src/repositories/shifts.js';
import { createSignup, listSignupsByShift, deleteSignup, moveSignup, listAllSignups }
  from '../src/repositories/signups.js';

function shift(db, capacity = 2) {
  return createShift(db, {
    area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity, notes: null,
  });
}

test('createSignup succeeds until capacity, then reports full', () => {
  const db = createDb(':memory:');
  const id = shift(db, 2);
  assert.equal(createSignup(db, { shift_id: id, name: 'A' }).ok, true);
  assert.equal(createSignup(db, { shift_id: id, name: 'B' }).ok, true);
  const third = createSignup(db, { shift_id: id, name: 'C' });
  assert.deepEqual(third, { ok: false, reason: 'full' });
  assert.equal(listSignupsByShift(db, id).length, 2);
});

test('createSignup rejects unknown shift', () => {
  const db = createDb(':memory:');
  assert.deepEqual(createSignup(db, { shift_id: 999, name: 'A' }),
    { ok: false, reason: 'no_shift' });
});

test('phone/note optional and stored', () => {
  const db = createDb(':memory:');
  const id = shift(db);
  createSignup(db, { shift_id: id, name: 'A', phone: '0170', note: 'vegan' });
  const [s] = listSignupsByShift(db, id);
  assert.equal(s.phone, '0170');
  assert.equal(s.note, 'vegan');
});

test('deleteSignup frees a slot', () => {
  const db = createDb(':memory:');
  const id = shift(db, 1);
  const r = createSignup(db, { shift_id: id, name: 'A' });
  assert.equal(createSignup(db, { shift_id: id, name: 'B' }).ok, false);
  deleteSignup(db, r.id);
  assert.equal(createSignup(db, { shift_id: id, name: 'B' }).ok, true);
});

test('moveSignup respects capacity of target', () => {
  const db = createDb(':memory:');
  const a = shift(db, 1);
  const b = shift(db, 1);
  const r = createSignup(db, { shift_id: a, name: 'A' });
  createSignup(db, { shift_id: b, name: 'B' });
  assert.deepEqual(moveSignup(db, r.id, b), { ok: false, reason: 'full' });
});

test('listAllSignups joins shift info', () => {
  const db = createDb(':memory:');
  const id = shift(db);
  createSignup(db, { shift_id: id, name: 'A' });
  const [row] = listAllSignups(db);
  assert.equal(row.shift_title, 'Bar');
  assert.equal(row.name, 'A');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/signups.test.js`
Expected: FAIL — `Cannot find module '../src/repositories/signups.js'`.

- [ ] **Step 3: Write src/repositories/signups.js**

```js
function countSignups(db, shiftId) {
  return db.prepare('SELECT COUNT(*) AS n FROM signups WHERE shift_id = ?')
    .get(shiftId).n;
}

export function createSignup(db, { shift_id, name, phone = null, note = null }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const shift = db.prepare('SELECT capacity FROM shifts WHERE id = ?').get(shift_id);
    if (!shift) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'no_shift' };
    }
    if (countSignups(db, shift_id) >= shift.capacity) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'full' };
    }
    const info = db
      .prepare(
        `INSERT INTO signups (shift_id,name,phone,note,created_at)
         VALUES (?,?,?,?,?)`
      )
      .run(shift_id, name, phone, note, new Date().toISOString());
    db.exec('COMMIT');
    return { ok: true, id: Number(info.lastInsertRowid) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listSignupsByShift(db, shiftId) {
  return db
    .prepare('SELECT * FROM signups WHERE shift_id = ? ORDER BY created_at')
    .all(shiftId);
}

export function deleteSignup(db, id) {
  db.prepare('DELETE FROM signups WHERE id = ?').run(id);
}

export function moveSignup(db, id, newShiftId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const signup = db.prepare('SELECT id FROM signups WHERE id = ?').get(id);
    if (!signup) { db.exec('ROLLBACK'); return { ok: false, reason: 'no_signup' }; }
    const shift = db.prepare('SELECT capacity FROM shifts WHERE id = ?').get(newShiftId);
    if (!shift) { db.exec('ROLLBACK'); return { ok: false, reason: 'no_shift' }; }
    if (countSignups(db, newShiftId) >= shift.capacity) {
      db.exec('ROLLBACK'); return { ok: false, reason: 'full' };
    }
    db.prepare('UPDATE signups SET shift_id = ? WHERE id = ?').run(newShiftId, id);
    db.exec('COMMIT');
    return { ok: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listAllSignups(db) {
  return db
    .prepare(
      `SELECT s.area AS shift_area, s.title AS shift_title,
              s.starts_at, s.ends_at,
              g.name, g.phone, g.note, g.created_at
       FROM signups g JOIN shifts s ON s.id = g.shift_id
       ORDER BY s.starts_at, s.area, g.created_at`
    )
    .all();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/signups.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/signups.js tests/signups.test.js
git commit -m "feat: signups repository with transactional capacity guard"
```

---

### Task 5: Eingabe-Validierung

**Files:**
- Create: `src/validate.js`
- Create: `tests/validate.test.js`

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `validateShiftInput(body)` → `{ok:true, value}` | `{ok:false, errors: string[]}`; `value` = `{area,title,starts_at,ends_at,capacity,notes}`
  - `validateSignupInput(body)` → `{ok:true, value}` | `{ok:false, errors: string[]}`; `value` = `{name,phone,note}` (leere Strings → `null` bei phone/note)

- [ ] **Step 1: Write the failing test**

`tests/validate.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateShiftInput, validateSignupInput } from '../src/validate.js';

test('signup requires name', () => {
  const r = validateSignupInput({ name: '  ', phone: '', note: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
});

test('signup phone/note optional -> null', () => {
  const r = validateSignupInput({ name: 'Anna', phone: '', note: '' });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Anna');
  assert.equal(r.value.phone, null);
  assert.equal(r.value.note, null);
});

test('shift needs valid time order and positive capacity', () => {
  const bad = validateShiftInput({
    area: 'Bar', title: 'x', starts_at: '2026-09-25T20:00',
    ends_at: '2026-09-25T18:00', capacity: '0',
  });
  assert.equal(bad.ok, false);

  const good = validateShiftInput({
    area: 'Bar', title: 'x', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: '3', notes: '',
  });
  assert.equal(good.ok, true);
  assert.equal(good.value.capacity, 3);
  assert.equal(good.value.notes, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/validate.test.js`
Expected: FAIL — `Cannot find module '../src/validate.js'`.

- [ ] **Step 3: Write src/validate.js**

```js
const MAX = 500;
function clean(v) { return typeof v === 'string' ? v.trim() : ''; }
function orNull(v) { const s = clean(v); return s === '' ? null : s.slice(0, MAX); }

export function validateSignupInput(body) {
  const errors = [];
  const name = clean(body.name);
  if (name === '') errors.push('Name ist erforderlich.');
  if (name.length > MAX) errors.push('Name ist zu lang.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, phone: orNull(body.phone), note: orNull(body.note) } };
}

export function validateShiftInput(body) {
  const errors = [];
  const area = clean(body.area);
  const title = clean(body.title);
  const starts_at = clean(body.starts_at);
  const ends_at = clean(body.ends_at);
  const capacity = Number.parseInt(body.capacity, 10);

  if (area === '') errors.push('Bereich ist erforderlich.');
  if (title === '') errors.push('Titel ist erforderlich.');
  if (starts_at === '') errors.push('Startzeit ist erforderlich.');
  if (ends_at === '') errors.push('Endzeit ist erforderlich.');
  if (!Number.isInteger(capacity) || capacity < 1) errors.push('Kapazität muss mindestens 1 sein.');
  if (starts_at && ends_at && ends_at <= starts_at) errors.push('Ende muss nach dem Start liegen.');
  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { area, title, starts_at, ends_at, capacity, notes: orNull(body.notes) } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/validate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/validate.js tests/validate.test.js
git commit -m "feat: input validation for shifts and signups"
```

---

### Task 6: CSV-Export

**Files:**
- Create: `src/csv.js`
- Create: `tests/csv.test.js`

**Interfaces:**
- Consumes: Zeilen-Form aus `listAllSignups` (Task 4).
- Produces: `signupsCsv(rows)` → `string` (UTF-8, `;`-getrennt, Header deutsch, Werte RFC-4180-escaped).

- [ ] **Step 1: Write the failing test**

`tests/csv.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signupsCsv } from '../src/csv.js';

test('csv has header and escapes separators/quotes', () => {
  const csv = signupsCsv([
    { shift_area: 'Bar', shift_title: 'Bar; Freitag', starts_at: '2026-09-25T18:00',
      ends_at: '2026-09-25T20:00', name: 'A "Ace"', phone: null, note: null,
      created_at: '2026-01-01T00:00' },
  ]);
  const lines = csv.trim().split('\n');
  assert.match(lines[0], /^Bereich;Schicht;Beginn;Ende;Name;Telefon;Notiz$/);
  assert.match(lines[1], /"Bar; Freitag"/);
  assert.match(lines[1], /"A ""Ace"""/);
});

test('empty list still returns header', () => {
  assert.match(signupsCsv([]).trim(), /^Bereich;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/csv.test.js`
Expected: FAIL — `Cannot find module '../src/csv.js'`.

- [ ] **Step 3: Write src/csv.js**

```js
function cell(v) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

export function signupsCsv(rows) {
  const header = ['Bereich', 'Schicht', 'Beginn', 'Ende', 'Name', 'Telefon', 'Notiz'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      r.shift_area, r.shift_title, r.starts_at, r.ends_at, r.name, r.phone, r.note,
    ].map(cell).join(';'));
  }
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/csv.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/csv.js tests/csv.test.js
git commit -m "feat: csv export of signups"
```

---

### Task 7: Auth – Passwort-Hashing + Sessions (inkl. CSRF)

**Files:**
- Create: `src/auth.js`
- Create: `scripts/hash-password.mjs`
- Create: `tests/auth.test.js`

**Interfaces:**
- Consumes: `createDb`.
- Produces:
  - `hashPassword(plain)` → `string` Format `scrypt$<saltHex>$<hashHex>`
  - `verifyPassword(plain, stored)` → `boolean` (timing-safe, false bei Formatfehler)
  - `createSession(db, {isAdmin=false})` → `{id, csrf}` (Ablauf +30 Tage)
  - `getSession(db, id)` → `{id,is_admin,csrf,expires_at}` | `undefined` (undefined wenn abgelaufen; löscht abgelaufene)
  - `deleteSession(db, id)` → void

- [ ] **Step 1: Write the failing test**

`tests/auth.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { hashPassword, verifyPassword, createSession, getSession, deleteSession }
  from '../src/auth.js';

test('hash + verify roundtrip', () => {
  const h = hashPassword('geheim');
  assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword('geheim', h), true);
  assert.equal(verifyPassword('falsch', h), false);
});

test('verify rejects malformed stored value', () => {
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
});

test('session create/get/delete', () => {
  const db = createDb(':memory:');
  const { id, csrf } = createSession(db, { isAdmin: true });
  assert.equal(typeof id, 'string');
  assert.equal(typeof csrf, 'string');
  const s = getSession(db, id);
  assert.equal(s.is_admin, 1);
  deleteSession(db, id);
  assert.equal(getSession(db, id), undefined);
});

test('expired session is not returned', () => {
  const db = createDb(':memory:');
  const { id } = createSession(db, {});
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
    .run('2000-01-01T00:00:00.000Z', id);
  assert.equal(getSession(db, id), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/auth.test.js`
Expected: FAIL — `Cannot find module '../src/auth.js'`.

- [ ] **Step 3: Write src/auth.js + scripts/hash-password.mjs**

`src/auth.js`:
```js
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = scryptSync(plain, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export function createSession(db, { isAdmin = false } = {}) {
  const id = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + THIRTY_DAYS).toISOString();
  db.prepare('INSERT INTO sessions (id,is_admin,csrf,expires_at) VALUES (?,?,?,?)')
    .run(id, isAdmin ? 1 : 0, csrf, expires_at);
  return { id, csrf };
}

export function getSession(db, id) {
  if (!id) return undefined;
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) return undefined;
  if (new Date(s.expires_at).getTime() <= Date.now()) {
    deleteSession(db, id);
    return undefined;
  }
  return s;
}

export function deleteSession(db, id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}
```

`scripts/hash-password.mjs`:
```js
import { hashPassword } from '../src/auth.js';

const plain = process.argv[2];
if (!plain) {
  console.error('Usage: node scripts/hash-password.mjs "<passwort>"');
  process.exit(1);
}
console.log(hashPassword(plain));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/auth.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth.js scripts/hash-password.mjs tests/auth.test.js
git commit -m "feat: password hashing + sessions + hash-password script"
```

---

### Task 8: Config-Loader

**Files:**
- Create: `src/config.js`
- Add tests to: `tests/config.test.js`

**Interfaces:**
- Consumes: nichts.
- Produces: `loadConfig(env)` → `{adminUser, adminPasswordHash, sessionSecret, baseUrl, port, dbPath, secureCookie}`; wirft `Error` bei fehlenden Pflichtwerten. `secureCookie` = `baseUrl` beginnt mit `https`.

- [ ] **Step 1: Write the failing test**

`tests/config.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = {
  ADMIN_USER: 'admin', ADMIN_PASSWORD_HASH: 'scrypt$aa$bb',
  SESSION_SECRET: 's', BASE_URL: 'https://helfer.example.org',
};

test('loads and derives values', () => {
  const c = loadConfig({ ...base, PORT: '8080', DB_PATH: '/data/app.db' });
  assert.equal(c.adminUser, 'admin');
  assert.equal(c.port, 8080);
  assert.equal(c.secureCookie, true);
  assert.equal(c.dbPath, '/data/app.db');
});

test('throws when required missing', () => {
  assert.throws(() => loadConfig({ ADMIN_USER: 'admin' }));
});

test('http base -> insecure cookie', () => {
  const c = loadConfig({ ...base, BASE_URL: 'http://localhost:8080' });
  assert.equal(c.secureCookie, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config.test.js`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 3: Write src/config.js**

```js
export function loadConfig(env = process.env) {
  const required = ['ADMIN_USER', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'BASE_URL'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Fehlende ENV-Variablen: ${missing.join(', ')}`);
  const baseUrl = env.BASE_URL;
  return {
    adminUser: env.ADMIN_USER,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    sessionSecret: env.SESSION_SECRET,
    baseUrl,
    port: Number.parseInt(env.PORT ?? '8080', 10),
    dbPath: env.DB_PATH ?? '/data/app.db',
    secureCookie: baseUrl.startsWith('https'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "feat: config loader with validation"
```

---

### Task 9: Fastify-App-Factory + Session-Middleware + Templates-Grundgerüst

**Files:**
- Create: `src/server.js`
- Create: `src/views/layout.eta`
- Create: `tests/helpers.js`
- Create: `tests/app.test.js`

**Interfaces:**
- Consumes: `loadConfig`, `createDb`, `getSession`, `createSession`, alle Repos, eta.
- Produces:
  - `buildApp(config, db)` → Fastify-Instanz. Registriert: formbody, cookie, static (`/assets`, `/styles.css`), rate-limit. Dekoriert Requests: `req.session` (immer vorhanden, via Cookie `sid`; neu erzeugt wenn keine), Helper `req.isAdmin`. Stellt `app.render(view, data)` bereit (eta, gemeinsames `layout.eta`).
  - `requireCsrf(req)` → wirft 403 bei Mismatch (wird in POST-Routes genutzt).
  - Am Dateiende: `if (import.meta.url === ...)` → `loadConfig` + `createDb(config.dbPath)` + `buildApp` + `listen`.

- [ ] **Step 1: Write the failing test**

`tests/helpers.js`:
```js
import { createDb } from '../src/db.js';
import { buildApp } from '../src/server.js';

export const testConfig = {
  adminUser: 'admin',
  adminPasswordHash: null, // per Test gesetzt
  sessionSecret: 'test-secret',
  baseUrl: 'http://localhost',
  port: 0,
  dbPath: ':memory:',
  secureCookie: false,
};

export async function makeApp(overrides = {}) {
  const db = createDb(':memory:');
  const app = buildApp({ ...testConfig, ...overrides }, db);
  await app.ready();
  return { app, db };
}
```

`tests/app.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';

test('GET / responds 200 and sets session cookie', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie']?.[0] ?? res.headers['set-cookie'] ?? '', /sid=/);
  await app.close();
});

test('serves styles.css', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/styles.css' });
  assert.equal(res.statusCode, 200);
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/app.test.js`
Expected: FAIL — `Cannot find module '../src/server.js'`.

- [ ] **Step 3: Write src/views/layout.eta + src/server.js**

`src/views/layout.eta`:
```html
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><%= it.title %> · Kölnvention Helfer</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header">
    <img src="/assets/Logo_weiss-1_2.png" alt="Kölnvention e.V." class="logo"
         onerror="this.style.display='none'">
    <h1>Helfer:innen · Kölnvention</h1>
    <p class="motto">Juggling's not dead · 25.–27.09.26</p>
  </header>
  <main><%~ it.body %></main>
  <footer class="site-footer">Kölnvention e.V.</footer>
</body>
</html>
```

`src/server.js`:
```js
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { Eta } from 'eta';
import { createDb } from './db.js';
import { loadConfig } from './config.js';
import { getSession, createSession } from './auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(__dirname, 'views');
const publicDir = path.join(__dirname, '..', 'public');

export function buildApp(config, db) {
  const app = Fastify({ logger: false });
  const eta = new Eta({ views: viewsDir, cache: true });

  app.register(formbody);
  app.register(cookie);
  app.register(rateLimit, { global: false });
  app.register(fastifyStatic, {
    root: path.join(publicDir, 'assets'),
    prefix: '/assets/',
  });
  app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/public/',
    decorateReply: false,
  });

  app.get('/styles.css', (req, reply) => {
    reply.type('text/css').sendFile('styles.css', publicDir);
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('render', (view, data) => {
    const body = eta.render(view, data);
    return eta.render('layout', { ...data, body });
  });

  // Session-Middleware: sorgt dafür, dass jede Anfrage eine Session hat.
  app.addHook('onRequest', async (req, reply) => {
    let sid = req.cookies?.sid;
    let session = sid ? getSession(db, sid) : undefined;
    if (!session) {
      const created = createSession(db, { isAdmin: false });
      sid = created.id;
      session = getSession(db, sid);
      reply.setCookie('sid', sid, {
        httpOnly: true, sameSite: 'lax', secure: config.secureCookie, path: '/',
      });
    }
    req.session = session;
    req.isAdmin = session.is_admin === 1;
  });

  registerPublicRoutes(app);
  registerAdminRoutes(app);
  return app;
}

export function requireCsrf(req, reply) {
  const token = req.body?.csrf;
  if (!token || token !== req.session.csrf) {
    reply.code(403).send('Ungültiges CSRF-Token.');
    return false;
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig(process.env);
  const db = createDb(config.dbPath);
  const app = buildApp(config, db);
  app.listen({ host: '0.0.0.0', port: config.port })
    .then(() => console.log(`Helfertool läuft auf Port ${config.port}`))
    .catch((err) => { console.error(err); process.exit(1); });
}
```

> Hinweis: `registerPublicRoutes`/`registerAdminRoutes` werden in Task 10–14 gefüllt. Für diese Task legst du **leere** Stub-Dateien an, die `GET /` bereits bedienen, damit die Tests grün werden:

`src/routes/public.js` (Stub für Task 9, in Task 10 ersetzt):
```js
export function registerPublicRoutes(app) {
  app.get('/', (req, reply) => {
    reply.type('text/html').send(app.render('public-list', { title: 'Helfen', shifts: [], errors: [], values: {} }));
  });
}
```

`src/routes/admin.js` (Stub für Task 9, in Task 11 ersetzt):
```js
export function registerAdminRoutes(_app) {}
```

Und eine minimale `src/views/public-list.eta` (in Task 10 erweitert):
```html
<h2>Schichten</h2>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/app.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/views/layout.eta src/views/public-list.eta src/routes/public.js src/routes/admin.js tests/helpers.js tests/app.test.js
git commit -m "feat: fastify app factory, session middleware, layout"
```

---

### Task 10: Öffentliche Routes – Schichtenliste + Eintragen + Danke

**Files:**
- Modify: `src/routes/public.js`
- Create/replace: `src/views/public-list.eta`, `src/views/confirm.eta`
- Create: `tests/public-routes.test.js`

**Interfaces:**
- Consumes: `listShifts`, `createSignup` (Repos), `validateSignupInput`, `requireCsrf`, `app.render`.
- Produces: `registerPublicRoutes(app)` mit:
  - `GET /` → Liste (gruppiert nach `area`), Formular je Schicht mit CSRF + `shift_id`.
  - `POST /signup` → validiert, prüft Kapazität, Redirect `/danke` bei Erfolg, sonst Re-Render mit Fehlern.
  - `GET /danke` → Bestätigung.

- [ ] **Step 1: Write the failing test**

`tests/public-routes.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { createShift } from '../src/repositories/shifts.js';

async function sessionCookie(app) {
  const res = await app.inject({ method: 'GET', url: '/' });
  const raw = [].concat(res.headers['set-cookie'] ?? []);
  return raw.map((c) => c.split(';')[0]).join('; ');
}

function csrfFromDb(db) {
  return db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
}

test('GET / lists open shifts', async () => {
  const { app, db } = await makeApp();
  createShift(db, { area: 'Bar', title: 'Bar Fr', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 2, notes: null });
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.match(res.body, /Bar Fr/);
  await app.close();
});

test('POST /signup with valid data redirects to /danke', async () => {
  const { app, db } = await makeApp();
  const id = createShift(db, { area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
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
  const id = createShift(db, { area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
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
  const id = createShift(db, { area: 'Bar', title: 'Bar', starts_at: '2026-09-25T18:00',
    ends_at: '2026-09-25T20:00', capacity: 1, notes: null });
  const cookie = await sessionCookie(app);
  const res = await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf: 'wrong', shift_id: String(id), name: 'Anna' } });
  assert.equal(res.statusCode, 403);
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/public-routes.test.js`
Expected: FAIL — Redirect/Body-Erwartungen erfüllt der Stub aus Task 9 nicht.

- [ ] **Step 3: Write routes + views**

`src/routes/public.js`:
```js
import { listShifts } from '../repositories/shifts.js';
import { createSignup } from '../repositories/signups.js';
import { validateSignupInput } from '../validate.js';
import { requireCsrf } from '../server.js';

function groupByArea(shifts) {
  const map = new Map();
  for (const s of shifts) {
    if (!map.has(s.area)) map.set(s.area, []);
    map.get(s.area).push(s);
  }
  return [...map.entries()].map(([area, items]) => ({ area, items }));
}

export function registerPublicRoutes(app) {
  const db = app.db;

  app.get('/', (req, reply) => {
    const groups = groupByArea(listShifts(db));
    reply.type('text/html').send(app.render('public-list', {
      title: 'Helfen', groups, csrf: req.session.csrf, errors: [], values: {},
    }));
  });

  app.post('/signup', (req, reply) => {
    if (!requireCsrf(req, reply)) return;
    const result = validateSignupInput(req.body);
    const shiftId = Number.parseInt(req.body.shift_id, 10);
    if (!result.ok) {
      const groups = groupByArea(listShifts(db));
      return reply.code(200).type('text/html').send(app.render('public-list', {
        title: 'Helfen', groups, csrf: req.session.csrf,
        errors: result.errors, values: req.body,
      }));
    }
    const created = createSignup(db, { shift_id: shiftId, ...result.value });
    if (!created.ok) {
      const msg = created.reason === 'full'
        ? 'Diese Schicht ist leider schon voll.'
        : 'Schicht nicht gefunden.';
      const groups = groupByArea(listShifts(db));
      return reply.code(200).type('text/html').send(app.render('public-list', {
        title: 'Helfen', groups, csrf: req.session.csrf, errors: [msg], values: req.body,
      }));
    }
    return reply.redirect('/danke');
  });

  app.get('/danke', (req, reply) => {
    reply.type('text/html').send(app.render('confirm', { title: 'Danke' }));
  });
}
```

`src/views/public-list.eta`:
```html
<% if (it.errors && it.errors.length) { %>
  <div class="errors"><% it.errors.forEach(function(e){ %><p><%= e %></p><% }) %></div>
<% } %>

<p class="intro">Trag dich für eine Schicht ein. Nur dein Name ist Pflicht –
die Telefonnummer ist freiwillig.</p>

<% if (!it.groups || !it.groups.length) { %>
  <p>Aktuell sind keine Schichten ausgeschrieben.</p>
<% } %>

<% (it.groups || []).forEach(function(group){ %>
  <section class="area">
    <h2><%= group.area %></h2>
    <% group.items.forEach(function(s){ %>
      <div class="shift <%= s.free <= 0 ? 'full' : '' %>">
        <div class="shift-head">
          <strong><%= s.title %></strong>
          <span class="time"><%= s.starts_at.replace('T',' ') %> – <%= s.ends_at.slice(11) %></span>
          <span class="slots"><%= s.free %> von <%= s.capacity %> frei</span>
        </div>
        <% if (s.notes) { %><p class="notes"><%= s.notes %></p><% } %>
        <% if (s.free > 0) { %>
          <form method="post" action="/signup" class="signup-form">
            <input type="hidden" name="csrf" value="<%= it.csrf %>">
            <input type="hidden" name="shift_id" value="<%= s.id %>">
            <input type="text" name="name" placeholder="Dein Name" required maxlength="500">
            <input type="tel" name="phone" placeholder="Telefon (optional)" maxlength="500">
            <input type="text" name="note" placeholder="Notiz (optional)" maxlength="500">
            <button type="submit">Eintragen</button>
          </form>
        <% } else { %>
          <p class="full-label">Ausgebucht</p>
        <% } %>
      </div>
    <% }) %>
  </section>
<% }) %>
```

`src/views/confirm.eta`:
```html
<div class="confirm">
  <h2>Danke, du bist eingetragen! 🤹</h2>
  <p>Wir freuen uns auf dich beim Festival.</p>
  <p><a href="/">Zurück zur Schichtenliste</a></p>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/public-routes.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/public.js src/views/public-list.eta src/views/confirm.eta tests/public-routes.test.js
git commit -m "feat: public shift list + signup flow"
```

---

### Task 11: Admin – Login/Logout + Auth-Guard

**Files:**
- Create/replace: `src/routes/admin.js`
- Create: `src/views/admin-login.eta`, `src/views/admin-dashboard.eta`
- Create: `tests/admin-routes.test.js`

**Interfaces:**
- Consumes: `config.adminUser/adminPasswordHash`, `verifyPassword`, `createSession`, `deleteSession`, `requireCsrf`, `listShifts`.
- Produces: `registerAdminRoutes(app)` mit:
  - `GET /admin/login`, `POST /admin/login` (rate-limit 10/min), bei Erfolg neue Admin-Session + Cookie, Redirect `/admin`.
  - `GET /admin` → Dashboard (nur Admin, sonst Redirect `/admin/login`).
  - `POST /admin/logout` → Session weg, Redirect `/admin/login`.
  - Interner Helper `requireAdmin(req, reply)` → boolean.

- [ ] **Step 1: Write the failing test**

`tests/admin-routes.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { hashPassword } from '../src/auth.js';

async function login(app, db, user = 'admin', pass = 'geheim') {
  const g = await app.inject({ method: 'GET', url: '/admin/login' });
  const cookie = [].concat(g.headers['set-cookie'] ?? [])
    .map((c) => c.split(';')[0]).join('; ');
  const csrf = db.prepare('SELECT csrf FROM sessions ORDER BY rowid DESC LIMIT 1').get().csrf;
  const res = await app.inject({ method: 'POST', url: '/admin/login',
    headers: { cookie }, payload: { csrf, username: user, password: pass } });
  return { res, cookie };
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-routes.test.js`
Expected: FAIL — Admin-Routes existieren noch nicht (Stub).

- [ ] **Step 3: Write routes + views**

`src/routes/admin.js`:
```js
import { verifyPassword, createSession, deleteSession } from '../auth.js';
import { requireCsrf } from '../server.js';
import { listShifts } from '../repositories/shifts.js';

export function requireAdmin(req, reply) {
  if (!req.isAdmin) {
    reply.redirect('/admin/login');
    return false;
  }
  return true;
}

export function registerAdminRoutes(app) {
  const db = app.db;
  const config = app.config;

  app.get('/admin/login', (req, reply) => {
    reply.type('text/html').send(app.render('admin-login', {
      title: 'Login', csrf: req.session.csrf, error: null,
    }));
  });

  app.post('/admin/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, (req, reply) => {
    if (!requireCsrf(req, reply)) return;
    const { username, password } = req.body;
    const ok = username === config.adminUser
      && verifyPassword(password ?? '', config.adminPasswordHash);
    if (!ok) {
      return reply.code(200).type('text/html').send(app.render('admin-login', {
        title: 'Login', csrf: req.session.csrf,
        error: 'Benutzername oder Passwort ist falsch.',
      }));
    }
    const created = createSession(db, { isAdmin: true });
    reply.setCookie('sid', created.id, {
      httpOnly: true, sameSite: 'lax', secure: config.secureCookie, path: '/',
    });
    return reply.redirect('/admin');
  });

  app.post('/admin/logout', (req, reply) => {
    if (!requireCsrf(req, reply)) return;
    deleteSession(db, req.session.id);
    return reply.redirect('/admin/login');
  });

  app.get('/admin', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const shifts = listShifts(db);
    reply.type('text/html').send(app.render('admin-dashboard', {
      title: 'Dashboard', shifts, csrf: req.session.csrf,
    }));
  });
}
```

`src/views/admin-login.eta`:
```html
<div class="admin-login">
  <h2>Admin-Login</h2>
  <% if (it.error) { %><p class="errors"><%= it.error %></p><% } %>
  <form method="post" action="/admin/login">
    <input type="hidden" name="csrf" value="<%= it.csrf %>">
    <input type="text" name="username" placeholder="Benutzername" required autocomplete="username">
    <input type="password" name="password" placeholder="Passwort" required autocomplete="current-password">
    <button type="submit">Anmelden</button>
  </form>
</div>
```

`src/views/admin-dashboard.eta`:
```html
<div class="admin">
  <div class="admin-bar">
    <h2>Dashboard – Schichten</h2>
    <div class="admin-actions">
      <a href="/admin/shifts/new">+ Neue Schicht</a>
      <a href="/admin/qr">QR-Code</a>
      <a href="/admin/export.csv">CSV-Export</a>
      <form method="post" action="/admin/logout" class="inline">
        <input type="hidden" name="csrf" value="<%= it.csrf %>">
        <button type="submit">Logout</button>
      </form>
    </div>
  </div>
  <table class="shifts-table">
    <thead><tr><th>Bereich</th><th>Titel</th><th>Beginn</th><th>Belegung</th><th></th></tr></thead>
    <tbody>
      <% it.shifts.forEach(function(s){ %>
        <tr>
          <td><%= s.area %></td>
          <td><%= s.title %></td>
          <td><%= s.starts_at.replace('T',' ') %></td>
          <td><%= s.taken %>/<%= s.capacity %></td>
          <td><a href="/admin/shifts/<%= s.id %>">öffnen</a></td>
        </tr>
      <% }) %>
    </tbody>
  </table>
  <% if (!it.shifts.length) { %><p>Noch keine Schichten angelegt.</p><% } %>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/admin-routes.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.js src/views/admin-login.eta src/views/admin-dashboard.eta tests/admin-routes.test.js
git commit -m "feat: admin login/logout + dashboard"
```

---

### Task 12: Admin – Schicht CRUD (anlegen/bearbeiten/löschen)

**Files:**
- Modify: `src/routes/admin.js`
- Create: `src/views/admin-shift-form.eta`
- Add tests to: `tests/admin-routes.test.js`

**Interfaces:**
- Consumes: `createShift`, `getShift`, `updateShift`, `deleteShift`, `validateShiftInput`, `requireAdmin`, `requireCsrf`.
- Produces zusätzliche Routes:
  - `GET /admin/shifts/new` → leeres Formular
  - `POST /admin/shifts` → anlegen, Redirect `/admin`
  - `GET /admin/shifts/:id/edit` → Formular vorbefüllt
  - `POST /admin/shifts/:id` → aktualisieren, Redirect `/admin`
  - `POST /admin/shifts/:id/delete` → löschen, Redirect `/admin`
  - (Die Detailseite `GET /admin/shifts/:id` wird erst in Task 13 registriert – hier NICHT anlegen, um Doppel-Registrierung zu vermeiden.)

- [ ] **Step 1: Write the failing test (an tests/admin-routes.test.js anhängen)**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-routes.test.js`
Expected: FAIL — neue Routes fehlen (404/keine Redirects).

- [ ] **Step 3: Add routes to src/routes/admin.js + view**

Ergänze in `registerAdminRoutes` (nach den bestehenden Routes) die Imports oben in der Datei:
```js
import { createShift, getShift, updateShift, deleteShift, listShifts } from '../repositories/shifts.js';
import { validateShiftInput } from '../validate.js';
```
(Der bestehende `listShifts`-Import wird zu obiger Sammelzeile zusammengeführt — keine doppelte Deklaration.)

Neue Routes:
```js
  app.get('/admin/shifts/new', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    reply.type('text/html').send(app.render('admin-shift-form', {
      title: 'Neue Schicht', csrf: req.session.csrf, action: '/admin/shifts',
      shift: { area: '', title: '', starts_at: '', ends_at: '', capacity: 1, notes: '' },
      errors: [],
    }));
  });

  app.post('/admin/shifts', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const v = validateShiftInput(req.body);
    if (!v.ok) {
      return reply.code(200).type('text/html').send(app.render('admin-shift-form', {
        title: 'Neue Schicht', csrf: req.session.csrf, action: '/admin/shifts',
        shift: req.body, errors: v.errors,
      }));
    }
    createShift(db, v.value);
    return reply.redirect('/admin');
  });

  app.get('/admin/shifts/:id/edit', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const shift = getShift(db, Number(req.params.id));
    if (!shift) return reply.code(404).send('Schicht nicht gefunden.');
    reply.type('text/html').send(app.render('admin-shift-form', {
      title: 'Schicht bearbeiten', csrf: req.session.csrf,
      action: `/admin/shifts/${shift.id}`, shift, errors: [],
    }));
  });

  app.post('/admin/shifts/:id', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const id = Number(req.params.id);
    const v = validateShiftInput(req.body);
    if (!v.ok) {
      return reply.code(200).type('text/html').send(app.render('admin-shift-form', {
        title: 'Schicht bearbeiten', csrf: req.session.csrf,
        action: `/admin/shifts/${id}`, shift: { ...req.body, id }, errors: v.errors,
      }));
    }
    updateShift(db, id, v.value);
    return reply.redirect('/admin');
  });

  app.post('/admin/shifts/:id/delete', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    deleteShift(db, Number(req.params.id));
    return reply.redirect('/admin');
  });
```

`src/views/admin-shift-form.eta`:
```html
<div class="admin">
  <h2><%= it.title %></h2>
  <% if (it.errors && it.errors.length) { %>
    <div class="errors"><% it.errors.forEach(function(e){ %><p><%= e %></p><% }) %></div>
  <% } %>
  <form method="post" action="<%= it.action %>" class="shift-form">
    <input type="hidden" name="csrf" value="<%= it.csrf %>">
    <label>Bereich <input name="area" value="<%= it.shift.area %>" required></label>
    <label>Titel <input name="title" value="<%= it.shift.title %>" required></label>
    <label>Beginn <input type="datetime-local" name="starts_at" value="<%= it.shift.starts_at %>" required></label>
    <label>Ende <input type="datetime-local" name="ends_at" value="<%= it.shift.ends_at %>" required></label>
    <label>Plätze <input type="number" min="1" name="capacity" value="<%= it.shift.capacity %>" required></label>
    <label>Notiz <input name="notes" value="<%= it.shift.notes || '' %>"></label>
    <button type="submit">Speichern</button>
    <a href="/admin">Abbrechen</a>
  </form>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/admin-routes.test.js`
Expected: PASS (alle Admin-Tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.js src/views/admin-shift-form.eta tests/admin-routes.test.js
git commit -m "feat: admin shift CRUD"
```

---

### Task 13: Admin – Schicht-Detail + Eintragungen verwalten

**Files:**
- Modify: `src/routes/admin.js`
- Create: `src/views/admin-shift-detail.eta`
- Add tests to: `tests/admin-routes.test.js`

**Interfaces:**
- Consumes: `getShift`, `listShifts`, `listSignupsByShift`, `createSignup`, `deleteSignup`, `moveSignup`, `validateSignupInput`.
- Produces:
  - `GET /admin/shifts/:id` → Detailseite: Schichtdaten, Liste der Eintragungen, Formular „Helfer hinzufügen", je Eintrag „entfernen"/„verschieben".
  - `POST /admin/shifts/:id/signups` → Helfer manuell hinzufügen (Kapazitätscheck; bei voll Fehlermeldung).
  - `POST /admin/signups/:sid/delete` → entfernen, Redirect zurück zur Schicht (`shift_id` im Body).
  - `POST /admin/signups/:sid/move` → in `target_shift_id` verschieben.

- [ ] **Step 1: Write the failing test (anhängen)**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-routes.test.js`
Expected: FAIL — Detail-/Signup-Routes fehlen.

- [ ] **Step 3: Add routes + view**

Imports oben in `admin.js` ergänzen:
```js
import { listSignupsByShift, createSignup, deleteSignup, moveSignup } from '../repositories/signups.js';
import { validateSignupInput } from '../validate.js';
```

Routes (ersetze die Basis-`GET /admin/shifts/:id`-Detailroute, falls in Task 12 angelegt, durch diese vollständige Version):
```js
  app.get('/admin/shifts/:id', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number(req.params.id);
    const shift = getShift(db, id);
    if (!shift) return reply.code(404).send('Schicht nicht gefunden.');
    const signups = listSignupsByShift(db, id);
    const others = listShifts(db).filter((s) => s.id !== id);
    reply.type('text/html').send(app.render('admin-shift-detail', {
      title: shift.title, shift, signups, others, csrf: req.session.csrf, errors: [],
    }));
  });

  app.post('/admin/shifts/:id/signups', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const id = Number(req.params.id);
    const v = validateSignupInput(req.body);
    if (v.ok) {
      const r = createSignup(db, { shift_id: id, ...v.value });
      if (!r.ok && r.reason === 'full') {
        const shift = getShift(db, id);
        const signups = listSignupsByShift(db, id);
        const others = listShifts(db).filter((s) => s.id !== id);
        return reply.code(200).type('text/html').send(app.render('admin-shift-detail', {
          title: shift.title, shift, signups, others, csrf: req.session.csrf,
          errors: ['Schicht ist voll.'],
        }));
      }
    }
    return reply.redirect(`/admin/shifts/${id}`);
  });

  app.post('/admin/signups/:sid/delete', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    deleteSignup(db, Number(req.params.sid));
    return reply.redirect(`/admin/shifts/${Number(req.body.shift_id)}`);
  });

  app.post('/admin/signups/:sid/move', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!requireCsrf(req, reply)) return;
    const target = Number(req.body.target_shift_id);
    moveSignup(db, Number(req.params.sid), target);
    return reply.redirect(`/admin/shifts/${target}`);
  });
```

`src/views/admin-shift-detail.eta`:
```html
<div class="admin">
  <p><a href="/admin">← Dashboard</a></p>
  <h2><%= it.shift.title %> <small>(<%= it.shift.area %>)</small></h2>
  <p><%= it.shift.starts_at.replace('T',' ') %> – <%= it.shift.ends_at.slice(11) %>,
     <%= it.signups.length %>/<%= it.shift.capacity %> belegt</p>
  <p>
    <a href="/admin/shifts/<%= it.shift.id %>/edit">Schicht bearbeiten</a> ·
  <form method="post" action="/admin/shifts/<%= it.shift.id %>/delete" class="inline"
        onsubmit="return confirm('Schicht wirklich löschen? Alle Eintragungen gehen verloren.')">
    <input type="hidden" name="csrf" value="<%= it.csrf %>">
    <button type="submit">Schicht löschen</button>
  </form>
  </p>

  <% if (it.errors && it.errors.length) { %>
    <div class="errors"><% it.errors.forEach(function(e){ %><p><%= e %></p><% }) %></div>
  <% } %>

  <h3>Eingetragene Helfer:innen</h3>
  <table class="signups-table">
    <thead><tr><th>Name</th><th>Telefon</th><th>Notiz</th><th>Aktionen</th></tr></thead>
    <tbody>
    <% it.signups.forEach(function(g){ %>
      <tr>
        <td><%= g.name %></td>
        <td><%= g.phone || '–' %></td>
        <td><%= g.note || '' %></td>
        <td>
          <form method="post" action="/admin/signups/<%= g.id %>/delete" class="inline">
            <input type="hidden" name="csrf" value="<%= it.csrf %>">
            <input type="hidden" name="shift_id" value="<%= it.shift.id %>">
            <button type="submit">entfernen</button>
          </form>
          <form method="post" action="/admin/signups/<%= g.id %>/move" class="inline">
            <input type="hidden" name="csrf" value="<%= it.csrf %>">
            <select name="target_shift_id">
              <% it.others.forEach(function(o){ %>
                <option value="<%= o.id %>"><%= o.area %> · <%= o.title %> (<%= o.free %> frei)</option>
              <% }) %>
            </select>
            <button type="submit">verschieben</button>
          </form>
        </td>
      </tr>
    <% }) %>
    </tbody>
  </table>
  <% if (!it.signups.length) { %><p>Noch niemand eingetragen.</p><% } %>

  <h3>Helfer:in manuell hinzufügen</h3>
  <form method="post" action="/admin/shifts/<%= it.shift.id %>/signups" class="signup-form">
    <input type="hidden" name="csrf" value="<%= it.csrf %>">
    <input type="text" name="name" placeholder="Name" required>
    <input type="tel" name="phone" placeholder="Telefon (optional)">
    <input type="text" name="note" placeholder="Notiz (optional)">
    <button type="submit">Hinzufügen</button>
  </form>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/admin-routes.test.js`
Expected: PASS (alle Admin-Tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.js src/views/admin-shift-detail.eta tests/admin-routes.test.js
git commit -m "feat: admin shift detail + signup management"
```

---

### Task 14: Admin – CSV-Export + QR-Code

**Files:**
- Modify: `src/routes/admin.js`
- Create: `src/views/admin-qr.eta`
- Add tests to: `tests/admin-routes.test.js`

**Interfaces:**
- Consumes: `listAllSignups`, `signupsCsv`, `qrcode` (`QRCode.toString`/`toDataURL`), `config.baseUrl`.
- Produces:
  - `GET /admin/export.csv` → `text/csv`, Dateiname `helfer-export.csv`, mit BOM für Excel.
  - `GET /admin/qr` → HTML-Seite mit eingebettetem QR (Data-URL) zu `${baseUrl}/` + Link zum SVG-Download.
  - `GET /admin/qr.svg` → `image/svg+xml` QR-Code.

- [ ] **Step 1: Write the failing test (anhängen)**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-routes.test.js`
Expected: FAIL — CSV/QR-Routes fehlen.

- [ ] **Step 3: Add routes + view**

Imports oben in `admin.js`:
```js
import QRCode from 'qrcode';
import { listAllSignups } from '../repositories/signups.js';
import { signupsCsv } from '../csv.js';
```

Routes:
```js
  app.get('/admin/export.csv', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const csv = signupsCsv(listAllSignups(db));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="helfer-export.csv"')
      .send('﻿' + csv); // BOM für Excel
  });

  app.get('/admin/qr', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const url = `${config.baseUrl}/`;
    const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 2 });
    reply.type('text/html').send(app.render('admin-qr', {
      title: 'QR-Code', url, dataUrl, csrf: req.session.csrf,
    }));
  });

  app.get('/admin/qr.svg', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const svg = await QRCode.toString(`${config.baseUrl}/`, { type: 'svg', margin: 2 });
    reply.header('Content-Type', 'image/svg+xml').send(svg);
  });
```

`src/views/admin-qr.eta`:
```html
<div class="admin qr-page">
  <p><a href="/admin">← Dashboard</a></p>
  <h2>QR-Code zur Helfer-Anmeldung</h2>
  <p>Führt zu: <code><%= it.url %></code></p>
  <img src="<%= it.dataUrl %>" alt="QR-Code" class="qr-img">
  <p><a href="/admin/qr.svg" download="helfer-qr.svg">QR als SVG herunterladen</a></p>
  <p class="hint">Zum Ausdrucken/Aushängen – Handy-Kamera drauf, fertig.</p>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/admin-routes.test.js` und danach `node --test` (gesamte Suite)
Expected: PASS (alle Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.js src/views/admin-qr.eta tests/admin-routes.test.js
git commit -m "feat: csv export + qr code page"
```

---

### Task 15: Branding-Styles (Punk/DIY) + Logo-Einbindung

**Files:**
- Create: `public/styles.css`

**Interfaces:**
- Consumes: Templates aus Task 9–14 (Klassennamen: `site-header`, `logo`, `motto`, `area`, `shift`, `full`, `signup-form`, `errors`, `admin`, `admin-bar`, `shifts-table`, `signups-table`, `qr-img`, `confirm`).
- Produces: fertiges, mobil-first Schwarz-Weiß-Stylesheet mit Punk-Anmutung. (Rein präsentational – wird über die bereits bestehenden Route-Tests mitgerendert; kein neuer Unit-Test, aber Sicht-Check in Task 16.)

- [ ] **Step 1: Write public/styles.css**

```css
:root {
  --ink: #0a0a0a;
  --paper: #f4f4f0;
  --accent: #ffffff;
  --danger: #b00020;
  --tape: #d9d9d9;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--ink); color: var(--paper);
  font-family: "Courier New", ui-monospace, monospace;
  line-height: 1.45;
}
main { max-width: 720px; margin: 0 auto; padding: 1rem; }
a { color: var(--paper); }

.site-header {
  text-align: center; padding: 1.25rem 1rem; border-bottom: 4px solid var(--paper);
  background: #000;
}
.site-header .logo { max-width: 160px; height: auto; }
.site-header h1 {
  font-size: 1.6rem; letter-spacing: 2px; text-transform: uppercase; margin: .4rem 0 .2rem;
}
.motto {
  display: inline-block; background: var(--paper); color: var(--ink);
  padding: .1rem .5rem; transform: rotate(-2deg); font-weight: bold;
}

h2, h3 { text-transform: uppercase; letter-spacing: 1px; }

.intro { border-left: 4px solid var(--paper); padding-left: .6rem; }

.area { margin-bottom: 1.5rem; }
.shift {
  border: 2px solid var(--paper); padding: .75rem; margin: .6rem 0;
  background: #111;
}
.shift.full { opacity: .55; }
.shift-head { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; }
.shift-head .slots { margin-left: auto; font-weight: bold; }
.full-label {
  display: inline-block; background: var(--danger); color: #fff;
  padding: .1rem .5rem; transform: rotate(-1deg);
}

.signup-form { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .6rem; }
.signup-form input { flex: 1 1 8rem; }
input, select, button {
  font: inherit; padding: .5rem; border: 2px solid var(--paper);
  background: var(--paper); color: var(--ink);
}
button {
  cursor: pointer; text-transform: uppercase; font-weight: bold;
  background: var(--ink); color: var(--paper);
}
button:hover { background: var(--paper); color: var(--ink); }

.errors { border: 2px solid var(--danger); color: #ff9aa2; padding: .5rem; margin: .5rem 0; }

.confirm { text-align: center; padding: 2rem 1rem; }

/* Admin */
.admin-bar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; justify-content: space-between; }
.admin-actions { display: flex; gap: .75rem; flex-wrap: wrap; align-items: center; }
.admin form.inline { display: inline; }
table { width: 100%; border-collapse: collapse; margin: .75rem 0; }
th, td { border: 1px solid var(--paper); padding: .4rem; text-align: left; font-size: .95rem; }
.shift-form { display: grid; gap: .5rem; max-width: 420px; }
.shift-form label { display: grid; gap: .2rem; }

.qr-page { text-align: center; }
.qr-img { max-width: 320px; width: 100%; height: auto; background: #fff; padding: .5rem; }

.site-footer { text-align: center; padding: 1rem; opacity: .6; font-size: .85rem; }

@media (max-width: 480px) {
  .shift-head .slots { margin-left: 0; }
}
```

- [ ] **Step 2: Verify rendering via existing tests**

Run: `node --test`
Expected: PASS (Styles brechen nichts; alle Tests grün).

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "feat: punk/DIY branding styles"
```

---

### Task 16: Deployment – Docker, Compose, ENV, nginx, README

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.dockerignore`
- Create: `nginx/helfer.example.org.conf`
- Create: `README.md`

**Interfaces:**
- Consumes: `npm start` (Task 1), `config.js` ENV-Namen (Task 8).
- Produces: reproduzierbarer Container-Build + Betriebsanleitung. Verifikation: Image baut, Container startet, `GET /` liefert 200.

- [ ] **Step 1: Write deployment files**

`Dockerfile`:
```dockerfile
FROM node:24-slim
ENV NODE_ENV=production
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "src/server.js"]
```

`.dockerignore`:
```
node_modules
.env
data
.git
docs
tests
```

`docker-compose.yml`:
```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./data:/data
```

`.env.example`:
```
# Admin-Zugang (genau ein Benutzer)
ADMIN_USER=admin
# Hash mit:  node scripts/hash-password.mjs "DEIN-PASSWORT"
ADMIN_PASSWORD_HASH=scrypt$REPLACE$REPLACE
# Zufälliger String, z.B.:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=REPLACE_ME
# Öffentliche URL (bestimmt u.a. secure-Cookie und QR-Ziel)
BASE_URL=https://helfer.example.org
PORT=8080
DB_PATH=/data/app.db
```

`nginx/helfer.example.org.conf`:
```nginx
server {
    listen 80;
    server_name helfer.example.org;
    # certbot legt hier den ACME-Challenge-Block an und richtet den 443-Block ein.
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`README.md`:
```markdown
# Helfertool Kölnvention

Schicht-Anmeldung für Helfer:innen (Kölnvention e.V., Jonglage-Festival).
Ein Admin-Login, Anmeldung ohne Registrierung, QR-Code zum Aushängen.

## Lokal entwickeln
```bash
npm install
cp .env.example .env
node scripts/hash-password.mjs "test123"   # Hash in .env eintragen
npm test
npm start   # http://localhost:8080  (BASE_URL in .env auf http://localhost:8080 setzen)
```

## Auf dem Server deployen
```bash
git clone <REPO_URL> /opt/helfer-koelnvention
cd /opt/helfer-koelnvention
cp .env.example .env
# Passwort-Hash erzeugen und in .env eintragen:
docker run --rm -v "$PWD":/app -w /app node:24-slim node scripts/hash-password.mjs "DEIN-PASSWORT"
# SESSION_SECRET, ADMIN_USER, BASE_URL in .env setzen
docker compose up -d --build
```

nginx + TLS:
```bash
cp nginx/helfer.example.org.conf /etc/nginx/sites-available/helfer.example.org
ln -s /etc/nginx/sites-available/helfer.example.org /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d helfer.example.org
```

## Updaten
```bash
cd /opt/helfer-koelnvention
git pull
docker compose up -d --build
```

## Bedienung
- Admin: `https://helfer.example.org/admin` → einloggen → Schichten anlegen.
- QR-Code: im Admin unter „QR-Code" → ausdrucken/aushängen.
- Export: „CSV-Export" lädt alle Eintragungen.

Die SQLite-DB liegt in `./data/app.db` (Docker-Volume) – für Backups einfach diese Datei sichern.
```

- [ ] **Step 2: Verify build + boot**

Run (auf einer Docker-fähigen Maschine):
```bash
cp .env.example .env
# ADMIN_PASSWORD_HASH per hash-password füllen, SESSION_SECRET setzen, BASE_URL=http://localhost:8080
docker compose up -d --build
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/
```
Expected: `200`. (Lokal ohne Docker: `npm start` + `curl` gegen `http://localhost:8080/`.)

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml .env.example nginx/helfer.example.org.conf README.md
git commit -m "chore: docker/compose/nginx deployment + readme"
```

---

## Self-Review

**1. Spec coverage:**
- Schicht-Slots buchen ohne Account → Task 4, 10 ✔
- Nur Admin verwaltet → Task 11–13 ✔
- Ein Admin via ENV → Task 8, 11 ✔
- Kontakt nur Telefon, optional; Name Pflicht → Task 5, 10 ✔
- QR-Code → Task 14 ✔
- CSV-Export → Task 6, 14 ✔
- Kein Overbooking (transaktional) → Task 4 ✔
- CSRF, Rate-Limit, Session-Cookie-Flags → Task 7, 9, 11 ✔
- Branding Punk/DIY, Logos, Deutsch → Task 9 (layout), 15 ✔
- Deploy git pull + docker compose + nginx → Task 16 ✔
- Tests TDD Kernlogik → jede Task ✔

**2. Placeholder scan:** Keine „TBD/TODO/später". `.env.example` enthält `REPLACE`-Marker – das ist beabsichtigter Beispielinhalt, kein Plan-Platzhalter.

**3. Type consistency:** Repo-Signaturen (`createSignup`→`{ok,id/reason}`, `listShifts`→`+taken/+free`, `getSession`→row/undefined, `createSession`→`{id,csrf}`) sind über Tasks 3/4/7/9–14 konsistent verwendet. `requireCsrf(req,reply)`→boolean, `requireAdmin(req,reply)`→boolean einheitlich.

**Hinweis zur Task-12/13-Überschneidung:** Die `GET /admin/shifts/:id`-Detailroute wird final in Task 13 definiert; in Task 12 wird sie nur erwähnt und in Task 13 vollständig ausgeführt – keine Doppel-Registrierung derselben Route (in Task 12 NICHT anlegen, nur in Task 13).
