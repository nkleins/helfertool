export function displayName(fullName) {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

export function formatTime(iso) {
  return (iso ?? '').slice(11, 16);
}

export function formatDay(iso) {
  const [y, m, d] = (iso ?? '').slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

// Aktuelle Ortszeit als "YYYY-MM-DDTHH:MM" (wie starts_at/ends_at gespeichert),
// unabhängig von der Zeitzone des Servers/Containers.
export function localNow(timeZone = 'Europe/Berlin', date = new Date()) {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
  return s.replace(' ', 'T');
}

// Schichten, deren Ende länger als graceMinutes zurückliegt, gelten als vergangen.
export function pastCutoff(nowLocal, graceMinutes = 60) {
  const d = new Date(`${nowLocal}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() - graceMinutes);
  return d.toISOString().slice(0, 16);
}
