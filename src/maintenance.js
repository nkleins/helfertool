// Hintergrund-Wartung: tägliches Backup der Datenbank und automatisches
// Löschen der Anmeldungen (Namen, Telefonnummern) nach der Veranstaltung.
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from './repositories/settings.js';
import { localNow } from './display.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const AUTO_DELETE_DAYS = 14;
const BACKUP_FILE = /^app-[\d-]+\.db$/;

// "YYYY-MM-DDTHH:MM" (Ortszeit wie in der DB) plus ganze Tage.
export function addDays(local, days) {
  const d = new Date(`${local}:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 16);
}

// Zeitpunkt, ab dem die Anmeldungen gelöscht werden – oder null, wenn das
// Löschen abgeschaltet ist oder es nichts zu löschen gibt.
export function autoDeleteDue(db) {
  if (getSettings(db).auto_delete !== '1') return null;
  if (db.prepare('SELECT COUNT(*) AS n FROM signups').get().n === 0) return null;
  const { last } = db.prepare('SELECT MAX(ends_at) AS last FROM shifts').get();
  return last ? addDays(last, AUTO_DELETE_DAYS) : null;
}

export function purgeExpiredSignups(db, nowLocal) {
  const due = autoDeleteDue(db);
  if (!due || nowLocal < due) return 0;
  return Number(db.prepare('DELETE FROM signups').run().changes);
}

// Schreibt eine konsistente Kopie der Datenbank und löscht ältere Backups,
// sodass immer nur das neueste (höchstens einen Tag alte) Backup existiert.
export function backupDb(db, dir, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const name = `app-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.db`;
  const target = path.join(dir, name);
  fs.rmSync(target, { force: true });
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  for (const file of fs.readdirSync(dir)) {
    if (file !== name && BACKUP_FILE.test(file)) fs.rmSync(path.join(dir, file), { force: true });
  }
  return target;
}

function newestBackupMs(dir) {
  if (!fs.existsSync(dir)) return 0;
  return Math.max(0, ...fs.readdirSync(dir)
    .filter((f) => BACKUP_FILE.test(f))
    .map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
}

// Prüft stündlich, ob gelöscht werden muss und ob ein neues Backup fällig ist.
export function startMaintenance(db, config, { intervalMs = 60 * 60 * 1000 } = {}) {
  const tick = () => {
    try {
      const removed = purgeExpiredSignups(db, localNow(config.timeZone));
      if (removed) console.log(`Datenschutz: ${removed} Anmeldungen ${AUTO_DELETE_DAYS} Tage nach der letzten Schicht gelöscht.`);
      if (config.backupDir && Date.now() - newestBackupMs(config.backupDir) >= DAY_MS) {
        console.log(`Backup geschrieben: ${backupDb(db, config.backupDir)}`);
      }
    } catch (err) {
      console.error('Wartung fehlgeschlagen:', err);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
