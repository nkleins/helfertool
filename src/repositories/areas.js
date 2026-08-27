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
