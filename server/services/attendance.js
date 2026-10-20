// ===== QUY TẮC TÍNH BUỔI (theo quy định trung tâm) =====
// Mỗi buổi CHÍNH KHÓA đã điểm danh đều trừ 1 buổi của gói — có mặt, đi muộn, nghỉ có phép hay không phép đều tính.
// Mỗi gói có số buổi nghỉ KHÔNG TÍNH PHÍ (gói 96 buổi: 4 buổi). Các buổi nghỉ đầu tiên trong hạn mức được hoàn lại.
// Buổi trung tâm cho nghỉ (nghỉ Tết sớm, cúp điện…) bị hủy và bù vào cuối khóa ⇒ không trừ học phí.
// Buổi học bù không trừ thêm (không đếm riêng).
export const SESSION_RULES = [
  'Có mặt hoặc Đi muộn: trừ 1 buổi.',
  'Nghỉ có phép hoặc không phép: đều tính là nghỉ và trừ 1 buổi.',
  'Mỗi gói có số buổi nghỉ không tính phí (gói 96 buổi: 4 buổi) — các buổi nghỉ trong hạn mức được hoàn lại.',
  'Trung tâm cho nghỉ (nghỉ lễ sớm, cúp điện…): buổi bị hủy và bù cuối khóa, không trừ học phí.',
  'Buổi học bù không trừ thêm.',
];

export const ATTENDANCE_LABEL = { present: 'Có mặt', late: 'Đi muộn', excused: 'Vắng có phép', absent: 'Vắng không phép' };

/** Tính số buổi đã dùng / còn lại cho các đăng ký. */
export function sessionUsage(db, enrollmentIds) {
  if (!enrollmentIds.length) return new Map();
  const ph = enrollmentIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT a.enrollment_id,
      COUNT(*) AS used,
      SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN a.status IN ('absent','excused') THEN 1 ELSE 0 END) AS absences,
      COUNT(*) AS marked
    FROM attendance a JOIN class_sessions s ON s.id = a.session_id
    WHERE a.is_makeup = 0 AND s.status != 'cancelled' AND a.enrollment_id IN (${ph})
    GROUP BY a.enrollment_id`).all(...enrollmentIds);
  const totals = db.prepare(`SELECT id, total_sessions, free_absences FROM enrollments WHERE id IN (${ph})`).all(...enrollmentIds);
  const map = new Map(totals.map((t) => [t.id, { total: t.total_sessions, used: 0, attended: 0, absences: 0, marked: 0, freeAbsences: t.free_absences, freeUsed: 0, freeLeft: t.free_absences, remaining: t.total_sessions }]));
  for (const r of rows) {
    const m = map.get(r.enrollment_id);
    const freeUsed = Math.min(r.absences, m.freeAbsences);
    const used = r.used - freeUsed;
    Object.assign(m, { used, attended: r.attended, absences: r.absences, marked: r.marked, freeUsed, freeLeft: m.freeAbsences - freeUsed, remaining: Math.max(0, m.total - used) });
  }
  return map;
}
