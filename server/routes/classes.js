import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest, forbidden } from '../lib/http.js';
import { nowIso, vnToday } from '../lib/time.js';
import { logActivity } from '../db/index.js';
import { visibleClassIds } from '../lib/scope.js';
import { generateDates, findConflicts, describePattern } from '../services/schedule.js';
import { classOccupancy, assignClass } from '../services/enrollments.js';
import { sessionUsage } from '../services/attendance.js';
import { computeFinance } from '../services/finance.js';
import { expectedEndDates } from '../services/packages.js';
import { learningStats, FLAG_RATE } from '../services/learning.js';

export const CLASS_STATUS = { planned: 'Sắp khai giảng', active: 'Đang học', finished: 'Đã kết thúc', cancelled: 'Đã hủy' };

const slotSchema = z.object({ weekday: z.coerce.number().int().min(1).max(7), start: v.time('giờ bắt đầu'), end: v.time('giờ kết thúc') })
  .refine((s) => s.end > s.start, { message: 'Giờ kết thúc phải sau giờ bắt đầu.', path: ['end'] });

const courseSchema = z.object({
  code: v.text(20, 'mã khóa'), name: v.text(120, 'tên khóa'), program: v.text(80, 'chương trình'), level: v.text(80, 'trình độ'),
  age_range: v.optText(40), total_sessions: v.int(1, 200, 'số buổi'), session_minutes: v.int(30, 240, 'thời lượng buổi'),
  tuition_fee: v.money('học phí'), description: v.optText(1000), status: z.enum(['active', 'archived']).default('active'), next_course_id: v.optId(),
});

export function classRoutes({ db }) {
  const r = Router();

  // ---------- Danh mục khóa học ----------
  r.get('/courses', can('classes.view', 'classes.view_own', 'enrollments.create'), (_req, res) => {
    const rows = db.prepare(`SELECT co.*, n.name AS next_course_name,
      (SELECT COUNT(*) FROM classes c WHERE c.course_id = co.id AND c.status IN ('planned','active')) AS open_classes,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = co.id AND e.status = 'active') AS active_students
      FROM courses co LEFT JOIN courses n ON n.id = co.next_course_id ORDER BY co.id`).all();
    res.json({ items: rows });
  });
  r.post('/courses', can('classes.edit'), (req, res) => {
    const b = parse(courseSchema, req.body);
    if (db.prepare('SELECT 1 FROM courses WHERE code = ?').get(b.code)) throw badRequest('Mã khóa đã tồn tại.', { code: 'Mã khóa đã tồn tại.' });
    const id = Number(db.prepare(`INSERT INTO courses(code, name, program, level, age_range, total_sessions, session_minutes, tuition_fee, description, status, next_course_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(b.code, b.name, b.program, b.level, b.age_range, b.total_sessions, b.session_minutes, b.tuition_fee, b.description, b.status, b.next_course_id).lastInsertRowid);
    res.status(201).json({ id });
  });
  r.put('/courses/:id', can('classes.edit'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(id)) throw notFound('Không tìm thấy khóa học.');
    const b = parse(courseSchema, req.body);
    if (db.prepare('SELECT 1 FROM courses WHERE code = ? AND id != ?').get(b.code, id)) throw badRequest('Mã khóa đã tồn tại.', { code: 'Mã khóa đã tồn tại.' });
    if (b.next_course_id === id) throw badRequest('Khóa tiếp theo không được là chính nó.', { next_course_id: 'Chọn khóa khác.' });
    // Học phí mới chỉ áp dụng cho đăng ký mới; đăng ký cũ giữ học phí tại thời điểm đăng ký.
    db.prepare(`UPDATE courses SET code=?, name=?, program=?, level=?, age_range=?, total_sessions=?, session_minutes=?, tuition_fee=?, description=?, status=?, next_course_id=? WHERE id=?`)
      .run(b.code, b.name, b.program, b.level, b.age_range, b.total_sessions, b.session_minutes, b.tuition_fee, b.description, b.status, b.next_course_id, id);
    res.json({ ok: true });
  });

  // ---------- Lớp học ----------
  r.get('/', can('classes.view', 'classes.view_own'), (req, res) => {
    const ids = visibleClassIds(db, req.user);
    const { status, course_id, teacher_id, q } = req.query;
    const where = [];
    const args = [];
    if (ids !== null) where.push(`c.id IN (${ids.length ? ids.join(',') : 'NULL'})`);
    if (status && status !== 'all') { where.push('c.status = ?'); args.push(status); } else if (!status) where.push(`c.status IN ('planned','active')`);
    if (course_id) { where.push('c.course_id = ?'); args.push(Number(course_id)); }
    if (teacher_id) { where.push('(c.teacher_id = ? OR c.assistant_id = ?)'); args.push(Number(teacher_id), Number(teacher_id)); }
    if (q) { where.push('(c.code LIKE ? OR c.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const today = vnToday();
    const rows = db.prepare(`SELECT c.*, co.name AS course_name, co.level, r.name AS room_name, t.full_name AS teacher_name, a.full_name AS assistant_name, hr.full_name AS homeroom_name,
        (SELECT COUNT(*) FROM class_sessions s WHERE s.class_id = c.id AND s.status = 'done') AS sessions_done,
        (SELECT COUNT(*) FROM class_sessions s WHERE s.class_id = c.id AND s.status != 'cancelled') AS sessions_total,
        (SELECT s.date || ' ' || s.start_time FROM class_sessions s WHERE s.class_id = c.id AND s.status = 'scheduled' AND s.date >= ? ORDER BY s.date, s.start_time LIMIT 1) AS next_session
      FROM classes c JOIN courses co ON co.id = c.course_id LEFT JOIN rooms r ON r.id = c.room_id LEFT JOIN users t ON t.id = c.teacher_id LEFT JOIN users a ON a.id = c.assistant_id LEFT JOIN users hr ON hr.id = c.homeroom_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, c.code`).all(today, ...args);
    res.json({ items: rows.map((c) => ({ ...c, occupancy: classOccupancy(db, c.id), schedule: describePattern(JSON.parse(c.schedule_json)) })), statusLabels: CLASS_STATUS });
  });

  r.post('/', can('classes.edit'), (req, res) => {
    const b = parse(z.object({
      code: v.text(20, 'mã lớp'), name: v.text(120, 'tên lớp'), course_id: v.id('khóa học'), room_id: v.id('phòng học'),
      teacher_id: v.id('giáo viên'), assistant_id: v.optId(), homeroom_id: v.optId(), max_students: v.int(1, 40, 'sĩ số tối đa'), start_date: v.date('ngày khai giảng'),
      schedule: z.array(slotSchema).min(1, 'Cần ít nhất một khung giờ học trong tuần.').max(7), note: v.optText(500),
    }), req.body);
    if (db.prepare('SELECT 1 FROM classes WHERE code = ?').get(b.code)) throw badRequest('Mã lớp đã tồn tại.', { code: 'Mã lớp đã tồn tại.' });
    if (b.assistant_id && b.assistant_id === b.teacher_id) throw badRequest('Trợ giảng phải khác giáo viên.', { assistant_id: 'Trợ giảng phải khác giáo viên.' });
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(b.room_id);
    if (!room) throw badRequest('Phòng không hợp lệ.', { room_id: 'Chọn phòng.' });
    if (b.max_students > room.capacity) throw badRequest(`Sĩ số tối đa vượt sức chứa phòng ${room.name} (${room.capacity}).`, { max_students: `Tối đa ${room.capacity} theo sức chứa phòng.` });
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(b.course_id);
    if (!course) throw badRequest('Khóa học không hợp lệ.', { course_id: 'Chọn khóa học.' });
    const dates = generateDates({ startDate: b.start_date, pattern: b.schedule, count: course.total_sessions });
    const conflicts = [];
    for (const d of dates) {
      for (const c of findConflicts(db, { date: d.date, start: d.start, end: d.end, roomId: b.room_id, teacherId: b.teacher_id, assistantId: b.assistant_id })) {
        conflicts.push({ ...c, message: `${d.date.split('-').reverse().join('/')}: ${c.message}` });
      }
    }
    if (conflicts.length) throw conflict(`Lịch lớp bị trùng ${conflicts.length} lần. Đổi phòng, giáo viên hoặc khung giờ.`, { conflicts: conflicts.slice(0, 10) });
    const ts = nowIso();
    const id = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO classes(code, name, course_id, room_id, teacher_id, assistant_id, homeroom_id, max_students, start_date, end_date, schedule_json, status, note, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.code, b.name, b.course_id, b.room_id, b.teacher_id, b.assistant_id, b.homeroom_id, b.max_students, dates[0].date, dates.at(-1).date,
        JSON.stringify(b.schedule), dates[0].date > vnToday() ? 'planned' : 'active', b.note, ts).lastInsertRowid);
      const ins = db.prepare(`INSERT INTO class_sessions(class_id, date, start_time, end_time, room_id, teacher_id, assistant_id, kind, seq_no, status, created_at) VALUES (?,?,?,?,?,?,?,'regular',?,'scheduled',?)`);
      dates.forEach((d, i) => ins.run(id, d.date, d.start, d.end, b.room_id, b.teacher_id, b.assistant_id, i + 1, ts));
      logActivity(db, { entityType: 'class', entityId: id, action: 'created', summary: `Tạo lớp ${b.code} với ${dates.length} buổi`, userId: req.user.id });
      return id;
    })();
    res.status(201).json({ id, sessions: dates.length });
  });

  r.get('/:id', can('classes.view', 'classes.view_own'), (req, res) => {
    const id = Number(req.params.id);
    const ids = visibleClassIds(db, req.user);
    if (ids !== null && !ids.includes(id)) throw forbidden('Bạn chỉ xem được lớp mình phụ trách.');
    const c = db.prepare(`SELECT c.*, co.name AS course_name, co.level, co.total_sessions, r.name AS room_name, r.capacity AS room_capacity, t.full_name AS teacher_name, a.full_name AS assistant_name, hr.full_name AS homeroom_name
      FROM classes c JOIN courses co ON co.id = c.course_id LEFT JOIN rooms r ON r.id = c.room_id LEFT JOIN users t ON t.id = c.teacher_id LEFT JOIN users a ON a.id = c.assistant_id LEFT JOIN users hr ON hr.id = c.homeroom_id WHERE c.id = ?`).get(id);
    if (!c) throw notFound('Không tìm thấy lớp.');
    const enrolls = db.prepare(`SELECT e.id AS enrollment_id, e.status, e.class_joined_at, s.id, s.code, s.full_name, s.dob FROM enrollments e JOIN students s ON s.id = e.student_id
      WHERE e.class_id = ? AND e.status IN ('active','completed') ORDER BY s.full_name`).all(id);
    const usage = sessionUsage(db, enrolls.map((e) => e.enrollment_id));
    const eids = enrolls.map((e) => e.enrollment_id);
    const showFee = has(req.user, 'finance.view') || has(req.user, 'finance.summary');
    const fin = showFee ? computeFinance(db, { enrollmentIds: eids }) : null;
    const ends = expectedEndDates(db, eids, { usage });
    const stats = learningStats(db, enrolls.map((e) => e.id));
    const lastPay = new Map(eids.length ? db.prepare(`SELECT enrollment_id, MAX(paid_at) d FROM receipts WHERE status = 'confirmed' AND enrollment_id IN (${eids.join(',')}) GROUP BY enrollment_id`).all().map((x) => [x.enrollment_id, x.d]) : []);
    const contacts = has(req.user, 'students.contacts');
    const students = enrolls.map((e) => ({
      ...e, usage: usage.get(e.enrollment_id), payment_status: fin?.get(e.enrollment_id)?.paymentStatus,
      paid: fin?.get(e.enrollment_id)?.paid, debt: fin?.get(e.enrollment_id)?.debt, last_paid_at: showFee ? lastPay.get(e.enrollment_id) || null : undefined,
      expected_end: ends.get(e.enrollment_id), stats: stats.get(e.id),
      flags: [
        stats.get(e.id)?.marked >= 4 && stats.get(e.id).attendanceRate < FLAG_RATE ? `Chuyên cần ${stats.get(e.id).attendanceRate}%` : null,
        stats.get(e.id)?.hwGraded >= 3 && stats.get(e.id).homeworkDoneRate < FLAG_RATE ? `BTVN ${stats.get(e.id).homeworkDoneRate}%` : null,
      ].filter(Boolean),
      parent: contacts ? db.prepare(`SELECT p.full_name, p.phone, sc.relationship FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id WHERE sc.student_id = ? AND sc.is_primary = 1`).get(e.id) : undefined,
    }));
    const sessions = db.prepare(`SELECT s.*, r.name AS room_name, t.full_name AS teacher_name,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status IN ('present','late')) AS present_count,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) AS marked_count
      FROM class_sessions s LEFT JOIN rooms r ON r.id = s.room_id LEFT JOIN users t ON t.id = s.teacher_id WHERE s.class_id = ? ORDER BY s.date, s.start_time`).all(id);
    const history = db.prepare(`SELECT l.*, u.full_name AS by_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE entity_type = 'class' AND entity_id = ? ORDER BY created_at DESC`).all(id);
    const events = db.prepare(`SELECT * FROM class_events WHERE class_id = ? ORDER BY date DESC LIMIT 24`).all(id);
    const own = has(req.user, 'classes.edit') || c.homeroom_id === req.user.id || c.teacher_id === req.user.id;
    res.json({
      class: { ...c, schedule: JSON.parse(c.schedule_json), schedule_text: describePattern(JSON.parse(c.schedule_json)), occupancy: classOccupancy(db, id) },
      students, sessions, history, events, statusLabels: CLASS_STATUS, flagRate: FLAG_RATE,
      can: { edit: has(req.user, 'classes.edit'), schedule: has(req.user, 'schedule.edit'), finance: !!fin, contacts, events: own && (has(req.user, 'class_events.edit') || has(req.user, 'classes.edit')), renew: has(req.user, 'enrollments.create') },
    });
  });

  r.put('/:id', can('classes.edit'), (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
    if (!c) throw notFound('Không tìm thấy lớp.');
    const b = parse(z.object({
      name: v.text(120, 'tên lớp'), room_id: v.id('phòng học'), teacher_id: v.id('giáo viên'), assistant_id: v.optId(), homeroom_id: v.optId(),
      max_students: v.int(1, 40, 'sĩ số tối đa'), status: z.enum(['planned', 'active', 'finished', 'cancelled']), note: v.optText(500),
    }), req.body);
    if (b.assistant_id && b.assistant_id === b.teacher_id) throw badRequest('Trợ giảng phải khác giáo viên.', { assistant_id: 'Trợ giảng phải khác giáo viên.' });
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(b.room_id);
    if (b.max_students > room.capacity) throw badRequest(`Sĩ số tối đa vượt sức chứa phòng ${room.name} (${room.capacity}).`, { max_students: `Tối đa ${room.capacity} theo sức chứa phòng.` });
    const occ = classOccupancy(db, id);
    if (b.max_students < occ) throw badRequest(`Lớp đang có ${occ} học viên, sĩ số tối đa không được nhỏ hơn.`, { max_students: `Tối thiểu ${occ}.` });
    const today = vnToday();
    const changedResources = b.room_id !== c.room_id || b.teacher_id !== c.teacher_id || (b.assistant_id || null) !== (c.assistant_id || null);
    if (changedResources) {
      // Áp dụng cho các buổi CHƯA diễn ra; kiểm tra trùng lịch trước khi lưu
      const future = db.prepare(`SELECT * FROM class_sessions WHERE class_id = ? AND date >= ? AND status = 'scheduled'`).all(id, today);
      const conflicts = [];
      for (const s of future) {
        for (const x of findConflicts(db, { date: s.date, start: s.start_time, end: s.end_time, roomId: b.room_id, teacherId: b.teacher_id, assistantId: b.assistant_id, excludeSessionId: s.id })) {
          conflicts.push({ ...x, message: `${s.date.split('-').reverse().join('/')}: ${x.message}` });
        }
      }
      if (conflicts.length) throw conflict('Thay đổi gây trùng lịch ở các buổi sắp tới.', { conflicts: conflicts.slice(0, 10) });
    }
    db.transaction(() => {
      db.prepare('UPDATE classes SET name=?, room_id=?, teacher_id=?, assistant_id=?, homeroom_id=?, max_students=?, status=?, note=? WHERE id=?')
        .run(b.name, b.room_id, b.teacher_id, b.assistant_id, b.homeroom_id, b.max_students, b.status, b.note, id);
      if (changedResources) {
        db.prepare(`UPDATE class_sessions SET room_id = ?, teacher_id = ?, assistant_id = ? WHERE class_id = ? AND date >= ? AND status = 'scheduled'`).run(b.room_id, b.teacher_id, b.assistant_id, id, today);
      }
      logActivity(db, { entityType: 'class', entityId: id, action: 'updated', summary: `Cập nhật thông tin lớp${changedResources ? ' (áp dụng phòng/giáo viên mới cho các buổi sắp tới)' : ''}`, userId: req.user.id });
    })();
    res.json({ ok: true });
  });

  // Đăng ký đang chờ xếp lớp phù hợp với khóa của lớp này
  r.get('/:id/candidates', can('classes.edit'), (req, res) => {
    const c = db.prepare('SELECT * FROM classes WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy lớp.');
    const rows = db.prepare(`SELECT e.id AS enrollment_id, e.code, e.status, s.id AS student_id, s.full_name, s.code AS student_code FROM enrollments e JOIN students s ON s.id = e.student_id
      WHERE e.course_id = ? AND e.status IN ('pending_class','reserved') ORDER BY e.enrolled_at`).all(c.course_id);
    res.json({ items: rows });
  });

  r.post('/:id/students', can('classes.edit'), (req, res) => {
    const b = parse(z.object({ enrollment_id: v.id('đăng ký') }), req.body);
    assignClass(db, { enrollmentId: b.enrollment_id, classId: Number(req.params.id), user: req.user });
    res.status(201).json({ ok: true });
  });

  return r;
}
