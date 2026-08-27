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
