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

export function validateShiftInput(body) {
  const errors = [];
  const area = clean(body.area);
  const title = clean(body.title);
  const starts_at = clean(body.starts_at);
  const ends_at = clean(body.ends_at);
  const capacity = Number.parseInt(body.capacity, 10);

  if (area === '') errors.push('Bereich ist erforderlich.');
  if (title === '') errors.push('Titel ist erforderlich.');
  if (starts_at === '') errors.push('Startzeit ist erforderlich.');
  if (ends_at === '') errors.push('Endzeit ist erforderlich.');
  if (!Number.isInteger(capacity) || capacity < 1) errors.push('Kapazität muss mindestens 1 sein.');
  if (starts_at && ends_at && ends_at <= starts_at) errors.push('Ende muss nach dem Start liegen.');
  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { area, title, starts_at, ends_at, capacity, notes: orNull(body.notes) } };
}
