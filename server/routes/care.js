import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict } from '../lib/http.js';
import { nextCode, notify, getMeta } from '../db/index.js';
import { nowIso, vnToday } from '../lib/time.js';
import { runReminders, RENEWAL_THRESHOLD } from '../services/reminders.js';
import { sessionUsage } from '../services/attendance.js';
import { computeFinance } from '../services/finance.js';

export const CARE_STATUS = { new: 'Mới', in_progress: 'Đang xử lý', waiting: 'Chờ phản hồi', done: 'Hoàn thành' };
export const CARE_TYPE = { absence: 'Vắng học', feedback: 'Phản hồi', complaint: 'Khiếu nại', renewal: 'Tái đăng ký', payment: 'Học phí', support: 'Bổ trợ học tập', general: 'Chăm sóc chung' };

export function careRoutes({ db }) {
  const r = Router();

  r.get('/', can('care.view'), (req, res) => {
    const { status, type, owner_id, q, due } = req.query;
    const where = [];
    const args = [];
    if (status === 'open' || !status) where.push(`c.status != 'done'`); else if (status !== 'all') { where.push('c.status = ?'); args.push(status); }
    if (type) { where.push('c.type = ?'); args.push(type); }
    if (owner_id === 'me') { where.push('c.owner_id = ?'); args.push(req.user.id); } else if (owner_id) { where.push('c.owner_id = ?'); args.push(Number(owner_id)); }
    if (q) { where.push('(s.full_name LIKE ? OR c.title LIKE ? OR c.code LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (due === 'overdue') { where.push(`c.due_date < ? AND c.status != 'done'`); args.push(vnToday()); }
    const items = db.prepare(`SELECT c.*, s.full_name AS student_name, s.code AS student_code, u.full_name AS owner_name,
        (SELECT COUNT(*) FROM care_logs l WHERE l.case_id = c.id) AS log_count
      FROM care_cases c JOIN students s ON s.id = c.student_id LEFT JOIN users u ON u.id = c.owner_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE c.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, c.due_date IS NULL, c.due_date, c.id DESC LIMIT 500`).all(...args);
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM care_cases GROUP BY status').all().map((x) => [x.status, x.n]));
    res.json({ items, counts, statusLabels: CARE_STATUS, typeLabels: CARE_TYPE, remindersLastRun: getMeta(db, 'reminders_last_run') });
  });

  // Danh sách sắp hết khóa (còn ≤ ngưỡng buổi) để tư vấn tái đăng ký
  r.get('/renewals', can('care.view'), (req, res) => {
    const rows = db.prepare(`SELECT e.id, e.code, e.student_id, e.course_id, s.full_name AS student_name, s.code AS student_code, co.name AS course_name, co.next_course_id, n.name AS next_course_name,
        c.code AS class_code, c.end_date,
        (SELECT COUNT(*) FROM enrollments e2 WHERE e2.previous_enrollment_id = e.id AND e2.status != 'cancelled') AS renewed,
        (SELECT cc.id FROM care_cases cc WHERE cc.source_key = 'renewal:' || e.id) AS care_id,
        (SELECT cc.status FROM care_cases cc WHERE cc.source_key = 'renewal:' || e.id) AS care_status
      FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses co ON co.id = e.course_id LEFT JOIN courses n ON n.id = co.next_course_id LEFT JOIN classes c ON c.id = e.class_id
      WHERE e.status = 'active'`).all();
    const usage = sessionUsage(db, rows.map((x) => x.id));
    const fin = has(req.user, 'finance.view') ? computeFinance(db, { enrollmentIds: rows.map((x) => x.id) }) : null;
    const items = rows.map((x) => ({ ...x, usage: usage.get(x.id), debt: fin?.get(x.id)?.debt }))
      .filter((x) => x.usage.remaining <= RENEWAL_THRESHOLD).sort((a, b) => a.usage.remaining - b.usage.remaining);
    res.json({ items, threshold: RENEWAL_THRESHOLD });
  });

  // Quét nhắc việc: chạy lại nhiều lần không sinh trùng
  r.post('/run-reminders', can('care.edit'), (_req, res) => {
    res.json({ created: runReminders(db) });
  });

  r.post('/', can('care.edit'), (req, res) => {
    const b = parse(z.object({
      student_id: v.id('học viên'), type: z.enum(Object.keys(CARE_TYPE), { error: 'Chọn loại.' }), title: v.text(200, 'tiêu đề'),
      content: v.optText(2000), priority: z.enum(['low', 'normal', 'high']).default('normal'), owner_id: v.optId(), due_date: v.optDate(),
    }), req.body);
    if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(b.student_id)) throw notFound('Không tìm thấy học viên.');
    const ts = nowIso();
    const id = Number(db.prepare(`INSERT INTO care_cases(code, student_id, type, title, content, status, priority, owner_id, due_date, created_by, created_at, updated_at) VALUES (?,?,?,?,?,'new',?,?,?,?,?,?)`)
      .run(nextCode(db, 'care', 'CS-', 4), b.student_id, b.type, b.title, b.content, b.priority, b.owner_id || req.user.id, b.due_date, req.user.id, ts, ts).lastInsertRowid);
    if (b.owner_id && b.owner_id !== req.user.id) notify(db, b.owner_id, { title: `Việc chăm sóc mới: ${b.title}`, link: `/care?id=${id}`, dedupeKey: `care:${id}` });
    res.status(201).json({ id });
  });

  r.get('/:id', can('care.view'), (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare(`SELECT c.*, s.full_name AS student_name, s.code AS student_code, u.full_name AS owner_name, cb.full_name AS created_by_name,
        a.status AS attendance_status, ses.date AS absence_date, cl.code AS absence_class, m.id AS makeup_id, m.status AS makeup_status, ms.date AS makeup_date, ms.start_time AS makeup_time
      FROM care_cases c JOIN students s ON s.id = c.student_id LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN users cb ON cb.id = c.created_by
      LEFT JOIN attendance a ON a.id = c.attendance_id LEFT JOIN class_sessions ses ON ses.id = a.session_id LEFT JOIN classes cl ON cl.id = ses.class_id
      LEFT JOIN makeups m ON m.absence_attendance_id = c.attendance_id AND m.status != 'cancelled' LEFT JOIN class_sessions ms ON ms.id = m.makeup_session_id
      WHERE c.id = ?`).get(id);
    if (!c) throw notFound('Không tìm thấy việc chăm sóc.');
    const logs = db.prepare(`SELECT l.*, u.full_name AS by_name FROM care_logs l LEFT JOIN users u ON u.id = l.created_by WHERE l.case_id = ? ORDER BY l.created_at DESC, l.id DESC`).all(id);
    const contacts = has(req.user, 'students.contacts') ? db.prepare(`SELECT p.full_name, p.phone, sc.relationship FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id WHERE sc.student_id = ? ORDER BY sc.is_primary DESC`).all(c.student_id) : null;
    res.json({ case: c, logs, contacts, statusLabels: CARE_STATUS, typeLabels: CARE_TYPE });
  });

  r.put('/:id', can('care.edit'), (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM care_cases WHERE id = ?').get(id);
    if (!c) throw notFound('Không tìm thấy việc chăm sóc.');
    const b = parse(z.object({
      status: z.enum(Object.keys(CARE_STATUS)), owner_id: v.optId(), due_date: v.optDate(), priority: z.enum(['low', 'normal', 'high']),
      resolution: v.optText(1000),
    }), req.body);
    if (b.status === 'done' && !b.resolution && !c.resolution) throw conflict('Vui lòng nhập kết quả xử lý trước khi hoàn thành.', { fields: { resolution: 'Nhập kết quả xử lý.' } });
    const ts = nowIso();
    db.prepare(`UPDATE care_cases SET status=?, owner_id=?, due_date=?, priority=?, resolution=COALESCE(?, resolution), resolved_at=CASE WHEN ?='done' THEN COALESCE(resolved_at, ?) ELSE NULL END, updated_at=? WHERE id=?`)
      .run(b.status, b.owner_id || c.owner_id, b.due_date, b.priority, b.resolution, b.status, ts, ts, id);
    if (b.owner_id && b.owner_id !== c.owner_id) notify(db, b.owner_id, { title: `Bạn được giao việc chăm sóc: ${c.title}`, link: `/care?id=${id}`, dedupeKey: `care-assign:${id}:${b.owner_id}` });
    res.json({ ok: true });
  });

  // Ghi lịch sử liên hệ
  r.post('/:id/logs', can('care.edit'), (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM care_cases WHERE id = ?').get(id);
    if (!c) throw notFound('Không tìm thấy việc chăm sóc.');
    const b = parse(z.object({
      channel: z.enum(['call', 'zalo', 'sms', 'meeting', 'email', 'note'], { error: 'Chọn kênh liên hệ.' }),
      content: v.text(2000, 'nội dung liên hệ'), result: v.optText(500),
      next_status: z.enum(['in_progress', 'waiting', 'done']).optional().nullable(),
    }), req.body);
    if (b.next_status === 'done' && !b.result) throw conflict('Vui lòng nhập kết quả trước khi hoàn thành.', { fields: { result: 'Nhập kết quả.' } });
    const ts = nowIso();
    db.transaction(() => {
      db.prepare('INSERT INTO care_logs(case_id, channel, content, result, created_by, created_at) VALUES (?,?,?,?,?,?)').run(id, b.channel, b.content, b.result, req.user.id, ts);
      const status = b.next_status || (c.status === 'new' ? 'in_progress' : c.status);
      db.prepare(`UPDATE care_cases SET status = ?, resolution = CASE WHEN ? = 'done' THEN ? ELSE resolution END, resolved_at = CASE WHEN ? = 'done' THEN ? ELSE resolved_at END, updated_at = ? WHERE id = ?`)
        .run(status, status, b.result, status, ts, ts, id);
    })();
    res.status(201).json({ ok: true });
  });

  return r;
}
