import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest, forbidden } from '../lib/http.js';
import { nowIso, vnToday, addDays, periodRange, startOfWeek } from '../lib/time.js';
import { ROLES } from '../auth/permissions.js';
import { createApproval } from '../services/approvals.js';
import { notify } from '../db/index.js';

export const LEAVE_KIND = { annual: 'Nghỉ phép năm', sick: 'Nghỉ ốm', personal: 'Việc riêng' };
export const LOG_STATUS = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };

export function hrRoutes({ db }) {
  const r = Router();

  r.get('/staff', can('hr.view'), (req, res) => {
    const rows = db.prepare(`SELECT u.id, u.code, u.full_name, u.title, u.phone, u.email, u.employment, u.status, u.joined_at, u.username, group_concat(r.role) AS roles
      FROM users u LEFT JOIN user_roles r ON r.user_id = u.id GROUP BY u.id ORDER BY u.code`).all();
    const today = vnToday();
    res.json({
      items: rows.map((x) => ({
        ...x, roles: x.roles ? x.roles.split(',') : [],
        classes: db.prepare(`SELECT code FROM classes WHERE (teacher_id = ? OR assistant_id = ?) AND status IN ('planned','active')`).all(x.id, x.id).map((c) => c.code),
        on_leave: !!db.prepare(`SELECT 1 FROM leave_requests WHERE user_id = ? AND status = 'approved' AND ? BETWEEN from_date AND to_date`).get(x.id, today),
      })),
      roleLabels: ROLES,
    });
  });

  r.put('/staff/:id', can('hr.edit'), (req, res) => {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw notFound('Không tìm thấy nhân sự.');
    const b = parse(z.object({
      title: v.text(120, 'chức danh'), phone: v.optPhone(), email: v.optEmail(), employment: z.enum(['full_time', 'part_time']),
      status: z.enum(['active', 'inactive']), roles: z.array(z.enum(Object.keys(ROLES))).min(1, 'Chọn ít nhất một vai trò.'),
    }), req.body);
    if (id === req.user.id && (b.status === 'inactive' || !b.roles.includes('manager')) && req.user.roles.includes('manager')) {
      throw conflict('Không thể tự gỡ quyền quản lý hoặc khóa tài khoản của chính mình.');
    }
    if (b.status === 'inactive') {
      const cls = db.prepare(`SELECT code FROM classes WHERE (teacher_id = ? OR assistant_id = ?) AND status IN ('planned','active')`).all(id, id);
      if (cls.length) throw conflict(`Nhân sự đang phụ trách lớp ${cls.map((c) => c.code).join(', ')}. Đổi giáo viên các lớp trước khi ngừng hoạt động.`);
    }
    db.transaction(() => {
      db.prepare('UPDATE users SET title=?, phone=?, email=?, employment=?, status=? WHERE id=?').run(b.title, b.phone, b.email, b.employment, b.status, id);
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
      for (const role of new Set(b.roles)) db.prepare('INSERT INTO user_roles(user_id, role) VALUES (?,?)').run(id, role);
    })();
    res.json({ ok: true });
  });

  // Lịch làm việc + lịch dạy theo tuần
  r.get('/schedule', (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : startOfWeek(vnToday());
    const to = addDays(from, 6);
    const all = has(req.user, 'hr.view');
    const filter = all ? '' : 'AND u.id = ?';
    const args = all ? [] : [req.user.id];
    const shifts = db.prepare(`SELECT w.*, u.full_name FROM work_shifts w JOIN users u ON u.id = w.user_id WHERE w.date BETWEEN ? AND ? ${filter} ORDER BY w.date, w.start_time`).all(from, to, ...args);
    const teaching = db.prepare(`SELECT s.id, s.date, s.start_time, s.end_time, s.status, u.id AS user_id, u.full_name, CASE WHEN s.teacher_id = u.id THEN 'teacher' ELSE 'assistant' END AS role,
        COALESCE(c.code, s.title) AS label, r.name AS room_name
      FROM class_sessions s JOIN users u ON (u.id = s.teacher_id OR u.id = s.assistant_id) LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN rooms r ON r.id = s.room_id
      WHERE s.date BETWEEN ? AND ? AND s.status != 'cancelled' ${filter} ORDER BY s.date, s.start_time`).all(from, to, ...args);
    const leaves = db.prepare(`SELECT l.*, u.full_name FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.status = 'approved' AND l.from_date <= ? AND l.to_date >= ? ${filter}`).all(to, from, ...args);
    const people = db.prepare(`SELECT id, full_name, title FROM users u WHERE status = 'active' ${filter} ORDER BY code`).all(...args);
    res.json({ from, to, shifts, teaching, leaves, people, canEdit: has(req.user, 'hr.edit') });
  });

  r.post('/shifts', can('hr.edit'), (req, res) => {
    const b = parse(z.object({ user_id: v.id('nhân sự'), date: v.date('ngày'), start_time: v.time('giờ bắt đầu'), end_time: v.time('giờ kết thúc'), note: v.optText(200) })
      .refine((x) => x.end_time > x.start_time, { message: 'Giờ kết thúc phải sau giờ bắt đầu.', path: ['end_time'] }), req.body);
    const overlap = db.prepare('SELECT 1 FROM work_shifts WHERE user_id = ? AND date = ? AND start_time < ? AND end_time > ?').get(b.user_id, b.date, b.end_time, b.start_time);
    if (overlap) throw conflict('Nhân sự đã có ca làm trùng giờ trong ngày này.');
    const id = Number(db.prepare('INSERT INTO work_shifts(user_id, date, start_time, end_time, note) VALUES (?,?,?,?,?)').run(b.user_id, b.date, b.start_time, b.end_time, b.note).lastInsertRowid);
    res.status(201).json({ id });
  });
  r.delete('/shifts/:id', can('hr.edit'), (req, res) => {
    const ch = db.prepare('DELETE FROM work_shifts WHERE id = ?').run(Number(req.params.id));
    if (!ch.changes) throw notFound('Không tìm thấy ca làm.');
    res.json({ ok: true });
  });

  // ---------- Đơn xin nghỉ (tạo kèm đề xuất để quản lý duyệt) ----------
  r.get('/leaves', (req, res) => {
    const all = has(req.user, 'approvals.decide') || has(req.user, 'hr.edit');
    const items = db.prepare(`SELECT l.*, u.full_name, a.code AS approval_code, a.decision_note, d.full_name AS decided_by_name FROM leave_requests l JOIN users u ON u.id = l.user_id
      LEFT JOIN approvals a ON a.id = l.approval_id LEFT JOIN users d ON d.id = a.decided_by ${all ? '' : 'WHERE l.user_id = ?'} ORDER BY l.from_date DESC`).all(...(all ? [] : [req.user.id]));
    res.json({ items, kindLabels: LEAVE_KIND });
  });
  r.post('/leaves', can('approvals.create'), (req, res) => {
    const b = parse(z.object({ kind: z.enum(Object.keys(LEAVE_KIND), { error: 'Chọn loại nghỉ.' }), from_date: v.date('ngày bắt đầu'), to_date: v.date('ngày kết thúc'), reason: v.text(500, 'lý do') }), req.body);
    if (b.to_date < b.from_date) throw badRequest('Ngày kết thúc phải từ ngày bắt đầu.', { to_date: 'Ngày kết thúc phải từ ngày bắt đầu.' });
    if (b.from_date < addDays(vnToday(), -7)) throw badRequest('Không tạo đơn nghỉ lùi quá 7 ngày.', { from_date: 'Không lùi quá 7 ngày.' });
    const dup = db.prepare(`SELECT 1 FROM leave_requests WHERE user_id = ? AND status IN ('pending','approved') AND from_date <= ? AND to_date >= ?`).get(req.user.id, b.to_date, b.from_date);
    if (dup) throw conflict('Bạn đã có đơn nghỉ trùng khoảng ngày này.');
    const out = db.transaction(() => {
      const lid = Number(db.prepare(`INSERT INTO leave_requests(user_id, kind, from_date, to_date, reason, status, created_at) VALUES (?,?,?,?,?,'pending',?)`).run(req.user.id, b.kind, b.from_date, b.to_date, b.reason, nowIso()).lastInsertRowid);
      const sessions = db.prepare(`SELECT COUNT(*) n FROM class_sessions WHERE (teacher_id = ? OR assistant_id = ?) AND date BETWEEN ? AND ? AND status = 'scheduled'`).get(req.user.id, req.user.id, b.from_date, b.to_date).n;
      const aid = createApproval(db, {
        type: 'leave', title: `${LEAVE_KIND[b.kind]} – ${req.user.full_name}`,
        description: `${b.from_date.split('-').reverse().join('/')} → ${b.to_date.split('-').reverse().join('/')}. ${b.reason}${sessions ? ` (Ảnh hưởng ${sessions} buổi dạy, cần sắp xếp dạy thay.)` : ''}`,
        requestedBy: req.user.id, refType: 'leave', refId: lid,
      });
      db.prepare('UPDATE leave_requests SET approval_id = ? WHERE id = ?').run(aid, lid);
      return { id: lid, approvalId: aid, affectedSessions: sessions };
    })();
    res.status(201).json(out);
  });

  // ---------- Giờ dạy thực tế ----------
  r.get('/teaching-logs', can('teaching.log', 'teaching.approve'), (req, res) => {
    const { from, to } = periodRange(req.query.period || 'month', vnToday(), req.query.from, req.query.to);
    const all = has(req.user, 'teaching.approve');
    const where = ['s.date BETWEEN ? AND ?'];
    const args = [from, to];
    if (!all) { where.push('l.user_id = ?'); args.push(req.user.id); } else if (req.query.user_id) { where.push('l.user_id = ?'); args.push(Number(req.query.user_id)); }
    if (req.query.status) { where.push('l.status = ?'); args.push(req.query.status); }
    const items = db.prepare(`SELECT l.*, u.full_name, s.date, s.start_time, s.end_time, COALESCE(c.code, s.title) AS class_label, rv.full_name AS reviewer
      FROM teaching_logs l JOIN users u ON u.id = l.user_id JOIN class_sessions s ON s.id = l.session_id LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN users rv ON rv.id = l.reviewed_by
      WHERE ${where.join(' AND ')} ORDER BY s.date DESC, s.start_time DESC`).all(...args);
    // Buổi đã dạy (đã điểm danh) nhưng chưa ghi giờ — cho giáo viên tự ghi nhận
    const missing = db.prepare(`SELECT s.id, s.date, s.start_time, s.end_time, COALESCE(c.code, s.title) AS class_label FROM class_sessions s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.status = 'done' AND s.date BETWEEN ? AND ? AND (s.teacher_id = ? OR s.assistant_id = ?)
      AND NOT EXISTS (SELECT 1 FROM teaching_logs l WHERE l.session_id = s.id AND l.user_id = ?) ORDER BY s.date DESC`).all(from, to, req.user.id, req.user.id, req.user.id);
    res.json({ from, to, items, missing, statusLabels: LOG_STATUS, canApprove: all });
  });

  r.post('/teaching-logs', can('teaching.log'), (req, res) => {
    const b = parse(z.object({ session_id: v.id('buổi dạy'), minutes: v.int(15, 300, 'số phút'), note: v.optText(300) }), req.body);
    const s = db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(b.session_id);
    if (!s || (s.teacher_id !== req.user.id && s.assistant_id !== req.user.id)) throw forbidden('Bạn chỉ ghi giờ cho buổi mình dạy.');
    if (s.status !== 'done') throw conflict('Chỉ ghi giờ cho buổi đã điểm danh.');
    const res2 = db.prepare(`INSERT INTO teaching_logs(session_id, user_id, role, minutes, status, note, created_at) VALUES (?,?,?,?,'pending',?,?) ON CONFLICT(session_id, user_id) DO NOTHING`)
      .run(s.id, req.user.id, s.teacher_id === req.user.id ? 'teacher' : 'assistant', b.minutes, b.note, nowIso());
    if (!res2.changes) throw conflict('Buổi này đã được ghi giờ.');
    res.status(201).json({ ok: true });
  });

  r.put('/teaching-logs/:id', can('teaching.log'), (req, res) => {
    const l = db.prepare('SELECT * FROM teaching_logs WHERE id = ?').get(Number(req.params.id));
    if (!l || l.user_id !== req.user.id) throw notFound('Không tìm thấy bản ghi giờ dạy.');
    if (l.status !== 'pending' && l.status !== 'rejected') throw conflict('Giờ dạy đã duyệt, không sửa được.');
    const b = parse(z.object({ minutes: v.int(15, 300, 'số phút'), note: v.optText(300) }), req.body);
    db.prepare(`UPDATE teaching_logs SET minutes = ?, note = ?, status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`).run(b.minutes, b.note, l.id);
    res.json({ ok: true });
  });

  r.post('/teaching-logs/review', can('teaching.approve'), (req, res) => {
    const b = parse(z.object({ ids: z.array(z.coerce.number().int()).min(1, 'Chọn ít nhất một dòng.').max(200), decision: z.enum(['approved', 'rejected']), note: v.optText(300) }), req.body);
    if (b.decision === 'rejected' && !b.note) throw badRequest('Nhập lý do từ chối.', { note: 'Nhập lý do từ chối.' });
    const ts = nowIso();
    const result = db.transaction(() => {
      let n = 0;
      for (const id of b.ids) {
        const l = db.prepare('SELECT * FROM teaching_logs WHERE id = ?').get(id);
        if (!l || l.user_id === req.user.id) continue; // không tự duyệt giờ của mình
        const ch = db.prepare(`UPDATE teaching_logs SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND status = 'pending'`).run(b.decision, req.user.id, ts, b.note, id);
        if (ch.changes) {
          n++;
          if (b.decision === 'rejected') notify(db, l.user_id, { title: 'Giờ dạy bị từ chối', body: b.note, link: '/hr?tab=teaching', dedupeKey: `tl-reject:${id}:${ts}` });
        }
      }
      return n;
    })();
    res.json({ updated: result });
  });

  // Tổng hợp giờ dạy đã duyệt theo người và kỳ (không tính lương)
  r.get('/teaching-summary', can('teaching.approve', 'teaching.log'), (req, res) => {
    const { from, to } = periodRange(req.query.period || 'month', vnToday(), req.query.from, req.query.to);
    const all = has(req.user, 'teaching.approve');
    const rows = db.prepare(`SELECT u.id, u.full_name, u.employment,
        SUM(CASE WHEN l.status = 'approved' THEN l.minutes ELSE 0 END) AS approved_minutes,
        SUM(CASE WHEN l.status = 'pending' THEN l.minutes ELSE 0 END) AS pending_minutes,
        SUM(CASE WHEN l.status = 'approved' AND l.role = 'teacher' THEN 1 ELSE 0 END) AS teacher_sessions,
        SUM(CASE WHEN l.status = 'approved' AND l.role = 'assistant' THEN 1 ELSE 0 END) AS assistant_sessions
      FROM teaching_logs l JOIN users u ON u.id = l.user_id JOIN class_sessions s ON s.id = l.session_id
      WHERE s.date BETWEEN ? AND ? ${all ? '' : 'AND u.id = ?'} GROUP BY u.id ORDER BY approved_minutes DESC`).all(from, to, ...(all ? [] : [req.user.id]));
    res.json({ from, to, items: rows });
  });

  return r;
}
