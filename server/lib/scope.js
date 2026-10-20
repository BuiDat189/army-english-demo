import { has } from '../auth/middleware.js';
import { forbidden } from './http.js';

/** null = xem được tất cả lớp; mảng = chỉ các lớp mình dạy/trợ giảng/chủ nhiệm (CM) */
export function visibleClassIds(db, user) {
  if (has(user, 'classes.view')) return null;
  if (has(user, 'classes.view_own')) {
    return db.prepare('SELECT id FROM classes WHERE teacher_id = ? OR assistant_id = ? OR homeroom_id = ?').all(user.id, user.id, user.id).map((r) => r.id);
  }
  return [];
}

/** null = xem tất cả học viên; mảng = chỉ học viên thuộc lớp mình dạy (kể cả học bù trong buổi mình dạy) */
export function visibleStudentIds(db, user) {
  if (has(user, 'students.view')) return null;
  if (has(user, 'students.view_own')) {
    const rows = db.prepare(`
      SELECT DISTINCT e.student_id AS id FROM enrollments e JOIN classes c ON c.id = e.class_id
        WHERE (c.teacher_id = ? OR c.assistant_id = ? OR c.homeroom_id = ?) AND e.status IN ('active','completed','reserved','pending_class')
      UNION SELECT DISTINCT m.student_id FROM makeups m JOIN class_sessions s ON s.id = m.makeup_session_id
        WHERE (s.teacher_id = ? OR s.assistant_id = ?) AND m.status != 'cancelled'`).all(user.id, user.id, user.id, user.id, user.id);
    return rows.map((r) => r.id);
  }
  return [];
}

export function assertStudentVisible(db, user, studentId) {
  const ids = visibleStudentIds(db, user);
  if (ids !== null && !ids.includes(Number(studentId))) throw forbidden('Bạn chỉ xem được học viên thuộc lớp mình phụ trách.');
}

/** Buổi học có thuộc phạm vi điểm danh của người dùng không (giáo viên, trợ giảng buổi đó hoặc chủ nhiệm lớp) */
export function canMarkSession(user, session, db = null) {
  if (has(user, 'attendance.edit')) return true;
  if (!has(user, 'attendance.edit_own')) return false;
  if (session.teacher_id === user.id || session.assistant_id === user.id) return true;
  if (session.homeroom_id !== undefined) return session.homeroom_id === user.id;
  return !!(db && session.class_id && db.prepare('SELECT 1 FROM classes WHERE id = ? AND homeroom_id = ?').get(session.class_id, user.id));
}

export const inList = (ids) => (ids.length ? ids.join(',') : 'NULL');
