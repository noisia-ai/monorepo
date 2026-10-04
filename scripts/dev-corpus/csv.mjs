export function parseCsv(input) {
  input = input.replace(/^\uFEFF/u, '');
  const first = input.split(/\r?\n/u, 1)[0];
  const delimiter = (first.match(/;/gu)?.length ?? 0) > (first.match(/,/gu)?.length ?? 0) ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === delimiter) { row.push(field); field = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('mfp_csv_unterminated_quote');
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...records] = rows;
  if (!header || new Set(header).size !== header.length) throw new Error('mfp_csv_header_invalid');
  if (records.some(record => record.length !== header.length)) throw new Error('mfp_csv_width_invalid');
  return { header, records: records.map(record => Object.fromEntries(header.map((key, i) => [key, record[i]]))) };
}
export function csv(header, rows) {
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [header.map(escape).join(','), ...rows.map(row => header.map(key => escape(row[key])).join(','))].join('\n') + '\n';
}
