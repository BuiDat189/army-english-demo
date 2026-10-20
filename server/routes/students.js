import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest } from '../lib/http.js';
import { nextCode, logActivity } from '../db/index.js';
import { nowIso } from '../lib/time.js';
import { visibleStudentIds, visibleClassIds, assertStudentVisible, inList } from '../lib/scope.js';
import { computeFinance } from '../services/finance.js';
import { sessionUsage } from '../services/attendance.js';
import { RENEWAL_THRESHOLD } from '../services/reminders.js';
import { expectedEndDates } from '../services/packages.js';
import { walletBalances, WALLET_KIND } from '../services/wallet.js';
import { learningStats, ASSESSMENT_KIND, HOMEWORK_LABEL, monthOf } from '../services/learning.js';
import { startOfMonth, endOfMonth, vnToday } from '../lib/time.js';

export const TAG_SUGGESTIONS = ['VIP', 'Anh chị em', 'Học bổng', 'Cần quan tâm', 'Phụ huynh khó tính', 'Thi chứng chỉ', 'Chuyển từ trung tâm khác'];
const normTags = (arr) => [...new Set((arr || []).map((t) => String(t).replace(/,/g, ' ').trim()).filter(Boolean))];
const tagsOf = (s) => (s ? s.split(',').filter(Boolean) : []);
// Chuẩn hóa ngày từ file: dd/mm/yyyy, d/m/yyyy hoặc yyyy-mm-dd
function parseDob(x) {
  if (!x) return null;
  const t = String(x).trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return 'invalid';
}

export const STUDENT_STATUS = { active: 'Đang học', reserved: 'Bảo lưu', inactive: 'Đã nghỉ', archived: 'Lưu trữ' };
const RELATIONSHIPS = ['Bố', 'Mẹ', 'Ông', 'Bà', 'Người giám hộ'];
const PAY_RANK = { overdue: 5, due_soon: 4, unpaid: 3, partial: 2, paid: 1, closed: 0 };

const studentSchema = z.object({
  full_name: v.text(120, 'họ tên học viên'),
  dob: v.optDate(),
  gender: z.enum(['male', 'female']).optional().nullable(),
  school: v.optText(120),
  note: v.optText(1000),
});
const parentSchema = z.object({
  full_name: v.text(120, 'tên phụ huynh'),
  phone: v.phone(),
  email: v.optEmail(),
  address: v.optText(250),
  occupation: v.optText(120),
  note: v.optText(500),
});

export function studentRoutes({ db }) {
  const r = Router();
  const viewAny = can('students.view', 'students.view_own');

  // ---------- Phụ huynh / người liên hệ ----------
  r.get('/parents/search', can('students.contacts'), (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ items: [] });
    const digits = q.replace(/\D/g, '');
    const rows = db.prepare(`SELECT p.*, (SELECT group_concat(s.full_name, ', ') FROM student_contacts sc JOIN students s ON s.id = sc.student_id WHERE sc.parent_id = p.id) AS children
      FROM parents p WHERE p.full_name LIKE ? ${digits.length >= 3 ? 'OR p.phone LIKE ?' : ''} ORDER BY p.full_name LIMIT 10`)
      .all(`%${q}%`, ...(digits.length >= 3 ? [`%${digits}%`] : []));
    res.json({ items: rows });
  });
  r.put('/parents/:pid', can('students.edit'), (req, res) => {
    const pid = Number(req.params.pid);
    if (!db.prepare('SELECT 1 FROM parents WHERE id = ?').get(pid)) throw notFound('Không tìm thấy phụ huynh.');
    const b = parse(parentSchema, req.body);
    db.prepare('UPDATE parents SET full_name=?, phone=?, email=?, address=?, occupation=?, note=? WHERE id=?').run(b.full_name, b.phone, b.email, b.address, b.occupation, b.note, pid);
    res.json({ ok: true });
  });

  // ---------- Danh sách học viên ----------
  r.get('/', viewAny, (req, res) => {
    const { q, status, class_id, payment, renewal, tag } = req.query;
    const ids = visibleStudentIds(db, req.user);
    const contacts = has(req.user, 'students.contacts');
    const where = [];
    const args = [];
    if (ids !== null) where.push(`s.id IN (${inList(ids)})`);
    if (q) {
      const digits = String(q).replace(/\D/g, '');
      where.push(`(s.full_name LIKE ? OR s.code LIKE ?${contacts ? ` OR EXISTS (SELECT 1 FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id WHERE sc.student_id = s.id AND (p.full_name LIKE ?${digits.length >= 3 ? ' OR p.phone LIKE ?' : ''}))` : ''})`);
      args.push(`%${q}%`, `%${q}%`, ...(contacts ? [`%${q}%`, ...(digits.length >= 3 ? [`%${digits}%`] : [])] : []));
    }
    if (status === 'studying') where.push(`s.status = 'active' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.status = 'active')`);
    else if (status && status !== 'all') { where.push('s.status = ?'); args.push(status); } else if (!status) where.push(`s.status != 'archived'`);
    if (class_id) { where.push(`EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.class_id = ? AND e.status = 'active')`); args.push(Number(class_id)); }
    if (tag) { where.push(`(',' || s.tags || ',') LIKE ?`); args.push(`%,${String(tag).replace(/[%_,]/g, '')},%`); }
    const rows = db.prepare(`SELECT s.* FROM students s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.full_name LIMIT 1000`).all(...args);
    const sids = rows.map((x) => x.id);
    const enrolls = sids.length ? db.prepare(`SELECT e.id, e.student_id, e.status, c.code AS class_code, c.id AS class_id, co.name AS course_name
      FROM enrollments e LEFT JOIN classes c ON c.id = e.class_id JOIN courses co ON co.id = e.course_id
      WHERE e.student_id IN (${inList(sids)})`).all() : [];
    const fin = has(req.user, 'finance.view') ? computeFinance(db, { enrollmentIds: enrolls.map((e) => e.id) }) : null;
    // Tư vấn / chủ nhiệm: chỉ xem số tiền đã đóng và ngày hết phí (không xem công nợ chi tiết, không xem liên hệ PH nếu không có quyền)
    const summary = fin || (has(req.user, 'finance.summary') ? computeFinance(db, { enrollmentIds: enrolls.map((e) => e.id) }) : null);
    const usage = sessionUsage(db, enrolls.filter((e) => e.status === 'active').map((e) => e.id));
    const ends = summary ? expectedEndDates(db, enrolls.filter((e) => e.status === 'active').map((e) => e.id), { usage }) : new Map();
    const today = vnToday();
    const parentRows = contacts && sids.length ? db.prepare(`SELECT sc.student_id, p.full_name, p.phone, sc.relationship FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id
      WHERE sc.is_primary = 1 AND sc.student_id IN (${inList(sids)})`).all() : [];
    const parentBy = new Map(parentRows.map((p) => [p.student_id, p]));
    // Chỉ giới hạn theo lớp với người chỉ được xem học viên lớp mình (giáo viên)
    const visibleClasses = has(req.user, 'students.view') ? null : visibleClassIds(db, req.user);
    let items = rows.map((s) => {
      const es = enrolls.filter((e) => e.student_id === s.id);
      const active = es.filter((e) => e.status === 'active' || e.status === 'pending_class');
      let debt = 0; let pay = null;
      if (fin) for (const e of es) { const f = fin.get(e.id); debt += f.debt; if (!pay || PAY_RANK[f.paymentStatus] > PAY_RANK[pay]) pay = f.paymentStatus; }
      const remain = active.map((e) => usage.get(e.id)?.remaining).filter((x) => x !== undefined);
      const endList = active.map((e) => ends.get(e.id)).filter(Boolean).sort();
      const feeEnd = endList.at(-1) || null;
      return {
        id: s.id, code: s.code, full_name: s.full_name, dob: s.dob, gender: s.gender, status: s.status, level: s.level, tags: tagsOf(s.tags),
        classes: active.filter((e) => e.class_code && (visibleClasses === null || visibleClasses.includes(e.class_id))).map((e) => ({ id: e.class_id, code: e.class_code })),
        pending_class: active.some((e) => e.status === 'pending_class'),
        parent: parentBy.get(s.id) || null,
        debt: fin ? debt : undefined, payment_status: fin ? pay : undefined,
        min_remaining: remain.length ? Math.min(...remain) : null,
        paid: summary ? es.reduce((t, e) => t + (summary.get(e.id)?.paid || 0), 0) : undefined,
        fee_end: summary ? feeEnd : undefined,
        fee_days_left: summary && feeEnd ? Math.round((Date.parse(feeEnd) - Date.parse(today)) / 86400000) : undefined,
        awaiting_approval: es.some((e) => e.status === 'pending_approval'),
      };
    });
    if (payment && fin) items = items.filter((x) => x.payment_status === payment || (payment === 'debt' && x.debt > 0));
    if (renewal) items = items.filter((x) => x.min_remaining !== null && x.min_remaining <= RENEWAL_THRESHOLD);
    const allTags = [...new Set(db.prepare(`SELECT tags FROM students WHERE tags != ''`).all().flatMap((x) => tagsOf(x.tags)))].sort((a, b) => a.localeCompare(b, 'vi'));
    res.json({ items, statusLabels: STUDENT_STATUS, tags: allTags });
  });

  // Gắn tag cho học viên
  r.put('/:id/tags', can('students.edit'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) throw notFound('Không tìm thấy học viên.');
    const b = parse(z.object({ tags: z.array(z.string().trim().min(1).max(30, 'Tag tối đa 30 ký tự.')).max(10, 'Tối đa 10 tag.') }), req.body);
    const tags = normTags(b.tags);
    db.prepare('UPDATE students SET tags = ?, updated_at = ? WHERE id = ?').run(tags.join(','), nowIso(), id);
    res.json({ tags });
  });

  // Nhập học viên từ file (client đọc Excel/CSV, gửi các dòng). commit=false: chỉ kiểm tra; commit=true: tạo các dòng hợp lệ.
  r.post('/import', can('students.import'), (req, res) => {
    const b = parse(z.object({ rows: z.array(z.record(z.string(), z.any())).max(1000, 'Mỗi lần nhập tối đa 1000 dòng.'), commit: z.boolean().default(false) }), req.body);
    const REL = ['Bố', 'Mẹ', 'Ông', 'Bà', 'Người giám hộ'];
    const seen = new Set();
    const results = b.rows.map((raw, i) => {
      const g = (k) => (raw[k] === undefined || raw[k] === null ? '' : String(raw[k]).trim());
      const errors = []; const warnings = [];
      const row = {
        student_name: g('student_name'), dob: parseDob(g('dob')), gender: { nam: 'male', 'nữ': 'female', nu: 'female', male: 'male', female: 'female' }[g('gender').toLowerCase()] || null,
        school: g('school') || null, parent_name: g('parent_name'), phone: g('phone').replace(/[\s.-]/g, ''), relationship: g('relationship') || 'Mẹ',
        parent_email: g('parent_email').toLowerCase() || null, note: g('note') || null, tags: normTags(g('tags').split(/[;,]/)),
      };
      if (!row.student_name) errors.push('Thiếu họ tên học viên');
      if (!row.parent_name) errors.push('Thiếu tên phụ huynh');
      if (!/^0\d{9,10}$/.test(row.phone)) errors.push('Số điện thoại không hợp lệ (10–11 số, bắt đầu bằng 0)');
      if (row.dob === 'invalid') errors.push('Ngày sinh không hợp lệ (dd/mm/yyyy)');
      if (g('gender') && !row.gender) warnings.push('Giới tính không rõ, để trống');
      if (!REL.includes(row.relationship)) { warnings.push(`Quan hệ "${row.relationship}" không có trong danh sách, dùng "Mẹ"`); row.relationship = 'Mẹ'; }
      if (row.parent_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.parent_email)) { warnings.push('Email không hợp lệ, bỏ qua'); row.parent_email = null; }
      const key = `${row.student_name.toLowerCase()}|${row.phone}`;
      if (seen.has(key)) errors.push('Trùng với dòng khác trong file');
      seen.add(key);
      let parent = null;
      if (!errors.length) {
        parent = db.prepare('SELECT * FROM parents WHERE phone = ? ORDER BY id LIMIT 1').get(row.phone);
        if (parent) {
          const dupStudent = db.prepare(`SELECT s.code FROM students s JOIN student_contacts sc ON sc.student_id = s.id WHERE sc.parent_id = ? AND lower(s.full_name) = lower(?)`).get(parent.id, row.student_name);
          if (dupStudent) errors.push(`Đã có học viên ${dupStudent.code} cùng tên, cùng phụ huynh`);
          else warnings.push(`Liên kết với phụ huynh có sẵn: ${parent.full_name}`);
        }
      }
      return { row: i + 1, data: row, errors, warnings, parentId: parent?.id ?? null, ok: errors.length === 0 };
    });
    let created = [];
    if (b.commit) {
      created = db.transaction(() => results.filter((x) => x.ok).map((x) => {
        const ts = nowIso();
        const d = x.data;
        let pid = x.parentId;
        if (!pid) pid = Number(db.prepare('INSERT INTO parents(full_name, phone, email, created_at) VALUES (?,?,?,?)').run(d.parent_name, d.phone, d.parent_email, ts).lastInsertRowid);
        const sid = Number(db.prepare(`INSERT INTO students(code, full_name, dob, gender, school, note, tags, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?)`)
          .run(nextCode(db, 'student', 'HV-', 4), d.student_name, d.dob, d.gender, d.school, d.note, d.tags.join(','), ts, ts).lastInsertRowid);
        db.prepare('INSERT INTO student_contacts(student_id, parent_id, relationship, is_primary) VALUES (?,?,?,1)').run(sid, pid, d.relationship);
        logActivity(db, { entityType: 'student', entityId: sid, action: 'imported', summary: 'Nhập hồ sơ từ file', userId: req.user.id });
        return sid;
      }))();
    }
    res.json({ results, valid: results.filter((x) => x.ok).length, invalid: results.filter((x) => !x.ok).length, created: created.length });
  });

  // Tạo học viên trực tiếp (không qua tuyển sinh), kèm người liên hệ
  r.post('/', can('students.edit'), (req, res) => {
    const b = parse(z.object({
      student: studentSchema,
      parent: z.object({ mode: z.enum(['existing', 'new']), parent_id: v.optId(), relationship: z.enum(RELATIONSHIPS, { error: 'Chọn quan hệ.' }) }).passthrough(),
    }), req.body);
    let parentData = null;
    if (b.parent.mode === 'new') parentData = parse(z.object({ parent: parentSchema }).passthrough(), req.body).parent;
    else if (!b.parent.parent_id) throw badRequest('Chọn phụ huynh có sẵn.', { 'parent.parent_id': 'Chọn phụ huynh.' });
    const id = db.transaction(() => {
      const ts = nowIso();
      let pid = b.parent.parent_id;
      if (parentData) pid = Number(db.prepare('INSERT INTO parents(full_name, phone, email, address, occupation, note, created_at) VALUES (?,?,?,?,?,?,?)').run(parentData.full_name, parentData.phone, parentData.email, parentData.address, parentData.occupation, parentData.note, ts).lastInsertRowid);
      const sid = Number(db.prepare(`INSERT INTO students(code, full_name, dob, gender, school, note, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'active',?,?)`)
        .run(nextCode(db, 'student', 'HV-', 4), b.student.full_name, b.student.dob, b.student.gender || null, b.student.school, b.student.note, ts, ts).lastInsertRowid);
      db.prepare('INSERT INTO student_contacts(student_id, parent_id, relationship, is_primary) VALUES (?,?,?,1)').run(sid, pid, b.parent.relationship);
      logActivity(db, { entityType: 'student', entityId: sid, action: 'created', summary: 'Tạo hồ sơ học viên trực tiếp', userId: req.user.id });
      return sid;
    })();
    res.status(201).json({ id });
  });

  r.get('/:id', viewAny, (req, res) => {
    const id = Number(req.params.id);
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!s) throw notFound('Không tìm thấy học viên.');
    assertStudentVisible(db, req.user, id);
    const canFinance = has(req.user, 'finance.view');
    const canContacts = has(req.user, 'students.contacts');
    const canCare = has(req.user, 'care.view');
    // Chỉ giới hạn theo lớp với người chỉ được xem học viên lớp mình (giáo viên)
    const visibleClasses = has(req.user, 'students.view') ? null : visibleClassIds(db, req.user);

    let enrollments = db.prepare(`SELECT e.*, co.name AS course_name, co.level, c.code AS class_code, c.name AS class_name, c.schedule_json, c.status AS class_status,
        t.full_name AS teacher_name, h.full_name AS homeroom_name, p.name AS package_name, p.months AS package_months
      FROM enrollments e JOIN courses co ON co.id = e.course_id LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN users t ON t.id = c.teacher_id
      LEFT JOIN users h ON h.id = c.homeroom_id LEFT JOIN fee_packages p ON p.id = e.package_id
      WHERE e.student_id = ? ORDER BY e.enrolled_at DESC`).all(id);
    if (visibleClasses !== null) enrollments = enrollments.filter((e) => e.class_id && visibleClasses.includes(e.class_id));
    const usage = sessionUsage(db, enrollments.map((e) => e.id));
    const fin = canFinance ? computeFinance(db, { enrollmentIds: enrollments.map((e) => e.id) }) : null;
    const sum = !canFinance && has(req.user, 'finance.summary') ? computeFinance(db, { enrollmentIds: enrollments.map((e) => e.id) }) : null;
    const ends = expectedEndDates(db, enrollments.map((e) => e.id), { usage });
    enrollments = enrollments.map((e) => ({
      ...e, idempotency_key: undefined, usage: usage.get(e.id), expected_end: ends.get(e.id) || null,
      finance: fin ? fin.get(e.id) : undefined,
      fee_summary: sum ? { paid: sum.get(e.id).paid, net: sum.get(e.id).net, paymentStatus: sum.get(e.id).paymentStatus } : undefined,
      discounts: canFinance ? db.prepare(`SELECT d.*, a.code AS approval_code FROM discounts d LEFT JOIN approvals a ON a.id = d.approval_id WHERE d.enrollment_id = ? ORDER BY d.created_at`).all(e.id) : undefined,
    }));

    let attendance = db.prepare(`SELECT a.*, s.date, s.start_time, s.end_time, s.topic, s.kind, s.title, c.code AS class_code, c.id AS class_id,
        m.id AS makeup_id_for_absence, m.status AS makeup_status, ms.date AS makeup_date, ms.start_time AS makeup_time
      FROM attendance a JOIN class_sessions s ON s.id = a.session_id LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN makeups m ON m.absence_attendance_id = a.id AND m.status != 'cancelled' LEFT JOIN class_sessions ms ON ms.id = m.makeup_session_id
      WHERE a.student_id = ? ORDER BY s.date DESC, s.start_time DESC`).all(id);
    if (visibleClasses !== null) attendance = attendance.filter((a) => a.class_id === null || visibleClasses.includes(a.class_id));

    const contacts = canContacts ? db.prepare(`SELECT p.*, sc.relationship, sc.is_primary,
        (SELECT group_concat(s2.full_name || '|' || s2.id, ';') FROM student_contacts sc2 JOIN students s2 ON s2.id = sc2.student_id WHERE sc2.parent_id = p.id AND s2.id != ?) AS siblings
      FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id WHERE sc.student_id = ? ORDER BY sc.is_primary DESC`).all(id, id) : null;

    const receipts = canFinance ? db.prepare(`SELECT r.*, u.full_name AS collector, e.code AS enrollment_code FROM receipts r LEFT JOIN users u ON u.id = r.collected_by JOIN enrollments e ON e.id = r.enrollment_id WHERE r.student_id = ? ORDER BY r.paid_at DESC, r.id DESC`).all(id) : null;
    const refunds = canFinance ? db.prepare(`SELECT f.*, a.code AS approval_code, a.status AS approval_status FROM refunds f LEFT JOIN approvals a ON a.id = f.approval_id WHERE f.student_id = ? ORDER BY f.created_at DESC`).all(id) : null;
    const care = canCare ? db.prepare(`SELECT c.*, u.full_name AS owner_name FROM care_cases c LEFT JOIN users u ON u.id = c.owner_id WHERE c.student_id = ? ORDER BY c.created_at DESC`).all(id) : null;
    const careLogs = canCare ? db.prepare(`SELECT l.*, u.full_name AS by_name, c.title AS case_title FROM care_logs l JOIN care_cases c ON c.id = l.case_id LEFT JOIN users u ON u.id = l.created_by WHERE c.student_id = ? ORDER BY l.created_at DESC`).all(id) : null;

    // Lịch sử xuyên suốt: tư vấn → học thử → đăng ký → học tập → chăm sóc
    const timeline = [];
    if (s.lead_id && (has(req.user, 'leads.view') || canCare)) {
      const lead = db.prepare('SELECT code, source, created_at FROM leads WHERE id = ?').get(s.lead_id);
      timeline.push({ at: lead.created_at, kind: 'lead', text: `Khách quan tâm ${lead.code} (nguồn ${lead.source})`, link: has(req.user, 'leads.view') ? `/leads/${s.lead_id}` : null });
      for (const a of db.prepare(`SELECT a.*, u.full_name AS by_name FROM lead_activities a LEFT JOIN users u ON u.id = a.created_by WHERE lead_id = ?`).all(s.lead_id)) {
        timeline.push({ at: a.created_at, kind: a.type === 'trial' ? 'trial' : 'consult', text: a.content, by: a.by_name });
      }
    }
    if (visibleClasses === null) {
      for (const a of db.prepare(`SELECT l.*, u.full_name AS by_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE entity_type = 'student' AND entity_id = ?`).all(id)) {
        timeline.push({ at: a.created_at, kind: a.action, text: a.summary, by: a.by_name });
      }
      if (canFinance) for (const rc of receipts) timeline.push({ at: rc.created_at, kind: 'receipt', text: `Phiếu thu ${rc.code}: ${rc.amount.toLocaleString('vi-VN')} đ${rc.status === 'cancelled' ? ' (đã hủy)' : ''}`, by: rc.collector });
      if (canCare) for (const c of care) timeline.push({ at: c.created_at, kind: 'care', text: `Chăm sóc: ${c.title}`, by: c.owner_name });
    }
    timeline.sort((a, b) => (a.at < b.at ? 1 : -1));

    const summary = {
      attended: attendance.filter((a) => ['present', 'late'].includes(a.status) && !a.is_makeup).length,
      absences: attendance.filter((a) => ['absent', 'excused'].includes(a.status)).length,
      openCare: care ? care.filter((c) => c.status !== 'done').length : undefined,
      debt: fin ? [...fin.values()].reduce((t, f) => t + f.debt, 0) : undefined,
    };
    // Học tập: chỉ số toàn khóa và tháng này, điểm kiểm tra, nhận xét gần đây
    const today = vnToday();
    const learning = {
      all: learningStats(db, [id]).get(id),
      month: learningStats(db, [id], { from: startOfMonth(today), to: endOfMonth(today) }).get(id),
      monthKey: monthOf(today),
      assessments: db.prepare(`SELECT a.*, c.code AS class_code, u.full_name AS created_by_name FROM assessments a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN users u ON u.id = a.created_by
        WHERE a.student_id = ? ORDER BY a.taken_at DESC`).all(id).filter((a) => visibleClasses === null || visibleClasses.includes(a.class_id)),
      comments: attendance.filter((a) => a.comment || a.homework_status).slice(0, 30).map((a) => ({ date: a.date, class_code: a.class_code, status: a.status, homework_status: a.homework_status, homework_score: a.homework_score, comment: a.comment, topic: a.topic })),
      kinds: ASSESSMENT_KIND, homeworkLabels: HOMEWORK_LABEL,
    };
    const wallet = canFinance ? {
      balance: walletBalances(db, [id]).get(id),
      items: db.prepare(`SELECT w.*, u.full_name AS created_by_name, r.code AS receipt_code FROM wallet_entries w LEFT JOIN users u ON u.id = w.created_by LEFT JOIN receipts r ON r.id = w.receipt_id WHERE w.student_id = ? ORDER BY w.created_at DESC`).all(id),
      kindLabels: WALLET_KIND,
    } : null;
    const checkins = db.prepare('SELECT date, checked_at FROM checkins WHERE student_id = ? ORDER BY date DESC LIMIT 10').all(id);
    res.json({ student: { ...s, tags: tagsOf(s.tags) }, contacts, enrollments, attendance, receipts, refunds, care, careLogs, timeline, summary, learning, wallet, checkins, statusLabels: STUDENT_STATUS, tagSuggestions: TAG_SUGGESTIONS,
      can: {
        finance: canFinance, contacts: canContacts, care: canCare, edit: has(req.user, 'students.edit'),
        collect: has(req.user, 'finance.collect'), request: has(req.user, 'requests.create'), checkin: has(req.user, 'checkin.edit'),
      } });
  });

  r.put('/:id', can('students.edit'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) throw notFound('Không tìm thấy học viên.');
    const b = parse(studentSchema, req.body);
    db.prepare('UPDATE students SET full_name=?, dob=?, gender=?, school=?, note=?, updated_at=? WHERE id=?').run(b.full_name, b.dob, b.gender || null, b.school, b.note, nowIso(), id);
    logActivity(db, { entityType: 'student', entityId: id, action: 'updated', summary: 'Cập nhật thông tin học viên', userId: req.user.id });
    res.json({ ok: true });
  });

  r.post('/:id/contacts', can('students.edit'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) throw notFound('Không tìm thấy học viên.');
    const b = parse(z.object({ mode: z.enum(['existing', 'new']), parent_id: v.optId(), relationship: z.enum(RELATIONSHIPS, { error: 'Chọn quan hệ.' }), is_primary: z.boolean().optional() }).passthrough(), req.body);
    db.transaction(() => {
      let pid = b.parent_id;
      if (b.mode === 'new') {
        const p = parse(parentSchema, req.body);
        pid = Number(db.prepare('INSERT INTO parents(full_name, phone, email, address, occupation, note, created_at) VALUES (?,?,?,?,?,?,?)').run(p.full_name, p.phone, p.email, p.address, p.occupation, p.note, nowIso()).lastInsertRowid);
      } else if (!pid || !db.prepare('SELECT 1 FROM parents WHERE id = ?').get(pid)) throw badRequest('Chọn phụ huynh có sẵn.', { parent_id: 'Chọn phụ huynh.' });
      if (db.prepare('SELECT 1 FROM student_contacts WHERE student_id = ? AND parent_id = ?').get(id, pid)) throw conflict('Người liên hệ này đã được liên kết.');
      if (b.is_primary) db.prepare('UPDATE student_contacts SET is_primary = 0 WHERE student_id = ?').run(id);
      const hasPrimary = db.prepare('SELECT 1 FROM student_contacts WHERE student_id = ? AND is_primary = 1').get(id);
      db.prepare('INSERT INTO student_contacts(student_id, parent_id, relationship, is_primary) VALUES (?,?,?,?)').run(id, pid, b.relationship, b.is_primary || !hasPrimary ? 1 : 0);
      logActivity(db, { entityType: 'student', entityId: id, action: 'contact_added', summary: `Liên kết người liên hệ (${b.relationship})`, userId: req.user.id });
    })();
    res.status(201).json({ ok: true });
  });

  r.post('/:id/contacts/:pid/primary', can('students.edit'), (req, res) => {
    const id = Number(req.params.id); const pid = Number(req.params.pid);
    if (!db.prepare('SELECT 1 FROM student_contacts WHERE student_id = ? AND parent_id = ?').get(id, pid)) throw notFound('Không tìm thấy liên kết.');
    db.transaction(() => {
      db.prepare('UPDATE student_contacts SET is_primary = 0 WHERE student_id = ?').run(id);
      db.prepare('UPDATE student_contacts SET is_primary = 1 WHERE student_id = ? AND parent_id = ?').run(id, pid);
    })();
    res.json({ ok: true });
  });

  r.delete('/:id/contacts/:pid', can('students.edit'), (req, res) => {
    const id = Number(req.params.id); const pid = Number(req.params.pid);
    const n = db.prepare('SELECT COUNT(*) n FROM student_contacts WHERE student_id = ?').get(id).n;
    if (n <= 1) throw conflict('Học viên cần ít nhất một người liên hệ.');
    const link = db.prepare('SELECT * FROM student_contacts WHERE student_id = ? AND parent_id = ?').get(id, pid);
    if (!link) throw notFound('Không tìm thấy liên kết.');
    db.transaction(() => {
      db.prepare('DELETE FROM student_contacts WHERE student_id = ? AND parent_id = ?').run(id, pid);
      if (link.is_primary) db.prepare('UPDATE student_contacts SET is_primary = 1 WHERE rowid = (SELECT rowid FROM student_contacts WHERE student_id = ? LIMIT 1)').run(id);
      logActivity(db, { entityType: 'student', entityId: id, action: 'contact_removed', summary: `Gỡ liên kết người liên hệ (${link.relationship})`, userId: req.user.id });
    })();
    res.json({ ok: true });
  });

  // Hồ sơ đã phát sinh nghiệp vụ: lưu trữ có lý do, không xóa cứng
  r.post('/:id/archive', can('students.edit'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ reason: v.text(500, 'lý do lưu trữ') }), req.body);
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!s) throw notFound('Không tìm thấy học viên.');
    const active = db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE student_id = ? AND status IN ('active','pending_class')`).get(id).n;
    if (active) throw conflict('Học viên còn đăng ký đang hiệu lực. Hủy hoặc kết thúc đăng ký trước khi lưu trữ.');
    db.prepare(`UPDATE students SET status = 'archived', archived_reason = ?, updated_at = ? WHERE id = ?`).run(b.reason, nowIso(), id);
    logActivity(db, { entityType: 'student', entityId: id, action: 'archived', summary: `Lưu trữ hồ sơ: ${b.reason}`, userId: req.user.id });
    res.json({ ok: true });
  });
  r.post('/:id/restore', can('students.edit'), (req, res) => {
    const id = Number(req.params.id);
    const s = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!s) throw notFound('Không tìm thấy học viên.');
    if (s.status !== 'archived') throw conflict('Hồ sơ không ở trạng thái lưu trữ.');
    db.prepare(`UPDATE students SET status = 'inactive', archived_reason = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), id);
    logActivity(db, { entityType: 'student', entityId: id, action: 'restored', summary: 'Khôi phục hồ sơ từ lưu trữ', userId: req.user.id });
    res.json({ ok: true });
  });

  return r;
}
