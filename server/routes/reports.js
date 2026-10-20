import { Router } from 'express';
import { has } from '../auth/middleware.js';
import { forbidden, notFound } from '../lib/http.js';
import { vnToday, periodRange, vnRangeIso, diffDays } from '../lib/time.js';
import { sendCsv } from '../lib/csv.js';
import { computeFinance, PAYMENT_STATUS_LABEL } from '../services/finance.js';
import { ATTENDANCE_LABEL } from '../services/attendance.js';
import { LEAD_STATUS } from './leads.js';
import { METHOD_LABEL } from './finance.js';
import { TASK_STATUS } from './tasks.js';
import { APPROVAL_TYPES } from '../services/approvals.js';
import { visibleStudentIds, inList } from '../lib/scope.js';
import { learningStats, supportReasons } from '../services/learning.js';
import { renewalDue, PACKAGE_KIND } from '../services/packages.js';
import { staffTable, KPI_RULES } from '../services/kpi.js';
import { cashIn } from '../services/wallet.js';
import { addDays, addMonths, startOfMonth, endOfMonth } from '../lib/time.js';
import { ISSUE_STATUS } from './assets.js';

/** Ngày hoàn tất học phí của các đăng ký (ngày phiếu thu làm tổng đã thu chạm số phải thu) */
function completionDates(db) {
  const enr = db.prepare(`SELECT e.id, e.kind, e.tuition_fee - COALESCE((SELECT SUM(amount) FROM discounts d WHERE d.enrollment_id = e.id AND d.status = 'approved'),0) AS net
    FROM enrollments e WHERE e.status NOT IN ('cancelled','pending_approval')`).all();
  const rc = db.prepare(`SELECT enrollment_id, amount, paid_at FROM receipts WHERE status = 'confirmed' ORDER BY paid_at, id`).all();
  const by = new Map();
  for (const r of rc) { if (!by.has(r.enrollment_id)) by.set(r.enrollment_id, []); by.get(r.enrollment_id).push(r); }
  const out = [];
  for (const e of enr) {
    let sum = 0;
    for (const r of by.get(e.id) || []) { sum += r.amount; if (sum >= e.net) { out.push({ id: e.id, kind: e.kind, date: r.paid_at, first: (by.get(e.id)[0] === r) }); break; } }
  }
  return out;
}

/** Công nợ cuối ngày d: phải thu sau giảm − đã thu tới ngày d của các đăng ký đã duyệt, chưa hủy */
function debtAsOf(db, d) {
  return db.prepare(`SELECT COALESCE(SUM(MAX(0, e.tuition_fee - COALESCE((SELECT SUM(amount) FROM discounts x WHERE x.enrollment_id = e.id AND x.status = 'approved'),0)
      - COALESCE((SELECT SUM(amount) FROM receipts r WHERE r.enrollment_id = e.id AND r.status = 'confirmed' AND r.paid_at <= ?),0))),0) s
    FROM enrollments e WHERE e.status NOT IN ('cancelled','pending_approval') AND e.enrolled_at <= ?`).get(d, d).s;
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const vnDate = (d) => (d ? d.split('-').reverse().join('/') : '');

// Mỗi báo cáo: quyền cần có + hàm dựng dữ liệu từ CÙNG nguồn nghiệp vụ với các màn hình
const REPORTS = {
  enrollment: {
    perm: 'reports.enrollment', title: 'Báo cáo tuyển sinh',
    build(db, { from, to }) {
      const [a, b] = vnRangeIso(from, to);
      const rows = db.prepare(`SELECT source,
          COUNT(*) AS leads,
          SUM(CASE WHEN status = 'enrolled' THEN 1 ELSE 0 END) AS enrolled,
          SUM(CASE WHEN status = 'unfit' THEN 1 ELSE 0 END) AS unfit,
          SUM(CASE WHEN status IN ('potential','appointing','checkin_booked','checked_in','trial_booked','trial_done','nurturing') THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM trials t WHERE t.lead_id = leads.id AND t.status = 'done') THEN 1 ELSE 0 END) AS trialed
        FROM leads WHERE created_at >= ? AND created_at < ? GROUP BY source ORDER BY leads DESC`).all(a, b)
        .map((r) => ({ ...r, conversion: pct(r.enrolled, r.leads) }));
      const byCourse = db.prepare(`SELECT co.name AS course, SUM(CASE WHEN e.previous_enrollment_id IS NULL THEN 1 ELSE 0 END) AS new_count,
          SUM(CASE WHEN e.previous_enrollment_id IS NOT NULL THEN 1 ELSE 0 END) AS renewal_count, COUNT(*) AS total
        FROM enrollments e JOIN courses co ON co.id = e.course_id WHERE e.enrolled_at BETWEEN ? AND ? GROUP BY co.id ORDER BY total DESC`).all(from, to);
      const totals = rows.reduce((t, r) => ({ leads: t.leads + r.leads, enrolled: t.enrolled + r.enrolled, unfit: t.unfit + r.unfit, open: t.open + r.open, trialed: t.trialed + r.trialed }), { leads: 0, enrolled: 0, unfit: 0, open: 0, trialed: 0 });
      totals.conversion = pct(totals.enrolled, totals.leads);
      return {
        columns: [
          { key: 'source', label: 'Nguồn' }, { key: 'leads', label: 'Khách mới', type: 'number' }, { key: 'trialed', label: 'Đã học thử', type: 'number' },
          { key: 'enrolled', label: 'Đã đăng ký', type: 'number' }, { key: 'unfit', label: 'Chưa phù hợp', type: 'number' }, { key: 'open', label: 'Đang tư vấn', type: 'number' },
          { key: 'conversion', label: 'Tỷ lệ chuyển đổi (%)', type: 'percent' },
        ],
        rows, totals: { source: 'Tổng', ...totals },
        extra: { title: 'Đăng ký khóa trong kỳ theo khóa học', columns: [{ key: 'course', label: 'Khóa học' }, { key: 'new_count', label: 'Học viên mới', type: 'number' }, { key: 'renewal_count', label: 'Tái đăng ký', type: 'number' }, { key: 'total', label: 'Tổng', type: 'number' }], rows: byCourse },
        note: 'Khách mới tính theo ngày tạo hồ sơ trong kỳ; trạng thái là trạng thái hiện tại của hồ sơ.',
      };
    },
  },
  attendance: {
    perm: 'reports.attendance', title: 'Báo cáo điểm danh',
    build(db, { from, to }) {
      const rows = db.prepare(`SELECT c.code AS class_code, c.name AS class_name, t.full_name AS teacher,
          COUNT(DISTINCT CASE WHEN s.status = 'done' THEN s.id END) AS sessions,
          SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
          SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
          SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
          SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
          COUNT(a.id) AS marks,
          COUNT(DISTINCT CASE WHEN s.status = 'cancelled' THEN s.id END) AS cancelled
        FROM classes c LEFT JOIN users t ON t.id = c.teacher_id
        JOIN class_sessions s ON s.class_id = c.id AND s.date BETWEEN ? AND ?
        LEFT JOIN attendance a ON a.session_id = s.id AND a.is_makeup = 0
        GROUP BY c.id ORDER BY c.code`).all(from, to).map((r) => ({ ...r, rate: pct(r.present + r.late, r.marks) }));
      const makeups = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN m.status = 'done' THEN 1 ELSE 0 END) done FROM makeups m JOIN class_sessions s ON s.id = m.makeup_session_id WHERE s.date BETWEEN ? AND ? AND m.status != 'cancelled'`).get(from, to);
      const totals = rows.reduce((t, r) => { for (const k of ['sessions', 'present', 'late', 'excused', 'absent', 'marks', 'cancelled']) t[k] = (t[k] || 0) + r[k]; return t; }, {});
      totals.rate = pct((totals.present || 0) + (totals.late || 0), totals.marks || 0);
      return {
        columns: [
          { key: 'class_code', label: 'Lớp' }, { key: 'teacher', label: 'Giáo viên' }, { key: 'sessions', label: 'Buổi đã dạy', type: 'number' }, { key: 'cancelled', label: 'Buổi hủy', type: 'number' },
          { key: 'present', label: ATTENDANCE_LABEL.present, type: 'number' }, { key: 'late', label: ATTENDANCE_LABEL.late, type: 'number' },
          { key: 'excused', label: ATTENDANCE_LABEL.excused, type: 'number' }, { key: 'absent', label: ATTENDANCE_LABEL.absent, type: 'number' },
          { key: 'rate', label: 'Tỷ lệ đi học (%)', type: 'percent' },
        ],
        rows, totals: { class_code: 'Tổng', ...totals },
        note: `Tỷ lệ đi học = (Có mặt + Đi muộn) / tổng lượt điểm danh chính khóa. Học bù trong kỳ: ${makeups.n || 0} lượt, đã học ${makeups.done || 0}.`,
      };
    },
  },
  finance: {
    perm: 'reports.finance', title: 'Báo cáo học phí & công nợ',
    build(db, { from, to, today }) {
      const byCourse = db.prepare(`SELECT co.name AS course, COUNT(r.id) AS receipts, COALESCE(SUM(r.amount),0) AS amount,
          COALESCE(SUM(CASE WHEN r.method = 'cash' THEN r.amount END),0) AS cash, COALESCE(SUM(CASE WHEN r.method = 'transfer' THEN r.amount END),0) AS transfer,
          COALESCE(SUM(CASE WHEN r.method = 'card' THEN r.amount END),0) AS card
        FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id JOIN courses co ON co.id = e.course_id
        WHERE r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ? GROUP BY co.id ORDER BY amount DESC`).all(from, to);
      const tp = db.prepare(`SELECT COUNT(*) AS receipts, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(CASE WHEN method = 'cash' THEN amount END),0) AS cash,
          COALESCE(SUM(CASE WHEN method = 'transfer' THEN amount END),0) AS transfer, COALESCE(SUM(CASE WHEN method = 'card' THEN amount END),0) AS card
        FROM wallet_entries WHERE kind = 'topup' AND status = 'confirmed' AND paid_at BETWEEN ? AND ?`).get(from, to);
      if (tp.receipts) byCourse.push({ course: 'Nạp tiền vào số dư (chưa gắn khóa)', ...tp });
      const fin = computeFinance(db, { today });
      const aging = { 'Chưa đến hạn': 0, 'Sắp đến hạn (≤7 ngày)': 0, 'Quá hạn 1–7 ngày': 0, 'Quá hạn 8–30 ngày': 0, 'Quá hạn > 30 ngày': 0 };
      let debt = 0;
      for (const f of fin.values()) {
        debt += f.debt;
        for (const i of f.installments) {
          if (!i.remaining || i.status === 'waived') continue;
          if (i.status === 'overdue') {
            const d = diffDays(today, i.due_date);
            aging[d <= 7 ? 'Quá hạn 1–7 ngày' : d <= 30 ? 'Quá hạn 8–30 ngày' : 'Quá hạn > 30 ngày'] += i.remaining;
          } else if (i.status === 'due_soon') aging['Sắp đến hạn (≤7 ngày)'] += i.remaining;
          else aging['Chưa đến hạn'] += i.remaining;
        }
      }
      const totals = byCourse.reduce((t, r) => ({ receipts: t.receipts + r.receipts, amount: t.amount + r.amount, cash: t.cash + r.cash, transfer: t.transfer + r.transfer, card: t.card + r.card }), { receipts: 0, amount: 0, cash: 0, transfer: 0, card: 0 });
      return {
        columns: [
          { key: 'course', label: 'Khóa học' }, { key: 'receipts', label: 'Số phiếu', type: 'number' }, { key: 'cash', label: METHOD_LABEL.cash, type: 'money' },
          { key: 'transfer', label: METHOD_LABEL.transfer, type: 'money' }, { key: 'card', label: METHOD_LABEL.card, type: 'money' }, { key: 'amount', label: 'Thực thu', type: 'money' },
        ],
        rows: byCourse, totals: { course: 'Tổng', ...totals },
        extra: { title: `Tuổi nợ tại ${vnDate(today)} — tổng công nợ ${debt.toLocaleString('vi-VN')} đ`, columns: [{ key: 'bucket', label: 'Nhóm' }, { key: 'amount', label: 'Số tiền', type: 'money' }], rows: Object.entries(aging).map(([bucket, amount]) => ({ bucket, amount })) },
        note: 'Thực thu = phiếu thu đã xác nhận có ngày thu trong kỳ (không gồm phiếu đã hủy, không gồm phiếu "Trừ số dư" vì tiền đã vào lúc nạp) + phiếu nạp tiền. Công nợ = phải thu sau giảm phí đã duyệt − đã thu.',
      };
    },
  },
  cashflow: {
    perm: 'reports.finance', title: 'Báo cáo thu chi',
    build(db, { from, to }) {
      const rows = [];
      for (const r of db.prepare(`SELECT r.paid_at AS date, r.code, s.full_name AS party, r.amount, r.method FROM receipts r JOIN students s ON s.id = r.student_id WHERE r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ?`).all(from, to)) {
        rows.push({ date: r.date, code: r.code, kind: 'Thu học phí', party: r.party, method: METHOD_LABEL[r.method], income: r.amount, expense: 0 });
      }
      for (const r of db.prepare(`SELECT w.paid_at AS date, w.code, s.full_name AS party, w.amount, w.method FROM wallet_entries w JOIN students s ON s.id = w.student_id WHERE w.kind = 'topup' AND w.status = 'confirmed' AND w.paid_at BETWEEN ? AND ?`).all(from, to)) {
        rows.push({ date: r.date, code: r.code, kind: 'Nạp tiền (số dư)', party: r.party, method: METHOD_LABEL[r.method], income: r.amount, expense: 0 });
      }
      for (const r of db.prepare(`SELECT f.paid_at AS date, f.code, s.full_name AS party, f.amount, f.method FROM refunds f JOIN students s ON s.id = f.student_id WHERE f.status = 'paid' AND f.paid_at BETWEEN ? AND ?`).all(from, to)) {
        rows.push({ date: r.date, code: r.code, kind: 'Hoàn phí', party: r.party, method: METHOD_LABEL[r.method] || r.method, income: 0, expense: r.amount });
      }
      for (const r of db.prepare(`SELECT a.paid_at AS date, a.code, a.title AS party, a.amount, a.payment_method AS method, a.type FROM approvals a WHERE a.type IN ('purchase','expense') AND a.payment_status = 'paid' AND a.paid_at BETWEEN ? AND ?`).all(from, to)) {
        rows.push({ date: r.date, code: r.code, kind: `Chi ${APPROVAL_TYPES[r.type].toLowerCase()}`, party: r.party, method: METHOD_LABEL[r.method] || r.method, income: 0, expense: r.amount });
      }
      rows.sort((a, b) => (a.date < b.date ? 1 : -1));
      const income = rows.reduce((s, r) => s + r.income, 0);
      const expense = rows.reduce((s, r) => s + r.expense, 0);
      const unpaid = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM approvals WHERE payment_status = 'unpaid'`).get();
      return {
        columns: [
          { key: 'date', label: 'Ngày', type: 'date' }, { key: 'code', label: 'Chứng từ' }, { key: 'kind', label: 'Loại' }, { key: 'party', label: 'Nội dung / Đối tượng' },
          { key: 'method', label: 'Hình thức' }, { key: 'income', label: 'Thu', type: 'money' }, { key: 'expense', label: 'Chi', type: 'money' },
        ],
        rows, totals: { date: '', code: 'Tổng', kind: `Chênh lệch: ${(income - expense).toLocaleString('vi-VN')} đ`, income, expense },
        note: `Chỉ tính khoản đã thực chi (đã xác nhận chi). Đề xuất đã duyệt nhưng chưa chi: ${unpaid.n} khoản, ${unpaid.s.toLocaleString('vi-VN')} đ — chưa đưa vào thu chi.`,
      };
    },
  },
  sales: {
    perm: 'reports.finance', title: 'Doanh số mới & tái phí',
    build(db, { from, to }) {
      const rows = db.prepare(`SELECT co.name AS course,
          COUNT(DISTINCT CASE WHEN e.kind = 'new' AND e.enrolled_at BETWEEN ? AND ? AND e.status != 'cancelled' THEN e.id END) AS new_count,
          COUNT(DISTINCT CASE WHEN e.kind = 'renew' AND e.enrolled_at BETWEEN ? AND ? AND e.status != 'cancelled' THEN e.id END) AS renew_count,
          COALESCE(SUM(CASE WHEN e.kind = 'new' AND r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ? THEN r.amount END),0) AS new_amount,
          COALESCE(SUM(CASE WHEN e.kind = 'renew' AND r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ? THEN r.amount END),0) AS renew_amount
        FROM courses co LEFT JOIN enrollments e ON e.course_id = co.id LEFT JOIN receipts r ON r.enrollment_id = e.id
        GROUP BY co.id ORDER BY co.id`).all(from, to, from, to, from, to, from, to)
        .map((r) => ({ ...r, total: r.new_amount + r.renew_amount, renew_rate: pct(r.renew_count, r.new_count + r.renew_count) }))
        .filter((r) => r.new_count || r.renew_count || r.total);
      const tp = db.prepare(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM wallet_entries WHERE kind = 'topup' AND status = 'confirmed' AND paid_at BETWEEN ? AND ?`).get(from, to);
      const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
      const byPackage = db.prepare(`SELECT p.name AS package, p.kind, COUNT(*) AS enrollments, SUM(e.tuition_fee) AS billed FROM enrollments e JOIN fee_packages p ON p.id = e.package_id
        WHERE e.enrolled_at BETWEEN ? AND ? AND e.status != 'cancelled' GROUP BY p.id ORDER BY enrollments DESC`).all(from, to).map((x) => ({ ...x, kind: PACKAGE_KIND[x.kind] }));
      return {
        columns: [
          { key: 'course', label: 'Khóa học' }, { key: 'new_count', label: 'ĐK mới', type: 'number' }, { key: 'renew_count', label: 'ĐK tái phí', type: 'number' },
          { key: 'renew_rate', label: 'Tỷ lệ tái phí (%)', type: 'percent' }, { key: 'new_amount', label: 'Doanh số mới', type: 'money' }, { key: 'renew_amount', label: 'Doanh số tái phí', type: 'money' }, { key: 'total', label: 'Tổng', type: 'money' },
        ],
        rows, totals: { course: 'Tổng', new_count: sum('new_count'), renew_count: sum('renew_count'), renew_rate: pct(sum('renew_count'), sum('new_count') + sum('renew_count')), new_amount: sum('new_amount'), renew_amount: sum('renew_amount'), total: sum('total') },
        extra: { title: 'Đăng ký trong kỳ theo gói phí', columns: [{ key: 'package', label: 'Gói phí' }, { key: 'kind', label: 'Loại' }, { key: 'enrollments', label: 'Số đăng ký', type: 'number' }, { key: 'billed', label: 'Học phí đăng ký', type: 'money' }], rows: byPackage },
        note: `Doanh số = tiền thực thu trong kỳ theo loại đăng ký (mới / tái phí), không gồm phiếu trừ số dư. Nạp tiền vào số dư trong kỳ: ${tp.n} phiếu, ${tp.s.toLocaleString('vi-VN')} đ (chưa gắn khóa, không nằm trong bảng).`,
      };
    },
  },
  renewal: {
    perm: 'reports.enrollment', title: 'Học viên tới hạn tái phí',
    build(db, { from, to, today }) {
      const rows = renewalDue(db, { from: from < today ? today : from, to: to < today ? today : to, today })
        .map((x) => ({ student: `${x.student_name} (${x.student_code})`, class_code: x.class_code, course: x.course_name, homeroom: x.homeroom_name || '—', remaining: x.remaining, expected_end: x.expected_end }));
      return {
        columns: [
          { key: 'student', label: 'Học viên' }, { key: 'class_code', label: 'Lớp' }, { key: 'course', label: 'Khóa học' }, { key: 'homeroom', label: 'Chủ nhiệm' },
          { key: 'remaining', label: 'Còn buổi', type: 'number' }, { key: 'expected_end', label: 'Dự kiến hết học phí', type: 'date' },
        ],
        rows, totals: null,
        note: 'Học viên đang học có ngày dự kiến hết học phí (hết buổi) nằm trong kỳ, tính từ hôm nay, và chưa có đăng ký tiếp theo. Ngày dự kiến tính theo lịch sắp tới của lớp và số buổi còn lại.',
      };
    },
  },
  learning: {
    perm: 'reports.attendance', title: 'Học tập theo lớp',
    build(db, { from, to }) {
      const classes = db.prepare(`SELECT c.id, c.code, c.name, t.full_name AS teacher, h.full_name AS homeroom FROM classes c LEFT JOIN users t ON t.id = c.teacher_id LEFT JOIN users h ON h.id = c.homeroom_id
        WHERE c.status IN ('active','planned') ORDER BY c.code`).all();
      const rows = classes.map((c) => {
        const ids = db.prepare(`SELECT student_id FROM enrollments WHERE class_id = ? AND status = 'active'`).all(c.id).map((x) => x.student_id);
        const st = learningStats(db, ids, { from, to });
        const vals = [...st.values()];
        const avg = (k) => { const xs = vals.map((x) => x[k]).filter((x) => x !== null && x !== undefined); return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null; };
        return {
          class_code: c.code, teacher: c.teacher, homeroom: c.homeroom || '—', students: ids.length,
          attendance: avg('attendanceRate'), homework_done: avg('homeworkDoneRate'), homework_avg: avg('homeworkAvg'), test_avg: avg('testAvg'),
          missing: vals.reduce((t, x) => t + x.missingHomework, 0), support: vals.filter((x) => supportReasons(x).length).length,
        };
      });
      return {
        columns: [
          { key: 'class_code', label: 'Lớp' }, { key: 'teacher', label: 'Giáo viên' }, { key: 'homeroom', label: 'Chủ nhiệm' }, { key: 'students', label: 'Sĩ số', type: 'number' },
          { key: 'attendance', label: 'Chuyên cần (%)', type: 'percent' }, { key: 'homework_done', label: 'Hoàn thành BTVN (%)', type: 'percent' },
          { key: 'homework_avg', label: 'Điểm BTVN TB', type: 'decimal' }, { key: 'test_avg', label: 'Điểm KT TB (/10)', type: 'decimal' },
          { key: 'missing', label: 'Lượt không làm BTVN', type: 'number' }, { key: 'support', label: 'HS cần bổ trợ', type: 'number' },
        ],
        rows, totals: null,
        note: 'Tính trong kỳ trên các buổi chính khóa đã điểm danh. "HS cần bổ trợ" theo ngưỡng ở mục Bổ trợ học tập (chuyên cần < 75%, BTVN TB < 6,5, không làm BTVN ≥ 2 buổi, KT TB < 6,5).',
      };
    },
  },
  checkin: {
    perm: 'reports.attendance', title: 'Check-in tại quầy',
    build(db, { from, to }) {
      const rows = db.prepare(`SELECT k.date, COUNT(*) AS checkins,
          (SELECT COUNT(DISTINCT a.student_id) FROM attendance a JOIN class_sessions s ON s.id = a.session_id WHERE s.date = k.date AND a.status IN ('present','late')) AS present
        FROM checkins k WHERE k.date BETWEEN ? AND ? GROUP BY k.date ORDER BY k.date DESC`).all(from, to)
        .map((r) => ({ ...r, rate: pct(r.checkins, r.present) }));
      const byStaff = db.prepare(`SELECT u.full_name AS staff, COUNT(*) AS checkins FROM checkins k JOIN users u ON u.id = k.checked_by WHERE k.date BETWEEN ? AND ? GROUP BY u.id ORDER BY checkins DESC`).all(from, to);
      return {
        columns: [{ key: 'date', label: 'Ngày', type: 'date' }, { key: 'checkins', label: 'Lượt check-in', type: 'number' }, { key: 'present', label: 'HS có mặt theo điểm danh', type: 'number' }, { key: 'rate', label: 'Tỷ lệ check-in (%)', type: 'percent' }],
        rows, totals: { date: 'Tổng', checkins: rows.reduce((t, r) => t + r.checkins, 0), present: rows.reduce((t, r) => t + r.present, 0), rate: pct(rows.reduce((t, r) => t + r.checkins, 0), rows.reduce((t, r) => t + r.present, 0)) },
        extra: { title: 'Check-in theo nhân viên', columns: [{ key: 'staff', label: 'Nhân viên' }, { key: 'checkins', label: 'Lượt check-in', type: 'number' }], rows: byStaff },
        note: 'Check-in là thao tác của quầy lễ tân khi học viên đến trung tâm; điểm danh là thao tác của giáo viên trong lớp. Tỷ lệ thấp nghĩa là quầy chưa check-in đủ.',
      };
    },
  },
  daily: {
    perm: 'reports.daily', title: 'Báo cáo ngày (kế toán)',
    build(db, { from, to, today }) {
      // Số check-in · Số Renew · Số hoàn new · Số cọc · Công nợ · Thực thu ngày · Thực thu tháng (lũy kế từ đầu tháng)
      const done = completionDates(db);
      const end = to > today ? today : to;
      const rows = [];
      for (let d = from; d <= end; d = addDays(d, 1)) {
        const deposits = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM wallet_entries WHERE kind = 'topup' AND status = 'confirmed' AND paid_at = ?`).get(d);
        // Đặt cọc còn gồm phiếu thu ĐẦU TIÊN của đăng ký mới mà chưa đóng đủ
        const partial = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(r.amount),0) s FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id
          WHERE r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at = ? AND e.kind = 'new'
          AND r.id = (SELECT MIN(r2.id) FROM receipts r2 WHERE r2.enrollment_id = e.id AND r2.status = 'confirmed')
          AND r.amount < e.tuition_fee - COALESCE((SELECT SUM(amount) FROM discounts x WHERE x.enrollment_id = e.id AND x.status = 'approved'),0)`).get(d);
        rows.push({
          date: d,
          checkins: db.prepare(`SELECT COUNT(*) n FROM leads WHERE substr(checked_in_at,1,10) = ?`).get(d).n,
          renew: db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE kind = 'renew' AND enrolled_at = ? AND status NOT IN ('cancelled')`).get(d).n,
          completed_new: done.filter((x) => x.kind === 'new' && x.date === d).length,
          deposits: deposits.n + partial.n, deposit_amount: deposits.s + partial.s,
          debt: debtAsOf(db, d),
          cash_day: cashIn(db, d, d).total,
          cash_month: cashIn(db, startOfMonth(d), d).total,
        });
      }
      rows.reverse();
      const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
      return {
        columns: [
          { key: 'date', label: 'Ngày', type: 'date' }, { key: 'checkins', label: 'Số check-in', type: 'number' }, { key: 'renew', label: 'Số Renew', type: 'number' },
          { key: 'completed_new', label: 'Số hoàn new', type: 'number' }, { key: 'deposits', label: 'Số cọc', type: 'number' }, { key: 'deposit_amount', label: 'Tiền cọc', type: 'money' },
          { key: 'debt', label: 'Công nợ cuối ngày', type: 'money' }, { key: 'cash_day', label: 'Thực thu ngày', type: 'money' }, { key: 'cash_month', label: 'Thực thu tháng (lũy kế)', type: 'money' },
        ],
        rows,
        totals: { date: 'Tổng kỳ', checkins: sum('checkins'), renew: sum('renew'), completed_new: sum('completed_new'), deposits: sum('deposits'), deposit_amount: sum('deposit_amount'), debt: rows[0]?.debt ?? 0, cash_day: sum('cash_day'), cash_month: rows[0]?.cash_month ?? 0 },
        notes: [
          'Số check-in: khách đến trung tâm check-in trong ngày.',
          'Số Renew: đăng ký tái phí tạo trong ngày. Số hoàn new: học viên MỚI đóng đủ học phí trong ngày.',
          'Số cọc: phiếu nạp tiền đặt cọc + phiếu thu đầu tiên chưa đủ học phí của học viên mới.',
          'Công nợ: tổng phải thu còn lại cuối ngày của các đăng ký đã được duyệt. Thực thu: tiền vào thật (không tính phiếu trừ số dư).',
        ],
      };
    },
  },
  staff_ec: {
    perm: 'reports.staff_ec', title: 'KPI từng tư vấn viên (EC)',
    build(db, { from, to, today }) {
      const rows = staffTable(db, 'ec', { from, to, today });
      return {
        columns: [
          { key: 'full_name', label: 'Tư vấn viên' }, { key: 'checkins', label: 'Check-in', type: 'number', toneKey: 'checkinTone' }, { key: 'checkinTarget', label: 'Mục tiêu check-in', type: 'number' },
          { key: 'potential', label: 'Data mới', type: 'number', toneKey: 'potentialTone' }, { key: 'open', label: 'Đang tư vấn', type: 'number' }, { key: 'followDue', label: 'Tới hạn liên hệ', type: 'number' },
          { key: 'enrolled', label: 'Đăng ký mới', type: 'number' }, { key: 'revenue', label: 'Doanh thu', type: 'money' },
        ],
        rows, notes: KPI_RULES,
        totals: { full_name: 'Tổng', ...Object.fromEntries(['checkins', 'checkinTarget', 'potential', 'open', 'followDue', 'enrolled', 'revenue'].map((k) => [k, rows.reduce((t, r) => t + r[k], 0)])) },
      };
    },
  },
  staff_cm: {
    perm: 'reports.staff_cm', title: 'KPI từng chủ nhiệm (CM)',
    build(db, { from, to, today }) {
      const rows = staffTable(db, 'cm', { from, to, today }).map((r) => ({ ...r, class_list: r.classCodes.join(', ') }));
      return {
        columns: [
          { key: 'full_name', label: 'Chủ nhiệm' }, { key: 'class_list', label: 'Lớp' }, { key: 'students', label: 'Học viên', type: 'number' }, { key: 'flagged', label: 'HS cảnh báo <90%', type: 'number' },
          { key: 'attendancePct', label: 'Điểm danh (%)', type: 'percent', toneKey: 'attendanceTone' }, { key: 'homeworkPct', label: 'Chấm BTVN (%)', type: 'percent', toneKey: 'homeworkTone' },
          { key: 'renewals', label: 'Tái phí', type: 'number' }, { key: 'renewRevenue', label: 'Doanh thu tái phí', type: 'money' }, { key: 'renewalDue', label: 'Tới hạn tái phí tháng', type: 'number' },
          { key: 'resultsOverdue', label: 'Trễ trả kết quả test', type: 'number' },
        ],
        rows, notes: KPI_RULES,
      };
    },
  },
  department: {
    perm: 'approvals.decide', title: 'Tổng hợp theo phòng ban',
    build(db, { from, to, today }) {
      const ec = staffTable(db, 'ec', { from, to, today });
      const cm = staffTable(db, 'cm', { from, to, today });
      const s = (arr, k) => arr.reduce((t, r) => t + (r[k] || 0), 0);
      const rows = [
        { dept: 'Phòng Sales (EC)', staff: ec.length, a: `${s(ec, 'checkins')} check-in · ${s(ec, 'potential')} data mới`, b: `${s(ec, 'enrolled')} đăng ký mới`, revenue: s(ec, 'revenue') },
        { dept: 'Phòng Học thuật (CM)', staff: cm.length, a: `${s(cm, 'students')} học viên · ${s(cm, 'flagged')} cảnh báo <90%`, b: `${s(cm, 'renewals')} tái phí · ${s(cm, 'renewalDue')} tới hạn`, revenue: s(cm, 'renewRevenue') },
      ];
      const trend = [];
      const endM = startOfMonth(to > today ? today : to);
      for (let i = 5; i >= 0; i--) {
        const m = addMonths(endM, -i);
        const me = endOfMonth(m);
        const sales = db.prepare(`SELECT e.kind, COALESCE(SUM(r.amount),0) s FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id WHERE r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ? GROUP BY e.kind`).all(m, me);
        trend.push({
          month: `T${Number(m.slice(5, 7))}/${m.slice(0, 4)}`,
          leads: db.prepare('SELECT COUNT(*) n FROM leads WHERE created_at >= ? AND created_at < ?').get(...vnRangeIso(m, me)).n,
          checkins: db.prepare('SELECT COUNT(*) n FROM leads WHERE substr(checked_in_at,1,10) BETWEEN ? AND ?').get(m, me).n,
          new_count: db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE kind = 'new' AND enrolled_at BETWEEN ? AND ? AND status != 'cancelled'`).get(m, me).n,
          renew_count: db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE kind = 'renew' AND enrolled_at BETWEEN ? AND ? AND status != 'cancelled'`).get(m, me).n,
          sales_new: sales.find((x) => x.kind === 'new')?.s || 0, sales_renew: sales.find((x) => x.kind === 'renew')?.s || 0,
          cash: cashIn(db, m, me).total,
        });
      }
      return {
        columns: [{ key: 'dept', label: 'Phòng ban' }, { key: 'staff', label: 'Nhân sự', type: 'number' }, { key: 'a', label: 'Hoạt động' }, { key: 'b', label: 'Kết quả' }, { key: 'revenue', label: 'Doanh thu', type: 'money' }],
        rows,
        extra: {
          title: 'Xu hướng 6 tháng', rows: trend,
          columns: [{ key: 'month', label: 'Tháng' }, { key: 'leads', label: 'Data mới', type: 'number' }, { key: 'checkins', label: 'Check-in', type: 'number' }, { key: 'new_count', label: 'ĐK mới', type: 'number' },
            { key: 'renew_count', label: 'Tái phí', type: 'number' }, { key: 'sales_new', label: 'Thu HV mới', type: 'money' }, { key: 'sales_renew', label: 'Thu tái phí', type: 'money' }, { key: 'cash', label: 'Thực thu', type: 'money' }],
        },
      };
    },
  },
  facilities: {
    perm: 'assets.view', title: 'Sự cố cơ sở vật chất',
    build(db, { from, to, today }) {
      const rows = db.prepare(`SELECT i.code, COALESCE(a.name, i.title) AS item, r.name AS room, i.description, i.severity, i.status, i.requested_due, i.resolved_at, substr(i.created_at,1,10) AS reported_on, u.full_name AS reporter
        FROM asset_issues i LEFT JOIN assets a ON a.id = i.asset_id LEFT JOIN rooms r ON r.id = COALESCE(i.room_id, a.room_id) LEFT JOIN users u ON u.id = i.reported_by
        WHERE substr(i.created_at,1,10) BETWEEN ? AND ? OR i.status NOT IN ('resolved','cancelled') ORDER BY i.created_at DESC`).all(from, to)
        .map((x) => ({ ...x, status_label: ISSUE_STATUS[x.status], late: !['resolved', 'cancelled'].includes(x.status) && x.requested_due && x.requested_due < today ? 'Quá hạn đề xuất' : '' }));
      const byRoom = new Map();
      for (const x of rows) { const k = x.room || 'Chưa rõ phòng'; byRoom.set(k, (byRoom.get(k) || 0) + 1); }
      return {
        columns: [{ key: 'code', label: 'Mã' }, { key: 'reported_on', label: 'Ngày báo', type: 'date' }, { key: 'room', label: 'Phòng' }, { key: 'item', label: 'Sự cố' }, { key: 'reporter', label: 'Người báo' },
          { key: 'requested_due', label: 'Đề xuất xử lý trước', type: 'date' }, { key: 'status_label', label: 'Trạng thái' }, { key: 'late', label: 'Cảnh báo' }],
        rows,
        extra: { title: 'Theo phòng', columns: [{ key: 'room', label: 'Phòng' }, { key: 'n', label: 'Số sự cố', type: 'number' }], rows: [...byRoom.entries()].map(([room, n]) => ({ room, n })) },
      };
    },
  },
  teaching: {
    perm: 'reports.teaching', title: 'Báo cáo giờ dạy',
    build(db, { from, to }) {
      const rows = db.prepare(`SELECT u.full_name, u.title,
          SUM(CASE WHEN l.status = 'approved' THEN l.minutes ELSE 0 END) AS approved_minutes,
          SUM(CASE WHEN l.status = 'pending' THEN l.minutes ELSE 0 END) AS pending_minutes,
          SUM(CASE WHEN l.status = 'approved' AND l.role = 'teacher' THEN 1 ELSE 0 END) AS teacher_sessions,
          SUM(CASE WHEN l.status = 'approved' AND l.role = 'assistant' THEN 1 ELSE 0 END) AS assistant_sessions
        FROM teaching_logs l JOIN users u ON u.id = l.user_id JOIN class_sessions s ON s.id = l.session_id
        WHERE s.date BETWEEN ? AND ? GROUP BY u.id ORDER BY approved_minutes DESC`).all(from, to)
        .map((r) => ({ ...r, approved_hours: Math.round((r.approved_minutes / 60) * 10) / 10, pending_hours: Math.round((r.pending_minutes / 60) * 10) / 10 }));
      const totals = rows.reduce((t, r) => ({ approved_hours: Math.round((t.approved_hours + r.approved_hours) * 10) / 10, pending_hours: Math.round((t.pending_hours + r.pending_hours) * 10) / 10, teacher_sessions: t.teacher_sessions + r.teacher_sessions, assistant_sessions: t.assistant_sessions + r.assistant_sessions }), { approved_hours: 0, pending_hours: 0, teacher_sessions: 0, assistant_sessions: 0 });
      return {
        columns: [
          { key: 'full_name', label: 'Nhân sự' }, { key: 'title', label: 'Chức danh' }, { key: 'teacher_sessions', label: 'Buổi dạy chính', type: 'number' },
          { key: 'assistant_sessions', label: 'Buổi trợ giảng', type: 'number' }, { key: 'approved_hours', label: 'Giờ đã duyệt', type: 'number' }, { key: 'pending_hours', label: 'Giờ chờ duyệt', type: 'number' },
        ],
        rows, totals: { full_name: 'Tổng', ...totals },
        note: 'Chỉ tổng hợp giờ dạy. Bản demo không tính lương vì chưa có quy tắc lương được xác nhận.',
      };
    },
  },
  tasks: {
    perm: 'reports.tasks', title: 'Báo cáo công việc',
    build(db, { from, to, today }) {
      const [a, b] = vnRangeIso(from, to);
      const rows = db.prepare(`SELECT u.full_name AS assignee,
          SUM(CASE WHEN t.status != 'done' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN t.status != 'done' AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue,
          SUM(CASE WHEN t.status = 'done' AND t.completed_at >= ? AND t.completed_at < ? THEN 1 ELSE 0 END) AS done_in_period,
          SUM(CASE WHEN t.status = 'done' AND t.completed_at >= ? AND t.completed_at < ? AND t.due_date IS NOT NULL AND substr(t.completed_at,1,10) <= t.due_date THEN 1 ELSE 0 END) AS on_time
        FROM tasks t JOIN users u ON u.id = t.assignee_id GROUP BY u.id ORDER BY overdue DESC, open DESC`).all(today, a, b, a, b);
      const totals = rows.reduce((t, r) => ({ open: t.open + r.open, overdue: t.overdue + r.overdue, done_in_period: t.done_in_period + r.done_in_period, on_time: t.on_time + r.on_time }), { open: 0, overdue: 0, done_in_period: 0, on_time: 0 });
      return {
        columns: [{ key: 'assignee', label: 'Người phụ trách' }, { key: 'open', label: 'Đang mở', type: 'number' }, { key: 'overdue', label: 'Quá hạn', type: 'number' }, { key: 'done_in_period', label: 'Hoàn thành trong kỳ', type: 'number' }, { key: 'on_time', label: 'Hoàn thành đúng hạn', type: 'number' }],
        rows, totals: { assignee: 'Tổng', ...totals },
        note: `Trạng thái: ${Object.values(TASK_STATUS).join(', ')}. "Quá hạn" tính tại hôm nay; "Hoàn thành trong kỳ" theo thời điểm hoàn thành.`,
      };
    },
  },
};

// Danh sách xuất CSV (dữ liệu quan trọng)
const EXPORTS = {
  students: {
    perm: 'students.view', filename: 'hoc-vien',
    build(db, user) {
      const ids = visibleStudentIds(db, user);
      const contacts = has(user, 'students.contacts');
      const rows = db.prepare(`SELECT s.*, (SELECT p.full_name FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id WHERE sc.student_id = s.id AND sc.is_primary = 1) AS parent_name,
          (SELECT p.phone FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id WHERE sc.student_id = s.id AND sc.is_primary = 1) AS parent_phone,
          (SELECT group_concat(c.code, ' ') FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.student_id = s.id AND e.status = 'active') AS classes
        FROM students s ${ids === null ? '' : `WHERE s.id IN (${inList(ids)})`} ORDER BY s.code`).all();
      return {
        columns: [{ key: 'code', label: 'Mã HV' }, { key: 'full_name', label: 'Họ tên' }, { label: 'Ngày sinh', value: (r) => vnDate(r.dob) }, { key: 'school', label: 'Trường' }, { key: 'level', label: 'Trình độ' },
          { key: 'classes', label: 'Lớp đang học' }, { label: 'Trạng thái', value: (r) => ({ active: 'Đang học', reserved: 'Bảo lưu', inactive: 'Đã nghỉ', archived: 'Lưu trữ' })[r.status] },
          ...(contacts ? [{ key: 'parent_name', label: 'Phụ huynh' }, { key: 'parent_phone', label: 'SĐT phụ huynh' }] : [])],
        rows,
      };
    },
  },
  leads: {
    perm: 'leads.view', filename: 'khach-quan-tam',
    build(db) {
      const rows = db.prepare(`SELECT l.*, u.full_name AS owner, c.name AS course FROM leads l LEFT JOIN users u ON u.id = l.owner_id LEFT JOIN courses c ON c.id = l.interest_course_id ORDER BY l.created_at DESC`).all();
      return {
        columns: [{ key: 'code', label: 'Mã' }, { key: 'parent_name', label: 'Phụ huynh' }, { key: 'phone', label: 'Số điện thoại' }, { key: 'student_name', label: 'Học viên' }, { key: 'course', label: 'Khóa quan tâm' },
          { key: 'source', label: 'Nguồn' }, { key: 'owner', label: 'Phụ trách' }, { label: 'Trạng thái', value: (r) => LEAD_STATUS[r.status] }, { key: 'next_contact_at', label: 'Hẹn liên hệ' }, { key: 'note', label: 'Ghi chú' }],
        rows,
      };
    },
  },
  receivables: {
    perm: 'finance.view', filename: 'cong-no',
    build(db) {
      const rows = db.prepare(`SELECT e.id, e.code, s.code AS student_code, s.full_name, co.name AS course, c.code AS class_code FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses co ON co.id = e.course_id LEFT JOIN classes c ON c.id = e.class_id ORDER BY e.code`).all();
      const fin = computeFinance(db);
      return {
        columns: [{ key: 'code', label: 'Mã đăng ký' }, { key: 'student_code', label: 'Mã HV' }, { key: 'full_name', label: 'Học viên' }, { key: 'course', label: 'Khóa' }, { key: 'class_code', label: 'Lớp' },
          { label: 'Học phí', value: (r) => fin.get(r.id).fee }, { label: 'Giảm đã duyệt', value: (r) => fin.get(r.id).discount }, { label: 'Phải thu', value: (r) => fin.get(r.id).net },
          { label: 'Đã thu', value: (r) => fin.get(r.id).paid }, { label: 'Công nợ', value: (r) => fin.get(r.id).debt }, { label: 'Quá hạn', value: (r) => fin.get(r.id).overdue },
          { label: 'Tình trạng', value: (r) => PAYMENT_STATUS_LABEL[fin.get(r.id).paymentStatus] }],
        rows,
      };
    },
  },
  receipts: {
    perm: 'finance.view', filename: 'phieu-thu',
    build(db, _user, { from, to }) {
      const rows = db.prepare(`SELECT r.*, s.full_name, e.code AS enrollment_code, u.full_name AS collector FROM receipts r JOIN students s ON s.id = r.student_id JOIN enrollments e ON e.id = r.enrollment_id LEFT JOIN users u ON u.id = r.collected_by
        WHERE r.paid_at BETWEEN ? AND ? ORDER BY r.paid_at DESC`).all(from, to);
      return {
        columns: [{ key: 'code', label: 'Số phiếu' }, { label: 'Ngày thu', value: (r) => vnDate(r.paid_at) }, { key: 'full_name', label: 'Học viên' }, { key: 'enrollment_code', label: 'Đăng ký' },
          { key: 'amount', label: 'Số tiền' }, { label: 'Hình thức', value: (r) => METHOD_LABEL[r.method] }, { key: 'collector', label: 'Người thu' },
          { label: 'Trạng thái', value: (r) => (r.status === 'confirmed' ? 'Đã xác nhận' : 'Đã hủy') }, { key: 'cancel_reason', label: 'Lý do hủy' }, { key: 'note', label: 'Ghi chú' }],
        rows,
      };
    },
  },
};

export function reportRoutes({ db }) {
  const r = Router();

  r.get('/', (req, res) => {
    res.json({ reports: Object.entries(REPORTS).filter(([, x]) => has(req.user, x.perm)).map(([key, x]) => ({ key, title: x.title })) });
  });

  r.get('/export/:name', (req, res) => {
    const ex = EXPORTS[req.params.name];
    if (!ex) throw notFound('Không có danh sách xuất này.');
    const alt = req.params.name === 'students' && has(req.user, 'students.view_own');
    if (!has(req.user, ex.perm) && !alt) throw forbidden();
    const today = vnToday();
    const range = periodRange(req.query.period || 'month', today, req.query.from, req.query.to);
    const { columns, rows } = ex.build(db, req.user, range);
    sendCsv(res, `${ex.filename}-${today}.csv`, columns, rows);
  });

  r.get('/:type', (req, res) => {
    const rep = REPORTS[req.params.type];
    if (!rep) throw notFound('Không có báo cáo này.');
    if (!has(req.user, rep.perm)) throw forbidden('Bạn không có quyền xem báo cáo này.');
    const today = vnToday();
    const range = periodRange(req.query.period || 'month', today, req.query.from, req.query.to);
    const data = rep.build(db, { ...range, today });
    if (req.query.format === 'csv') {
      const cols = data.columns.map((c) => ({ key: c.key, label: c.label, value: c.type === 'date' ? (row) => vnDate(row[c.key]) : undefined }));
      return sendCsv(res, `bao-cao-${req.params.type}-${range.from}_${range.to}.csv`, cols, [...data.rows, ...(data.totals ? [data.totals] : [])]);
    }
    res.json({ type: req.params.type, title: rep.title, ...range, ...data });
  });

  return r;
}
