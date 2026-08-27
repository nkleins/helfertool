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
    .map((s) => ({ ...s, free: Math.max(0, s.capacity - s.taken) }));
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
