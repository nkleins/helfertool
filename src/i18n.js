// Übersetzungen für Helferseiten und Admin-Bereich. Inhalte aus der Datenbank
// (Bereiche, Schichten, Branding) werden nicht übersetzt.
import de from './locales/de.js';
import en from './locales/en.js';

export const LANGS = ['de', 'en'];
export const messages = { de, en };

// t('schlüssel', { platzhalter }) – unbekannte Schlüssel (z.B. freie Titel) kommen
// unverändert zurück.
export function translator(lang) {
  const d = messages[lang] ?? messages.de;
  const t = (key, vars = {}) => String(d[key] ?? messages.de[key] ?? key ?? '')
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  t.list = (key) => d[key] ?? messages.de[key];
  return t;
}

// Sprache: gespeicherte Wahl (Cookie) > Browsersprache. Deutsch, wenn der
// Browser Deutsch bevorzugt oder nichts angibt, sonst Englisch.
export function pickLang(req) {
  const saved = req.cookies?.lang;
  if (LANGS.includes(saved)) return saved;
  const header = String(req.headers['accept-language'] ?? '').trim().toLowerCase();
  if (!header || header.startsWith('de') || header.startsWith('*')) return 'de';
  return 'en';
}
