# Schichtplan-Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bereiche als eigenes Konzept, einen Schicht-Generator statt Einzel-Anlage, einen öffentlichen Stundenplan mit Bereichs-Tabs (mobil zuerst), „Meine Schichten" mit Selbst-Abmelden und eine Admin-Fortschrittsübersicht bauen.

**Architecture:** Serverseitig gerendertes Fastify-Monolith. Neue `areas`-Tabelle, `shifts.area_id`-FK, `signups.device_token`. Reine Hilfsfunktionen (`planSlots`, `displayName`) getrennt von DB-Repos, damit sie isoliert testbar sind. Views bleiben Eta-Partials innerhalb von `layout.eta`. Tabs auf der öffentlichen Seite via minimalem JS mit No-JS-Fallback (alle Bereiche sichtbar).

**Tech Stack:** Node ≥ 24, Fastify 5, `node:sqlite` (DatabaseSync), Eta, `node --test`, keine neuen Dependencies.

## Global Constraints

- Node ≥ 24, ES-Module (`"type": "module"`), keine neuen npm-Dependencies.
- Jede POST-Route nutzt `requireCsrf(req, reply)`; Admin-Routen zusätzlich `requireAdmin(req, reply)`.
- SQLite über `node:sqlite`; Schreibvorgänge mit mehreren Schritten in `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`.
- Alle Nutzertexte auf Deutsch.
- Zeiten werden als String `YYYY-MM-DDTHH:MM` gespeichert (lokale Wandzeit, keine Zeitzone), passend zu `datetime-local`/`date`+`time`.
- Tests laufen mit `npm test` (`node --test`); DB im Test ist `:memory:`.
- Committe nach jeder Task. Commit-Messages auf Deutsch, mit `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Neu:**
- `src/repositories/areas.js` — CRUD für Bereiche.
- `src/display.js` — reine Anzeige-Helfer: `displayName`, `formatTime`, `formatDay`.
- `src/views/meine.eta` — „Meine Schichten".
- `src/views/admin-areas.eta` — Bereichsverwaltung.
- `src/views/admin-generate.eta` — Schicht-Generator.
- `tests/areas.test.js`, `tests/display.test.js`, `tests/generate.test.js`, `tests/meine.test.js`.

**Geändert:**
- `src/db.js` — Schema `areas`, `shifts.area_id`, `signups.device_token` + Migration.
- `src/repositories/shifts.js` — `area_id`/optionaler Titel, Join, `planSlots`, `generateShifts`, `deleteShiftsByAreaDay`, `areaStats`.
- `src/repositories/signups.js` — `device_token`, `listByToken`, `cancelOwnSignup`, `listAllSignups` (Area-Join).
- `src/validate.js` — `validateAreaInput`, `validateGenerateInput`, `validateShiftInput` (auf `area_id`).
- `src/routes/public.js` — Tabs-Daten, Cookie, `/meine`, `/signup/:id/cancel`.
- `src/routes/admin.js` — Bereichs-CRUD, Generator, Dashboard-Übersicht, Bulk-Delete, Edit auf `area_id`.
- `src/views/public-list.eta`, `admin-dashboard.eta`, `admin-shift-form.eta`, `admin-shift-detail.eta`.
- `public/styles.css` — mobil-zuerst, aufgeräumtes dunkles Design, Bereichsfarben, Tabs, Stundenplan.
- `tests/helpers.js` — `seedArea`-Helfer.
- Bestehende Tests, die `createShift({ area: '...' })` nutzen, auf `area_id` umstellen.

---

## Task 1: Schema, Migration & Bereichs-Repository

**Files:**
- Modify: `src/db.js`
- Create: `src/repositories/areas.js`
- Modify: `tests/helpers.js`
- Create: `tests/areas.test.js`
- Modify: `tests/db.test.js`

**Interfaces:**
- Produces:
  - Schema-Tabellen `areas(id, name, color, sort_order)`, `shifts(id, area_id, title, starts_at, ends_at, capacity, notes)`, `signups(..., device_token)`.
  - `createArea(db, { name, color, sort_order }) -> number` (id)
  - `listAreas(db) -> Array<{id,name,color,sort_order}>` (sortiert nach `sort_order`, dann `name`)
  - `getArea(db, id) -> row | undefined`
  - `updateArea(db, id, { name, color, sort_order }) -> void`
  - `deleteArea(db, id) -> void`
  - Test-Helfer `seedArea(db, overrides?) -> number` (id eines Standard-Bereichs)

- [ ] **Step 1: Failing-Test für das Bereichs-Repository schreiben**

Create `tests/areas.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createArea, listAreas, getArea, updateArea, deleteArea } from '../src/repositories/areas.js';

test('createArea + listAreas sortiert nach sort_order dann name', () => {
  const db = createDb(':memory:');
  createArea(db, { name: 'Springer', color: '#4488ff', sort_order: 2 });
  createArea(db, { name: 'Küche', color: '#ff8844', sort_order: 1 });
  const areas = listAreas(db);
  assert.deepEqual(areas.map((a) => a.name), ['Küche', 'Springer']);
  assert.equal(areas[0].color, '#ff8844');
});

test('updateArea ändert Name und Farbe', () => {
  const db = createDb(':memory:');
  const id = createArea(db, { name: 'Bar', color: '#888888', sort_order: 0 });
  updateArea(db, id, { name: 'Cocktailbar', color: '#00cc99', sort_order: 5 });
  const a = getArea(db, id);
  assert.equal(a.name, 'Cocktailbar');
  assert.equal(a.color, '#00cc99');
  assert.equal(a.sort_order, 5);
});

test('deleteArea entfernt Bereich und per Cascade seine Schichten', () => {
  const db = createDb(':memory:');
  const id = createArea(db, { name: 'Bar', color: '#888888', sort_order: 0 });
  db.prepare(`INSERT INTO shifts (area_id,title,starts_at,ends_at,capacity,notes)
              VALUES (?,?,?,?,?,?)`).run(id, null, '2026-09-25T18:00', '2026-09-25T19:00', 2, null);
  deleteArea(db, id);
  assert.equal(getArea(db, id), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 0);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/areas.test.js`
Expected: FAIL (`src/repositories/areas.js` existiert nicht / Tabelle `areas` fehlt).

- [ ] **Step 3: Schema in `src/db.js` erweitern und Migration ergänzen**

Ersetze `initSchema` und ergänze die Migrationsfunktion. Vollständiger neuer Inhalt von `src/db.js`:

```js
import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function migrateShiftsToAreaId(db) {
  // FK vor dem Tabellentausch aus (signups.shift_id verweist auf shifts.id).
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    const oldAreas = db.prepare('SELECT DISTINCT area FROM shifts').all();
    const findArea = db.prepare('SELECT id FROM areas WHERE name = ?');
    const insertArea = db.prepare('INSERT INTO areas (name) VALUES (?)');
    for (const { area } of oldAreas) {
      const name = area ?? 'Ohne Bereich';
      if (!findArea.get(name)) insertArea.run(name);
    }
    db.exec(`
      CREATE TABLE shifts_new (
        id        INTEGER PRIMARY KEY,
        area_id   INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
        title     TEXT,
        starts_at TEXT NOT NULL,
        ends_at   TEXT NOT NULL,
        capacity  INTEGER NOT NULL,
        notes     TEXT
      );`);
    db.exec(`
      INSERT INTO shifts_new (id, area_id, title, starts_at, ends_at, capacity, notes)
      SELECT s.id, a.id, s.title, s.starts_at, s.ends_at, s.capacity, s.notes
      FROM shifts s JOIN areas a ON a.name = COALESCE(s.area, 'Ohne Bereich');`);
    db.exec('DROP TABLE shifts;');
    db.exec('ALTER TABLE shifts_new RENAME TO shifts;');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON;');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS areas (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#888888',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      csrf       TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signups (
      id           INTEGER PRIMARY KEY,
      shift_id     INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      phone        TEXT,
      note         TEXT,
      device_token TEXT,
      created_at   TEXT NOT NULL
    );
  `);

  const shiftCols = columnNames(db, 'shifts');
  if (shiftCols.length === 0) {
    db.exec(`
      CREATE TABLE shifts (
        id        INTEGER PRIMARY KEY,
        area_id   INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
        title     TEXT,
        starts_at TEXT NOT NULL,
        ends_at   TEXT NOT NULL,
        capacity  INTEGER NOT NULL,
        notes     TEXT
      );`);
  } else if (!shiftCols.includes('area_id')) {
    migrateShiftsToAreaId(db);
  }

  if (!columnNames(db, 'signups').includes('device_token')) {
    db.exec('ALTER TABLE signups ADD COLUMN device_token TEXT;');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_signups_shift ON signups(shift_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_signups_token ON signups(device_token);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_shifts_area ON shifts(area_id);');
}

export function createDb(path) {
  const db = openDb(path);
  initSchema(db);
  return db;
}
```

- [ ] **Step 4: `src/repositories/areas.js` schreiben**

```js
export function createArea(db, { name, color = '#888888', sort_order = 0 }) {
  const info = db
    .prepare('INSERT INTO areas (name, color, sort_order) VALUES (?,?,?)')
    .run(name, color, sort_order);
  return Number(info.lastInsertRowid);
}

export function listAreas(db) {
  return db.prepare('SELECT * FROM areas ORDER BY sort_order, name').all();
}

export function getArea(db, id) {
  return db.prepare('SELECT * FROM areas WHERE id = ?').get(id);
}

export function updateArea(db, id, { name, color, sort_order }) {
  db.prepare('UPDATE areas SET name=?, color=?, sort_order=? WHERE id=?')
    .run(name, color, sort_order, id);
}

export function deleteArea(db, id) {
  db.prepare('DELETE FROM areas WHERE id = ?').run(id);
}
```

- [ ] **Step 5: `seedArea`-Helfer in `tests/helpers.js` ergänzen**

Am Ende von `tests/helpers.js` ergänzen:

```js
import { createArea } from '../src/repositories/areas.js';

export function seedArea(db, overrides = {}) {
  return createArea(db, { name: 'Bar', color: '#888888', sort_order: 0, ...overrides });
}
```

(Der bestehende `import`-Block bleibt; die neue `import`-Zeile oben zu den anderen Imports hinzufügen.)

- [ ] **Step 6: Tests ausführen (Repo + Schema)**

Run: `node --test tests/areas.test.js`
Expected: PASS (3 Tests).

- [ ] **Step 7: `tests/db.test.js` auf neues Schema anpassen (falls nötig)**

Öffne `tests/db.test.js`. Falls dort auf `shifts.area` (Text) geprüft wird, ersetze die Erwartung: eine frische DB hat eine `shifts`-Tabelle mit Spalte `area_id`. Beispiel-Assertion (ergänzen/ersetzen):

```js
test('frisches Schema hat shifts.area_id und areas-Tabelle', () => {
  const db = createDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(shifts)').all().map((c) => c.name);
  assert.ok(cols.includes('area_id'));
  assert.ok(!cols.includes('area'));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  assert.ok(tables.includes('areas'));
});
```

- [ ] **Step 8: Migrations-Test schreiben (alter `area`-Text → `area_id`)**

Ergänze in `tests/db.test.js` einen Test, der eine alte DB simuliert und die Migration prüft:

```js
import { openDb, initSchema } from '../src/db.js';

test('Migration überführt alte shifts.area-Textspalte nach areas/area_id', () => {
  const db = openDb(':memory:');
  // altes Schema nachbauen
  db.exec(`CREATE TABLE shifts (id INTEGER PRIMARY KEY, area TEXT NOT NULL, title TEXT NOT NULL,
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL, notes TEXT);`);
  db.exec(`CREATE TABLE signups (id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone TEXT, note TEXT, created_at TEXT NOT NULL);`);
  db.prepare(`INSERT INTO shifts (area,title,starts_at,ends_at,capacity,notes)
    VALUES (?,?,?,?,?,?)`).run('Küche', 'Frühdienst', '2026-09-25T08:00', '2026-09-25T09:00', 3, null);
  initSchema(db);
  const cols = db.prepare('PRAGMA table_info(shifts)').all().map((c) => c.name);
  assert.ok(cols.includes('area_id'));
  const row = db.prepare(`SELECT s.title, a.name AS area FROM shifts s JOIN areas a ON a.id = s.area_id`).get();
  assert.equal(row.area, 'Küche');
  assert.equal(row.title, 'Frühdienst');
  assert.ok(db.prepare('PRAGMA table_info(signups)').all().map((c) => c.name).includes('device_token'));
});
```

- [ ] **Step 9: Tests ausführen**

Run: `node --test tests/db.test.js tests/areas.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/db.js src/repositories/areas.js tests/helpers.js tests/areas.test.js tests/db.test.js
git commit -m "feat: areas-Tabelle, area_id-Migration und Bereichs-Repository

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Anzeige-Helfer (`displayName`, `formatTime`, `formatDay`)

**Files:**
- Create: `src/display.js`
- Create: `tests/display.test.js`

**Interfaces:**
- Produces:
  - `displayName(fullName: string) -> string` — „Kolja Kleinschmidt" → „Kolja K."; „Kolja" → „Kolja"; „" → „".
  - `formatTime(iso: string) -> string` — `2026-09-25T18:30` → `18:30`.
  - `formatDay(iso: string) -> string` — `2026-09-25T18:30` → `25.09.2026`.

- [ ] **Step 1: Failing-Test schreiben**

Create `tests/display.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, formatTime, formatDay } from '../src/display.js';

test('displayName kürzt Nachnamen zu Initial', () => {
  assert.equal(displayName('Kolja Kleinschmidt'), 'Kolja K.');
});
test('displayName ohne Nachname bleibt unverändert', () => {
  assert.equal(displayName('Kolja'), 'Kolja');
});
test('displayName nimmt letztes Wort als Nachname-Initial', () => {
  assert.equal(displayName('Anna Maria Schmidt'), 'Anna S.');
});
test('displayName mit leerer Eingabe ist leer', () => {
  assert.equal(displayName('   '), '');
});
test('formatTime schneidet HH:MM aus ISO', () => {
  assert.equal(formatTime('2026-09-25T18:30'), '18:30');
});
test('formatDay gibt TT.MM.JJJJ', () => {
  assert.equal(formatDay('2026-09-25T18:30'), '25.09.2026');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/display.test.js`
Expected: FAIL (`src/display.js` fehlt).

- [ ] **Step 3: `src/display.js` implementieren**

```js
export function displayName(fullName) {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

export function formatTime(iso) {
  return (iso ?? '').slice(11, 16);
}

export function formatDay(iso) {
  const [y, m, d] = (iso ?? '').slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
```

- [ ] **Step 4: Test ausführen, Erfolg prüfen**

Run: `node --test tests/display.test.js`
Expected: PASS (6 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/display.js tests/display.test.js
git commit -m "feat: Anzeige-Helfer displayName/formatTime/formatDay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Schicht-Repository — area_id, Join, Generator, Stats, Bulk-Delete

**Files:**
- Modify: `src/repositories/shifts.js`
- Modify: `tests/shifts.test.js`
- Create: `tests/generate.test.js`

**Interfaces:**
- Consumes: `createArea`/`seedArea` (Task 1).
- Produces:
  - `createShift(db, { area_id, title, starts_at, ends_at, capacity, notes }) -> number`
  - `getShift(db, id) -> row | undefined` (Rohzeile inkl. `area_id`)
  - `listShifts(db) -> Array<{...shift, area_name, area_color, sort_order, taken, free}>` (sortiert nach `sort_order`, `starts_at`)
  - `updateShift(db, id, { area_id, title, starts_at, ends_at, capacity, notes }) -> void`
  - `deleteShift(db, id) -> void`
  - `planSlots({ date, from, to, slotMinutes }) -> Array<{starts_at, ends_at}>` (reine Funktion; überspringt unvollständigen Rest)
  - `generateShifts(db, { area_id, title, date, from, to, slotMinutes, capacity, notes }) -> { count }`
  - `deleteShiftsByAreaDay(db, area_id, day) -> { count }` (day = `YYYY-MM-DD`)
  - `areaStats(db) -> Array<{area_id, name, color, capacity, taken, free, gaps}>`

- [ ] **Step 1: Failing-Test für `planSlots` schreiben**

Create `tests/generate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { seedArea } from './helpers.js';
import { planSlots, generateShifts, listShifts } from '../src/repositories/shifts.js';

test('planSlots erzeugt lückenlose 60-min-Blöcke', () => {
  const slots = planSlots({ date: '2026-09-25', from: '10:00', to: '13:00', slotMinutes: 60 });
  assert.deepEqual(slots, [
    { starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00' },
    { starts_at: '2026-09-25T11:00', ends_at: '2026-09-25T12:00' },
    { starts_at: '2026-09-25T12:00', ends_at: '2026-09-25T13:00' },
  ]);
});

test('planSlots überspringt unvollständigen Rest', () => {
  const slots = planSlots({ date: '2026-09-25', from: '10:00', to: '11:30', slotMinutes: 60 });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].ends_at, '2026-09-25T11:00');
});

test('planSlots mit 90-min-Blöcken', () => {
  const slots = planSlots({ date: '2026-09-25', from: '08:00', to: '11:00', slotMinutes: 90 });
  assert.deepEqual(slots.map((s) => s.starts_at + '/' + s.ends_at), [
    '2026-09-25T08:00/2026-09-25T09:30',
    '2026-09-25T09:30/2026-09-25T11:00',
  ]);
});

test('planSlots liefert leer, wenn Fenster kürzer als Schichtlänge', () => {
  assert.deepEqual(planSlots({ date: '2026-09-25', from: '10:00', to: '10:20', slotMinutes: 30 }), []);
});

test('generateShifts legt alle Schichten mit Kapazität an', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  const { count } = generateShifts(db, {
    area_id, title: 'Frühdienst', date: '2026-09-25', from: '08:00', to: '10:00',
    slotMinutes: 30, capacity: 3, notes: null,
  });
  assert.equal(count, 4);
  const shifts = listShifts(db);
  assert.equal(shifts.length, 4);
  assert.ok(shifts.every((s) => s.capacity === 3 && s.title === 'Frühdienst'));
  assert.equal(shifts[0].area_name, 'Bar');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/generate.test.js`
Expected: FAIL (`planSlots`/`generateShifts` fehlen, `listShifts` liefert kein `area_name`).

- [ ] **Step 3: `src/repositories/shifts.js` neu schreiben**

Vollständiger neuer Inhalt:

```js
export function createShift(db, { area_id, title, starts_at, ends_at, capacity, notes }) {
  const info = db
    .prepare(`INSERT INTO shifts (area_id,title,starts_at,ends_at,capacity,notes)
              VALUES (?,?,?,?,?,?)`)
    .run(area_id, title ?? null, starts_at, ends_at, capacity, notes ?? null);
  return Number(info.lastInsertRowid);
}

export function getShift(db, id) {
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
}

export function listShifts(db) {
  return db
    .prepare(
      `SELECT s.*, a.name AS area_name, a.color AS area_color, a.sort_order AS sort_order,
        (SELECT COUNT(*) FROM signups g WHERE g.shift_id = s.id) AS taken
       FROM shifts s JOIN areas a ON a.id = s.area_id
       ORDER BY a.sort_order, a.name, s.starts_at`
    )
    .all()
    .map((s) => ({ ...s, free: Math.max(0, s.capacity - s.taken) }));
}

export function updateShift(db, id, { area_id, title, starts_at, ends_at, capacity, notes }) {
  db.prepare(
    `UPDATE shifts SET area_id=?, title=?, starts_at=?, ends_at=?, capacity=?, notes=?
     WHERE id=?`
  ).run(area_id, title ?? null, starts_at, ends_at, capacity, notes ?? null, id);
}

export function deleteShift(db, id) {
  db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
}

function pad(n) { return String(n).padStart(2, '0'); }

export function planSlots({ date, from, to, slotMinutes }) {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const startMin = fh * 60 + fm;
  const endMin = th * 60 + tm;
  const slots = [];
  for (let s = startMin; s + slotMinutes <= endMin; s += slotMinutes) {
    const e = s + slotMinutes;
    slots.push({
      starts_at: `${date}T${pad(Math.floor(s / 60))}:${pad(s % 60)}`,
      ends_at: `${date}T${pad(Math.floor(e / 60))}:${pad(e % 60)}`,
    });
  }
  return slots;
}

export function generateShifts(db, { area_id, title, date, from, to, slotMinutes, capacity, notes }) {
  const slots = planSlots({ date, from, to, slotMinutes });
  db.exec('BEGIN IMMEDIATE');
  try {
    const stmt = db.prepare(
      `INSERT INTO shifts (area_id,title,starts_at,ends_at,capacity,notes)
       VALUES (?,?,?,?,?,?)`
    );
    for (const slot of slots) {
      stmt.run(area_id, title ?? null, slot.starts_at, slot.ends_at, capacity, notes ?? null);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { count: slots.length };
}

export function deleteShiftsByAreaDay(db, area_id, day) {
  const info = db
    .prepare(`DELETE FROM shifts WHERE area_id = ? AND substr(starts_at, 1, 10) = ?`)
    .run(area_id, day);
  return { count: Number(info.changes) };
}

export function areaStats(db) {
  return db
    .prepare(
      `SELECT a.id AS area_id, a.name, a.color,
        COALESCE(SUM(s.capacity), 0) AS capacity,
        COALESCE(SUM((SELECT COUNT(*) FROM signups g WHERE g.shift_id = s.id)), 0) AS taken,
        COALESCE(SUM(CASE WHEN (SELECT COUNT(*) FROM signups g WHERE g.shift_id = s.id) < s.capacity
                          THEN 1 ELSE 0 END), 0) AS gaps
       FROM areas a LEFT JOIN shifts s ON s.area_id = a.id
       GROUP BY a.id
       ORDER BY a.sort_order, a.name`
    )
    .all()
    .map((r) => ({ ...r, free: Math.max(0, r.capacity - r.taken) }));
}
```

- [ ] **Step 4: `tests/generate.test.js` ausführen, Erfolg prüfen**

Run: `node --test tests/generate.test.js`
Expected: PASS (5 Tests).

- [ ] **Step 5: `tests/shifts.test.js` auf neue Signatur umstellen**

Öffne `tests/shifts.test.js`. Ersetze jeden `createShift(db, { area: 'X', title, ... })`-Aufruf durch das Anlegen eines Bereichs + `area_id`. Muster (oben importieren: `import { seedArea } from './helpers.js';`):

```js
// vorher: createShift(db, { area: 'Bar', title: 'Bar', starts_at, ends_at, capacity, notes: null })
const area_id = seedArea(db);
createShift(db, { area_id, title: 'Bar', starts_at, ends_at, capacity, notes: null });
```

Ergänze außerdem Tests für Stats & Bulk-Delete:

```js
import { areaStats, deleteShiftsByAreaDay, generateShifts } from '../src/repositories/shifts.js';

test('areaStats zählt Kapazität, Belegung und Lücken', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  generateShifts(db, { area_id, title: null, date: '2026-09-25', from: '10:00', to: '12:00', slotMinutes: 60, capacity: 2, notes: null });
  const stats = areaStats(db).find((s) => s.area_id === area_id);
  assert.equal(stats.capacity, 4);
  assert.equal(stats.taken, 0);
  assert.equal(stats.gaps, 2);
});

test('deleteShiftsByAreaDay löscht nur den passenden Tag', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  generateShifts(db, { area_id, title: null, date: '2026-09-25', from: '10:00', to: '12:00', slotMinutes: 60, capacity: 1, notes: null });
  generateShifts(db, { area_id, title: null, date: '2026-09-26', from: '10:00', to: '11:00', slotMinutes: 60, capacity: 1, notes: null });
  const { count } = deleteShiftsByAreaDay(db, area_id, '2026-09-25');
  assert.equal(count, 2);
  assert.equal(listShifts(db).length, 1);
});
```

(Passende Imports `createDb`, `listShifts`, `seedArea` oben ergänzen, falls noch nicht vorhanden.)

- [ ] **Step 6: Tests ausführen**

Run: `node --test tests/shifts.test.js tests/generate.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/shifts.js tests/shifts.test.js tests/generate.test.js
git commit -m "feat: Schicht-Repo auf area_id + Generator, Stats, Bulk-Delete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Signup-Repository — device_token, listByToken, cancelOwnSignup, Area-Join

**Files:**
- Modify: `src/repositories/signups.js`
- Modify: `tests/signups.test.js`

**Interfaces:**
- Consumes: `seedArea` (Task 1), `createShift` (Task 3).
- Produces:
  - `createSignup(db, { shift_id, name, phone?, note?, device_token? }) -> { ok, id } | { ok:false, reason }`
  - `listSignupsByShift(db, shiftId) -> rows`
  - `deleteSignup(db, id) -> void`
  - `moveSignup(db, id, newShiftId) -> { ok } | { ok:false, reason }`
  - `listAllSignups(db) -> rows` (mit `shift_area` = Bereichsname, für CSV)
  - `listByToken(db, token) -> Array<{signup_id, name, note, area_name, area_color, title, starts_at, ends_at}>`
  - `cancelOwnSignup(db, id, token) -> { ok } | { ok:false, reason:'not_found'|'forbidden' }`

- [ ] **Step 1: Failing-Test schreiben**

In `tests/signups.test.js` (bestehende `area`-Aufrufe zuerst wie in Task 3 auf `seedArea`+`area_id` umstellen), dann ergänzen:

```js
import { listByToken, cancelOwnSignup } from '../src/repositories/signups.js';

test('createSignup speichert device_token; listByToken filtert danach', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  const sid = createShift(db, { area_id, title: 'Bar', starts_at: '2026-09-25T18:00', ends_at: '2026-09-25T19:00', capacity: 5, notes: null });
  createSignup(db, { shift_id: sid, name: 'Anna Meyer', device_token: 'tok-1' });
  createSignup(db, { shift_id: sid, name: 'Ben Kraus', device_token: 'tok-2' });
  const mine = listByToken(db, 'tok-1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, 'Anna Meyer');
  assert.equal(mine[0].area_name, 'Bar');
});

test('cancelOwnSignup löscht nur bei passendem Token', () => {
  const db = createDb(':memory:');
  const area_id = seedArea(db);
  const sid = createShift(db, { area_id, title: 'Bar', starts_at: '2026-09-25T18:00', ends_at: '2026-09-25T19:00', capacity: 5, notes: null });
  const { id } = createSignup(db, { shift_id: sid, name: 'Anna', device_token: 'tok-1' });
  assert.deepEqual(cancelOwnSignup(db, id, 'tok-2'), { ok: false, reason: 'forbidden' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signups').get().n, 1);
  assert.deepEqual(cancelOwnSignup(db, id, 'tok-1'), { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM signups').get().n, 0);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/signups.test.js`
Expected: FAIL (`device_token`-Param wird ignoriert, `listByToken`/`cancelOwnSignup` fehlen).

- [ ] **Step 3: `src/repositories/signups.js` neu schreiben**

```js
function countSignups(db, shiftId) {
  return db.prepare('SELECT COUNT(*) AS n FROM signups WHERE shift_id = ?').get(shiftId).n;
}

export function createSignup(db, { shift_id, name, phone = null, note = null, device_token = null }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const shift = db.prepare('SELECT capacity FROM shifts WHERE id = ?').get(shift_id);
    if (!shift) { db.exec('ROLLBACK'); return { ok: false, reason: 'no_shift' }; }
    if (countSignups(db, shift_id) >= shift.capacity) { db.exec('ROLLBACK'); return { ok: false, reason: 'full' }; }
    const info = db
      .prepare(`INSERT INTO signups (shift_id,name,phone,note,device_token,created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(shift_id, name, phone, note, device_token, new Date().toISOString());
    db.exec('COMMIT');
    return { ok: true, id: Number(info.lastInsertRowid) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listSignupsByShift(db, shiftId) {
  return db.prepare('SELECT * FROM signups WHERE shift_id = ? ORDER BY created_at').all(shiftId);
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
    if (countSignups(db, newShiftId) >= shift.capacity) { db.exec('ROLLBACK'); return { ok: false, reason: 'full' }; }
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
      `SELECT a.name AS shift_area, s.title AS shift_title, s.starts_at, s.ends_at,
              g.name, g.phone, g.note, g.created_at
       FROM signups g JOIN shifts s ON s.id = g.shift_id JOIN areas a ON a.id = s.area_id
       ORDER BY s.starts_at, a.name, g.created_at`
    )
    .all();
}

export function listByToken(db, token) {
  if (!token) return [];
  return db
    .prepare(
      `SELECT g.id AS signup_id, g.name, g.note,
              a.name AS area_name, a.color AS area_color,
              s.title, s.starts_at, s.ends_at
       FROM signups g JOIN shifts s ON s.id = g.shift_id JOIN areas a ON a.id = s.area_id
       WHERE g.device_token = ?
       ORDER BY s.starts_at`
    )
    .all(token);
}

export function cancelOwnSignup(db, id, token) {
  const row = db.prepare('SELECT device_token FROM signups WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: 'not_found' };
  if (!token || row.device_token !== token) return { ok: false, reason: 'forbidden' };
  db.prepare('DELETE FROM signups WHERE id = ?').run(id);
  return { ok: true };
}
```

- [ ] **Step 4: Tests ausführen, Erfolg prüfen**

Run: `node --test tests/signups.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/signups.js tests/signups.test.js
git commit -m "feat: signups mit device_token, Meine-Schichten-Abfrage und Selbst-Abmelden

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Validierung — Bereiche, Generator, Schicht auf area_id

**Files:**
- Modify: `src/validate.js`
- Modify: `tests/validate.test.js`

**Interfaces:**
- Produces:
  - `validateAreaInput(body) -> { ok, value:{name,color,sort_order} } | { ok:false, errors }`
  - `validateShiftInput(body) -> { ok, value:{area_id,title,starts_at,ends_at,capacity,notes} } | { ok:false, errors }` (title optional → `null` wenn leer)
  - `validateGenerateInput(body) -> { ok, value:{area_id,title,date,from,to,slotMinutes,capacity,notes} } | { ok:false, errors }`
  - `validateSignupInput(body)` bleibt unverändert.

- [ ] **Step 1: Failing-Test schreiben**

Ergänze in `tests/validate.test.js`:

```js
import { validateAreaInput, validateGenerateInput, validateShiftInput } from '../src/validate.js';

test('validateAreaInput verlangt Name, setzt Farb-Default', () => {
  assert.equal(validateAreaInput({ name: '' }).ok, false);
  const v = validateAreaInput({ name: 'Küche', color: '', sort_order: '' });
  assert.equal(v.ok, true);
  assert.equal(v.value.name, 'Küche');
  assert.equal(v.value.color, '#888888');
  assert.equal(v.value.sort_order, 0);
});

test('validateShiftInput akzeptiert leeren Titel als null', () => {
  const v = validateShiftInput({ area_id: '3', title: '', starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00', capacity: '2' });
  assert.equal(v.ok, true);
  assert.equal(v.value.area_id, 3);
  assert.equal(v.value.title, null);
});

test('validateShiftInput lehnt fehlenden Bereich und Ende<=Start ab', () => {
  assert.equal(validateShiftInput({ area_id: '', starts_at: '2026-09-25T10:00', ends_at: '2026-09-25T11:00', capacity: '1' }).ok, false);
  assert.equal(validateShiftInput({ area_id: '1', starts_at: '2026-09-25T11:00', ends_at: '2026-09-25T10:00', capacity: '1' }).ok, false);
});

test('validateGenerateInput prüft Zeitfenster, Länge und Kapazität', () => {
  const v = validateGenerateInput({ area_id: '2', title: 'Frühdienst', date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '30', capacity: '3' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value, { area_id: 2, title: 'Frühdienst', date: '2026-09-25', from: '08:00', to: '10:00', slotMinutes: 30, capacity: 3, notes: null });
  assert.equal(validateGenerateInput({ area_id: '2', date: '2026-09-25', from: '10:00', to: '10:00', slot_minutes: '30', capacity: '3' }).ok, false);
  assert.equal(validateGenerateInput({ area_id: '2', date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '45', capacity: '3' }).ok, false);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/validate.test.js`
Expected: FAIL (neue Funktionen fehlen).

- [ ] **Step 3: `src/validate.js` erweitern**

Ersetze `validateShiftInput` und ergänze die neuen Funktionen (der Kopf mit `MAX`/`clean`/`orNull` und `validateSignupInput` bleibt unverändert):

```js
const ALLOWED_SLOTS = [30, 60, 90, 120];
const HEX = /^#[0-9a-fA-F]{6}$/;

export function validateAreaInput(body) {
  const errors = [];
  const name = clean(body.name);
  let color = clean(body.color);
  if (name === '') errors.push('Name ist erforderlich.');
  if (name.length > MAX) errors.push('Name ist zu lang.');
  if (color === '') color = '#888888';
  else if (!HEX.test(color)) errors.push('Farbe muss ein Hex-Wert wie #33aa88 sein.');
  const sort_order = Number.parseInt(body.sort_order, 10);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, color, sort_order: Number.isInteger(sort_order) ? sort_order : 0 } };
}

export function validateShiftInput(body) {
  const errors = [];
  const area_id = Number.parseInt(body.area_id, 10);
  const title = clean(body.title);
  const starts_at = clean(body.starts_at);
  const ends_at = clean(body.ends_at);
  const capacity = Number.parseInt(body.capacity, 10);

  if (!Number.isInteger(area_id) || area_id < 1) errors.push('Bereich ist erforderlich.');
  if (starts_at === '') errors.push('Startzeit ist erforderlich.');
  if (ends_at === '') errors.push('Endzeit ist erforderlich.');
  if (!Number.isInteger(capacity) || capacity < 1) errors.push('Kapazität muss mindestens 1 sein.');
  if (starts_at && ends_at && ends_at <= starts_at) errors.push('Ende muss nach dem Start liegen.');
  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { area_id, title: title === '' ? null : title.slice(0, MAX), starts_at, ends_at, capacity, notes: orNull(body.notes) } };
}

export function validateGenerateInput(body) {
  const errors = [];
  const area_id = Number.parseInt(body.area_id, 10);
  const title = clean(body.title);
  const date = clean(body.date);
  const from = clean(body.from);
  const to = clean(body.to);
  const slotMinutes = Number.parseInt(body.slot_minutes, 10);
  const capacity = Number.parseInt(body.capacity, 10);

  if (!Number.isInteger(area_id) || area_id < 1) errors.push('Bereich ist erforderlich.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Datum ist erforderlich.');
  if (!/^\d{2}:\d{2}$/.test(from)) errors.push('Startzeit ist erforderlich.');
  if (!/^\d{2}:\d{2}$/.test(to)) errors.push('Endzeit ist erforderlich.');
  if (from && to && to <= from) errors.push('Ende muss nach dem Start liegen.');
  if (!ALLOWED_SLOTS.includes(slotMinutes)) errors.push('Schichtlänge muss 30, 60, 90 oder 120 Minuten sein.');
  if (!Number.isInteger(capacity) || capacity < 1) errors.push('Plätze müssen mindestens 1 sein.');
  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { area_id, title: title === '' ? null : title.slice(0, MAX), date, from, to, slotMinutes, capacity, notes: orNull(body.notes) } };
}
```

- [ ] **Step 4: Tests ausführen, Erfolg prüfen**

Run: `node --test tests/validate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validate.js tests/validate.test.js
git commit -m "feat: Validierung für Bereiche, Generator und area_id-Schichten

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Admin — Bereiche verwalten (Routen + View)

**Files:**
- Modify: `src/routes/admin.js`
- Create: `src/views/admin-areas.eta`
- Modify: `tests/admin-routes.test.js`

**Interfaces:**
- Consumes: `listAreas/createArea/getArea/updateArea/deleteArea` (Task 1), `validateAreaInput` (Task 5).
- Produces Routen:
  - `GET /admin/areas` — Liste + Anlegen-Formular
  - `POST /admin/areas` — anlegen
  - `POST /admin/areas/:id` — aktualisieren
  - `POST /admin/areas/:id/delete` — löschen

- [ ] **Step 1: Failing-Test schreiben**

Hilfsfunktionen für Admin-Session findest du in `tests/admin-routes.test.js` (Login → Cookie → CSRF). Ergänze analog zum bestehenden Muster:

```js
test('Admin kann Bereich anlegen und sieht ihn in der Liste', async () => {
  const { app, db, cookie, csrf } = await adminSession(); // vorhandenes Muster der Datei nutzen
  const res = await app.inject({ method: 'POST', url: '/admin/areas',
    headers: { cookie }, payload: { csrf, name: 'Küche', color: '#ff8844', sort_order: '1' } });
  assert.equal(res.statusCode, 302);
  const list = await app.inject({ method: 'GET', url: '/admin/areas', headers: { cookie } });
  assert.match(list.body, /Küche/);
  await app.close();
});
```

> Hinweis: Falls `tests/admin-routes.test.js` noch keinen wiederverwendbaren `adminSession()`-Helfer hat, extrahiere die vorhandene Login-Logik (siehe bestehende Tests der Datei) in eine lokale `async function adminSession()`, die `{ app, db, cookie, csrf }` zurückgibt. Bestehende `createShift({ area: ... })`-Aufrufe in dieser Datei zusätzlich auf `seedArea`+`area_id` umstellen.

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/admin-routes.test.js`
Expected: FAIL (Route `/admin/areas` unbekannt → 404/302 auf Login).

- [ ] **Step 3: Routen in `src/routes/admin.js` ergänzen**

Oben die Imports erweitern:

```js
import { listAreas, createArea, getArea, updateArea, deleteArea } from '../repositories/areas.js';
import { validateAreaInput, validateGenerateInput } from '../validate.js';
import { generateShifts, areaStats, deleteShiftsByAreaDay, planSlots } from '../repositories/shifts.js';
```

(Die bestehende Zeile, die `validateShiftInput, validateSignupInput` importiert, um `validateAreaInput`/`validateGenerateInput` ergänzen oder die obige Zeile ergänzend hinzufügen — Doppelimporte vermeiden.)

Innerhalb `registerAdminRoutes(app)` ergänzen:

```js
app.get('/admin/areas', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  reply.type('text/html').send(app.render('admin-areas', {
    title: 'Bereiche', areas: listAreas(db), csrf: req.session.csrf, errors: [],
  }));
});

app.post('/admin/areas', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  if (!requireCsrf(req, reply)) return;
  const v = validateAreaInput(req.body);
  if (!v.ok) {
    return reply.code(200).type('text/html').send(app.render('admin-areas', {
      title: 'Bereiche', areas: listAreas(db), csrf: req.session.csrf, errors: v.errors,
    }));
  }
  createArea(db, v.value);
  return reply.redirect('/admin/areas');
});

app.post('/admin/areas/:id', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  if (!requireCsrf(req, reply)) return;
  const id = Number(req.params.id);
  if (!getArea(db, id)) return reply.code(404).send('Bereich nicht gefunden.');
  const v = validateAreaInput(req.body);
  if (v.ok) updateArea(db, id, v.value);
  return reply.redirect('/admin/areas');
});

app.post('/admin/areas/:id/delete', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  if (!requireCsrf(req, reply)) return;
  deleteArea(db, Number(req.params.id));
  return reply.redirect('/admin/areas');
});
```

- [ ] **Step 4: `src/views/admin-areas.eta` schreiben**

```html
<div class="admin">
  <div class="admin-bar">
    <h2>Bereiche</h2>
    <div class="admin-actions"><a href="/admin">← Dashboard</a></div>
  </div>
  <% if (it.errors && it.errors.length) { %>
    <div class="errors"><% it.errors.forEach(function(e){ %><p><%= e %></p><% }) %></div>
  <% } %>

  <form method="post" action="/admin/areas" class="area-form">
    <input type="hidden" name="csrf" value="<%= it.csrf %>">
    <input name="name" placeholder="Neuer Bereich (z.B. Küche)" required maxlength="500">
    <input type="color" name="color" value="#33aa88" aria-label="Farbe">
    <input type="number" name="sort_order" value="0" aria-label="Reihenfolge" style="width:5rem">
    <button type="submit">Anlegen</button>
  </form>

  <table>
    <thead><tr><th>Bereich</th><th>Farbe</th><th>Reihenfolge</th><th></th></tr></thead>
    <tbody>
    <% it.areas.forEach(function(a){ %>
      <tr>
        <form method="post" action="/admin/areas/<%= a.id %>" class="row-form">
          <input type="hidden" name="csrf" value="<%= it.csrf %>">
          <td><input name="name" value="<%= a.name %>" maxlength="500"></td>
          <td><input type="color" name="color" value="<%= a.color %>"></td>
          <td><input type="number" name="sort_order" value="<%= a.sort_order %>" style="width:5rem"></td>
          <td>
            <button type="submit">Speichern</button>
          </td>
        </form>
        <td>
          <form method="post" action="/admin/areas/<%= a.id %>/delete" class="inline"
                onsubmit="return confirm('Bereich und alle seine Schichten löschen?')">
            <input type="hidden" name="csrf" value="<%= it.csrf %>">
            <button type="submit" class="danger">Löschen</button>
          </form>
        </td>
      </tr>
    <% }) %>
    </tbody>
  </table>
</div>
```

- [ ] **Step 5: Tests ausführen, Erfolg prüfen**

Run: `node --test tests/admin-routes.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.js src/views/admin-areas.eta tests/admin-routes.test.js
git commit -m "feat: Admin-Bereichsverwaltung (CRUD + View)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Admin — Schicht-Generator (Routen + View), Einzel-Edit auf area_id

**Files:**
- Modify: `src/routes/admin.js`
- Create: `src/views/admin-generate.eta`
- Modify: `src/views/admin-shift-form.eta`
- Modify: `tests/admin-routes.test.js`

**Interfaces:**
- Consumes: `validateGenerateInput`, `generateShifts`, `planSlots`, `listAreas`, `validateShiftInput`, `updateShift`, `getShift`.
- Produces Routen:
  - `GET /admin/shifts/new` — Generator-Formular (ersetzt bisherige Einzel-Neu-Ansicht)
  - `POST /admin/shifts/generate` — Schichten erzeugen
  - `GET /admin/shifts/:id/edit` + `POST /admin/shifts/:id` — Einzel-Bearbeitung mit Bereichs-Dropdown

- [ ] **Step 1: Failing-Test schreiben**

```js
test('Generator erzeugt mehrere Schichten aus einem Zeitfenster', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const area_id = seedArea(db);
  const res = await app.inject({ method: 'POST', url: '/admin/shifts/generate',
    headers: { cookie }, payload: { csrf, area_id: String(area_id), title: 'Frühdienst',
      date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '30', capacity: '3', notes: '' } });
  assert.equal(res.statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 4);
  await app.close();
});

test('Generator mit ungültiger Schichtlänge zeigt Fehler (kein Redirect)', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const area_id = seedArea(db);
  const res = await app.inject({ method: 'POST', url: '/admin/shifts/generate',
    headers: { cookie }, payload: { csrf, area_id: String(area_id), date: '2026-09-25', from: '08:00', to: '10:00', slot_minutes: '45', capacity: '3' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Schichtlänge/);
  await app.close();
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/admin-routes.test.js`
Expected: FAIL (`/admin/shifts/generate` fehlt).

- [ ] **Step 3: Routen in `src/routes/admin.js` ersetzen/ergänzen**

Ersetze die bisherige `GET /admin/shifts/new`- und `POST /admin/shifts`-Route durch:

```js
app.get('/admin/shifts/new', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  reply.type('text/html').send(app.render('admin-generate', {
    title: 'Schichten erzeugen', areas: listAreas(db), csrf: req.session.csrf,
    values: { area_id: '', title: '', date: '', from: '', to: '', slot_minutes: '60', capacity: '2', notes: '' },
    errors: [], preview: null,
  }));
});

app.post('/admin/shifts/generate', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  if (!requireCsrf(req, reply)) return;
  const v = validateGenerateInput(req.body);
  if (!v.ok) {
    return reply.code(200).type('text/html').send(app.render('admin-generate', {
      title: 'Schichten erzeugen', areas: listAreas(db), csrf: req.session.csrf,
      values: req.body, errors: v.errors, preview: null,
    }));
  }
  const slots = planSlots(v.value);
  if (slots.length === 0) {
    return reply.code(200).type('text/html').send(app.render('admin-generate', {
      title: 'Schichten erzeugen', areas: listAreas(db), csrf: req.session.csrf,
      values: req.body, errors: ['Das Zeitfenster ist kürzer als eine Schicht.'], preview: null,
    }));
  }
  generateShifts(db, v.value);
  return reply.redirect('/admin');
});
```

Ersetze in der bestehenden `GET /admin/shifts/:id/edit`- und `POST /admin/shifts/:id`-Route die Übergabe an das Formular so, dass `areas` mitgegeben wird:

```js
app.get('/admin/shifts/:id/edit', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const shift = getShift(db, Number(req.params.id));
  if (!shift) return reply.code(404).send('Schicht nicht gefunden.');
  reply.type('text/html').send(app.render('admin-shift-form', {
    title: 'Schicht bearbeiten', csrf: req.session.csrf,
    action: `/admin/shifts/${shift.id}`, shift, areas: listAreas(db), errors: [],
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
      action: `/admin/shifts/${id}`, shift: { ...req.body, id }, areas: listAreas(db), errors: v.errors,
    }));
  }
  updateShift(db, id, v.value);
  return reply.redirect('/admin');
});
```

- [ ] **Step 4: `src/views/admin-generate.eta` schreiben**

```html
<div class="admin">
  <div class="admin-bar">
    <h2>Schichten erzeugen</h2>
    <div class="admin-actions"><a href="/admin">← Dashboard</a> · <a href="/admin/areas">Bereiche</a></div>
  </div>
  <% if (it.errors && it.errors.length) { %>
    <div class="errors"><% it.errors.forEach(function(e){ %><p><%= e %></p><% }) %></div>
  <% } %>
  <% if (!it.areas.length) { %>
    <p>Bitte lege zuerst einen <a href="/admin/areas">Bereich</a> an.</p>
  <% } else { %>
  <form method="post" action="/admin/shifts/generate" class="shift-form">
    <input type="hidden" name="csrf" value="<%= it.csrf %>">
    <label>Bereich
      <select name="area_id" required>
        <% it.areas.forEach(function(a){ %>
          <option value="<%= a.id %>" <%= String(a.id) === String(it.values.area_id) ? 'selected' : '' %>><%= a.name %></option>
        <% }) %>
      </select>
    </label>
    <label>Titel (optional) <input name="title" value="<%= it.values.title || '' %>"></label>
    <label>Datum <input type="date" name="date" value="<%= it.values.date || '' %>" required></label>
    <label>Von <input type="time" name="from" value="<%= it.values.from || '' %>" required></label>
    <label>Bis <input type="time" name="to" value="<%= it.values.to || '' %>" required></label>
    <label>Schichtlänge
      <select name="slot_minutes">
        <% [30,60,90,120].forEach(function(m){ %>
          <option value="<%= m %>" <%= String(m) === String(it.values.slot_minutes) ? 'selected' : '' %>><%= m %> min</option>
        <% }) %>
      </select>
    </label>
    <label>Plätze pro Schicht <input type="number" min="1" name="capacity" value="<%= it.values.capacity || 2 %>" required></label>
    <label>Notiz (optional, an alle) <input name="notes" value="<%= it.values.notes || '' %>"></label>
    <button type="submit">Schichten erzeugen</button>
    <a href="/admin">Abbrechen</a>
  </form>
  <% } %>
</div>
```

- [ ] **Step 5: `src/views/admin-shift-form.eta` auf Bereichs-Dropdown + optionalen Titel umstellen**

Ersetze die Zeilen für `area` und `title`:

```html
    <label>Bereich
      <select name="area_id" required>
        <% it.areas.forEach(function(a){ %>
          <option value="<%= a.id %>" <%= String(a.id) === String(it.shift.area_id) ? 'selected' : '' %>><%= a.name %></option>
        <% }) %>
      </select>
    </label>
    <label>Titel (optional) <input name="title" value="<%= it.shift.title || '' %>"></label>
```

- [ ] **Step 6: Tests ausführen, Erfolg prüfen**

Run: `node --test tests/admin-routes.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/admin.js src/views/admin-generate.eta src/views/admin-shift-form.eta tests/admin-routes.test.js
git commit -m "feat: Schicht-Generator (Zeitfenster + Länge) und Einzel-Edit mit Bereichs-Dropdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Admin — Dashboard mit Fortschrittsübersicht & Bulk-Delete

**Files:**
- Modify: `src/routes/admin.js`
- Modify: `src/views/admin-dashboard.eta`
- Modify: `src/views/admin-shift-detail.eta`
- Modify: `tests/admin-routes.test.js`

**Interfaces:**
- Consumes: `listShifts`, `areaStats`, `deleteShiftsByAreaDay`, `displayName`, `formatTime`, `formatDay`.
- Produces Routen:
  - `GET /admin` — Übersicht: Stats pro Bereich + Schichten gruppiert nach Bereich/Tag
  - `POST /admin/shifts/bulk-delete` — `area_id` + `day` löschen

- [ ] **Step 1: Failing-Test schreiben**

```js
test('Dashboard zeigt Fortschritt und Schichten', async () => {
  const { app, db, cookie } = await adminSession();
  const area_id = seedArea(db, { name: 'Küche' });
  await app.inject({ method: 'GET', url: '/admin', headers: { cookie } }); // warmup
  db.prepare(`INSERT INTO shifts (area_id,title,starts_at,ends_at,capacity,notes)
              VALUES (?,?,?,?,?,?)`).run(area_id, null, '2026-09-25T08:00', '2026-09-25T09:00', 2, null);
  const res = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
  assert.match(res.body, /Küche/);
  assert.match(res.body, /belegt/);
  await app.close();
});

test('Bulk-Delete entfernt einen Tag eines Bereichs', async () => {
  const { app, db, cookie, csrf } = await adminSession();
  const area_id = seedArea(db);
  db.prepare(`INSERT INTO shifts (area_id,title,starts_at,ends_at,capacity,notes)
              VALUES (?,?,?,?,?,?)`).run(area_id, null, '2026-09-25T08:00', '2026-09-25T09:00', 1, null);
  const res = await app.inject({ method: 'POST', url: '/admin/shifts/bulk-delete',
    headers: { cookie }, payload: { csrf, area_id: String(area_id), day: '2026-09-25' } });
  assert.equal(res.statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 0);
  await app.close();
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/admin-routes.test.js`
Expected: FAIL (kein „belegt"-Text / `/admin/shifts/bulk-delete` fehlt).

- [ ] **Step 3: `GET /admin` ersetzen + Bulk-Delete-Route ergänzen**

Oben Import ergänzen: `import { displayName, formatTime, formatDay } from '../display.js';`

```js
app.get('/admin', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const shifts = listShifts(db);
  // Gruppierung nach Bereich → Tag
  const groups = [];
  const index = new Map();
  for (const s of shifts) {
    const day = s.starts_at.slice(0, 10);
    const key = `${s.area_id}|${day}`;
    if (!index.has(key)) {
      const g = { area_id: s.area_id, area_name: s.area_name, area_color: s.area_color, day, dayLabel: formatDay(s.starts_at), items: [] };
      index.set(key, g); groups.push(g);
    }
    index.get(key).items.push({ ...s, time: `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}` });
  }
  reply.type('text/html').send(app.render('admin-dashboard', {
    title: 'Dashboard', stats: areaStats(db), groups, csrf: req.session.csrf,
  }));
});

app.post('/admin/shifts/bulk-delete', (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  if (!requireCsrf(req, reply)) return;
  deleteShiftsByAreaDay(db, Number(req.body.area_id), String(req.body.day));
  return reply.redirect('/admin');
});
```

- [ ] **Step 4: `src/views/admin-dashboard.eta` neu schreiben**

```html
<div class="admin">
  <div class="admin-bar">
    <h2>Dashboard</h2>
    <div class="admin-actions">
      <a href="/admin/shifts/new">+ Schichten erzeugen</a> ·
      <a href="/admin/areas">Bereiche</a> ·
      <a href="/admin/qr">QR</a> ·
      <a href="/admin/export.csv">CSV</a>
      <form method="post" action="/admin/logout" class="inline">
        <input type="hidden" name="csrf" value="<%= it.csrf %>"><button type="submit">Logout</button>
      </form>
    </div>
  </div>

  <section class="progress">
    <% it.stats.forEach(function(a){ var pct = a.capacity ? Math.round(a.taken*100/a.capacity) : 0; %>
      <div class="progress-row">
        <span class="dot" style="background:<%= a.color %>"></span>
        <strong><%= a.name %></strong>
        <span class="bar"><span class="bar-fill" style="width:<%= pct %>%;background:<%= a.color %>"></span></span>
        <span class="pct"><%= pct %>% belegt (<%= a.taken %>/<%= a.capacity %>) · <%= a.gaps %> Lücken</span>
      </div>
    <% }) %>
  </section>

  <% if (!it.groups.length) { %><p>Noch keine Schichten. <a href="/admin/shifts/new">Jetzt erzeugen.</a></p><% } %>

  <% it.groups.forEach(function(g){ %>
    <section class="day-group">
      <div class="day-head">
        <h3><span class="dot" style="background:<%= g.area_color %>"></span> <%= g.area_name %> · <%= g.dayLabel %></h3>
        <form method="post" action="/admin/shifts/bulk-delete" class="inline"
              onsubmit="return confirm('Alle Schichten dieses Bereichs an diesem Tag löschen?')">
          <input type="hidden" name="csrf" value="<%= it.csrf %>">
          <input type="hidden" name="area_id" value="<%= g.area_id %>">
          <input type="hidden" name="day" value="<%= g.day %>">
          <button type="submit" class="danger">Tag löschen</button>
        </form>
      </div>
      <table>
        <thead><tr><th>Zeit</th><th>Titel</th><th>Belegt</th><th></th></tr></thead>
        <tbody>
        <% g.items.forEach(function(s){ %>
          <tr class="<%= s.free <= 0 ? 'row-full' : (s.taken > 0 ? 'row-part' : 'row-empty') %>">
            <td><%= s.time %></td>
            <td><%= s.title || '—' %></td>
            <td><%= s.taken %>/<%= s.capacity %></td>
            <td><a href="/admin/shifts/<%= s.id %>">Details</a> · <a href="/admin/shifts/<%= s.id %>/edit">Bearb.</a></td>
          </tr>
        <% }) %>
        </tbody>
      </table>
    </section>
  <% }) %>
</div>
```

- [ ] **Step 5: `src/views/admin-shift-detail.eta` an area_id/Titel anpassen**

Öffne `src/views/admin-shift-detail.eta`. Ersetze eine etwaige Anzeige von `it.shift.area` (Text) durch den Bereichsnamen und mache den Titel optional. Falls die View den Bereichsnamen braucht, gib ihn in der `GET /admin/shifts/:id`-Route mit: erweitere dort das `shift`-Objekt um den Bereichsnamen:

```js
// in GET /admin/shifts/:id, nach getShift:
const area = getArea(db, shift.area_id);
// ... beim Rendern: shift: { ...shift, area_name: area ? area.name : '' }
```

und in der View statt `<%= it.shift.area %>` → `<%= it.shift.area_name %>`, sowie Titel-Anzeige auf `<%= it.shift.title || '' %>`.

- [ ] **Step 6: Tests ausführen, Erfolg prüfen**

Run: `node --test tests/admin-routes.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/admin.js src/views/admin-dashboard.eta src/views/admin-shift-detail.eta tests/admin-routes.test.js
git commit -m "feat: Admin-Dashboard mit Fortschrittsübersicht und Tag-Bulk-Delete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Öffentliche Seite — Bereichs-Tabs + Stundenplan, Cookie beim Eintragen

**Files:**
- Modify: `src/routes/public.js`
- Modify: `src/views/public-list.eta`
- Modify: `tests/public-routes.test.js`

**Interfaces:**
- Consumes: `listAreas` (Task 1), `listShifts` (Task 3), `displayName`/`formatTime`/`formatDay` (Task 2), `listSignupsByShift` (Task 4).
- Produces:
  - `GET /` — Tabs pro Bereich + je Bereich Stundenplan mit Eingetragenen (Anzeige „Vorname N.")
  - `POST /signup` — setzt `htoken`-Cookie und speichert `device_token`
  - Cookie-Name: `htoken`, `httpOnly:true, sameSite:'lax', secure:config.secureCookie, path:'/', maxAge:60*60*24*120`

- [ ] **Step 1: Failing-Test schreiben**

```js
import { seedArea } from './helpers.js';
import { createShift } from '../src/repositories/shifts.js';

test('GET / zeigt Bereichs-Tab und Schicht', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db, { name: 'Küche' });
  createShift(db, { area_id, title: null, starts_at: '2026-09-25T08:00', ends_at: '2026-09-25T09:00', capacity: 2, notes: null });
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.match(res.body, /Küche/);
  assert.match(res.body, /08:00/);
  await app.close();
});

test('POST /signup setzt htoken-Cookie und zeigt Namen gekürzt', async () => {
  const { app, db } = await makeApp();
  const area_id = seedArea(db);
  const id = createShift(db, { area_id, title: null, starts_at: '2026-09-25T18:00', ends_at: '2026-09-25T19:00', capacity: 2, notes: null });
  const cookie = await sessionCookie(app);
  const csrf = csrfFromDb(db);
  const res = await app.inject({ method: 'POST', url: '/signup',
    headers: { cookie }, payload: { csrf, shift_id: String(id), name: 'Kolja Kleinschmidt', phone: '', note: '' } });
  assert.equal(res.statusCode, 302);
  const setCookies = [].concat(res.headers['set-cookie'] ?? []).join(';');
  assert.match(setCookies, /htoken=/);
  const home = await app.inject({ method: 'GET', url: '/' });
  assert.match(home.body, /Kolja K\./);
  assert.doesNotMatch(home.body, /Kleinschmidt/);
  await app.close();
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/public-routes.test.js`
Expected: FAIL (kein Tab-Markup / kein `htoken` / voller Name sichtbar).

- [ ] **Step 3: `src/routes/public.js` neu schreiben**

```js
import { randomBytes } from 'node:crypto';
import { listShifts } from '../repositories/shifts.js';
import { listAreas } from '../repositories/areas.js';
import { createSignup, listSignupsByShift, listByToken, cancelOwnSignup } from '../repositories/signups.js';
import { validateSignupInput } from '../validate.js';
import { displayName, formatTime, formatDay } from '../display.js';
import { requireCsrf, rateLimiter } from '../server.js';

const HTOKEN_MAX_AGE = 60 * 60 * 24 * 120; // 120 Tage

function buildAreaGroups(db) {
  const areas = listAreas(db);
  const shifts = listShifts(db);
  const byArea = new Map(areas.map((a) => [a.id, { ...a, shifts: [] }]));
  for (const s of shifts) {
    const g = byArea.get(s.area_id);
    if (!g) continue;
    g.shifts.push({
      ...s,
      time: `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`,
      dayLabel: formatDay(s.starts_at),
      names: listSignupsByShift(db, s.id).map((x) => displayName(x.name)),
    });
  }
  return [...byArea.values()];
}

function render(app, req, extra) {
  return app.render('public-list', {
    title: 'Helfen', areas: buildAreaGroups(app.db), csrf: req.session.csrf,
    errors: [], values: {}, ...extra,
  });
}

export function registerPublicRoutes(app) {
  const db = app.db;
  const signupLimit = rateLimiter(app, {
    max: app.config.signupRateMax ?? 120, timeWindow: '1 minute', keyGenerator: () => 'signup',
  });

  app.get('/', (req, reply) => {
    reply.type('text/html').send(render(app, req, {}));
  });

  app.post('/signup', async (req, reply) => {
    if (!(await signupLimit(req, reply))) return;
    if (!requireCsrf(req, reply)) return;
    const result = validateSignupInput(req.body);
    const shiftId = Number.parseInt(req.body.shift_id, 10);
    if (!result.ok) {
      return reply.code(200).type('text/html').send(render(app, req, { errors: result.errors, values: req.body }));
    }
    let token = req.cookies?.htoken;
    if (!token) {
      token = randomBytes(16).toString('hex');
      reply.setCookie('htoken', token, {
        httpOnly: true, sameSite: 'lax', secure: app.config.secureCookie, path: '/', maxAge: HTOKEN_MAX_AGE,
      });
    }
    const created = createSignup(db, { shift_id: shiftId, ...result.value, device_token: token });
    if (!created.ok) {
      const msg = created.reason === 'full' ? 'Diese Schicht ist leider schon voll.' : 'Schicht nicht gefunden.';
      return reply.code(200).type('text/html').send(render(app, req, { errors: [msg], values: req.body }));
    }
    return reply.redirect('/danke');
  });

  app.get('/danke', (req, reply) => {
    reply.type('text/html').send(app.render('confirm', { title: 'Danke' }));
  });

  app.get('/meine', (req, reply) => {
    const token = req.cookies?.htoken;
    const items = listByToken(db, token).map((s) => ({
      ...s, time: `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`, dayLabel: formatDay(s.starts_at),
    }));
    reply.type('text/html').send(app.render('meine', { title: 'Meine Schichten', items, csrf: req.session.csrf }));
  });

  app.post('/signup/:id/cancel', (req, reply) => {
    if (!requireCsrf(req, reply)) return;
    cancelOwnSignup(db, Number(req.params.id), req.cookies?.htoken);
    return reply.redirect('/meine');
  });
}
```

- [ ] **Step 4: `src/views/public-list.eta` neu schreiben (Tabs + Stundenplan)**

```html
<% if (it.errors && it.errors.length) { %>
  <div class="errors"><% it.errors.forEach(function(e){ %><p><%= e %></p><% }) %></div>
<% } %>

<p class="intro">Trag dich für eine Schicht ein. Nur dein Vorname ist Pflicht.
  <a href="/meine">Meine Schichten →</a></p>

<% if (!it.areas.length) { %>
  <p>Aktuell sind keine Bereiche/Schichten ausgeschrieben.</p>
<% } else { %>
<div class="tabs" role="tablist">
  <% it.areas.forEach(function(a, i){ %>
    <button class="tab<%= i === 0 ? ' active' : '' %>" data-tab="area-<%= a.id %>"
            style="--tab-color:<%= a.color %>"><%= a.name %></button>
  <% }) %>
</div>

<% it.areas.forEach(function(a, i){ %>
  <section class="area-panel<%= i === 0 ? ' active' : '' %>" id="area-<%= a.id %>" style="--area-color:<%= a.color %>">
    <% if (!a.shifts.length) { %>
      <p class="empty">Für „<%= a.name %>" gibt es noch keine Schichten.</p>
    <% } %>
    <% a.shifts.forEach(function(s){ %>
      <div class="slot <%= s.free <= 0 ? 'slot-full' : 'slot-free' %>">
        <div class="slot-time"><span class="day"><%= s.dayLabel %></span><strong><%= s.time %></strong></div>
        <div class="slot-body">
          <% if (s.title) { %><div class="slot-title"><%= s.title %></div><% } %>
          <div class="slot-status">
            <% if (s.free > 0) { %><span class="free-badge"><%= s.free %> von <%= s.capacity %> frei</span>
            <% } else { %><span class="full-badge">Voll</span><% } %>
          </div>
          <% if (s.names.length) { %>
            <ul class="names"><% s.names.forEach(function(n){ %><li><%= n %></li><% }) %></ul>
          <% } %>
          <% if (s.notes) { %><p class="notes"><%= s.notes %></p><% } %>
          <% if (s.free > 0) { %>
            <form method="post" action="/signup" class="signup-form">
              <input type="hidden" name="csrf" value="<%= it.csrf %>">
              <input type="hidden" name="shift_id" value="<%= s.id %>">
              <input type="text" name="name" placeholder="Dein Vorname" required maxlength="500">
              <input type="tel" name="phone" placeholder="Telefon (optional)" maxlength="500">
              <button type="submit">Eintragen</button>
            </form>
          <% } %>
        </div>
      </div>
    <% }) %>
  </section>
<% }) %>

<script>
(function () {
  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.area-panel');
  function show(id) {
    panels.forEach(function (p) { p.classList.toggle('active', p.id === id); });
    tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.tab === id); });
    try { localStorage.setItem('kv-area', id); } catch (e) {}
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { show(t.dataset.tab); }); });
  try {
    var saved = localStorage.getItem('kv-area');
    if (saved && document.getElementById(saved)) show(saved);
  } catch (e) {}
  document.body.classList.add('js');
})();
</script>
<% } %>
```

- [ ] **Step 5: Tests ausführen, Erfolg prüfen**

Run: `node --test tests/public-routes.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/public.js src/views/public-list.eta tests/public-routes.test.js
git commit -m "feat: öffentlicher Stundenplan mit Bereichs-Tabs, gekürzte Namen, htoken-Cookie

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: „Meine Schichten"-View + Selbst-Abmelden

**Files:**
- Create: `src/views/meine.eta`
- Create: `tests/meine.test.js`

**Interfaces:**
- Consumes: `GET /meine`, `POST /signup/:id/cancel` (Task 9), `createSignup` mit `device_token` (Task 4).

- [ ] **Step 1: Failing-Test schreiben**

Create `tests/meine.test.js`:

```js
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
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `node --test tests/meine.test.js`
Expected: FAIL (`meine.eta` fehlt → Render-Fehler).

- [ ] **Step 3: `src/views/meine.eta` schreiben**

```html
<div class="meine">
  <div class="admin-bar">
    <h2>Meine Schichten</h2>
    <div class="admin-actions"><a href="/">← Zum Plan</a></div>
  </div>
  <% if (!it.items.length) { %>
    <p class="empty">Auf diesem Gerät bist du noch nicht eingetragen. Trag dich auf dem
      <a href="/">Schichtplan</a> ein — deine Anmeldungen erscheinen dann hier.</p>
    <p class="hint">Eintragungen von einem anderen Gerät kannst du hier nicht sehen oder abmelden —
      dafür bitte an einen Admin wenden.</p>
  <% } else { %>
    <ul class="mine-list">
      <% it.items.forEach(function(s){ %>
        <li class="mine-item" style="--area-color:<%= s.area_color %>">
          <div>
            <span class="dot" style="background:<%= s.area_color %>"></span>
            <strong><%= s.area_name %></strong><% if (s.title) { %> · <%= s.title %><% } %>
            <div class="mine-time"><%= s.dayLabel %>, <%= s.time %></div>
          </div>
          <form method="post" action="/signup/<%= s.signup_id %>/cancel" class="inline"
                onsubmit="return confirm('Von dieser Schicht abmelden?')">
            <input type="hidden" name="csrf" value="<%= it.csrf %>">
            <button type="submit" class="danger">Abmelden</button>
          </form>
        </li>
      <% }) %>
    </ul>
  <% } %>
</div>
```

- [ ] **Step 4: Tests ausführen, Erfolg prüfen**

Run: `node --test tests/meine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/meine.eta tests/meine.test.js
git commit -m "feat: Meine-Schichten-Ansicht mit gerätebasiertem Selbst-Abmelden

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: CSV-Export & Smoke-Test aktualisieren

**Files:**
- Modify: `tests/csv.test.js` (falls es alte `area`-Feldnamen prüft)
- Modify: `tests/smoke.test.js`
- Modify: `tests/app.test.js`
- Modify: `src/csv.js` (nur falls Spaltennamen an `shift_area` angepasst werden müssen)

**Interfaces:**
- Consumes: `listAllSignups` (Task 4, liefert weiterhin `shift_area`).

- [ ] **Step 1: Bestehende Tests sichten und auf area_id umstellen**

Öffne `tests/csv.test.js`, `tests/smoke.test.js`, `tests/app.test.js`. Ersetze jeden verbliebenen `createShift(db, { area: '...' , ... })`-Aufruf durch `seedArea`+`area_id` (Import `import { seedArea } from './helpers.js';`). Beispiel:

```js
const area_id = seedArea(db, { name: 'Bar' });
createShift(db, { area_id, title: 'Bar', starts_at: '2026-09-25T18:00', ends_at: '2026-09-25T20:00', capacity: 2, notes: null });
```

`src/csv.js` bleibt unverändert, solange es das Feld `shift_area` aus `listAllSignups` liest (tut es). Prüfe das und passe nur an, falls dort ein anderer Feldname erwartet wird.

- [ ] **Step 2: Gesamte Test-Suite ausführen**

Run: `npm test`
Expected: PASS — **alle** Testdateien grün. Behebe verbliebene `area`-Referenzen, bis nichts mehr fehlschlägt.

- [ ] **Step 3: Commit**

```bash
git add tests/csv.test.js tests/smoke.test.js tests/app.test.js src/csv.js
git commit -m "test: restliche Tests auf area_id-Schema umgestellt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Frontend — aufgeräumtes, mobil-zuerst dunkles Design

**Files:**
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: die CSS-Klassen aus den Views: `.tabs/.tab`, `.area-panel`, `.slot/.slot-free/.slot-full`, `.slot-time/.slot-body/.slot-title/.slot-status`, `.free-badge/.full-badge`, `.names`, `.progress/.progress-row/.bar/.bar-fill/.dot/.pct`, `.day-group/.day-head`, `.row-full/.row-part/.row-empty`, `.mine-list/.mine-item/.mine-time`, `.danger`, `.empty/.hint`.

- [ ] **Step 1: `public/styles.css` überarbeiten**

Ersetze die Datei durch ein aufgeräumtes, kontraststarkes dunkles, mobil-zuerst gestaltetes Stylesheet. Behalte Kopf/Logo/Motto-Stil grob bei, aber entferne das Ausgrauen (`opacity`) und sorge für klare Lesbarkeit:

```css
:root {
  --bg: #14161a;
  --surface: #1e2127;
  --surface-2: #262a32;
  --ink: #f2f4f8;
  --muted: #a5adba;
  --line: #333a44;
  --accent: #4fd1a5;
  --danger: #ff6b6b;
  --free: #4fd1a5;
  --radius: 12px;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5; -webkit-text-size-adjust: 100%;
}
main { max-width: 780px; margin: 0 auto; padding: 1rem; }
a { color: var(--accent); }

.site-header { text-align: center; padding: 1rem; border-bottom: 1px solid var(--line); background: #0f1114; }
.site-header .logo { max-width: 150px; height: auto; }
.site-header h1 { font-size: 1.3rem; letter-spacing: 1px; text-transform: uppercase; margin: .4rem 0 .2rem; }
.motto { display: inline-block; background: var(--accent); color: #06110c; padding: .1rem .5rem; border-radius: 6px; font-weight: 700; font-size: .85rem; }

h2, h3 { letter-spacing: .3px; }
.intro { color: var(--muted); }

/* Tabs */
.tabs { display: flex; gap: .4rem; overflow-x: auto; padding: .25rem 0 .6rem; -webkit-overflow-scrolling: touch; }
.tab {
  flex: 0 0 auto; padding: .55rem .9rem; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink);
  font: inherit; font-weight: 600; white-space: nowrap;
}
.tab.active { border-color: var(--tab-color, var(--accent)); box-shadow: inset 0 -3px 0 var(--tab-color, var(--accent)); }

/* Ohne JS: alle Panels sichtbar. Mit JS: nur aktives. */
.area-panel { display: block; margin: .5rem 0 1.25rem; }
body.js .area-panel { display: none; }
body.js .area-panel.active { display: block; }

/* Stundenplan-Blöcke */
.slot {
  display: flex; gap: .75rem; background: var(--surface); border: 1px solid var(--line);
  border-left: 4px solid var(--area-color, var(--line)); border-radius: var(--radius);
  padding: .75rem; margin: .55rem 0;
}
.slot-free { border-left-color: var(--free); }
.slot-full { background: var(--surface-2); }
.slot-time { min-width: 5.5rem; }
.slot-time .day { display: block; color: var(--muted); font-size: .8rem; }
.slot-time strong { font-size: 1.05rem; }
.slot-body { flex: 1; }
.slot-title { font-weight: 600; }
.free-badge { color: #06110c; background: var(--free); padding: .05rem .5rem; border-radius: 999px; font-size: .8rem; font-weight: 700; }
.full-badge { color: #fff; background: #55606e; padding: .05rem .5rem; border-radius: 999px; font-size: .8rem; font-weight: 700; }
.names { list-style: none; display: flex; flex-wrap: wrap; gap: .3rem; padding: .4rem 0 0; margin: 0; }
.names li { background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px; padding: .1rem .55rem; font-size: .85rem; }
.notes { color: var(--muted); font-size: .9rem; margin: .4rem 0 0; }
.empty, .hint { color: var(--muted); }

/* Formulare */
.signup-form { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .6rem; }
.signup-form input { flex: 1 1 8rem; }
input, select, button, textarea {
  font: inherit; padding: .6rem; border-radius: 8px; border: 1px solid var(--line);
  background: var(--surface-2); color: var(--ink);
}
input::placeholder { color: var(--muted); }
button { cursor: pointer; font-weight: 700; background: var(--accent); color: #06110c; border-color: transparent; }
button:hover { filter: brightness(1.08); }
button.danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); }

.errors { border: 1px solid var(--danger); color: #ffb3b3; background: rgba(255,107,107,.08); padding: .6rem; border-radius: 8px; margin: .5rem 0; }
.confirm { text-align: center; padding: 2rem 1rem; }

/* Admin */
.admin-bar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; justify-content: space-between; }
.admin-actions { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
.inline { display: inline; }
.dot { display: inline-block; width: .7rem; height: .7rem; border-radius: 50%; vertical-align: middle; }
table { width: 100%; border-collapse: collapse; margin: .6rem 0; }
th, td { border: 1px solid var(--line); padding: .5rem; text-align: left; font-size: .95rem; }
.row-full { color: var(--muted); }
.row-empty td { background: rgba(79,209,165,.06); }
.shift-form, .area-form { display: grid; gap: .55rem; max-width: 480px; }
.area-form { grid-auto-flow: column; grid-template-columns: 1fr auto auto auto; align-items: center; }
.shift-form label { display: grid; gap: .25rem; }

/* Fortschritt */
.progress { display: grid; gap: .5rem; margin: .75rem 0 1.25rem; }
.progress-row { display: grid; grid-template-columns: auto auto 1fr auto; gap: .5rem; align-items: center; }
.bar { height: .7rem; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.bar-fill { display: block; height: 100%; }
.pct { color: var(--muted); font-size: .85rem; white-space: nowrap; }
.day-group { margin: 1rem 0; }
.day-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }

/* Meine Schichten */
.mine-list { list-style: none; padding: 0; margin: .5rem 0; display: grid; gap: .5rem; }
.mine-item { display: flex; align-items: center; justify-content: space-between; gap: .75rem;
  background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--area-color, var(--line));
  border-radius: var(--radius); padding: .7rem .8rem; }
.mine-time { color: var(--muted); font-size: .88rem; }

.qr-page { text-align: center; }
.qr-img { max-width: 320px; width: 100%; height: auto; background: #fff; padding: .5rem; border-radius: 8px; }
.site-footer { text-align: center; padding: 1rem; color: var(--muted); font-size: .85rem; }

@media (max-width: 560px) {
  .slot { flex-direction: column; gap: .35rem; }
  .slot-time { min-width: 0; }
  .progress-row { grid-template-columns: auto 1fr; }
  .progress-row .pct { grid-column: 1 / -1; }
  .area-form { grid-auto-flow: row; grid-template-columns: 1fr; }
}
```

- [ ] **Step 2: App starten und visuell prüfen (mobil-Breite)**

Manueller Rauchtest: App lokal starten und `/` sowie `/admin` bei schmaler Fensterbreite ansehen (belegte Schichten müssen gut lesbar sein, Tabs umschaltbar). Verifikation der Funktion über die Test-Suite:

Run: `npm test`
Expected: PASS (gesamte Suite grün).

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "feat: aufgeräumtes, mobil-zuerst dunkles Design mit Tabs, Stundenplan, Fortschrittsbalken

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: End-to-End-Rauchtest & README-Notiz

**Files:**
- Modify: `README.md`
- Create: `tests/e2e-flow.test.js`

**Interfaces:**
- Consumes: alle vorigen Routen.

- [ ] **Step 1: E2E-Ablauftest schreiben**

Create `tests/e2e-flow.test.js`:

```js
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
```

- [ ] **Step 2: Test ausführen**

Run: `node --test tests/e2e-flow.test.js`
Expected: PASS.

- [ ] **Step 3: README um die neuen Konzepte ergänzen**

Ergänze in `README.md` einen kurzen Abschnitt: „Bereiche zuerst unter `/admin/areas` anlegen, dann Schichten unter `/admin/shifts/new` per Zeitfenster erzeugen. Die öffentliche Seite `/` zeigt pro Bereich einen Stundenplan; `/meine` zeigt gerätebasiert die eigenen Anmeldungen."

- [ ] **Step 4: Gesamte Suite ausführen**

Run: `npm test`
Expected: PASS — alle Tests grün.

- [ ] **Step 5: Commit**

```bash
git add README.md tests/e2e-flow.test.js
git commit -m "test: E2E-Ablauf Bereich→Generator→Anmeldung; README aktualisiert

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review-Ergebnis (vom Autor)

- **Spec-Abdeckung:** Bereiche (T1, T6); Generator (T3, T7); öffentl. Tabs+Stundenplan (T9, T12); Namen „Vorname N." (T2, T9); Nachschauen von jedem Gerät (öffentlicher Plan, T9); Meine Schichten + Selbst-Abmelden nur Cookie (T4, T9, T10); Admin-Fortschritt (T3, T8); Bulk-Delete (T3, T8); mobil-zuerst/lesbar (T12); CSV/QR erhalten (T8-Links, T11); Migration (T1).
- **Nicht-Ziele eingehalten:** kein „fast voll", keine Doppelbuchungswarnung, kein Helfer-Login, kein 2D-Raster, kein Hell/Dunkel-Schalter.
- **Typkonsistenz geprüft:** `area_id` durchgängig `number`; `slotMinutes` (JS) vs. Formularfeld `slot_minutes`; `device_token`/Cookie `htoken` konsistent; `listShifts` liefert `area_name/area_color/free/taken`, von Views/Stats genutzt.
- **Bekannte Abhängigkeit:** Task 6–8, 11 setzen einen wiederverwendbaren `adminSession()`-Helfer in `tests/admin-routes.test.js` voraus; falls nicht vorhanden, in Task 6 Step 1 aus der bestehenden Login-Logik extrahieren.
