import { vnToday, startOfMonth, endOfMonth, addDays, vnRangeIso } from '../lib/time.js';
import { usersWithRole } from '../db/index.js';
import { OPEN_STATUSES, LEAD_STATUS } from './leads.js';
import { learningStats, FLAG_RATE } from './learning.js';
import { renewalDue, renewalWindows } from './packages.js';

// ===== KPI THEO QUY ĐỊNH TRUNG TÂM =====
// EC: tối thiểu 1 khách check-in mỗi ngày và 25 data tiềm năng mới mỗi tháng.
// CM: mỗi ngày điểm danh đủ các buổi đã dạy và chấm BTVN cho học viên có mặt.
// Màu: đạt ≥ 100% xanh · 60–99% vàng · dưới 60% đỏ.
export const KPI_TARGETS = { ecCheckinPerDay: 1, ecPotentialPerMonth: 25 };
export const KPI_RULES = [
  `Tư vấn viên (EC): tối thiểu ${KPI_TARGETS.ecCheckinPerDay} khách check-in/ngày và ${KPI_TARGETS.ecPotentialPerMonth} data tiềm năng mới/tháng.`,
  'Chủ nhiệm (CM): mỗi ngày điểm danh 100% buổi đã dạy và chấm BTVN 100% học viên có mặt.',
  'Màu nền: xanh khi đạt ≥ 100%, vàng 60–99%, đỏ dưới 60%.',
];
export const toneOf = (pct) => (pct === null ? 'neutral' : pct >= 100 ? 'good' : pct >= 60 ? 'warn' : 'bad');
const pctOf = (v, t) => (t ? Math.min(999, Math.round((v / t) * 100)) : null);

/** Chỉ số của một tư vấn viên (EC) */
export function ecStats(db, uid, { today = vnToday(), from = startOfMonth(today), to = endOfMonth(today) } = {}) {
  const mStart = startOfMonth(today);
  const checkinsToday = db.prepare(`SELECT COUNT(*) n FROM leads WHERE owner_id = ? AND substr(checked_in_at,1,10) = ?`).get(uid, today).n;
  const checkinsPeriod = db.prepare(`SELECT COUNT(*) n FROM leads WHERE owner_id = ? AND substr(checked_in_at,1,10) BETWEEN ? AND ?`).get(uid, from, to).n;
  const potentialMonth = db.prepare(`SELECT COUNT(*) n FROM leads WHERE created_by = ? AND created_at >= ? AND created_at < ?`).get(uid, ...vnRangeIso(mStart, endOfMonth(today))).n;
  const potentialPeriod = db.prepare(`SELECT COUNT(*) n FROM leads WHERE created_by = ? AND created_at >= ? AND created_at < ?`).get(uid, ...vnRangeIso(from, to)).n;
  const byStatus = Object.fromEntries(OPEN_STATUSES.map((s) => [s, 0]));
  for (const r of db.prepare(`SELECT status, COUNT(*) n FROM leads WHERE owner_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')}) GROUP BY status`).all(uid, ...OPEN_STATUSES)) byStatus[r.status] = r.n;
  const followDue = db.prepare(`SELECT COUNT(*) n FROM leads WHERE owner_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')}) AND substr(next_contact_at,1,10) <= ?`).get(uid, ...OPEN_STATUSES, today).n;
  const enrolled = db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE sold_by = ? AND kind = 'new' AND enrolled_at BETWEEN ? AND ? AND status NOT IN ('cancelled')`).get(uid, from, to).n;
  const revenue = db.prepare(`SELECT COALESCE(SUM(r.amount),0) s FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id WHERE e.sold_by = ? AND r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ?`).get(uid, from, to).s;
  const kpis = [
    { key: 'checkin_today', label: 'Check-in hôm nay', value: checkinsToday, target: KPI_TARGETS.ecCheckinPerDay, unit: 'khách' },
    { key: 'potential_month', label: 'Data tiềm năng tháng này', value: potentialMonth, target: KPI_TARGETS.ecPotentialPerMonth, unit: 'data' },
  ].map((k) => ({ ...k, pct: pctOf(k.value, k.target), tone: toneOf(pctOf(k.value, k.target)) }));
  return { kpis, checkinsToday, checkinsPeriod, potentialMonth, potentialPeriod, byStatus, followDue, enrolled, revenue };
}

/** Chỉ số của một chủ nhiệm (CM): lớp chủ nhiệm hoặc đang dạy */
export function cmStats(db, uid, { today = vnToday(), from = startOfMonth(today), to = endOfMonth(today) } = {}) {
  const classes = db.prepare(`SELECT id, code FROM classes WHERE status IN ('active','planned') AND (homeroom_id = ? OR teacher_id = ?)`).all(uid, uid);
  const ids = classes.map((c) => c.id);
  const inIds = ids.length ? ids.join(',') : 'NULL';
  const sessionsToday = db.prepare(`SELECT s.id, s.status, s.start_time, c.code AS class_code,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status IN ('present','late')) AS present,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status IN ('present','late') AND a.homework_status IS NOT NULL) AS graded
    FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE s.date = ? AND s.status != 'cancelled' AND s.class_id IN (${inIds}) ORDER BY s.start_time`).all(today);
  const total = sessionsToday.length;
  const marked = sessionsToday.filter((s) => s.status === 'done').length;
  const present = sessionsToday.reduce((t, s) => t + s.present, 0);
  const graded = sessionsToday.reduce((t, s) => t + s.graded, 0);
  // Học viên lớp mình: cảnh báo chuyên cần / BTVN < 90%
  const students = ids.length ? db.prepare(`SELECT DISTINCT e.student_id AS id FROM enrollments e WHERE e.class_id IN (${inIds}) AND e.status = 'active'`).all().map((x) => x.id) : [];
  const st = learningStats(db, students);
  let flagged = 0;
  for (const s of st.values()) if ((s.marked >= 4 && s.attendanceRate < FLAG_RATE) || (s.hwGraded >= 3 && s.homeworkDoneRate < FLAG_RATE)) flagged++;
  const renewals = db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE sold_by = ? AND kind = 'renew' AND enrolled_at BETWEEN ? AND ? AND status != 'cancelled'`).get(uid, from, to).n;
  const renewRevenue = db.prepare(`SELECT COALESCE(SUM(r.amount),0) s FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id WHERE e.sold_by = ? AND e.kind = 'renew' AND r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ?`).get(uid, from, to).s;
  const w = renewalWindows(today);
  const due = renewalDue(db, { from: w.thisMonth.from, to: w.thisMonth.to, today }).filter((d) => ids.includes(d.class_id));
  const resultsOverdue = db.prepare(`SELECT COUNT(*) n FROM class_events WHERE kind = 'test' AND status = 'done' AND results_returned_at IS NULL AND results_due < ? AND class_id IN (${inIds})`).get(today).n;
  const month = today.slice(0, 7);
  const eventsMissing = classes.filter((c) => !db.prepare(`SELECT 1 FROM class_events WHERE class_id = ? AND kind = 'test' AND status != 'cancelled' AND date LIKE ?`).get(c.id, `${month}%`)
    || !db.prepare(`SELECT 1 FROM class_events WHERE class_id = ? AND kind = 'parent_meeting' AND status != 'cancelled' AND date LIKE ?`).get(c.id, `${month}%`)).map((c) => c.code);
  const attPct = total ? pctOf(marked, total) : null;
  const hwPct = present ? pctOf(graded, present) : (total && marked === total ? 100 : null);
  const kpis = [
    { key: 'attendance_today', label: 'Điểm danh hôm nay', value: marked, target: total, unit: 'buổi', pct: attPct, tone: toneOf(attPct) },
    { key: 'homework_today', label: 'Chấm BTVN hôm nay', value: graded, target: present, unit: 'học viên', pct: hwPct, tone: toneOf(hwPct) },
  ];
  return { kpis, classes, sessionsToday, students: students.length, flagged, renewals, renewRevenue, renewalDue: due.length, resultsOverdue, eventsMissing };
}

/** "Đề xuất cần xử lý": việc được giao chưa xong, ưu tiên quá hạn / hôm nay */
export function proposalsFor(db, uid, today = vnToday()) {
  return db.prepare(`SELECT t.id, t.code, t.title, t.description, t.due_date, t.due_time, t.priority, t.status, t.related_type, t.related_id,
      CASE WHEN t.due_date < ? THEN 'overdue' WHEN t.due_date = ? THEN 'today' ELSE 'upcoming' END AS when_tag
    FROM tasks t WHERE t.assignee_id = ? AND t.status != 'done' AND (t.due_date IS NULL OR t.due_date <= ?)
    ORDER BY CASE WHEN t.due_date < ? THEN 0 WHEN t.due_date = ? THEN 1 ELSE 2 END, t.due_date, t.due_time LIMIT 12`).all(today, today, uid, addDays(today, 3), today, today);
}

/** Bảng KPI từng nhân sự của một phòng (EC hoặc CM) */
export function staffTable(db, dept, { from, to, today = vnToday() }) {
  if (dept === 'ec') {
    const ids = [...new Set([...usersWithRole(db, 'consultant'), ...usersWithRole(db, 'sales_lead')])];
    return ids.map((uid) => {
      const u = db.prepare('SELECT id, code, full_name, title FROM users WHERE id = ?').get(uid);
      const s = ecStats(db, uid, { today, from, to });
      // Ngày làm việc đã qua trong kỳ (trừ Chủ nhật) để so KPI check-in/ngày
      let days = 0;
      for (let d = from; d <= (to < today ? to : today); d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) days++;
      const checkinTarget = days * KPI_TARGETS.ecCheckinPerDay;
      return {
        ...u, checkins: s.checkinsPeriod, checkinTarget, checkinPct: pctOf(s.checkinsPeriod, checkinTarget), checkinTone: toneOf(pctOf(s.checkinsPeriod, checkinTarget)),
        potential: s.potentialPeriod, potentialPct: pctOf(s.potentialPeriod, KPI_TARGETS.ecPotentialPerMonth), potentialTone: toneOf(pctOf(s.potentialPeriod, KPI_TARGETS.ecPotentialPerMonth)),
        open: Object.values(s.byStatus).reduce((a, b) => a + b, 0), byStatus: s.byStatus, followDue: s.followDue, enrolled: s.enrolled, revenue: s.revenue,
      };
    }).sort((a, b) => b.revenue - a.revenue || b.checkins - a.checkins);
  }
  const ids = [...new Set(db.prepare(`SELECT homeroom_id AS id FROM classes WHERE status IN ('active','planned') AND homeroom_id IS NOT NULL`).all().map((x) => x.id))];
  return ids.map((uid) => {
    const u = db.prepare('SELECT id, code, full_name, title FROM users WHERE id = ?').get(uid);
    const s = cmStats(db, uid, { today, from, to });
    // Tỷ lệ điểm danh đúng ngày + chấm BTVN trong kỳ
    const inIds = s.classes.length ? s.classes.map((c) => c.id).join(',') : 'NULL';
    const ses = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status = 'done' AND substr(attendance_saved_at,1,10) <= date THEN 1 ELSE 0 END) ontime,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) done FROM class_sessions WHERE class_id IN (${inIds}) AND date BETWEEN ? AND ? AND date <= ? AND status != 'cancelled'`).get(from, to, today);
    const hw = db.prepare(`SELECT COUNT(*) present, SUM(CASE WHEN a.homework_status IS NOT NULL THEN 1 ELSE 0 END) graded FROM attendance a JOIN class_sessions s ON s.id = a.session_id
        WHERE s.class_id IN (${inIds}) AND s.date BETWEEN ? AND ? AND a.status IN ('present','late')`).get(from, to);
    const attPct = ses.total ? pctOf(ses.done || 0, ses.total) : null;
    const hwPct = hw.present ? pctOf(hw.graded || 0, hw.present) : null;
    return {
      ...u, classes: s.classes.length, classCodes: s.classes.map((c) => c.code), students: s.students, flagged: s.flagged,
      sessions: ses.total, marked: ses.done || 0, ontime: ses.ontime || 0, attendancePct: attPct, attendanceTone: toneOf(attPct),
      homeworkPct: hwPct, homeworkTone: toneOf(hwPct), renewals: s.renewals, renewRevenue: s.renewRevenue, renewalDue: s.renewalDue, resultsOverdue: s.resultsOverdue,
    };
  }).sort((a, b) => b.renewRevenue - a.renewRevenue || b.students - a.students);
}

export { LEAD_STATUS };
