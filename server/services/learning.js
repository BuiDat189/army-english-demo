import { vnToday, addDays, startOfMonth, endOfMonth } from '../lib/time.js';

// ===== HỌC TẬP: BTVN, điểm kiểm tra, nhận xét, bổ trợ =====
export const HOMEWORK_LABEL = { done: 'Hoàn thành', partial: 'Làm chưa đủ', missing: 'Không làm' };
export const ASSESSMENT_KIND = { unit: 'Kiểm tra unit', midterm: 'Giữa khóa', final: 'Cuối khóa', mock: 'Thi thử' };

// Ngưỡng cảnh báo theo quy định trung tâm: hoàn thành BTVN < 90% và chuyên cần < 90%
export const FLAG_RATE = 90;
export const SUPPORT_RULES = {
  attendanceRate: FLAG_RATE, // chuyên cần dưới 90%
  homeworkDoneRate: FLAG_RATE, // hoàn thành BTVN dưới 90%
  homeworkAvg: 6.5, // điểm BTVN trung bình dưới 6,5
  missingHomework: 2, // không làm BTVN từ 2 buổi trở lên trong tháng
  testAvg: 6.5, // điểm kiểm tra trung bình dưới 6,5 (quy về thang 10)
};
export const SUPPORT_RULE_TEXT = [
  `Chuyên cần dưới ${SUPPORT_RULES.attendanceRate}% trong tháng (khi đã có từ 4 buổi)`,
  `Hoàn thành BTVN dưới ${SUPPORT_RULES.homeworkDoneRate}% (khi đã chấm từ 3 buổi)`,
  `Điểm BTVN trung bình dưới ${String(SUPPORT_RULES.homeworkAvg).replace('.', ',')}`,
  `Không làm BTVN từ ${SUPPORT_RULES.missingHomework} buổi trở lên`,
  `Điểm kiểm tra trung bình dưới ${String(SUPPORT_RULES.testAvg).replace('.', ',')} (thang 10)`,
];

const round1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);

/**
 * Chỉ số học tập theo học viên trong khoảng ngày:
 * chuyên cần (%), tỉ lệ hoàn thành BTVN (%), điểm BTVN TB, số buổi không làm BTVN, điểm kiểm tra TB (thang 10).
 * Chỉ tính buổi chính khóa đã điểm danh, không tính buổi bị hủy.
 */
export function learningStats(db, studentIds, { from = '0000-01-01', to = '9999-12-31' } = {}) {
  const out = new Map();
  if (!studentIds.length) return out;
  const ph = studentIds.map(() => '?').join(',');
  const att = db.prepare(`SELECT a.student_id,
      COUNT(*) AS marked,
      SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN a.homework_status IS NOT NULL THEN 1 ELSE 0 END) AS hw_graded,
      SUM(CASE WHEN a.homework_status = 'done' THEN 1 ELSE 0 END) AS hw_done,
      SUM(CASE WHEN a.homework_status = 'missing' THEN 1 ELSE 0 END) AS hw_missing,
      AVG(a.homework_score) AS hw_avg
    FROM attendance a JOIN class_sessions s ON s.id = a.session_id
    WHERE a.is_makeup = 0 AND s.status != 'cancelled' AND s.date BETWEEN ? AND ? AND a.student_id IN (${ph})
    GROUP BY a.student_id`).all(from, to, ...studentIds);
  const tests = db.prepare(`SELECT student_id, AVG(score * 10.0 / max_score) AS avg, COUNT(*) AS n FROM assessments
    WHERE taken_at BETWEEN ? AND ? AND student_id IN (${ph}) GROUP BY student_id`).all(from, to, ...studentIds);
  const testBy = new Map(tests.map((t) => [t.student_id, t]));
  for (const id of studentIds) out.set(id, { marked: 0, hwGraded: 0, attendanceRate: null, homeworkDoneRate: null, homeworkAvg: null, missingHomework: 0, testAvg: null, tests: 0 });
  for (const r of att) {
    out.set(r.student_id, {
      marked: r.marked,
      attendanceRate: r.marked ? Math.round((r.attended / r.marked) * 100) : null,
      homeworkDoneRate: r.hw_graded ? Math.round((r.hw_done / r.hw_graded) * 100) : null, hwGraded: r.hw_graded,
      homeworkAvg: round1(r.hw_avg),
      missingHomework: r.hw_missing,
      testAvg: null, tests: 0,
    });
  }
  for (const [id, t] of testBy) Object.assign(out.get(id), { testAvg: round1(t.avg), tests: t.n });
  return out;
}

/** Lý do cần bổ trợ theo ngưỡng; rỗng nếu không cần */
export function supportReasons(st) {
  const r = [];
  if (st.attendanceRate !== null && st.marked >= 4 && st.attendanceRate < SUPPORT_RULES.attendanceRate) r.push(`Chuyên cần ${st.attendanceRate}%`);
  if (st.homeworkDoneRate !== null && st.hwGraded >= 3 && st.homeworkDoneRate < SUPPORT_RULES.homeworkDoneRate) r.push(`Hoàn thành BTVN ${st.homeworkDoneRate}%`);
  if (st.homeworkAvg !== null && st.homeworkAvg < SUPPORT_RULES.homeworkAvg) r.push(`Điểm BTVN TB ${String(st.homeworkAvg).replace('.', ',')}`);
  if (st.missingHomework >= SUPPORT_RULES.missingHomework) r.push(`Không làm BTVN ${st.missingHomework} buổi`);
  if (st.testAvg !== null && st.testAvg < SUPPORT_RULES.testAvg) r.push(`Điểm kiểm tra TB ${String(st.testAvg).replace('.', ',')}`);
  return r;
}

/** Danh sách rà soát bổ trợ của một tháng: học viên đang học + chỉ số tháng + lý do gợi ý + quyết định đã ghi (nếu có) */
export function supportList(db, month, { studentIds = null } = {}) {
  const from = `${month}-01`;
  const to = endOfMonth(from);
  let students = db.prepare(`SELECT DISTINCT s.id, s.code, s.full_name, c.code AS class_code, c.id AS class_id, h.full_name AS homeroom_name
    FROM students s JOIN enrollments e ON e.student_id = s.id AND e.status = 'active' LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN users h ON h.id = c.homeroom_id
    WHERE s.status = 'active' ORDER BY s.full_name`).all();
  if (studentIds) students = students.filter((s) => studentIds.includes(s.id));
  // Một học viên học nhiều lớp: gộp mã lớp
  const by = new Map();
  for (const s of students) {
    if (!by.has(s.id)) by.set(s.id, { ...s, classes: [] });
    if (s.class_code) by.get(s.id).classes.push(s.class_code);
  }
  const list = [...by.values()];
  const stats = learningStats(db, list.map((s) => s.id), { from, to });
  const reviews = new Map(db.prepare(`SELECT r.*, u.full_name AS decided_by_name, c.code AS case_code, c.status AS case_status FROM support_reviews r
    LEFT JOIN users u ON u.id = r.decided_by LEFT JOIN care_cases c ON c.id = r.case_id WHERE r.month = ?`).all(month).map((r) => [r.student_id, r]));
  return list.map((s) => {
    const st = stats.get(s.id);
    const reasons = supportReasons(st);
    const review = reviews.get(s.id) || null;
    return { ...s, stats: st, reasons, suggested: reasons.length > 0, review, state: review ? review.status : reasons.length ? 'needed' : 'ok' };
  });
}

/** Việc học tập cần làm: buổi đã dạy chưa chấm BTVN/nhận xét và học viên không làm BTVN gần đây */
export function learningTodo(db, { today = vnToday(), classIds = null, days = 14 } = {}) {
  const scope = classIds === null ? '' : `AND s.class_id IN (${classIds.length ? classIds.join(',') : 'NULL'})`;
  const ungraded = db.prepare(`SELECT s.id, s.date, s.start_time, s.homework, c.code AS class_code, c.id AS class_id, t.full_name AS teacher_name,
      SUM(CASE WHEN a.homework_status IS NULL THEN 1 ELSE 0 END) AS missing_grade,
      SUM(CASE WHEN a.comment IS NULL OR a.comment = '' THEN 1 ELSE 0 END) AS missing_comment,
      COUNT(*) AS present
    FROM class_sessions s JOIN classes c ON c.id = s.class_id JOIN attendance a ON a.session_id = s.id AND a.status IN ('present','late')
    LEFT JOIN users t ON t.id = s.teacher_id
    WHERE s.status = 'done' AND s.date BETWEEN ? AND ? ${scope}
    GROUP BY s.id HAVING missing_grade > 0 OR missing_comment > 0 ORDER BY s.date DESC, s.start_time DESC`).all(addDays(today, -7), today);
  const missing = db.prepare(`SELECT st.id AS student_id, st.full_name, st.code, c.code AS class_code, COUNT(*) AS times, MAX(s.date) AS last_date
    FROM attendance a JOIN class_sessions s ON s.id = a.session_id JOIN students st ON st.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE a.homework_status = 'missing' AND s.date BETWEEN ? AND ? ${scope}
    GROUP BY st.id, c.code ORDER BY times DESC, last_date DESC`).all(addDays(today, -days), today);
  return { ungraded, missing };
}

export function monthOf(date = vnToday()) { return startOfMonth(date).slice(0, 7); }
