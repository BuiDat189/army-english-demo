// Định dạng theo chuẩn Việt Nam: ngày dd/MM/yyyy, giờ 24h, tiền VNĐ, múi giờ Asia/Ho_Chi_Minh.
const TZ = 'Asia/Ho_Chi_Minh';
const moneyFmt = new Intl.NumberFormat('vi-VN');
const NBSP = String.fromCharCode(160); // không để chữ "đ" rơi xuống dòng riêng
const dtParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const money = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${moneyFmt.format(n)}${NBSP}đ`);
export const num = (n) => (n === null || n === undefined ? '—' : moneyFmt.format(n));
export const moneyShort = (n) => {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
};

/** 'YYYY-MM-DD' → 'dd/MM/yyyy' */
export function date(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
}
/** ISO UTC → 'dd/MM/yyyy HH:mm' giờ VN */
export function dateTime(iso) {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(iso)) return `${date(iso.slice(0, 10))} ${iso.slice(11)}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return dtParts.format(d).replace(',', '');
}
export function vnDateOf(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function todayVN() { return vnDateOf(new Date().toISOString()); }

export function addDays(d, n) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function isoWeekday(d) { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; }
export function startOfWeek(d) { return addDays(d, 1 - isoWeekday(d)); }
export const WEEKDAYS = { 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật' };
export const WEEKDAYS_SHORT = { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' };
export function weekdayLabel(d) { return WEEKDAYS[isoWeekday(d)]; }

export function relativeDay(d, today = todayVN()) {
  if (!d) return '';
  const diff = Math.round((new Date(`${d.slice(0, 10)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Ngày mai';
  if (diff === -1) return 'Hôm qua';
  if (diff > 1 && diff < 7) return `${diff} ngày nữa`;
  if (diff < -1 && diff > -30) return `${-diff} ngày trước`;
  return date(d);
}

export function age(dob, today = todayVN()) {
  if (!dob) return null;
  let a = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  if (today.slice(5) < dob.slice(5, 10)) a--;
  return a;
}
export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts.at(-2)?.[0] || '') + (parts.at(-1)?.[0] || '')).toUpperCase();
}
/** Hiển thị số điện thoại dạng 0000 123 456 */
export function phone(p) {
  if (!p) return '—';
  return p.length === 10 ? [p.slice(0, 4), p.slice(4, 7), p.slice(7)].join(NBSP) : p;
}
/** Chuỗi số nhập kiểu 1.500.000 → 1500000 */
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  const digits = String(s ?? '').replace(/[^\d-]/g, '');
  return digits === '' || digits === '-' ? NaN : Number(digits);
}
