import { hashPassword } from '../auth.js';

// Einzelrechte für Team-Accounts. Der Hauptadmin (is_owner) darf immer alles,
// zusätzlich Benutzer verwalten und alles zurücksetzen.
export const PERMISSIONS = [
  { key: 'shifts', label: 'Schichten erzeugen, bearbeiten und löschen' },
  { key: 'signups', label: 'Helfer:innen eintragen, bearbeiten und austragen' },
  { key: 'areas', label: 'Bereiche anlegen, bearbeiten und löschen' },
  { key: 'export', label: 'CSV-Export herunterladen (enthält Telefonnummern)' },
  { key: 'settings_view', label: 'Einstellungen ansehen' },
  { key: 'settings_edit', label: 'Einstellungen ändern (Name, Logo, Farbe …)' },
];
const PERM_KEYS = new Set(PERMISSIONS.map((p) => p.key));

function hydrate(row) {
  if (!row) return undefined;
  const perms = JSON.parse(row.perms || '[]').filter((p) => PERM_KEYS.has(p));
  const areaIds = row.area_ids == null ? null : JSON.parse(row.area_ids);
  return {
    ...row,
    is_owner: row.is_owner === 1,
    must_change_password: row.must_change_password === 1,
    perms,
    areaIds, // null = alle Bereiche
  };
}

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) n FROM users').get().n;
}

export function listUsers(db) {
  return db.prepare('SELECT * FROM users ORDER BY is_owner DESC, username').all().map(hydrate);
}

export function getUser(db, id) {
  return hydrate(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function getUserByName(db, username) {
  return hydrate(db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username));
}

export function createUser(db, { username, password, passwordHash, isOwner = false, perms = [], areaIds = null, mustChange = false }) {
  const info = db.prepare(`INSERT INTO users (username, password_hash, is_owner, perms, area_ids, must_change_password, created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    username, passwordHash ?? hashPassword(password), isOwner ? 1 : 0,
    JSON.stringify(perms.filter((p) => PERM_KEYS.has(p))), areaIds == null ? null : JSON.stringify(areaIds),
    mustChange ? 1 : 0, new Date().toISOString(),
  );
  return Number(info.lastInsertRowid);
}

export function updateUserAccess(db, id, { username, perms, areaIds }) {
  db.prepare('UPDATE users SET username = ?, perms = ?, area_ids = ? WHERE id = ? AND is_owner = 0')
    .run(username, JSON.stringify(perms.filter((p) => PERM_KEYS.has(p))), areaIds == null ? null : JSON.stringify(areaIds), id);
}

export function setPassword(db, id, password, { mustChange = false } = {}) {
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?')
    .run(hashPassword(password), mustChange ? 1 : 0, id);
}

export function deleteUser(db, id) {
  const user = getUser(db, id);
  if (!user || user.is_owner) return false;
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return true;
}

export function deleteSessionsOfUser(db, id, exceptSessionId = null) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?').run(id, exceptSessionId);
}

// Fügt einen neu angelegten Bereich dem Bereichs-Filter eines Accounts hinzu,
// damit er ihn nach dem Anlegen auch sieht.
export function grantArea(db, user, areaId) {
  if (!user || user.is_owner || user.areaIds == null) return;
  const ids = [...new Set([...user.areaIds, areaId])];
  db.prepare('UPDATE users SET area_ids = ? WHERE id = ?').run(JSON.stringify(ids), user.id);
}

// Erststart: gibt es noch keinen Account, wird der Hauptadmin angelegt –
// aus ADMIN_USER/ADMIN_PASSWORD_HASH (bestehende Installationen) oder
// als admin/admin mit Pflicht, das Passwort beim ersten Login zu ändern.
export function ensureOwner(db, config) {
  if (countUsers(db) > 0) return;
  if (config.adminUser && config.adminPasswordHash) {
    createUser(db, { username: config.adminUser, passwordHash: config.adminPasswordHash, isOwner: true });
  } else {
    createUser(db, { username: 'admin', password: 'admin', isOwner: true, mustChange: true });
  }
}

export function can(user, perm) {
  if (!user) return false;
  return user.is_owner || user.perms.includes(perm);
}

export function canSeeArea(user, areaId) {
  if (!user) return false;
  return user.is_owner || user.areaIds == null || user.areaIds.includes(Number(areaId));
}
