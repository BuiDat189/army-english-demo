import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest, forbidden } from '../lib/http.js';
import { nextCode, logActivity, notify } from '../db/index.js';
import { nowIso, vnToday, vnTime, addDays } from '../lib/time.js';
import { visibleClassIds, visibleStudentIds, inList } from '../lib/scope.js';
import { sessionStudentIds } from '../services/schedule.js';
import { learningTodo, supportList, monthOf, SUPPORT_RULE_TEXT, ASSESSMENT_KIND, HOMEWORK_LABEL } from '../services/learning.js';

// Học tập: check-in tại quầy, BTVN & nhận xét còn thiếu, bổ trợ học tập hằng tháng, điểm kiểm tra theo lớp
export function learningRoutes({ db }) {
  const r = Router();

  // ---------- Check-in ----------
  // Danh sách học viên có buổi học trong ngày + trạng thái đã check-in
  r.get('/checkins', can('checkin.edit'), (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : vnToday();
    const sessions = db.prepare(`SELECT s.id, s.start_time, s.end_time, s.kind, s.title, c.code AS class_code, r.name AS room_name FROM class_sessions s
      LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN rooms r ON r.id = s.room_id WHERE s.date = ? AND s.status != 'cancelled' ORDER BY s.start_time`).all(date);
    const done = new Map(db.prepare(`SELECT k.*, u.full_name AS checked_by_name FROM checkins k LEFT JOIN users u ON u.id = k.checked_by WHERE k.date = ?`).all(date).map((k) => [k.student_id, k]));
    const expected = [];
    const seen = new Set();
    for (const s of sessions) {
      for (const sid of sessionStudentIds(db, s.id)) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        const st = db.prepare('SELECT id, code, full_name FROM students WHERE id = ?').get(sid);
        expected.push({ ...st, session: s, checkin: done.get(sid) || null });
      }
    }
    // Check-in của học viên không có lịch hôm nay (đến học bù, đến gặp tư vấn…)
    for (const [sid, k] of done) {
      if (seen.has(sid)) continue;
      const st = db.prepare('SELECT id, code, full_name FROM students WHERE id = ?').get(sid);
      expected.push({ ...st, session: null, checkin: k });
    }
    expected.sort((a, b) => (a.session?.start_time || '99').localeCompare(b.session?.start_time || '99') || a.full_name.localeCompare(b.full_name, 'vi'));
    const byStaff = db.prepare(`SELECT u.full_name, COUNT(*) n FROM checkins k JOIN users u ON u.id = k.checked_by WHERE k.date = ? GROUP BY u.id ORDER BY n DESC`).all(date);
    res.json({ date, items: expected, total: expected.filter((x) => x.session).length, checked: done.size, byStaff });
  });

  r.post('/checkins', can('checkin.edit'), (req, res) => {
    const b = parse(z.object({ student_id: v.id('học viên'), note: v.optText(200) }), req.body);
    const date = vnToday();
    const st = db.prepare('SELECT * FROM students WHERE id = ?').get(b.student_id);
    if (!st) throw notFound('Không tìm thấy học viên.');
    const ex = db.prepare('SELECT * FROM checkins WHERE student_id = ? AND date = ?').get(b.student_id, date);
    if (ex) return res.json({ id: ex.id, duplicate: true, checked_at: ex.checked_at });
    // Gắn với buổi học gần nhất trong ngày của học viên (nếu có)
    const sess = db.prepare(`SELECT s.id, s.start_time FROM class_sessions s WHERE s.date = ? AND s.status != 'cancelled' ORDER BY s.start_time`).all(date)
      .find((s) => sessionStudentIds(db, s.id).includes(b.student_id));
    const id = Number(db.prepare('INSERT INTO checkins(student_id, date, checked_at, session_id, checked_by, note) VALUES (?,?,?,?,?,?)')
      .run(b.student_id, date, nowIso(), sess?.id ?? null, req.user.id, b.note).lastInsertRowid);
    logActivity(db, { entityType: 'student', entityId: b.student_id, action: 'checkin', summary: `Check-in lúc ${vnTime()}`, userId: req.user.id });
    res.status(201).json({ id, duplicate: false });
  });

  // Hoàn tác check-in nhầm (chỉ trong ngày)
  r.delete('/checkins/:id', can('checkin.edit'), (req, res) => {
    const k = db.prepare('SELECT * FROM checkins WHERE id = ?').get(Number(req.params.id));
    if (!k) throw notFound('Không tìm thấy lượt check-in.');
    if (k.date !== vnToday()) throw conflict('Chỉ hoàn tác được check-in trong ngày.');
    db.prepare('DELETE FROM checkins WHERE id = ?').run(k.id);
    logActivity(db, { entityType: 'student', entityId: k.student_id, action: 'checkin_undo', summary: 'Hoàn tác check-in', userId: req.user.id });
    res.json({ ok: true });
  });

  // ---------- BTVN & nhận xét còn thiếu ----------
  r.get('/todo', can('learning.edit', 'learning.edit_own'), (req, res) => {
    const classIds = has(req.user, 'learning.edit') ? null : visibleClassIds(db, req.user);
    res.json({ ...learningTodo(db, { classIds }), homeworkLabels: HOMEWORK_LABEL });
  });

  // ---------- Bổ trợ học tập ----------
  r.get('/support', can('support.view'), (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : monthOf();
    const items = supportList(db, month);
    const counts = { all: items.length, needed: items.filter((x) => x.state === 'needed').length, not_needed: items.filter((x) => x.state === 'not_needed').length, confirmed: items.filter((x) => x.state === 'confirmed').length };
    res.json({ month, items, counts, rules: SUPPORT_RULE_TEXT });
  });

  // Ghi quyết định: xác nhận bổ trợ (tạo việc chăm sóc loại "Bổ trợ học tập") hoặc không cần bổ trợ
  r.post('/support', can('support.view'), (req, res) => {
    const b = parse(z.object({
      student_id: v.id('học viên'), month: z.string().regex(/^\d{4}-\d{2}$/, 'Tháng không hợp lệ.'),
      status: z.enum(['confirmed', 'not_needed'], { error: 'Chọn quyết định.' }), note: v.optText(500), owner_id: v.optId(), due_date: v.optDate(),
    }), req.body);
    if (b.status === 'not_needed' && !b.note) throw badRequest('Ghi lý do không cần bổ trợ.', { note: 'Ghi lý do không cần bổ trợ.' });
    const out = db.transaction(() => {
      const st = db.prepare('SELECT * FROM students WHERE id = ?').get(b.student_id);
      if (!st) throw notFound('Không tìm thấy học viên.');
      const prev = db.prepare('SELECT * FROM support_reviews WHERE student_id = ? AND month = ?').get(b.student_id, b.month);
      if (prev) throw conflict('Học viên đã được rà soát trong tháng này.');
      let caseId = null;
      if (b.status === 'confirmed') {
        const row = supportList(db, b.month, { studentIds: [b.student_id] })[0];
        const ts = nowIso();
        const e = db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND status = 'active' ORDER BY enrolled_at DESC LIMIT 1`).get(b.student_id);
        caseId = Number(db.prepare(`INSERT INTO care_cases(code, student_id, enrollment_id, type, title, content, status, priority, owner_id, due_date, source_key, created_by, created_at, updated_at)
          VALUES (?,?,?,'support',?,?,'new','high',?,?,?,?,?,?)`).run(nextCode(db, 'care', 'CS-', 4), b.student_id, e?.id ?? null,
          `Bổ trợ học tập tháng ${b.month.slice(5)}/${b.month.slice(0, 4)}`, [row?.reasons?.join('; '), b.note].filter(Boolean).join('. ') || 'Bổ trợ học tập',
          b.owner_id || req.user.id, b.due_date || addDays(vnToday(), 7), `support:${b.student_id}:${b.month}`, req.user.id, ts, ts).lastInsertRowid);
        if ((b.owner_id || req.user.id) !== req.user.id) notify(db, b.owner_id, { title: `Việc bổ trợ học tập: ${st.full_name}`, link: `/care?id=${caseId}`, dedupeKey: `support:${caseId}` });
      }
      db.prepare('INSERT INTO support_reviews(student_id, month, status, note, case_id, decided_by, decided_at) VALUES (?,?,?,?,?,?,?)').run(b.student_id, b.month, b.status, b.note, caseId, req.user.id, nowIso());
      logActivity(db, { entityType: 'student', entityId: b.student_id, action: 'support', summary: b.status === 'confirmed' ? `Xác nhận bổ trợ học tập tháng ${b.month.slice(5)}/${b.month.slice(0, 4)}` : `Không cần bổ trợ tháng ${b.month.slice(5)}: ${b.note}`, userId: req.user.id });
      return { caseId };
    })();
    res.status(201).json(out);
  });

  r.delete('/support/:studentId/:month', can('support.view'), (req, res) => {
    const row = db.prepare('SELECT * FROM support_reviews WHERE student_id = ? AND month = ?').get(Number(req.params.studentId), req.params.month);
    if (!row) throw notFound('Không tìm thấy quyết định.');
    if (row.case_id && db.prepare(`SELECT 1 FROM care_logs WHERE case_id = ?`).get(row.case_id)) throw conflict('Việc bổ trợ đã có ghi nhận xử lý, không hoàn tác được.');
    db.transaction(() => {
      db.prepare('DELETE FROM support_reviews WHERE student_id = ? AND month = ?').run(row.student_id, row.month);
      if (row.case_id) db.prepare('DELETE FROM care_cases WHERE id = ?').run(row.case_id);
    })();
    res.json({ ok: true });
  });

  // ---------- Điểm kiểm tra ----------
  const canEditClass = (user, cls) => has(user, 'learning.edit') || (has(user, 'learning.edit_own') && (cls.teacher_id === user.id || cls.assistant_id === user.id || cls.homeroom_id === user.id));

  r.get('/assessments', can('classes.view', 'classes.view_own', 'students.view', 'students.view_own'), (req, res) => {
    const classId = Number(req.query.class_id || 0);
    const studentId = Number(req.query.student_id || 0);
    const where = [];
    const args = [];
    if (classId) {
      const ids = visibleClassIds(db, req.user);
      if (ids !== null && !ids.includes(classId)) throw forbidden('Bạn chỉ xem được lớp mình phụ trách.');
      where.push('a.class_id = ?'); args.push(classId);
    }
    if (studentId) {
      const ids = visibleStudentIds(db, req.user);
      if (ids !== null && !ids.includes(studentId)) throw forbidden('Bạn chỉ xem được học viên lớp mình.');
      where.push('a.student_id = ?'); args.push(studentId);
    }
    if (!where.length) throw badRequest('Chọn lớp hoặc học viên.');
    const items = db.prepare(`SELECT a.*, s.full_name AS student_name, s.code AS student_code, c.code AS class_code, u.full_name AS created_by_name FROM assessments a
      JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN users u ON u.id = a.created_by
      WHERE ${where.join(' AND ')} ORDER BY a.taken_at DESC, a.title, s.full_name`).all(...args);
    res.json({ items, kinds: ASSESSMENT_KIND });
  });

  // Nhập điểm một bài kiểm tra cho cả lớp
  r.post('/assessments', can('learning.edit', 'learning.edit_own'), (req, res) => {
    const b = parse(z.object({
      class_id: v.id('lớp'), title: v.text(120, 'tên bài kiểm tra'), kind: z.enum(Object.keys(ASSESSMENT_KIND), { error: 'Chọn loại bài kiểm tra.' }),
      taken_at: v.date('ngày kiểm tra'), max_score: z.coerce.number().min(1).max(1000).default(10),
      scores: z.array(z.object({ student_id: v.id('học viên'), score: z.union([z.literal(''), z.null(), z.coerce.number()]).optional(), comment: v.optText(300) })),
    }), req.body);
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(b.class_id);
    if (!cls) throw notFound('Không tìm thấy lớp.');
    if (!canEditClass(req.user, cls)) throw forbidden('Bạn chỉ nhập điểm cho lớp mình dạy.');
    if (b.taken_at > vnToday()) throw badRequest('Ngày kiểm tra không ở tương lai.', { taken_at: 'Chọn ngày đến hôm nay.' });
    const roster = new Map(db.prepare(`SELECT student_id, id FROM enrollments WHERE class_id = ? AND status IN ('active','completed')`).all(b.class_id).map((x) => [x.student_id, x.id]));
    const fields = {};
    const rows = b.scores.filter((x) => x.score !== '' && x.score !== null && x.score !== undefined);
    rows.forEach((x, i) => {
      if (!roster.has(x.student_id)) fields[`scores.${i}`] = 'Học viên không thuộc lớp.';
      else if (x.score < 0 || x.score > b.max_score) fields[`scores.${b.scores.indexOf(x)}.score`] = `Điểm từ 0 đến ${b.max_score}.`;
    });
    if (Object.keys(fields).length) throw badRequest('Điểm chưa hợp lệ.', fields);
    if (!rows.length) throw badRequest('Nhập điểm cho ít nhất một học viên.', { scores: 'Nhập điểm cho ít nhất một học viên.' });
    const dup = db.prepare('SELECT 1 FROM assessments WHERE class_id = ? AND title = ? AND taken_at = ?').get(b.class_id, b.title, b.taken_at);
    if (dup) throw conflict('Bài kiểm tra này đã được nhập điểm. Đặt tên khác hoặc sửa điểm từng học viên.');
    const ts = nowIso();
    db.transaction(() => {
      for (const x of rows) {
        db.prepare('INSERT INTO assessments(class_id, student_id, enrollment_id, title, kind, score, max_score, taken_at, comment, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(b.class_id, x.student_id, roster.get(x.student_id), b.title, b.kind, x.score, b.max_score, b.taken_at, x.comment, req.user.id, ts);
      }
      logActivity(db, { entityType: 'class', entityId: b.class_id, action: 'assessment', summary: `Nhập điểm "${b.title}" cho ${rows.length} học viên`, userId: req.user.id });
    })();
    res.status(201).json({ ok: true, count: rows.length });
  });

  r.put('/assessments/:id', can('learning.edit', 'learning.edit_own'), (req, res) => {
    const a = db.prepare('SELECT a.*, c.teacher_id, c.assistant_id FROM assessments a LEFT JOIN classes c ON c.id = a.class_id WHERE a.id = ?').get(Number(req.params.id));
    if (!a) throw notFound('Không tìm thấy điểm.');
    if (!canEditClass(req.user, a)) throw forbidden('Bạn chỉ sửa điểm lớp mình dạy.');
    const b = parse(z.object({ score: z.coerce.number().min(0).max(a.max_score, `Điểm tối đa ${a.max_score}.`), comment: v.optText(300) }), req.body);
    db.prepare('UPDATE assessments SET score = ?, comment = ? WHERE id = ?').run(b.score, b.comment, a.id);
    res.json({ ok: true });
  });

  r.delete('/assessments/:id', can('learning.edit', 'learning.edit_own'), (req, res) => {
    const a = db.prepare('SELECT a.*, c.teacher_id, c.assistant_id FROM assessments a LEFT JOIN classes c ON c.id = a.class_id WHERE a.id = ?').get(Number(req.params.id));
    if (!a) throw notFound('Không tìm thấy điểm.');
    if (!canEditClass(req.user, a)) throw forbidden('Bạn chỉ xóa điểm lớp mình dạy.');
    db.prepare('DELETE FROM assessments WHERE id = ?').run(a.id);
    res.json({ ok: true });
  });

  return r;
}

export { inList };
