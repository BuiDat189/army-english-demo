// Xuất CSV an toàn cho Excel/Google Sheets:
//  • BOM UTF-8 để hiển thị đúng tiếng Việt;
//  • chuỗi bắt đầu bằng = + - @ tab CR được thêm dấu ' phía trước để không bị hiểu là công thức (CSV injection);
//  • số giữ nguyên dạng số.
const DANGEROUS = /^[=+\-@\t\r]/;
const BOM = String.fromCharCode(0xfeff);

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (DANGEROUS.test(s)) s = `'${s}`;
  if (/[",\r\n;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function sendCsv(res, filename, columns, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(toCsv(columns, rows));
}
