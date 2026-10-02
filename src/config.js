import path from 'node:path';
import { REPO_URL } from './project.js';

export function loadConfig(env = process.env) {
  const required = ['SESSION_SECRET', 'BASE_URL'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Fehlende ENV-Variablen: ${missing.join(', ')}`);
  const baseUrl = env.BASE_URL;
  const dbPath = env.DB_PATH ?? '/data/app.db';
  return {
    adminUser: env.ADMIN_USER,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    sessionSecret: env.SESSION_SECRET,
    baseUrl,
    port: Number.parseInt(env.PORT ?? '8080', 10),
    dbPath,
    // Tägliches Backup neben der Datenbank; BACKUP_DIR=off schaltet es ab.
    backupDir: env.BACKUP_DIR === 'off' || dbPath === ':memory:'
      ? null : (env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups')),
    secureCookie: baseUrl.startsWith('https'),
    timeZone: env.TIMEZONE ?? 'Europe/Berlin',
    // AGPL: Link zum Quellcode. Wer das Tool verändert betreibt, setzt hier sein eigenes Repo.
    sourceUrl: env.SOURCE_URL || REPO_URL,
  };
}
