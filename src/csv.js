function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

const DEFAULT_HEADER = ['Bereich', 'Schicht', 'Beginn', 'Ende', 'Name', 'Telefon', 'Notiz'];

export function signupsCsv(rows, header = DEFAULT_HEADER) {
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      r.shift_area, r.shift_title, r.starts_at, r.ends_at, r.name, r.phone, r.note,
    ].map(cell).join(';'));
  }
  return lines.join('\n') + '\n';
}
