import { vnToday, addDays, endOfMonth, addMonths, startOfMonth } from '../lib/time.js';
import { badRequest } from '../lib/http.js';
import { generateDates } from './schedule.js';
import { sessionUsage } from './attendance.js';
import { computeFinance } from './finance.js';
import { RENEWAL_THRESHOLD } from './reminders.js';

// ===== GÓI PHÍ & TÁI PHÍ =====
// Gói phí gắn với một khóa học: số buổi tính phí + buổi tặng, giá, loại NEW (học viên mới) hoặc TÁI PHÍ.
// Đăng ký là "tái phí" khi học viên đã từng có đăng ký khác (đang học, hoàn thành hoặc bảo lưu).
export const PACKAGE_KIND = { new: 'Mới', renew: 'Tái phí' };

export function packageRow(db, id) {
  return db.prepare('SELECT p.*, c.name AS course_name FROM fee_packages p JOIN courses c ON c.id = p.course_id WHERE p.id = ?').get(id);
}

/** Kiểm tra gói phí thuộc đúng khóa và còn bán */
export function resolvePackage(db, { packageId, courseId }) {
  const p = packageRow(db, packageId);
  if (!p || p.status !== 'active') throw badRequest('Gói phí không hợp lệ.', { package_id: 'Chọn gói phí đang áp dụng.' });
  if (p.course_id !== courseId) throw badRequest('Gói phí không thuộc khóa học đã chọn.', { package_id: 'Chọn gói phí của khóa học này.' });
  return p;
}

export function enrollmentKind(db, studentId, previousEnrollmentId = null) {
  if (previousEnrollmentId) return 'renew';
  const had = db.prepare(`SELECT 1 FROM enrollments WHERE student_id = ? AND status IN ('active','completed','reserved')`).get(studentId);
  return had ? 'renew' : 'new';
}

/**
 * Ngày dự kiến hết học phí (hết buổi) của các đăng ký đang học:
 * lấy buổi thứ N trong lịch sắp tới của lớp (N = số buổi còn lại); nếu lịch lớp không đủ buổi thì
 * kéo dài theo lịch tuần của lớp. Đăng ký chưa xếp lớp/bảo lưu: không tính được (null).
 */
export function expectedEndDates(db, enrollmentIds, { today = vnToday(), usage = null } = {}) {
  const out = new Map();
  if (!enrollmentIds.length) return out;
  const use = usage || sessionUsage(db, enrollmentIds);
  const rows = db.prepare(`SELECT e.id, e.status, e.class_id, c.schedule_json FROM enrollments e LEFT JOIN classes c ON c.id = e.class_id
    WHERE e.id IN (${enrollmentIds.map(() => '?').join(',')})`).all(...enrollmentIds);
  const futureByClass = new Map();
  for (const e of rows) {
    if (e.status !== 'active' || !e.class_id) { out.set(e.id, null); continue; }
    const remaining = use.get(e.id)?.remaining ?? 0;
    if (remaining <= 0) { out.set(e.id, today); continue; }
    if (!futureByClass.has(e.class_id)) {
      futureByClass.set(e.class_id, db.prepare(`SELECT date FROM class_sessions WHERE class_id = ? AND date >= ? AND status = 'scheduled' ORDER BY date, start_time`).all(e.class_id, today).map((x) => x.date));
    }
    const future = futureByClass.get(e.class_id);
    if (remaining <= future.length) { out.set(e.id, future[remaining - 1]); continue; }
    const pattern = JSON.parse(e.schedule_json || '[]');
    if (!pattern.length) { out.set(e.id, future.at(-1) || null); continue; }
    const extra = generateDates({ startDate: addDays(future.at(-1) || today, 1), pattern, count: remaining - future.length });
    out.set(e.id, extra.at(-1)?.date || null);
  }
  return out;
}

/**
 * Học viên tới hạn tái phí: đăng ký đang học có ngày dự kiến hết học phí trong khoảng [from, to]
 * hoặc còn ≤ RENEWAL_THRESHOLD buổi. Bỏ qua học viên đã có đăng ký tiếp theo (đã tái phí).
 */
export function renewalDue(db, { from, to, today = vnToday() }) {
  const active = db.prepare(`SELECT e.id, e.code, e.student_id, e.total_sessions, s.full_name AS student_name, s.code AS student_code, c.code AS class_code, c.id AS class_id,
      co.name AS course_name, c.homeroom_id, h.full_name AS homeroom_name
    FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses co ON co.id = e.course_id LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN users h ON h.id = c.homeroom_id
    WHERE e.status = 'active' AND NOT EXISTS (SELECT 1 FROM enrollments n WHERE n.previous_enrollment_id = e.id AND n.status != 'cancelled')`).all();
  const ids = active.map((e) => e.id);
  const usage = sessionUsage(db, ids);
  const ends = expectedEndDates(db, ids, { today, usage });
  return active.map((e) => ({ ...e, remaining: usage.get(e.id)?.remaining ?? e.total_sessions, expected_end: ends.get(e.id) }))
    .filter((e) => e.expected_end && e.expected_end >= from && e.expected_end <= to)
    .sort((a, b) => a.expected_end.localeCompare(b.expected_end));
}

export function renewalWindows(today = vnToday()) {
  const nextMonth = addMonths(startOfMonth(today), 1);
  return { thisMonth: { from: startOfMonth(today), to: endOfMonth(today) }, nextMonth: { from: nextMonth, to: endOfMonth(nextMonth) } };
}

// ===== PHỄU L0–L5 =====
// L0 Data (tiềm năng / lên hẹn / chăm sóc) · L1 Đăng ký check-in · L2 Đã check-in · L3 Học thử · L4 Đặt cọc / đóng một phần · L5 Đóng đủ học phí
export const LEVELS = [
  { key: 'L0', label: 'Data tư vấn' }, { key: 'L1', label: 'Đăng ký check-in' }, { key: 'L2', label: 'Đã check-in' },
  { key: 'L3', label: 'Học thử' }, { key: 'L4', label: 'Đặt cọc / đóng một phần' }, { key: 'L5', label: 'Đóng đủ học phí' },
];
const STATUS_LEVEL = { potential: 'L0', appointing: 'L0', nurturing: 'L0', checkin_booked: 'L1', checked_in: 'L2', trial_booked: 'L3', trial_done: 'L3' };

/** Cấp độ phễu của từng khách. Khách đã đăng ký: L5 nếu đăng ký đầu tiên đã đóng đủ, ngược lại L4. Khách "chưa phù hợp" không thuộc phễu. */
export function leadLevels(db, leads) {
  const out = new Map();
  const enrolled = leads.filter((l) => l.status === 'enrolled' && l.converted_student_id);
  const firstEnroll = new Map();
  for (const l of enrolled) {
    const e = db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND status != 'cancelled' ORDER BY enrolled_at, id LIMIT 1`).get(l.converted_student_id);
    if (e) firstEnroll.set(l.id, e.id);
  }
  const fin = firstEnroll.size ? computeFinance(db, { enrollmentIds: [...firstEnroll.values()] }) : new Map();
  for (const l of leads) {
    if (STATUS_LEVEL[l.status]) out.set(l.id, STATUS_LEVEL[l.status]);
    else if (l.status === 'enrolled') {
      const f = fin.get(firstEnroll.get(l.id));
      out.set(l.id, f && f.debt === 0 ? 'L5' : 'L4');
    } else out.set(l.id, null);
  }
  return out;
}

export { RENEWAL_THRESHOLD };
