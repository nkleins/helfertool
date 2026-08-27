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
