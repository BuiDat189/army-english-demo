import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest, forbidden } from '../lib/http.js';
import { logActivity, notify } from '../db/index.js';
import { nowIso, vnToday, addDays } from '../lib/time.js';
import { generateDates, findConflicts } from '../services/schedule.js';
import { visibleClassIds, inList } from '../lib/scope.js';

// ===== NGHỈ DO TRUNG TÂM (nghỉ Tết sớm, cúp điện, sự cố…) =====
// Các buổi trong khoảng bị hủy và bù đủ số buổi vào cuối lịch lớp theo lịch tuần ⇒ học phí không bị trừ.
// Buổi đã điểm danh không bị đụng tới.

const closureSchema = z.object({
  from_date: v.date('từ ngày'), to_date: v.date('đến ngày'), reason: v.text(300, 'lý do nghỉ'),
  class_ids: z.array(z.coerce.number().int().positive()).optional().nullable(),
});

function affectedSessions(db, { from, to, classIds }) {
  return db.prepare(`SELECT s.*, c.code AS class_code FROM class_sessions s JOIN classes c ON c.id = s.class_id
    WHERE s.date BETWEEN ? AND ? AND s.status = 'scheduled' AND c.status IN ('planned','active') ${classIds?.length ? `AND s.class_id IN (${inList(classIds)})` : ''}
    AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id) ORDER BY s.date, s.start_time`).all(from, to);
}

function previewOf(db, b) {
  const sessions = affectedSessions(db, { from: b.from_date, to: b.to_date, classIds: b.class_ids });
  const byClass = new Map();
  for (const s of sessions) {
    if (!byClass.has(s.class_id)) byClass.set(s.class_id, { class_id: s.class_id, class_code: s.class_code, sessions: [] });
    byClass.get(s.class_id).sessions.push(s);
  }
  return [...byClass.values()].map((c) => {
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(c.class_id);
    const last = db.prepare(`SELECT MAX(date) d FROM class_sessions WHERE class_id = ? AND status != 'cancelled'`).get(c.class_id).d || b.to_date;
    const start = addDays(last > b.to_date ? last : b.to_date, 1);
    const added = generateDates({ startDate: start, pattern: JSON.parse(cls.schedule_json || '[]'), count: c.sessions.length });
    return { ...c, cls, added, cancelled: c.sessions.length };
  });
}

export function closureRoutes({ db }) {
  const r = Router();

  r.get('/', can('classes.view', 'classes.view_own'), (_req, res) => {
    const items = db.prepare(`SELECT x.*, u.full_name AS created_by_name FROM center_closures x LEFT JOIN users u ON u.id = x.created_by ORDER BY x.from_date DESC LIMIT 100`).all()
      .map((x) => ({ ...x, class_codes: x.class_ids ? db.prepare(`SELECT code FROM classes WHERE id IN (${inList(JSON.parse(x.class_ids))})`).all().map((c) => c.code) : null }));
    res.json({ items });
  });

  // Xem trước: lớp nào bị ảnh hưởng, bao nhiêu buổi, buổi bù rơi vào ngày nào
  r.post('/preview', can('closures.edit'), (req, res) => {
    const b = parse(closureSchema, req.body);
    if (b.to_date < b.from_date) throw badRequest('Đến ngày phải sau từ ngày.', { to_date: 'Đến ngày phải sau từ ngày.' });
    const p = previewOf(db, b);
    res.json({ classes: p.map((c) => ({ class_id: c.class_id, class_code: c.class_code, cancelled: c.cancelled, added: c.added.map((d) => d.date) })), total: p.reduce((t, c) => t + c.cancelled, 0) });
  });

  r.post('/', can('closures.edit'), (req, res) => {
    const b = parse(closureSchema, req.body);
    if (b.to_date < b.from_date) throw badRequest('Đến ngày phải sau từ ngày.', { to_date: 'Đến ngày phải sau từ ngày.' });
    if (b.to_date > addDays(vnToday(), 365)) throw badRequest('Chỉ khai báo trong vòng 1 năm tới.', { to_date: 'Tối đa 1 năm tới.' });
    const out = db.transaction(() => {
      const plan = previewOf(db, b);
      if (!plan.length) throw conflict('Không có buổi học nào chưa điểm danh trong khoảng này.');
      const ts = nowIso();
      const dmy = (d) => d.split('-').reverse().join('/');
      let cancelled = 0;
      let added = 0;
      const warnings = [];
      for (const c of plan) {
        for (const s of c.sessions) {
          db.prepare(`UPDATE class_sessions SET status = 'cancelled', cancel_reason = ? WHERE id = ? AND status = 'scheduled'`).run(`Trung tâm nghỉ: ${b.reason}`, s.id);
          db.prepare(`UPDATE makeups SET status = 'cancelled', note = 'Buổi học bù bị hủy do trung tâm nghỉ' WHERE makeup_session_id = ? AND status = 'scheduled'`).run(s.id);
          db.prepare(`UPDATE trials SET status = 'cancelled', updated_at = ? WHERE session_id = ? AND status = 'scheduled'`).run(ts, s.id);
          cancelled++;
        }
        const maxSeq = db.prepare('SELECT COALESCE(MAX(seq_no),0) m FROM class_sessions WHERE class_id = ?').get(c.class_id).m;
        const ins = db.prepare(`INSERT INTO class_sessions(class_id, date, start_time, end_time, room_id, teacher_id, assistant_id, kind, seq_no, status, created_at, title)
          VALUES (?,?,?,?,?,?,?,'regular',?,'scheduled',?,?)`);
        c.added.forEach((d, i) => {
          const conf = findConflicts(db, { date: d.date, start: d.start, end: d.end, roomId: c.cls.room_id, teacherId: c.cls.teacher_id, assistantId: c.cls.assistant_id });
          if (conf.length) warnings.push(`${c.class_code} ${dmy(d.date)}: ${conf[0].message}`);
          ins.run(c.class_id, d.date, d.start, d.end, c.cls.room_id, c.cls.teacher_id, c.cls.assistant_id, maxSeq + i + 1, ts, 'Buổi bù do trung tâm nghỉ');
          added++;
        });
        if (c.added.length) db.prepare('UPDATE classes SET end_date = ? WHERE id = ? AND (end_date IS NULL OR end_date < ?)').run(c.added.at(-1).date, c.class_id, c.added.at(-1).date);
        logActivity(db, { entityType: 'class', entityId: c.class_id, action: 'closure', summary: `Trung tâm nghỉ ${dmy(b.from_date)}–${dmy(b.to_date)} (${b.reason}): hủy ${c.cancelled} buổi, bù ${c.added.length} buổi cuối khóa`, userId: req.user.id });
        for (const uid of new Set([c.cls.teacher_id, c.cls.assistant_id, c.cls.homeroom_id])) {
          notify(db, uid, { title: `Lớp ${c.class_code}: trung tâm nghỉ ${dmy(b.from_date)}–${dmy(b.to_date)}`, body: `Hủy ${c.cancelled} buổi, bù cuối khóa đến ${dmy(c.added.at(-1)?.date || b.to_date)}. Học phí không bị trừ.`, link: `/classes/${c.class_id}`, dedupeKey: `closure:${c.class_id}:${b.from_date}:${b.to_date}` });
        }
      }
      const id = Number(db.prepare(`INSERT INTO center_closures(from_date, to_date, reason, class_ids, sessions_cancelled, sessions_added, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(b.from_date, b.to_date, b.reason, b.class_ids?.length ? JSON.stringify(b.class_ids) : null, cancelled, added, req.user.id, ts).lastInsertRowid);
      return { id, cancelled, added, classes: plan.length, warnings };
    })();
    res.status(201).json(out);
  });

  return r;
}

// ===== LỊCH TEST / HỌP PHỤ HUYNH CỦA LỚP =====
export const EVENT_KIND = { test: 'Kiểm tra định kỳ', parent_meeting: 'Họp phụ huynh' };
export const RESULTS_DAYS = 5; // trả kết quả test cho phụ huynh trong 5 ngày

function ownsClass(db, user, classId) {
  if (has(user, 'classes.edit')) return true;
  return !!db.prepare('SELECT 1 FROM classes WHERE id = ? AND (homeroom_id = ? OR teacher_id = ?)').get(classId, user.id, user.id);
}

export function classEventRoutes({ db }) {
  const r = Router();

  r.get('/', can('classes.view', 'classes.view_own'), (req, res) => {
    const ids = visibleClassIds(db, req.user);
    const today = vnToday();
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today.slice(0, 7);
    const where = [`(e.date LIKE ? OR (e.kind = 'test' AND e.status = 'done' AND e.results_returned_at IS NULL))`];
    const args = [`${month}%`];
    if (ids !== null) where.push(`e.class_id IN (${inList(ids)})`);
    if (req.query.class_id) { where.push('e.class_id = ?'); args.push(Number(req.query.class_id)); }
    const items = db.prepare(`SELECT e.*, c.code AS class_code, c.homeroom_id, h.full_name AS homeroom_name, u.full_name AS created_by_name FROM class_events e JOIN classes c ON c.id = e.class_id
      LEFT JOIN users h ON h.id = c.homeroom_id LEFT JOIN users u ON u.id = e.created_by WHERE ${where.join(' AND ')} ORDER BY e.date, e.start_time`).all(...args)
      .map((e) => ({ ...e, results_overdue: e.kind === 'test' && e.status === 'done' && !e.results_returned_at && e.results_due < today, can_edit: ownsClass(db, req.user, e.class_id) }));
    // Lớp đang học chưa có lịch test / họp PH trong tháng
    const active = db.prepare(`SELECT c.id, c.code, c.homeroom_id, h.full_name AS homeroom_name FROM classes c LEFT JOIN users h ON h.id = c.homeroom_id WHERE c.status = 'active'
      ${ids !== null ? `AND c.id IN (${inList(ids)})` : ''} ORDER BY c.code`).all();
    const missing = active.map((c) => ({
      ...c,
      test: !!db.prepare(`SELECT 1 FROM class_events WHERE class_id = ? AND kind = 'test' AND status != 'cancelled' AND date LIKE ?`).get(c.id, `${month}%`),
      parent_meeting: !!db.prepare(`SELECT 1 FROM class_events WHERE class_id = ? AND kind = 'parent_meeting' AND status != 'cancelled' AND date LIKE ?`).get(c.id, `${month}%`),
    })).filter((c) => !c.test || !c.parent_meeting);
    res.json({ month, items, missing, kindLabels: EVENT_KIND, resultsDays: RESULTS_DAYS });
  });

  r.post('/', can('class_events.edit', 'classes.edit'), (req, res) => {
    const b = parse(z.object({
      class_id: v.id('lớp'), kind: z.enum(['test', 'parent_meeting'], { error: 'Chọn loại lịch.' }), title: v.optText(150),
      date: v.date('ngày'), start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Giờ không hợp lệ.').optional().nullable(), note: v.optText(500),
    }), req.body);
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(b.class_id);
    if (!cls) throw notFound('Không tìm thấy lớp.');
    if (!ownsClass(db, req.user, b.class_id)) throw forbidden('Chỉ chủ nhiệm/giáo viên của lớp được đặt lịch.');
    if (b.date < addDays(vnToday(), -30)) throw badRequest('Ngày quá xa trong quá khứ.', { date: 'Ngày quá xa.' });
    const title = b.title || `${EVENT_KIND[b.kind]} tháng ${b.date.slice(5, 7)}/${b.date.slice(0, 4)}`;
    const id = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO class_events(class_id, kind, title, date, start_time, note, status, results_due, created_by, created_at) VALUES (?,?,?,?,?,?,'scheduled',?,?,?)`)
        .run(b.class_id, b.kind, title, b.date, b.start_time || null, b.note, b.kind === 'test' ? addDays(b.date, RESULTS_DAYS) : null, req.user.id, nowIso()).lastInsertRowid);
      logActivity(db, { entityType: 'class', entityId: b.class_id, action: 'event', summary: `Đặt lịch ${EVENT_KIND[b.kind].toLowerCase()} ${b.date.split('-').reverse().join('/')}`, userId: req.user.id });
      return id;
    })();
    res.status(201).json({ id });
  });

  const load = (req) => {
    const e = db.prepare('SELECT * FROM class_events WHERE id = ?').get(Number(req.params.id));
    if (!e) throw notFound('Không tìm thấy lịch.');
    if (!ownsClass(db, req.user, e.class_id)) throw forbidden('Chỉ chủ nhiệm/giáo viên của lớp được cập nhật.');
    return e;
  };

  // Đã tổ chức (test: bắt đầu đếm 5 ngày trả kết quả từ ngày test)
  r.post('/:id/done', can('class_events.edit', 'classes.edit'), (req, res) => {
    const e = load(req);
    if (e.status !== 'scheduled') throw conflict('Lịch đã được cập nhật.');
    if (e.date > vnToday()) throw conflict('Chưa đến ngày tổ chức.');
    db.prepare(`UPDATE class_events SET status = 'done' WHERE id = ?`).run(e.id);
    res.json({ ok: true });
  });

  r.post('/:id/results-returned', can('class_events.edit', 'classes.edit'), (req, res) => {
    const e = load(req);
    if (e.kind !== 'test') throw badRequest('Chỉ lịch test mới có kết quả.');
    if (e.status !== 'done') throw conflict('Đánh dấu đã tổ chức test trước.');
    if (e.results_returned_at) throw conflict('Đã trả kết quả trước đó.');
    db.prepare('UPDATE class_events SET results_returned_at = ? WHERE id = ?').run(nowIso(), e.id);
    db.prepare(`UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE source_key = ? AND status != 'done'`).run(nowIso(), nowIso(), `test-results:${e.id}`);
    logActivity(db, { entityType: 'class', entityId: e.class_id, action: 'test_results', summary: `Đã trả kết quả ${e.title} cho phụ huynh`, userId: req.user.id });
    res.json({ ok: true });
  });

  r.post('/:id/cancel', can('class_events.edit', 'classes.edit'), (req, res) => {
    const e = load(req);
    if (e.status !== 'scheduled') throw conflict('Chỉ hủy được lịch chưa tổ chức.');
    db.prepare(`UPDATE class_events SET status = 'cancelled' WHERE id = ?`).run(e.id);
    res.json({ ok: true });
  });

  return r;
}
