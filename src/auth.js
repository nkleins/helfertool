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

export function createSession(db, { isAdmin = false, userId = null } = {}) {
  const id = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + THIRTY_DAYS).toISOString();
  // Abgelaufene Sessions bei der Gelegenheit aufräumen, damit die Tabelle nicht wächst.
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions (id,is_admin,csrf,expires_at,user_id) VALUES (?,?,?,?,?)')
    .run(id, isAdmin ? 1 : 0, csrf, expires_at, userId);
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
