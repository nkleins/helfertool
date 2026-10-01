// Branding/Einstellungen als Key-Value in der DB, damit das Tool ohne
// Code-Änderung für andere Conventions nutzbar ist.
export const DEFAULT_SETTINGS = {
  event_name: 'Arbeitsbeschaffungsmaßnahmen',
  org_name: 'Kölnvention',
  motto: "Juggling's not dead · 25.–27.09.26",
  footer: 'Kölnvention e.V.',
  accent_color: '#4fd1a5',
  show_logo: '1',
};

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in s) s[r.key] = r.value;
  return s;
}

export function saveSettings(db, values) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in values) stmt.run(key, String(values[key] ?? ''));
  }
}

export function getLogo(db) {
  return db.prepare("SELECT mime, data, updated_at FROM uploads WHERE name = 'logo'").get();
}

// Nur der Zeitstempel (für Cache-Busting), ohne das Bild selbst zu laden.
export function getLogoVersion(db) {
  return db.prepare("SELECT updated_at FROM uploads WHERE name = 'logo'").get()?.updated_at ?? null;
}

export function setLogo(db, { mime, data }) {
  db.prepare(`INSERT INTO uploads (name, mime, data, updated_at) VALUES ('logo', ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`)
    .run(mime, data, new Date().toISOString());
}

export function clearLogo(db) {
  db.prepare("DELETE FROM uploads WHERE name = 'logo'").run();
}

// Nur Rastergrafiken (kein SVG → kein Skript-Einschleusen über das Logo).
export function detectImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
