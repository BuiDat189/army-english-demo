// Mọi ngày nghiệp vụ tính theo Asia/Ho_Chi_Minh (UTC+7, không có giờ mùa hè).
// Quy ước lưu trữ: ngày 'YYYY-MM-DD', giờ 'HH:MM', thời điểm (created_at…) là ISO UTC.

const TZ = 'Asia/Ho_Chi_Minh';
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

let clockOverride = null;
/** Cho phép test cố định "bây giờ". */
export function setClock(date) { clockOverride = date ? new Date(date) : null; }
export function now() { return clockOverride ? new Date(clockOverride) : new Date(); }
export function nowIso() { return now().toISOString(); }

function parts(d) {
  const o = {};
  for (const p of fmt.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD */
export function vnToday() {
  const p = parts(now());
  return `${p.year}-${p.month}-${p.day}`;
}
/** Giờ hiện tại theo giờ Việt Nam, dạng HH:MM */
export function vnTime() {
  const p = parts(now());
  return `${p.hour}:${p.minute}`;
}
export function vnDateOf(iso) {
  const p = parts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}`;
}

// Tính toán trên chuỗi ngày bằng UTC để tránh lệch múi giờ của máy chủ
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
/** 1 = Thứ 2 … 7 = Chủ nhật */
export function isoWeekday(date) {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}
export function startOfWeek(date) { return addDays(date, 1 - isoWeekday(date)); }
export function startOfMonth(date) { return `${date.slice(0, 7)}-01`; }
export function endOfMonth(date) {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}
export function diffDays(a, b) {
  return Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
}
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Khoảng thời gian theo kỳ lọc. Trả về {from, to} (bao gồm hai đầu) */
export function periodRange(period, today = vnToday(), from, to) {
  switch (period) {
    case 'today': return { from: today, to: today };
    case 'week': return { from: startOfWeek(today), to: addDays(startOfWeek(today), 6) };
    case 'last30': return { from: addDays(today, -29), to: today };
    case 'quarter': {
      const m = Number(today.slice(5, 7));
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      const f = `${today.slice(0, 4)}-${String(qStart).padStart(2, '0')}-01`;
      return { from: f, to: endOfMonth(addMonths(f, 2)) };
    }
    case 'last_month': {
      const f = addMonths(startOfMonth(today), -1);
      return { from: f, to: endOfMonth(f) };
    }
    case 'custom':
      if (isValidDate(from) && isValidDate(to) && from <= to) return { from, to };
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case 'month':
    default:
      return { from: startOfMonth(today), to: endOfMonth(today) };
  }
}

/** Ranh giới thời điểm UTC cho một khoảng ngày theo giờ VN: [bắt đầu, kết thúc) để so với cột ISO */
export function vnRangeIso(from, to) {
  return [new Date(`${from}T00:00:00+07:00`).toISOString(), new Date(`${addDays(to, 1)}T00:00:00+07:00`).toISOString()];
}
