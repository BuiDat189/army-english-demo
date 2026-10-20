import { addDays, isoWeekday, toMinutes } from '../lib/time.js';

/** Học viên thuộc một buổi: học viên của lớp (đăng ký đang học) + học viên học bù được xếp vào buổi. */
export function sessionStudentIds(db, sessionId) {
  const s = db.prepare('SELECT id, class_id, date FROM class_sessions WHERE id = ?').get(sessionId);
  if (!s) return [];
  const ids = new Set();
  if (s.class_id) {
    for (const r of db.prepare(`SELECT student_id FROM enrollments WHERE class_id = ? AND status IN ('active','completed')
        AND (class_joined_at IS NULL OR class_joined_at <= ?)`).all(s.class_id, s.date)) ids.add(r.student_id);
  }
  for (const r of db.prepare(`SELECT student_id FROM makeups WHERE makeup_session_id = ? AND status != 'cancelled'`).all(sessionId)) ids.add(r.student_id);
  return [...ids];
}

const overlap = (aStart, aEnd, bStart, bEnd) => toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);

/**
 * Kiểm tra trùng lịch cho một khoảng thời gian.
 * Kiểm tra: phòng, giáo viên, trợ giảng (một người không thể ở hai buổi cùng lúc dù ở vai trò nào),
 * học viên, và lịch học thử/kiểm tra đầu vào độc lập. Buổi đã hủy không chiếm lịch.
 */
export function findConflicts(db, { date, start, end, roomId, teacherId, assistantId, studentIds = [], excludeSessionId = null, excludeTrialId = null }) {
  const conflicts = [];
  const people = [teacherId, assistantId].filter(Boolean);
  const sessions = db.prepare(`SELECT s.*, c.code AS class_code, c.name AS class_name, r.name AS room_name
      FROM class_sessions s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN rooms r ON r.id = s.room_id
      WHERE s.date = ? AND s.status != 'cancelled' AND s.id != ?`).all(date, excludeSessionId || 0)
    .filter((s) => overlap(start, end, s.start_time, s.end_time));
  const name = (id) => db.prepare('SELECT full_name FROM users WHERE id = ?').get(id)?.full_name || `#${id}`;
  for (const s of sessions) {
    const label = `${s.class_code || s.title || 'Buổi học bù'} (${s.start_time}–${s.end_time})`;
    if (roomId && s.room_id === roomId) conflicts.push({ type: 'room', message: `Phòng ${s.room_name} đã có ${label}.`, sessionId: s.id });
    for (const p of people) {
      if (p === s.teacher_id || p === s.assistant_id) {
        conflicts.push({ type: 'staff', message: `${name(p)} đã được phân công ${label}.`, sessionId: s.id });
      }
    }
    if (studentIds.length) {
      const inSession = new Set(sessionStudentIds(db, s.id));
      for (const sid of studentIds) {
        if (inSession.has(sid)) {
          const st = db.prepare('SELECT full_name FROM students WHERE id = ?').get(sid);
          conflicts.push({ type: 'student', message: `Học viên ${st?.full_name} đã có lịch ${label}.`, sessionId: s.id });
        }
      }
    }
  }
  // Lịch học thử / kiểm tra đầu vào không gắn vào buổi có sẵn
  const trials = db.prepare(`SELECT t.*, l.student_name FROM trials t JOIN leads l ON l.id = t.lead_id
      WHERE t.date = ? AND t.status = 'scheduled' AND t.session_id IS NULL AND t.id != ?`).all(date, excludeTrialId || 0)
    .filter((t) => overlap(start, end, t.start_time, t.end_time));
  for (const t of trials) {
    const label = `${t.type === 'placement' ? 'kiểm tra đầu vào' : 'học thử'} của ${t.student_name} (${t.start_time}–${t.end_time})`;
    if (roomId && t.room_id === roomId) conflicts.push({ type: 'room', message: `Phòng đã được đặt cho ${label}.` });
    for (const p of people) if (p === t.teacher_id) conflicts.push({ type: 'staff', message: `${name(p)} đã có lịch ${label}.` });
  }
  return conflicts;
}

/** Sinh danh sách buổi theo lịch tuần cho tới khi đủ số buổi. */
export function generateDates({ startDate, pattern, count, maxDays = 400 }) {
  const out = [];
  if (!pattern.length) return out;
  let d = startDate;
  for (let i = 0; i < maxDays && out.length < count; i++, d = addDays(d, 1)) {
    const wd = isoWeekday(d);
    for (const p of pattern.filter((x) => x.weekday === wd).sort((a, b) => a.start.localeCompare(b.start))) {
      if (out.length < count) out.push({ date: d, start: p.start, end: p.end });
    }
  }
  return out;
}

export const WEEKDAY_LABEL = { 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật' };
export function describePattern(pattern) {
  return pattern.map((p) => `${WEEKDAY_LABEL[p.weekday]} ${p.start}–${p.end}`).join(', ');
}
