import { Router } from 'express';
import { can } from '../auth/middleware.js';
import { vnToday, periodRange } from '../lib/time.js';
import { usersWithRole } from '../db/index.js';
import { computeFinance } from '../services/finance.js';
import { leadLevels, LEVELS, renewalDue, renewalWindows } from '../services/packages.js';

// Hiệu suất đội ngũ: EC = tư vấn tuyển sinh (phễu L0–L5, doanh số), CM = chủ nhiệm lớp (sĩ số, đóng phí, tái phí)
export const PERFORMANCE_DEFINITIONS = {
  levels: 'L0 Mới · L1 Đã liên hệ · L2 Hẹn học thử · L3 Đã học thử · L4 Đã đăng ký nhưng chưa đóng đủ (đặt cọc/đóng một phần) · L5 Đã đóng đủ học phí. Khách "chưa phù hợp" không tính.',
  newFullfee: 'Đăng ký học viên MỚI do tư vấn viên tạo trong kỳ và đã đóng đủ học phí.',
  revenue: 'Tiền thực thu trong kỳ (phiếu thu đã xác nhận, không tính phiếu trừ số dư) của các đăng ký do tư vấn viên tạo; tách học viên mới và tái phí.',
  acs: 'ACS (sĩ số đóng đủ trung bình) = số học viên đóng đủ học phí ÷ số lớp đang phụ trách.',
  renewalDue: 'Học viên dự kiến hết học phí trong tháng này hoặc tháng sau, chưa tái phí.',
};

export function performanceRoutes({ db }) {
  const r = Router();

  r.get('/ec', can('performance.view'), (req, res) => {
    const today = vnToday();
    const { from, to } = periodRange(req.query.period || 'month', today, req.query.from, req.query.to);
    const ecIds = usersWithRole(db, 'consultant');
    const leads = db.prepare(`SELECT id, status, owner_id, converted_student_id FROM leads WHERE status != 'unfit'`).all();
    const levels = leadLevels(db, leads);
    const enrolls = db.prepare(`SELECT e.id, e.kind, e.enrolled_at, e.created_by, e.status FROM enrollments e WHERE e.status != 'cancelled'`).all();
    const fin = computeFinance(db, { enrollmentIds: enrolls.map((e) => e.id), today });
    const income = db.prepare(`SELECT r.amount, e.created_by, e.kind FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id
      WHERE r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ?`).all(from, to);
    const rows = ecIds.map((uid) => {
      const u = db.prepare('SELECT id, full_name, code FROM users WHERE id = ?').get(uid);
      const mine = leads.filter((l) => l.owner_id === uid);
      const counts = Object.fromEntries(LEVELS.map((l) => [l.key, 0]));
      for (const l of mine) { const lv = levels.get(l.id); if (lv) counts[lv]++; }
      const newFullfee = enrolls.filter((e) => e.created_by === uid && e.kind === 'new' && e.enrolled_at >= from && e.enrolled_at <= to && fin.get(e.id)?.debt === 0).length;
      const inc = income.filter((x) => x.created_by === uid);
      const salesNew = inc.filter((x) => x.kind === 'new').reduce((s, x) => s + x.amount, 0);
      const salesRenew = inc.filter((x) => x.kind === 'renew').reduce((s, x) => s + x.amount, 0);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return { ...u, total, ...counts, newFullfee, salesNew, salesRenew, revenue: salesNew + salesRenew, conversion: total ? Math.round((counts.L5 / total) * 1000) / 10 : 0 };
    }).sort((a, b) => b.revenue - a.revenue);
    res.json({ from, to, rows, levels: LEVELS, definitions: PERFORMANCE_DEFINITIONS });
  });

  r.get('/cm', can('performance.view'), (req, res) => {
    const today = vnToday();
    const classes = db.prepare(`SELECT c.id, c.code, c.homeroom_id FROM classes c WHERE c.status IN ('active','planned') AND c.homeroom_id IS NOT NULL`).all();
    const cmIds = [...new Set(classes.map((c) => c.homeroom_id))];
    const enrolls = db.prepare(`SELECT e.id, e.class_id, e.student_id FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.status = 'active' AND c.status IN ('active','planned')`).all();
    const fin = computeFinance(db, { enrollmentIds: enrolls.map((e) => e.id), today });
    const w = renewalWindows(today);
    const due = renewalDue(db, { from: w.thisMonth.from, to: w.nextMonth.to, today });
    const trials = db.prepare(`SELECT s.class_id, COUNT(*) n FROM trials t JOIN class_sessions s ON s.id = t.session_id WHERE t.status = 'scheduled' AND t.date >= ? GROUP BY s.class_id`).all(today);
    const trialBy = new Map(trials.map((t) => [t.class_id, t.n]));
    const rows = cmIds.map((uid) => {
      const u = db.prepare('SELECT id, full_name, code FROM users WHERE id = ?').get(uid);
      const mine = classes.filter((c) => c.homeroom_id === uid);
      const ids = new Set(mine.map((c) => c.id));
      const es = enrolls.filter((e) => ids.has(e.class_id));
      const fullfee = es.filter((e) => fin.get(e.id)?.debt === 0).length;
      const deposit = es.filter((e) => fin.get(e.id)?.debt > 0 && fin.get(e.id)?.paid > 0).length;
      const unpaid = es.filter((e) => fin.get(e.id)?.paid === 0 && fin.get(e.id)?.debt > 0).length;
      return {
        ...u, classes: mine.length, classCodes: mine.map((c) => c.code), students: es.length, trial: mine.reduce((s, c) => s + (trialBy.get(c.id) || 0), 0),
        deposit, unpaid, fullfee, acs: mine.length ? Math.round((fullfee / mine.length) * 100) / 100 : 0,
        renewThisMonth: due.filter((d) => ids.has(d.class_id) && d.expected_end <= w.thisMonth.to).length,
        renewNextMonth: due.filter((d) => ids.has(d.class_id) && d.expected_end >= w.nextMonth.from).length,
      };
    }).sort((a, b) => b.students - a.students);
    res.json({ rows, windows: w, definitions: PERFORMANCE_DEFINITIONS });
  });

  return r;
}
