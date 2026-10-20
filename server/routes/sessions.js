import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest, forbidden } from '../lib/http.js';
import { nowIso, vnToday, addDays, toMinutes } from '../lib/time.js';
import { logActivity, notify } from '../db/index.js';
import { canMarkSession, visibleStudentIds, inList } from '../lib/scope.js';
import { findConflicts, sessionStudentIds } from '../services/schedule.js';
import { ATTENDANCE_LABEL, SESSION_RULES } from '../services/attendance.js';
import { ensureAbsenceCase } from '../services/reminders.js';
import { HOMEWORK_LABEL } from '../services/learning.js';

export const SESSION_STATUS = { scheduled: 'Chưa diễn ra', done: 'Đã điểm danh', cancelled: 'Đã hủy' };

const SESSION_SELECT = `SELECT s.*, c.code AS class_code, c.name AS class_name, c.max_students, c.homeroom_id, co.name AS course_name, r.name AS room_name,
    t.full_name AS teacher_name, a.full_name AS assistant_name
  FROM class_sessions s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN courses co ON co.id = c.course_id
  LEFT JOIN rooms r ON r.id = s.room_id LEFT JOIN users t ON t.id = s.teacher_id LEFT JOIN users a ON a.id = s.assistant_id`;

function canSeeSession(db, user, s) {
  if (has(user, 'classes.view')) return true;
  return s.teacher_id === user.id || s.assistant_id === user.id || (s.class_id && !!db.prepare('SELECT 1 FROM classes WHERE id = ? AND homeroom_id = ?').get(s.class_id, user.id));
}

export function sessionRoutes({ db }) {
  const r = Router();
  const viewAny = can('classes.view', 'classes.view_own');

  // Lịch theo khoảng ngày (tuần/ngày). Kèm lịch học thử/kiểm tra đầu vào độc lập.
  r.get('/', viewAny, (req, res) => {
    const today = vnToday();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : addDays(from, 6);
    if (to < from || to > addDays(from, 62)) throw badRequest('Khoảng ngày không hợp lệ (tối đa 62 ngày).');
    const where = ['s.date BETWEEN ? AND ?'];
    const args = [from, to];
    if (!has(req.user, 'classes.view')) { where.push('(s.teacher_id = ? OR s.assistant_id = ? OR c.homeroom_id = ?)'); args.push(req.user.id, req.user.id, req.user.id); }
    if (req.query.class_id) { where.push('s.class_id = ?'); args.push(Number(req.query.class_id)); }
    if (req.query.teacher_id) { where.push('(s.teacher_id = ? OR s.assistant_id = ?)'); args.push(Number(req.query.teacher_id), Number(req.query.teacher_id)); }
    if (req.query.room_id) { where.push('s.room_id = ?'); args.push(Number(req.query.room_id)); }
    if (req.query.include_cancelled !== '1') where.push(`s.status != 'cancelled'`);
    const sessions = db.prepare(`${SESSION_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.date, s.start_time`).all(...args)
      .map((s) => ({ ...s, student_count: sessionStudentIds(db, s.id).length, trial_count: db.prepare(`SELECT COUNT(*) n FROM trials WHERE session_id = ? AND status = 'scheduled'`).get(s.id).n }));
    let trials = [];
    if (has(req.user, 'leads.view') || has(req.user, 'classes.view') || has(req.user, 'classes.view_own')) {
      trials = db.prepare(`SELECT t.*, l.student_name, l.parent_name, l.id AS lead_id, l.owner_id AS lead_owner_id, r.name AS room_name, u.full_name AS teacher_name FROM trials t JOIN leads l ON l.id = t.lead_id
        LEFT JOIN rooms r ON r.id = t.room_id LEFT JOIN users u ON u.id = t.teacher_id
        WHERE t.session_id IS NULL AND t.status = 'scheduled' AND t.date BETWEEN ? AND ? ${has(req.user, 'classes.view') ? '' : 'AND t.teacher_id = ?'}
        ORDER BY t.date, t.start_time`).all(from, to, ...(has(req.user, 'classes.view') ? [] : [req.user.id]));
    }
    res.json({ from, to, today, sessions, trials, statusLabels: SESSION_STATUS });
  });

  // Học viên vắng cần chăm sóc / học bù
  r.get('/absences', can('makeup.edit', 'care.view', 'attendance.edit_own'), (req, res) => {
    const today = vnToday();
    const days = Math.min(90, Number(req.query.days || 30));
    const sIds = visibleStudentIds(db, req.user);
    const rows = db.prepare(`SELECT a.id AS attendance_id, a.status, a.note, a.student_id, a.enrollment_id, st.full_name, st.code AS student_code,
        s.date, s.start_time, s.topic, c.code AS class_code, c.id AS class_id, co.id AS course_id,
        m.id AS makeup_id, m.status AS makeup_status, ms.date AS makeup_date, ms.start_time AS makeup_time, mc.code AS makeup_class_code,
        cc.id AS care_id, cc.status AS care_status
      FROM attendance a JOIN class_sessions s ON s.id = a.session_id JOIN students st ON st.id = a.student_id
      LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN courses co ON co.id = c.course_id
      LEFT JOIN makeups m ON m.absence_attendance_id = a.id AND m.status != 'cancelled'
      LEFT JOIN class_sessions ms ON ms.id = m.makeup_session_id LEFT JOIN classes mc ON mc.id = ms.class_id
      LEFT JOIN care_cases cc ON cc.source_key = 'absence:' || a.id
      WHERE a.status IN ('absent','excused') AND a.is_makeup = 0 AND s.date BETWEEN ? AND ? ${sIds === null ? '' : `AND a.student_id IN (${inList(sIds)})`}
      ORDER BY s.date DESC`).all(addDays(today, -days), today);
    res.json({ items: rows, rules: SESSION_RULES });
  });

  r.get('/:id', viewAny, (req, res) => {
    const id = Number(req.params.id);
    const s = db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id);
    if (!s || !canSeeSession(db, req.user, s)) throw notFound('Không tìm thấy buổi học.');
    const ids = sessionStudentIds(db, id);
    const att = new Map(db.prepare('SELECT * FROM attendance WHERE session_id = ?').all(id).map((a) => [a.student_id, a]));
    const makeupsIn = new Map(db.prepare(`SELECT m.*, os.date AS original_date, oc.code AS original_class FROM makeups m JOIN attendance oa ON oa.id = m.absence_attendance_id
      JOIN class_sessions os ON os.id = oa.session_id LEFT JOIN classes oc ON oc.id = os.class_id WHERE m.makeup_session_id = ? AND m.status != 'cancelled'`).all(id).map((m) => [m.student_id, m]));
    const roster = ids.map((sid) => {
      const st = db.prepare('SELECT id, code, full_name FROM students WHERE id = ?').get(sid);
      const mk = makeupsIn.get(sid);
      const e = mk ? null : db.prepare(`SELECT id FROM enrollments WHERE class_id = ? AND student_id = ? AND status IN ('active','completed')`).get(s.class_id, sid);
      return { ...st, enrollment_id: mk ? mk.enrollment_id : e?.id, attendance: att.get(sid) || null, makeup: mk || null };
    }).sort((a, b) => (a.makeup ? 1 : 0) - (b.makeup ? 1 : 0) || a.full_name.localeCompare(b.full_name, 'vi'));
    const trials = db.prepare(`SELECT t.*, l.student_name, l.parent_name, l.code AS lead_code FROM trials t JOIN leads l ON l.id = t.lead_id WHERE t.session_id = ? AND t.status != 'cancelled'`).all(id);
    const history = db.prepare(`SELECT l.*, u.full_name AS by_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE entity_type = 'session' AND entity_id = ? ORDER BY created_at DESC`).all(id);
    const prevHomework = s.class_id ? db.prepare(`SELECT date, homework FROM class_sessions WHERE class_id = ? AND status = 'done' AND homework IS NOT NULL AND (date < ? OR (date = ? AND start_time < ?)) ORDER BY date DESC, start_time DESC LIMIT 1`).get(s.class_id, s.date, s.date, s.start_time) : null;
    const today = vnToday();
    res.json({
      session: s, roster, trials, history, statusLabels: SESSION_STATUS, attendanceLabels: ATTENDANCE_LABEL, rules: SESSION_RULES, prevHomework, homeworkLabels: HOMEWORK_LABEL,
      can: {
        mark: canMarkSession(req.user, s, db) && s.status !== 'cancelled' && s.date <= today,
        markReason: s.status === 'cancelled' ? 'Buổi học đã hủy.' : s.date > today ? 'Chỉ điểm danh được từ ngày diễn ra buổi học.' : !canMarkSession(req.user, s, db) ? 'Bạn không phụ trách buổi học này.' : null,
        schedule: has(req.user, 'schedule.edit') && s.status === 'scheduled',
        makeup: has(req.user, 'makeup.edit'),
        trialResult: has(req.user, 'leads.edit') || s.teacher_id === req.user.id,
      },
    });
  });

  // Lưu điểm danh: ghi đè theo (buổi, học viên) ⇒ lưu nhiều lần không nhân đôi
  r.put('/:id/attendance', can('attendance.edit', 'attendance.edit_own'), (req, res) => {
    const id = Number(req.params.id);
    const s = db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(id);
    if (!s) throw notFound('Không tìm thấy buổi học.');
    if (!canMarkSession(req.user, s, db)) throw forbidden('Bạn chỉ điểm danh được buổi học mình phụ trách.');
    if (s.status === 'cancelled') throw conflict('Buổi học đã hủy, không điểm danh.');
    if (s.date > vnToday()) throw conflict('Chưa đến ngày học, không thể điểm danh trước.');
    const b = parse(z.object({
      records: z.array(z.object({
        student_id: v.id('học viên'), status: z.enum(['present', 'late', 'excused', 'absent'], { error: 'Chọn trạng thái điểm danh.' }), note: v.optText(300),
        // BTVN của buổi trước (chấm tại buổi này), điểm BTVN thang 10, nhận xét riêng
        homework_status: z.enum(['done', 'partial', 'missing']).optional().nullable().transform((x) => x || null),
        homework_score: z.union([z.literal(''), z.null(), z.coerce.number().min(0, 'Điểm từ 0 đến 10.').max(10, 'Điểm từ 0 đến 10.')]).optional().transform((x) => (x === '' || x === undefined ? null : x)),
        comment: v.optText(500), improvement: v.optText(500),
      })),
      topic: v.optText(300), teacher_note: v.optText(2000), homework: v.optText(1000),
    }), req.body);
    const roster = new Set(sessionStudentIds(db, id));
    const fields = {};
    const given = new Set();
    for (const [i, rec] of b.records.entries()) {
      if (!roster.has(rec.student_id)) fields[`records.${i}`] = 'Học viên không thuộc buổi học này.';
      if (given.has(rec.student_id)) fields[`records.${i}`] = 'Học viên bị lặp.';
      given.add(rec.student_id);
    }
    const missing = [...roster].filter((x) => !given.has(x));
    if (missing.length) {
      const names = missing.map((x) => db.prepare('SELECT full_name FROM students WHERE id = ?').get(x).full_name);
      throw badRequest(`Chưa điểm danh: ${names.join(', ')}.`, { records: `Còn ${missing.length} học viên chưa chọn trạng thái.` });
    }
    if (Object.keys(fields).length) throw badRequest('Danh sách điểm danh không hợp lệ.', fields);
    const ts = nowIso();
    const result = db.transaction(() => {
      let changed = 0; let careCreated = 0;
      const makeups = new Map(db.prepare(`SELECT * FROM makeups WHERE makeup_session_id = ? AND status != 'cancelled'`).all(id).map((m) => [m.student_id, m]));
      for (const rec of b.records) {
        const mk = makeups.get(rec.student_id);
        const enrollmentId = mk ? mk.enrollment_id : db.prepare(`SELECT id FROM enrollments WHERE class_id = ? AND student_id = ? AND status IN ('active','completed')`).get(s.class_id, rec.student_id)?.id;
        const prev = db.prepare('SELECT * FROM attendance WHERE session_id = ? AND student_id = ?').get(id, rec.student_id);
        // Vắng thì không chấm BTVN/điểm (giữ nhận xét nếu có)
        const absent = ['absent', 'excused'].includes(rec.status);
        const hwStatus = absent ? null : rec.homework_status;
        const hwScore = absent ? null : rec.homework_score;
        const same = (a, b) => (a ?? null) === (b ?? null);
        if (prev && prev.status === rec.status && same(prev.note, rec.note) && same(prev.homework_status, hwStatus) && same(prev.homework_score, hwScore) && same(prev.comment, rec.comment) && same(prev.improvement, rec.improvement)) continue;
        if (prev && prev.status === rec.status && same(prev.note, rec.note)) {
          // Chỉ đổi BTVN/điểm/nhận xét/hướng cải thiện: cập nhật, không ảnh hưởng tính buổi hay việc chăm sóc
          db.prepare('UPDATE attendance SET homework_status = ?, homework_score = ?, comment = ?, improvement = ? WHERE id = ?').run(hwStatus, hwScore, rec.comment, rec.improvement, prev.id);
          changed++;
          continue;
        }
        db.prepare(`INSERT INTO attendance(session_id, student_id, enrollment_id, status, note, is_makeup, makeup_id, marked_by, marked_at, homework_status, homework_score, comment, improvement) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at,
            homework_status = excluded.homework_status, homework_score = excluded.homework_score, comment = excluded.comment, improvement = excluded.improvement`)
          .run(id, rec.student_id, enrollmentId ?? null, rec.status, rec.note, mk ? 1 : 0, mk?.id ?? null, req.user.id, ts, hwStatus, hwScore, rec.comment, rec.improvement);
        changed++;
        const attId = db.prepare('SELECT id FROM attendance WHERE session_id = ? AND student_id = ?').get(id, rec.student_id).id;
        if (mk) {
          db.prepare('UPDATE makeups SET status = ? WHERE id = ?').run(['present', 'late'].includes(rec.status) ? 'done' : 'missed', mk.id);
        } else if (['absent', 'excused'].includes(rec.status)) {
          if (ensureAbsenceCase(db, attId, req.user.id)?.created) careCreated++;
        } else if (prev && ['absent', 'excused'].includes(prev.status)) {
          // Sửa từ vắng sang có mặt: đóng việc chăm sóc tự sinh (nếu chưa ai xử lý) và hủy lịch học bù chưa diễn ra
          db.prepare(`UPDATE care_cases SET status = 'done', resolution = 'Điểm danh được sửa thành có mặt', resolved_at = ?, updated_at = ?
            WHERE source_key = ? AND status = 'new' AND NOT EXISTS (SELECT 1 FROM care_logs l WHERE l.case_id = care_cases.id)`).run(ts, ts, `absence:${attId}`);
          db.prepare(`UPDATE makeups SET status = 'cancelled', note = 'Hủy vì điểm danh được sửa thành có mặt' WHERE absence_attendance_id = ? AND status = 'scheduled'`).run(attId);
        }
      }
      const first = !s.attendance_saved_at;
      db.prepare(`UPDATE class_sessions SET status = 'done', topic = ?, teacher_note = ?, homework = ?, attendance_saved_at = ?, attendance_saved_by = ? WHERE id = ?`).run(b.topic, b.teacher_note, b.homework, ts, req.user.id, id);
      // Đề xuất giờ dạy thực tế (một bản ghi cho mỗi người/buổi)
      const minutes = toMinutes(s.end_time) - toMinutes(s.start_time);
      for (const [uid, role] of [[s.teacher_id, 'teacher'], [s.assistant_id, 'assistant']]) {
        if (uid) db.prepare(`INSERT INTO teaching_logs(session_id, user_id, role, minutes, status, created_at) VALUES (?,?,?,?, 'pending', ?) ON CONFLICT(session_id, user_id) DO NOTHING`).run(id, uid, role, minutes, ts);
      }
      logActivity(db, { entityType: 'session', entityId: id, action: first ? 'attendance_saved' : 'attendance_updated', summary: `${first ? 'Điểm danh' : 'Cập nhật điểm danh'}: ${changed} thay đổi`, userId: req.user.id });
      return { changed, careCreated };
    })();
    res.json({ ok: true, ...result });
  });

  const sessionBody = z.object({
    class_id: v.optId(), date: v.date('ngày học'), start_time: v.time('giờ bắt đầu'), end_time: v.time('giờ kết thúc'),
    room_id: v.id('phòng'), teacher_id: v.id('giáo viên'), assistant_id: v.optId(), title: v.optText(120), reason: v.optText(300),
  }).refine((x) => x.end_time > x.start_time, { message: 'Giờ kết thúc phải sau giờ bắt đầu.', path: ['end_time'] })
    .refine((x) => !x.assistant_id || x.assistant_id !== x.teacher_id, { message: 'Trợ giảng phải khác giáo viên.', path: ['assistant_id'] });

  // Tạo buổi học bổ sung cho lớp
  r.post('/', can('schedule.edit'), (req, res) => {
    const b = parse(sessionBody, req.body);
    if (!b.class_id) throw badRequest('Chọn lớp cho buổi học.', { class_id: 'Chọn lớp.' });
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(b.class_id);
    if (!cls || ['finished', 'cancelled'].includes(cls.status)) throw badRequest('Lớp không hợp lệ hoặc đã kết thúc.', { class_id: 'Chọn lớp đang hoạt động.' });
    if (b.date < vnToday()) throw badRequest('Không tạo buổi học trong quá khứ.', { date: 'Chọn ngày từ hôm nay.' });
    const studentIds = db.prepare(`SELECT student_id FROM enrollments WHERE class_id = ? AND status = 'active'`).all(b.class_id).map((x) => x.student_id);
    const conflicts = findConflicts(db, { date: b.date, start: b.start_time, end: b.end_time, roomId: b.room_id, teacherId: b.teacher_id, assistantId: b.assistant_id, studentIds });
    if (conflicts.length) throw conflict('Lịch bị trùng.', { conflicts });
    const seq = db.prepare('SELECT COALESCE(MAX(seq_no),0)+1 n FROM class_sessions WHERE class_id = ?').get(b.class_id).n;
    const id = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO class_sessions(class_id, date, start_time, end_time, room_id, teacher_id, assistant_id, kind, seq_no, status, title, created_at) VALUES (?,?,?,?,?,?,?,'regular',?,'scheduled',?,?)`)
        .run(b.class_id, b.date, b.start_time, b.end_time, b.room_id, b.teacher_id, b.assistant_id, seq, b.title, nowIso()).lastInsertRowid);
      logActivity(db, { entityType: 'session', entityId: id, action: 'created', summary: `Tạo buổi học bổ sung${b.reason ? `: ${b.reason}` : ''}`, userId: req.user.id });
      logActivity(db, { entityType: 'class', entityId: b.class_id, action: 'session_added', summary: `Thêm buổi ${b.date.split('-').reverse().join('/')} ${b.start_time}`, userId: req.user.id });
      return id;
    })();
    res.status(201).json({ id });
  });

  // Đổi lịch một buổi (ngày/giờ/phòng/giáo viên)
  r.put('/:id', can('schedule.edit'), (req, res) => {
    const id = Number(req.params.id);
    const s = db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(id);
    if (!s) throw notFound('Không tìm thấy buổi học.');
    if (s.status !== 'scheduled') throw conflict('Chỉ đổi lịch được buổi chưa diễn ra.');
    const b = parse(sessionBody, { ...req.body, class_id: s.class_id });
    if (b.date < vnToday()) throw badRequest('Không dời buổi học về quá khứ.', { date: 'Chọn ngày từ hôm nay.' });
    const conflicts = findConflicts(db, { date: b.date, start: b.start_time, end: b.end_time, roomId: b.room_id, teacherId: b.teacher_id, assistantId: b.assistant_id, studentIds: sessionStudentIds(db, id), excludeSessionId: id });
    if (conflicts.length) throw conflict('Lịch mới bị trùng.', { conflicts });
    const old = `${s.date.split('-').reverse().join('/')} ${s.start_time}`;
    db.transaction(() => {
      db.prepare('UPDATE class_sessions SET date=?, start_time=?, end_time=?, room_id=?, teacher_id=?, assistant_id=? WHERE id=?').run(b.date, b.start_time, b.end_time, b.room_id, b.teacher_id, b.assistant_id, id);
      db.prepare(`UPDATE trials SET date = ?, start_time = ?, end_time = ?, room_id = ?, teacher_id = ? WHERE session_id = ? AND status = 'scheduled'`).run(b.date, b.start_time, b.end_time, b.room_id, b.teacher_id, id);
      logActivity(db, { entityType: 'session', entityId: id, action: 'rescheduled', summary: `Đổi lịch từ ${old} sang ${b.date.split('-').reverse().join('/')} ${b.start_time}${b.reason ? ` — ${b.reason}` : ''}`, userId: req.user.id });
      if (s.class_id) logActivity(db, { entityType: 'class', entityId: s.class_id, action: 'rescheduled', summary: `Đổi lịch buổi ${old} → ${b.date.split('-').reverse().join('/')} ${b.start_time}`, userId: req.user.id });
      for (const uid of new Set([s.teacher_id, s.assistant_id, b.teacher_id, b.assistant_id])) {
        notify(db, uid, { title: 'Lịch dạy thay đổi', body: `Buổi ${old} chuyển sang ${b.date.split('-').reverse().join('/')} ${b.start_time}`, link: `/schedule?session=${id}`, dedupeKey: `resched:${id}:${b.date}:${b.start_time}` });
      }
    })();
    res.json({ ok: true });
  });

  // Hủy buổi có lý do. Buổi đã hủy không chiếm lịch, không trừ buổi của học viên.
  r.post('/:id/cancel', can('schedule.edit'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ reason: v.text(300, 'lý do hủy') }), req.body);
    const s = db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(id);
    if (!s) throw notFound('Không tìm thấy buổi học.');
    if (s.status === 'cancelled') throw conflict('Buổi học đã hủy trước đó.');
    if (db.prepare('SELECT COUNT(*) n FROM attendance WHERE session_id = ?').get(id).n) throw conflict('Buổi học đã có điểm danh, không thể hủy.');
    db.transaction(() => {
      db.prepare(`UPDATE class_sessions SET status = 'cancelled', cancel_reason = ? WHERE id = ?`).run(b.reason, id);
      db.prepare(`UPDATE makeups SET status = 'cancelled', note = 'Buổi học bù bị hủy' WHERE makeup_session_id = ? AND status = 'scheduled'`).run(id);
      db.prepare(`UPDATE trials SET status = 'cancelled', updated_at = ? WHERE session_id = ? AND status = 'scheduled'`).run(nowIso(), id);
      logActivity(db, { entityType: 'session', entityId: id, action: 'cancelled', summary: `Hủy buổi học: ${b.reason}`, userId: req.user.id });
      if (s.class_id) logActivity(db, { entityType: 'class', entityId: s.class_id, action: 'session_cancelled', summary: `Hủy buổi ${s.date.split('-').reverse().join('/')}: ${b.reason}`, userId: req.user.id });
      for (const uid of [s.teacher_id, s.assistant_id]) notify(db, uid, { title: 'Buổi học bị hủy', body: `${s.date.split('-').reverse().join('/')} ${s.start_time}: ${b.reason}`, link: `/schedule?session=${id}`, dedupeKey: `cancel:${id}` });
    })();
    res.json({ ok: true });
  });

  // ---------- Học bù ----------
  r.get('/makeup/options', can('makeup.edit'), (req, res) => {
    const attId = Number(req.query.attendance_id);
    const a = db.prepare(`SELECT a.*, s.class_id, c.course_id FROM attendance a JOIN class_sessions s ON s.id = a.session_id LEFT JOIN classes c ON c.id = s.class_id WHERE a.id = ?`).get(attId);
    if (!a) throw notFound('Không tìm thấy buổi vắng.');
    const today = vnToday();
    const rows = db.prepare(`${SESSION_SELECT} WHERE s.status = 'scheduled' AND s.date BETWEEN ? AND ? AND s.class_id IS NOT NULL AND c.course_id = ? ORDER BY s.date, s.start_time`)
      .all(today, addDays(today, 28), a.course_id);
    const options = [];
    for (const s of rows) {
      const ids = sessionStudentIds(db, s.id);
      if (ids.includes(a.student_id)) continue;
      const full = ids.length >= s.max_students;
      const clash = findConflicts(db, { date: s.date, start: s.start_time, end: s.end_time, studentIds: [a.student_id], excludeSessionId: s.id });
      options.push({ ...s, student_count: ids.length, full, conflict: clash[0]?.message || null });
    }
    res.json({ items: options });
  });

  r.post('/makeup', can('makeup.edit'), (req, res) => {
    const b = parse(z.object({
      attendance_id: v.id('buổi vắng'), session_id: v.optId(),
      new_session: z.object({ date: v.date('ngày học bù'), start_time: v.time('giờ bắt đầu'), end_time: v.time('giờ kết thúc'), room_id: v.id('phòng'), teacher_id: v.id('giáo viên') })
        .refine((x) => x.end_time > x.start_time, { message: 'Giờ kết thúc phải sau giờ bắt đầu.', path: ['end_time'] }).optional().nullable(),
      note: v.optText(300),
    }), req.body);
    if (!b.session_id && !b.new_session) throw badRequest('Chọn buổi học bù.', { session_id: 'Chọn buổi học có sẵn hoặc tạo buổi học bù riêng.' });
    const out = db.transaction(() => {
      const a = db.prepare(`SELECT a.*, s.date AS absent_date, s.class_id, s.topic, c.code AS class_code, c.course_id FROM attendance a JOIN class_sessions s ON s.id = a.session_id LEFT JOIN classes c ON c.id = s.class_id WHERE a.id = ?`).get(b.attendance_id);
      if (!a) throw notFound('Không tìm thấy buổi vắng.');
      if (a.is_makeup) throw badRequest('Không xếp học bù cho chính buổi học bù.');
      if (!['absent', 'excused'].includes(a.status)) throw conflict('Học viên không vắng buổi này.');
      const existing = db.prepare('SELECT * FROM makeups WHERE absence_attendance_id = ?').get(a.id);
      if (existing && existing.status !== 'cancelled' && existing.status !== 'missed') throw conflict('Buổi vắng này đã được xếp học bù.', { makeupId: existing.id });
      const today = vnToday();
      let sessionId = b.session_id;
      if (sessionId) {
        const s = db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(sessionId);
        if (!s || s.status !== 'scheduled' || s.date < today) throw badRequest('Buổi học bù không hợp lệ.', { session_id: 'Chọn buổi chưa diễn ra.' });
        const ids = sessionStudentIds(db, sessionId);
        if (ids.includes(a.student_id)) throw conflict('Học viên đã có trong buổi này.');
        if (s.max_students && ids.length >= s.max_students) throw conflict(`Buổi học đã đủ sĩ số (${ids.length}/${s.max_students}).`);
        const clash = findConflicts(db, { date: s.date, start: s.start_time, end: s.end_time, studentIds: [a.student_id], excludeSessionId: sessionId });
        if (clash.length) throw conflict('Học viên bị trùng lịch.', { conflicts: clash });
      } else {
        const n = b.new_session;
        if (n.date < today) throw badRequest('Ngày học bù phải từ hôm nay.', { 'new_session.date': 'Chọn ngày từ hôm nay.' });
        const clash = findConflicts(db, { date: n.date, start: n.start_time, end: n.end_time, roomId: n.room_id, teacherId: n.teacher_id, studentIds: [a.student_id] });
        if (clash.length) throw conflict('Lịch học bù bị trùng.', { conflicts: clash });
        sessionId = Number(db.prepare(`INSERT INTO class_sessions(class_id, date, start_time, end_time, room_id, teacher_id, kind, status, title, topic, created_at) VALUES (NULL,?,?,?,?,?,'makeup','scheduled',?,?,?)`)
          .run(n.date, n.start_time, n.end_time, n.room_id, n.teacher_id, `Học bù ${a.class_code || ''}`.trim(), a.topic ? `Học bù: ${a.topic}` : null, nowIso()).lastInsertRowid);
      }
      let makeupId;
      if (existing) {
        db.prepare(`UPDATE makeups SET makeup_session_id = ?, status = 'scheduled', note = ?, created_by = ?, created_at = ? WHERE id = ?`).run(sessionId, b.note, req.user.id, nowIso(), existing.id);
        makeupId = existing.id;
      } else {
        makeupId = Number(db.prepare(`INSERT INTO makeups(absence_attendance_id, student_id, enrollment_id, makeup_session_id, status, note, created_by, created_at) VALUES (?,?,?,?,'scheduled',?,?,?)`)
          .run(a.id, a.student_id, a.enrollment_id, sessionId, b.note, req.user.id, nowIso()).lastInsertRowid);
      }
      const ms = db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(sessionId);
      const when = `${ms.date.split('-').reverse().join('/')} ${ms.start_time}`;
      logActivity(db, { entityType: 'student', entityId: a.student_id, action: 'makeup_scheduled', summary: `Xếp học bù ${when} cho buổi nghỉ ${a.absent_date.split('-').reverse().join('/')}`, userId: req.user.id });
      const care = db.prepare('SELECT id, status FROM care_cases WHERE source_key = ?').get(`absence:${a.id}`);
      if (care) {
        db.prepare('INSERT INTO care_logs(case_id, channel, content, result, created_by, created_at) VALUES (?,?,?,?,?,?)').run(care.id, 'note', `Đã xếp lịch học bù ${when}.`, null, req.user.id, nowIso());
        db.prepare(`UPDATE care_cases SET status = CASE WHEN status = 'new' THEN 'in_progress' ELSE status END, updated_at = ? WHERE id = ?`).run(nowIso(), care.id);
      }
      for (const uid of [ms.teacher_id, ms.assistant_id]) notify(db, uid, { title: 'Có học viên học bù trong buổi của bạn', body: when, link: `/schedule?session=${sessionId}`, dedupeKey: `makeup:${makeupId}:${sessionId}` });
      return { makeupId, sessionId };
    })();
    res.status(201).json(out);
  });

  r.post('/makeup/:mid/cancel', can('makeup.edit'), (req, res) => {
    const mid = Number(req.params.mid);
    const m = db.prepare('SELECT * FROM makeups WHERE id = ?').get(mid);
    if (!m) throw notFound('Không tìm thấy lịch học bù.');
    if (m.status !== 'scheduled') throw conflict('Chỉ hủy được lịch học bù chưa diễn ra.');
    if (db.prepare('SELECT 1 FROM attendance WHERE makeup_id = ?').get(mid)) throw conflict('Buổi học bù đã điểm danh.');
    db.prepare(`UPDATE makeups SET status = 'cancelled' WHERE id = ?`).run(mid);
    logActivity(db, { entityType: 'student', entityId: m.student_id, action: 'makeup_cancelled', summary: 'Hủy lịch học bù', userId: req.user.id });
    res.json({ ok: true });
  });

  return r;
}
