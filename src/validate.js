const MAX = 500;
function clean(v) { return typeof v === 'string' ? v.trim() : ''; }
function orNull(v) { const s = clean(v); return s === '' ? null : s.slice(0, MAX); }

export function validateSignupInput(body) {
  const errors = [];
  const name = clean(body.name);
  if (name === '') errors.push('Name ist erforderlich.');
  if (name.length > MAX) errors.push('Name ist zu lang.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, phone: orNull(body.phone), note: orNull(body.note) } };
}

const ALLOWED_SLOTS = [30, 60, 90, 120, 180, 240, 300, 360, 420, 480];
const HEX = /^#[0-9a-fA-F]{6}$/;

export function validateAreaInput(body) {
  const errors = [];
  const name = clean(body.name);
  let color = clean(body.color);
  if (name === '') errors.push('Name ist erforderlich.');
  if (name.length > MAX) errors.push('Name ist zu lang.');
  if (color === '') color = '#888888';
  else if (!HEX.test(color)) errors.push('Farbe muss ein Hex-Wert wie #33aa88 sein.');
  const sort_order = Number.parseInt(body.sort_order, 10);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, color, sort_order: Number.isInteger(sort_order) ? sort_order : 0, description: orNull(body.description), name_en: orNull(body.name_en), description_en: orNull(body.description_en) } };
}

export function validateShiftInput(body) {
  const errors = [];
  const area_id = Number.parseInt(body.area_id, 10);
  const title = clean(body.title);
  const starts_at = clean(body.starts_at);
  const ends_at = clean(body.ends_at);
  const capacity = Number.parseInt(body.capacity, 10);

  if (!Number.isInteger(area_id) || area_id < 1) errors.push('Bereich ist erforderlich.');
  if (starts_at === '') errors.push('Startzeit ist erforderlich.');
  if (ends_at === '') errors.push('Endzeit ist erforderlich.');
  if (!Number.isInteger(capacity) || capacity < 1) errors.push('Kapazität muss mindestens 1 sein.');
  if (starts_at && ends_at && ends_at <= starts_at) errors.push('Ende muss nach dem Start liegen.');
  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { area_id, title: title === '' ? null : title.slice(0, MAX), starts_at, ends_at, capacity, notes: orNull(body.notes), is_orga: body.is_orga ? 1 : 0, requires_phone: body.requires_phone ? 1 : 0, title_en: orNull(body.title_en), notes_en: orNull(body.notes_en) } };
}

export function validateGenerateInput(body) {
  const errors = [];
  const area_id = Number.parseInt(body.area_id, 10);
  const title = clean(body.title);
  const date = clean(body.date);
  const from = clean(body.from);
  const to = clean(body.to);
  const slotMinutes = Number.parseInt(body.slot_minutes, 10);
  const capacity = Number.parseInt(body.capacity, 10);

  if (!Number.isInteger(area_id) || area_id < 1) errors.push('Bereich ist erforderlich.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Datum ist erforderlich.');
  if (!/^\d{2}:\d{2}$/.test(from)) errors.push('Startzeit ist erforderlich.');
  if (!/^\d{2}:\d{2}$/.test(to)) errors.push('Endzeit ist erforderlich.');
  // Bis < Von ist erlaubt und bedeutet "über Mitternacht" (Folgetag);
  // nur Bis == Von ist mehrdeutig und wird abgelehnt.
  if (from && to && to === from) errors.push('Start und Ende dürfen nicht gleich sein.');
  const onHalfHour = (t) => /^\d{2}:(00|30)$/.test(t);
  if ((from && !onHalfHour(from)) || (to && !onHalfHour(to))) {
    errors.push('Zeiten müssen zur vollen oder halben Stunde liegen (:00 oder :30).');
  }
  if (!ALLOWED_SLOTS.includes(slotMinutes)) errors.push('Ungültige Schichtlänge (30–120 min in 30er-Schritten, danach in Stunden bis 8 h).');
  if (!Number.isInteger(capacity) || capacity < 1) errors.push('Plätze müssen mindestens 1 sein.');
  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { area_id, title: title === '' ? null : title.slice(0, MAX), date, from, to, slotMinutes, capacity, notes: orNull(body.notes), is_orga: body.is_orga ? 1 : 0, requires_phone: body.requires_phone ? 1 : 0, title_en: orNull(body.title_en), notes_en: orNull(body.notes_en) } };
}

export function validateSettingsInput(body) {
  const errors = [];
  const event_name = clean(body.event_name);
  let accent_color = clean(body.accent_color);
  if (event_name === '') errors.push('Name der Veranstaltung/Seite ist erforderlich.');
  if (accent_color === '') accent_color = '#4fd1a5';
  else if (!HEX.test(accent_color)) errors.push('Akzentfarbe muss ein Hex-Wert wie #4fd1a5 sein.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: {
    event_name: event_name.slice(0, MAX),
    org_name: clean(body.org_name).slice(0, MAX),
    motto: clean(body.motto).slice(0, MAX),
    footer: clean(body.footer).slice(0, MAX),
    accent_color,
    show_logo: body.show_logo ? '1' : '0',
  } };
}

const MIN_PASSWORD = 8;

export function validateNewPassword(password, repeat) {
  const errors = [];
  const pw = typeof password === 'string' ? password : '';
  if (pw.length < MIN_PASSWORD) errors.push(`Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein.`);
  else if (pw.length > 200) errors.push('Passwort ist zu lang.');
  if (pw !== repeat) errors.push('Die beiden Passwörter stimmen nicht überein.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: pw };
}

const asList = (v) => (v == null ? [] : [].concat(v));

// Account-Formular: Name, Rechte-Haken und Bereichs-Auswahl.
export function validateUserInput(body, { requirePassword }) {
  const errors = [];
  const username = clean(body.username);
  if (username === '') errors.push('Benutzername ist erforderlich.');
  else if (username.length > 50) errors.push('Benutzername ist zu lang (max. 50 Zeichen).');
  const perms = asList(body.perms).map(String);
  const areaIds = body.area_scope === 'some'
    ? asList(body.areas).map((x) => Number.parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0)
    : null;
  let password;
  if (requirePassword) {
    const v = validateNewPassword(body.password, body.password);
    if (!v.ok) errors.push(...v.errors); else password = v.value;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { username, perms, areaIds, ...(password ? { password } : {}) } };
}
