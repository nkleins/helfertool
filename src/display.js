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
