export function createArea(db, { name, color = '#888888', sort_order = 0, description = null, name_en = null, description_en = null }) {
  const info = db
    .prepare('INSERT INTO areas (name, color, sort_order, description, name_en, description_en) VALUES (?,?,?,?,?,?)')
    .run(name, color, sort_order, description ?? null, name_en ?? null, description_en ?? null);
  return Number(info.lastInsertRowid);
}

export function listAreas(db) {
  return db.prepare('SELECT * FROM areas ORDER BY sort_order, name').all();
}

export function getArea(db, id) {
  return db.prepare('SELECT * FROM areas WHERE id = ?').get(id);
}

export function updateArea(db, id, { name, color, sort_order, description = null, name_en = null, description_en = null }) {
  db.prepare('UPDATE areas SET name=?, color=?, sort_order=?, description=?, name_en=?, description_en=? WHERE id=?')
    .run(name, color, sort_order, description ?? null, name_en ?? null, description_en ?? null, id);
}

export function deleteArea(db, id) {
  db.prepare('DELETE FROM areas WHERE id = ?').run(id);
}
