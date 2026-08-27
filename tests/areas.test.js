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
