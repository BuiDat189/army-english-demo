import { Router } from 'express';
import { can, has } from '../auth/middleware.js';
import { vnToday, addDays, addMonths, startOfMonth, endOfMonth, periodRange, vnRangeIso } from '../lib/time.js';
import { visibleClassIds, visibleStudentIds, inList } from '../lib/scope.js';
import { computeFinance } from '../services/finance.js';
import { sessionStudentIds } from '../services/schedule.js';
import { cashIn } from '../services/wallet.js';
import { renewalDue, renewalWindows } from '../services/packages.js';
import { learningTodo } from '../services/learning.js';
import { ecStats, cmStats, proposalsFor, KPI_RULES } from '../services/kpi.js';

// Định nghĩa chỉ số — hiển thị cạnh thẻ để người xem hiểu đúng
export const KPI_DEFINITIONS = {
  studying: 'Số học viên có ít nhất một đăng ký đang học (đã xếp lớp, chưa kết thúc). Không tính bảo lưu, chờ xếp lớp.',
  leadsOpen: 'Khách đang tư vấn: Tiềm năng tháng, Đang lên hẹn, Đăng ký/Đã check-in, Đăng ký/Đã học thử, Chăm sóc thêm (chưa đăng ký, chưa đóng hồ sơ). Không phụ thuộc kỳ lọc.',
  classesToday: 'Số buổi học chính khóa và học bù diễn ra hôm nay (không tính buổi đã hủy).',
  income: 'Tiền vào thật trong kỳ: phiếu thu ĐÃ XÁC NHẬN (trừ phiếu "Trừ số dư") + phiếu nạp tiền. Không tính phiếu đã hủy; không phải tổng học phí đăng ký.',
  salesNew: 'Tiền thực thu trong kỳ của các đăng ký học viên MỚI (lần đầu học tại trung tâm).',
  salesRenew: 'Tiền thực thu trong kỳ của các đăng ký TÁI PHÍ (học viên đã từng học, đăng ký tiếp).',
  topups: 'Tiền phụ huynh nạp vào số dư (đặt cọc / đóng trước) trong kỳ, chưa gắn khóa học.',
  renewalDue: 'Học viên dự kiến hết học phí (hết buổi) trong tháng này / tháng sau và chưa đăng ký tiếp.',
  receivablesDue: 'Số tiền của các đợt thanh toán đã quá hạn hoặc đến hạn trong 7 ngày tới mà chưa thu đủ (tính tại hôm nay).',
  tasksOverdue: 'Công việc chưa hoàn thành có hạn trước hôm nay.',
  enrolledInPeriod: 'Số đăng ký khóa tạo trong kỳ (gồm học viên mới và tái đăng ký). Tổng học phí đăng ký là số phải thu, khác tiền thực thu.',
};

export function dashboardRoutes({ db }) {
  const r = Router();

  r.get('/', can('dashboard.view'), (req, res) => {
    const u = req.user;
    const today = vnToday();
    const period = req.query.period || 'month';
    const { from, to } = periodRange(period, today, req.query.from, req.query.to);
    const kpis = {};
    // Ba mức xem lớp: tất cả (classes.view) · chỉ lớp mình dạy (classes.view_own) · không xem lớp
    const allClasses = has(u, 'classes.view');
    const ownClasses = !allClasses && has(u, 'classes.view_own');
    const studentIds = visibleStudentIds(db, u);
    const ownStudents = studentIds !== null;
    const classFilter = ownClasses ? `AND (s.teacher_id = ${u.id} OR s.assistant_id = ${u.id} OR c.homeroom_id = ${u.id})` : '';

    if (studentIds === null || studentIds.length) {
      kpis.studying = {
        value: db.prepare(`SELECT COUNT(DISTINCT st.id) n FROM students st JOIN enrollments e ON e.student_id = st.id WHERE e.status = 'active' AND st.status = 'active'
          ${ownStudents ? `AND st.id IN (${inList(studentIds)}) AND e.class_id IN (${inList(visibleClassIds(db, u))})` : ''}`).get().n,
        link: '/students?status=studying', label: ownStudents ? 'Học viên lớp tôi dạy' : 'Học viên đang học',
      };
    }
    if (has(u, 'leads.view')) {
      const leadScope = has(u, 'leads.view_all') ? '' : `AND (owner_id = ${u.id} OR created_by = ${u.id})`;
      kpis.leadsOpen = {
        value: db.prepare(`SELECT COUNT(*) n FROM leads WHERE status IN ('potential','appointing','checkin_booked','checked_in','trial_booked','trial_done','nurturing') ${leadScope}`).get().n,
        sub: `${db.prepare(`SELECT COUNT(*) n FROM leads WHERE created_at >= ? AND created_at < ? ${leadScope}`).get(...vnRangeIso(from, to)).n} data mới trong kỳ`,
        link: '/leads?status=open', label: has(u, 'leads.view_all') ? 'Khách đang tư vấn' : 'Khách tôi đang tư vấn',
      };
    }
    const scheduleVisible = allClasses || ownClasses;
    const todaySessions = !scheduleVisible ? [] : db.prepare(`SELECT s.*, c.code AS class_code, c.name AS class_name, r.name AS room_name, t.full_name AS teacher_name, a.full_name AS assistant_name
      FROM class_sessions s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN rooms r ON r.id = s.room_id LEFT JOIN users t ON t.id = s.teacher_id LEFT JOIN users a ON a.id = s.assistant_id
      WHERE s.date = ? AND s.status != 'cancelled' ${classFilter} ORDER BY s.start_time`).all(today)
      .map((s) => ({ ...s, student_count: sessionStudentIds(db, s.id).length }));
    if (scheduleVisible) kpis.classesToday = { value: todaySessions.length, sub: `${todaySessions.filter((s) => s.status === 'done').length} buổi đã điểm danh`, link: `/schedule?view=day&date=${today}`, label: 'Buổi học hôm nay' };

    if (has(u, 'finance.view') || has(u, 'dashboard.finance')) {
      const inc = cashIn(db, from, to);
      kpis.income = { value: inc.total, money: true, sub: `${inc.receiptCount} phiếu thu${inc.topupCount ? ` · ${inc.topupCount} phiếu nạp` : ''}`, link: `/finance?tab=receipts&period=custom&from=${from}&to=${to}`, label: 'Tiền thực thu trong kỳ' };
      const fin = computeFinance(db, { today });
      let overdue = 0; let soon = 0; let nOver = 0; let nSoon = 0;
      for (const f of fin.values()) { if (f.overdue) { overdue += f.overdue; nOver++; } if (f.dueSoon) { soon += f.dueSoon; nSoon++; } }
      kpis.receivablesDue = { value: overdue + soon, money: true, sub: `${nOver} khoản quá hạn · ${nSoon} sắp đến hạn`, link: '/finance?status=due', label: 'Công nợ đến hạn/quá hạn', tone: overdue > 0 ? 'danger' : 'neutral' };
    }
    const taskScope = has(u, 'tasks.view_all') ? '' : `AND (assignee_id = ${u.id} OR created_by = ${u.id})`;
    kpis.tasksOverdue = { value: db.prepare(`SELECT COUNT(*) n FROM tasks WHERE status != 'done' AND due_date < ? ${taskScope}`).get(today).n, link: '/tasks?view=overdue', label: has(u, 'tasks.view_all') ? 'Công việc quá hạn' : 'Việc của tôi quá hạn', tone: 'warning' };

    // Lịch hôm nay: buổi học + học thử/kiểm tra đầu vào
    const trialsToday = db.prepare(`SELECT t.*, l.student_name, l.id AS lead_id, l.parent_name, r.name AS room_name, us.full_name AS teacher_name, c.code AS class_code FROM trials t JOIN leads l ON l.id = t.lead_id
      LEFT JOIN rooms r ON r.id = t.room_id LEFT JOIN users us ON us.id = t.teacher_id LEFT JOIN class_sessions s ON s.id = t.session_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE t.date = ? AND t.status = 'scheduled' ${has(u, 'leads.view') || allClasses ? '' : `AND t.teacher_id = ${u.id}`} ORDER BY t.start_time`).all(today)
      .filter(() => scheduleVisible || has(u, 'leads.view'));

    // Danh sách cần xử lý
    const todo = {};
    if (has(u, 'leads.view')) {
      todo.trials = db.prepare(`SELECT t.id, t.date, t.start_time, t.type, l.id AS lead_id, l.student_name, l.parent_name FROM trials t JOIN leads l ON l.id = t.lead_id
        WHERE t.status = 'scheduled' AND t.date BETWEEN ? AND ? ${has(u, 'leads.view_all') ? '' : `AND (l.owner_id = ${u.id} OR t.teacher_id = ${u.id} OR l.trial_class_id IN (SELECT id FROM classes WHERE homeroom_id = ${u.id}))`}
        ORDER BY t.date, t.start_time LIMIT 6`).all(today, addDays(today, 2));
      todo.followups = db.prepare(`SELECT id, parent_name, student_name, next_contact_at FROM leads WHERE status IN ('potential','appointing','checkin_booked','checked_in','trial_booked','trial_done','nurturing')
        AND next_contact_at IS NOT NULL AND substr(next_contact_at,1,10) <= ? ${has(u, 'leads.view_all') ? '' : `AND owner_id = ${u.id}`} ORDER BY next_contact_at LIMIT 6`).all(today);
    }
    if (has(u, 'care.view')) {
      todo.absences = db.prepare(`SELECT c.id, c.title, c.status, c.priority, s.full_name AS student_name, s.id AS student_id FROM care_cases c JOIN students s ON s.id = c.student_id
        WHERE c.type = 'absence' AND c.status != 'done' ORDER BY c.priority = 'high' DESC, c.created_at DESC LIMIT 6`).all();
    } else if (ownClasses) {
      todo.absences = db.prepare(`SELECT a.id, st.full_name AS student_name, st.id AS student_id, s.date, c.code AS class_code, a.status FROM attendance a JOIN class_sessions s ON s.id = a.session_id
        JOIN students st ON st.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id WHERE a.status IN ('absent','excused') AND a.is_makeup = 0 AND s.date >= ? AND (s.teacher_id = ? OR s.assistant_id = ? OR c.homeroom_id = ?)
        ORDER BY s.date DESC LIMIT 6`).all(addDays(today, -7), u.id, u.id, u.id).map((x) => ({ ...x, title: `Vắng buổi ${x.date.split('-').reverse().join('/')} (${x.class_code})` }));
    }
    if (has(u, 'finance.view')) {
      const fin = computeFinance(db, { today });
      const over = [...fin.entries()].filter(([, f]) => f.overdue > 0).sort((a, b) => b[1].overdue - a[1].overdue).slice(0, 6);
      todo.receivables = over.map(([id, f]) => {
        const e = db.prepare('SELECT e.id, e.code, s.full_name AS student_name, s.id AS student_id FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.id = ?').get(id);
        const oldest = f.installments.find((i) => i.status === 'overdue');
        return { ...e, overdue: f.overdue, due_date: oldest?.due_date };
      });
    }
    if (has(u, 'approvals.decide')) {
      todo.approvals = db.prepare(`SELECT a.id, a.code, a.title, a.type, a.amount, a.stage, u.full_name AS requester FROM approvals a JOIN users u ON u.id = a.requested_by WHERE a.status = 'pending' AND COALESCE(a.stage,'') != 'lead' ORDER BY a.created_at LIMIT 6`).all();
    } else if (has(u, 'approvals.decide_lead')) {
      todo.approvals = db.prepare(`SELECT a.id, a.code, a.title, a.type, a.amount, a.stage, u.full_name AS requester FROM approvals a JOIN users u ON u.id = a.requested_by WHERE a.status = 'pending' AND a.stage = 'lead' ORDER BY a.created_at LIMIT 6`).all();
    } else if (has(u, 'finance.pay')) {
      todo.approvals = db.prepare(`SELECT a.id, a.code, a.title, a.type, a.amount, u.full_name AS requester, 'to_pay' AS mode FROM approvals a JOIN users u ON u.id = a.requested_by WHERE a.payment_status = 'unpaid' ORDER BY a.decided_at LIMIT 6`).all();
    } else {
      todo.approvals = db.prepare(`SELECT a.id, a.code, a.title, a.type, a.amount, a.status FROM approvals a WHERE a.requested_by = ? AND a.status = 'pending' ORDER BY a.created_at LIMIT 6`).all(u.id);
    }

    // Biểu đồ 6 tháng gần nhất (kết thúc ở tháng chứa ngày cuối kỳ)
    let charts = null;
    if (has(u, 'leads.view') || has(u, 'finance.view') || has(u, 'dashboard.finance')) {
      const end = startOfMonth(to > today ? today : to);
      const months = [];
      for (let i = 5; i >= 0; i--) months.push(addMonths(end, -i));
      charts = months.map((m) => {
        const a = m; const b = endOfMonth(m);
        const row = { month: m.slice(0, 7), label: `T${Number(m.slice(5, 7))}/${m.slice(2, 4)}` };
        if (has(u, 'leads.view')) {
          row.leads = db.prepare(`SELECT COUNT(*) n FROM leads WHERE created_at >= ? AND created_at < ?`).get(...vnRangeIso(a, b)).n;
          row.newEnrollments = db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE enrolled_at BETWEEN ? AND ? AND kind = 'new'`).get(a, b).n;
          row.renewals = db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE enrolled_at BETWEEN ? AND ? AND kind = 'renew'`).get(a, b).n;
        }
        if (has(u, 'finance.view') || has(u, 'dashboard.finance')) {
          row.income = cashIn(db, a, b).total;
          row.billed = db.prepare(`SELECT COALESCE(SUM(e.tuition_fee - COALESCE((SELECT SUM(amount) FROM discounts d WHERE d.enrollment_id = e.id AND d.status = 'approved'),0)),0) s FROM enrollments e WHERE e.enrolled_at BETWEEN ? AND ? AND e.status != 'cancelled'`).get(a, b).s;
        }
        return row;
      });
    }
    const enrolledInPeriod = has(u, 'leads.view') || has(u, 'finance.view')
      ? db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE enrolled_at BETWEEN ? AND ?`).get(from, to).n : null;

    // ---------- LIVE: doanh số mới/tái phí theo khóa, tới hạn tái phí, học tập, check-in ----------
    const live = {};
    if (has(u, 'finance.view') || has(u, 'dashboard.finance')) {
      const sales = db.prepare(`SELECT co.name AS course, e.kind, SUM(r.amount) AS amount FROM receipts r JOIN enrollments e ON e.id = r.enrollment_id JOIN courses co ON co.id = e.course_id
        WHERE r.status = 'confirmed' AND r.method != 'wallet' AND r.paid_at BETWEEN ? AND ? GROUP BY co.id, e.kind`).all(from, to);
      const byCourse = new Map();
      for (const x of sales) {
        if (!byCourse.has(x.course)) byCourse.set(x.course, { course: x.course, new: 0, renew: 0 });
        byCourse.get(x.course)[x.kind === 'renew' ? 'renew' : 'new'] += x.amount;
      }
      const cash = cashIn(db, from, to);
      live.sales = {
        new: sales.filter((x) => x.kind !== 'renew').reduce((t, x) => t + x.amount, 0),
        renew: sales.filter((x) => x.kind === 'renew').reduce((t, x) => t + x.amount, 0),
        topups: cash.topups, topupCount: cash.topupCount,
        byCourse: [...byCourse.values()].sort((a, b) => b.new + b.renew - a.new - a.renew),
        newStudents: db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE kind = 'new' AND enrolled_at BETWEEN ? AND ? AND status != 'cancelled'`).get(from, to).n,
        renewStudents: db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE kind = 'renew' AND enrolled_at BETWEEN ? AND ? AND status != 'cancelled'`).get(from, to).n,
      };
    }
    if (has(u, 'classes.view') && (has(u, 'care.view') || has(u, 'finance.view'))) {
      const w = renewalWindows(today);
      const due = renewalDue(db, { from: w.thisMonth.from, to: w.nextMonth.to, today });
      const pick = (x) => ({ id: x.id, student_id: x.student_id, student_name: x.student_name, class_code: x.class_code, remaining: x.remaining, expected_end: x.expected_end });
      live.renewal = { thisMonth: due.filter((x) => x.expected_end <= w.thisMonth.to).map(pick), nextMonth: due.filter((x) => x.expected_end >= w.nextMonth.from).map(pick), windows: w };
    }
    if (has(u, 'learning.edit') || has(u, 'learning.edit_own')) {
      const t = learningTodo(db, { today, classIds: has(u, 'learning.edit') ? null : visibleClassIds(db, u) });
      live.learning = { ungraded: t.ungraded.slice(0, 6), ungradedCount: t.ungraded.length, missing: t.missing.slice(0, 6), missingCount: t.missing.length };
    }
    if (has(u, 'checkin.edit')) {
      const expected = db.prepare(`SELECT id FROM class_sessions WHERE date = ? AND status != 'cancelled'`).all(today).reduce((n, s) => n + sessionStudentIds(db, s.id).length, 0);
      live.checkin = { checked: db.prepare('SELECT COUNT(*) n FROM checkins WHERE date = ?').get(today).n, expected };
    }

    // ---------- KHU VỰC CÁ NHÂN: "Đề xuất cần xử lý" + KPI đổi màu theo vai trò ----------
    const work = { proposals: proposalsFor(db, u.id, today), rules: KPI_RULES };
    if (u.roles.includes('consultant') || u.roles.includes('sales_lead')) work.ec = ecStats(db, u.id, { today, from, to });
    if (u.roles.includes('teacher') || u.roles.includes('academic')) {
      const cm = cmStats(db, u.id, { today, from, to });
      if (cm.classes.length) work.cm = cm;
    }
    if (has(u, 'reports.daily')) {
      const mStart = startOfMonth(today);
      work.cash = { today: cashIn(db, today, today).total, month: cashIn(db, mStart, today).total };
    }

    res.json({ today, period: { key: period, from, to }, kpis, live, work, scheduleVisible: scheduleVisible || has(u, 'leads.view'), todaySessions, trialsToday, todo, charts, enrolledInPeriod, definitions: KPI_DEFINITIONS });
  });

  return r;
}
