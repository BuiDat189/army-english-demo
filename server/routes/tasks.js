import { Router } from 'express';
import { z } from 'zod';
import { has } from '../auth/middleware.js';
import { parse, v, notFound, forbidden, conflict } from '../lib/http.js';
import { nextCode, notify, logActivity } from '../db/index.js';
import { nowIso, vnToday } from '../lib/time.js';
import { checklistTemplates } from '../db/seed.js';

export const TASK_STATUS = { todo: 'Cần làm', in_progress: 'Đang làm', review: 'Chờ kiểm tra', done: 'Hoàn thành' };
export const TASK_PRIORITY = { low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn cấp' };

const taskSchema = z.object({
  title: v.text(200, 'tiêu đề công việc'), description: v.optText(3000),
  priority: z.enum(Object.keys(TASK_PRIORITY)).default('normal'), assignee_id: v.optId(),
  due_date: v.optDate(), due_time: z.string().optional().nullable().transform((s) => (s ? s : null)).refine((s) => s === null || /^\d{2}:\d{2}$/.test(s), 'Giờ không hợp lệ.'),
  status: z.enum(Object.keys(TASK_STATUS)).optional(),
  items: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
});

export function taskRoutes({ db }) {
  const r = Router();
  const seeAll = (u) => has(u, 'tasks.view_all');
  const visibleTask = (u, t) => seeAll(u) || t.assignee_id === u.id || t.created_by === u.id;
  const load = (u, id) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!t || !visibleTask(u, t)) throw notFound('Không tìm thấy công việc.');
    return t;
  };

  r.get('/templates', (_req, res) => res.json({ templates: checklistTemplates() }));

  r.get('/', (req, res) => {
    const { view = 'all', status, assignee_id, q, priority } = req.query;
    const today = vnToday();
    const where = [];
    const args = [];
    if (!seeAll(req.user)) { where.push('(t.assignee_id = ? OR t.created_by = ?)'); args.push(req.user.id, req.user.id); }
    if (view === 'mine') { where.push('t.assignee_id = ?'); args.push(req.user.id); }
    if (view === 'overdue') { where.push(`t.status != 'done' AND t.due_date < ?`); args.push(today); }
    if (view === 'today') { where.push(`t.due_date = ?`); args.push(today); }
    if (view === 'done') where.push(`t.status = 'done'`);
    if (view === 'open') where.push(`t.status != 'done'`);
    if (status) { where.push('t.status = ?'); args.push(status); }
    if (priority) { where.push('t.priority = ?'); args.push(priority); }
    if (assignee_id) { where.push('t.assignee_id = ?'); args.push(Number(assignee_id)); }
    if (q) { where.push('(t.title LIKE ? OR t.code LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const items = db.prepare(`SELECT t.*, u.full_name AS assignee_name, c.full_name AS creator_name,
        (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id) AS item_total, (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id AND i.done = 1) AS item_done,
        (SELECT COUNT(*) FROM task_comments m WHERE m.task_id = t.id) AS comment_count
      FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END, t.position, t.due_date IS NULL, t.due_date, t.id DESC LIMIT 500`).all(...args);
    res.json({ items, today, statusLabels: TASK_STATUS, priorityLabels: TASK_PRIORITY, canAssign: has(req.user, 'tasks.assign') });
  });

  r.post('/', (req, res) => {
    const b = parse(taskSchema, req.body);
    const assignee = b.assignee_id || req.user.id;
    if (assignee !== req.user.id && !has(req.user, 'tasks.assign')) throw forbidden('Bạn chỉ tạo được công việc cho chính mình.');
    const ts = nowIso();
    const id = db.transaction(() => {
      const pos = db.prepare(`SELECT COALESCE(MAX(position),0)+1 p FROM tasks WHERE status = ?`).get(b.status || 'todo').p;
      const id = Number(db.prepare(`INSERT INTO tasks(code, title, description, status, priority, assignee_id, created_by, due_date, due_time, position, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(nextCode(db, 'task', 'CV-', 4), b.title, b.description, b.status || 'todo', b.priority, assignee, req.user.id, b.due_date, b.due_time, pos, ts, ts).lastInsertRowid);
      (b.items || []).forEach((text, i) => db.prepare('INSERT INTO task_items(task_id, text, position) VALUES (?,?,?)').run(id, text, i));
      if (assignee !== req.user.id) notify(db, assignee, { title: `Bạn được giao việc: ${b.title}`, body: b.due_date ? `Hạn ${b.due_date.split('-').reverse().join('/')}` : null, link: `/tasks?id=${id}`, dedupeKey: `task-assign:${id}:${assignee}` });
      return id;
    })();
    res.status(201).json({ id });
  });

  // Tạo checklist từ mẫu cho một ngày. Khóa template:<mẫu>:<ngày> chống tạo trùng khi bấm lại.
  r.post('/from-template', (req, res) => {
    const templates = checklistTemplates();
    const b = parse(z.object({ template_key: z.enum(Object.keys(templates), { error: 'Chọn mẫu checklist.' }), date: v.date('ngày'), assignee_id: v.optId() }), req.body);
    const assignee = b.assignee_id || req.user.id;
    if (assignee !== req.user.id && !has(req.user, 'tasks.assign')) throw forbidden('Bạn chỉ tạo được công việc cho chính mình.');
    const key = `template:${b.template_key}:${b.date}`;
    const existing = db.prepare('SELECT id FROM tasks WHERE source_key = ?').get(key);
    if (existing) return res.status(200).json({ id: existing.id, duplicate: true });
    const t = templates[b.template_key];
    const ts = nowIso();
    const id = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO tasks(code, title, status, priority, assignee_id, created_by, due_date, template_key, source_key, position, created_at, updated_at) VALUES (?,?,'todo','normal',?,?,?,?,?,0,?,?)`)
        .run(nextCode(db, 'task', 'CV-', 4), `${t.name} – ${b.date.split('-').reverse().join('/')}`, assignee, req.user.id, b.date, b.template_key, key, ts, ts).lastInsertRowid);
      t.items.forEach((text, i) => db.prepare('INSERT INTO task_items(task_id, text, position) VALUES (?,?,?)').run(id, text, i));
      return id;
    })();
    res.status(201).json({ id, duplicate: false });
  });

  r.get('/:id', (req, res) => {
    const t = load(req.user, Number(req.params.id));
    const items = db.prepare('SELECT i.*, u.full_name AS done_by_name FROM task_items i LEFT JOIN users u ON u.id = i.done_by WHERE task_id = ? ORDER BY position, id').all(t.id);
    const comments = db.prepare('SELECT c.*, u.full_name AS user_name FROM task_comments c JOIN users u ON u.id = c.user_id WHERE task_id = ? ORDER BY created_at').all(t.id);
    const people = db.prepare('SELECT id, full_name FROM users WHERE id IN (?, ?)').all(t.assignee_id || 0, t.created_by || 0);
    let related = null;
    if (t.related_type === 'asset_issue') related = db.prepare(`SELECT i.id, i.code, i.status, COALESCE(a.name, i.title) AS asset_name FROM asset_issues i LEFT JOIN assets a ON a.id = i.asset_id WHERE i.id = ?`).get(t.related_id);
    if (t.related_type === 'lead') related = db.prepare(`SELECT id, code, student_name, parent_name, status FROM leads WHERE id = ?`).get(t.related_id);
    if (t.related_type === 'class') related = db.prepare(`SELECT id, code FROM classes WHERE id = ?`).get(t.related_id);
    if (t.related_type === 'student') related = db.prepare(`SELECT id, code, full_name FROM students WHERE id = ?`).get(t.related_id);
    const history = db.prepare(`SELECT l.*, u.full_name AS by_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE entity_type = 'task' AND entity_id = ? ORDER BY created_at DESC`).all(t.id);
    res.json({ task: { ...t, assignee_name: people.find((p) => p.id === t.assignee_id)?.full_name, creator_name: people.find((p) => p.id === t.created_by)?.full_name }, items, comments, related, history, statusLabels: TASK_STATUS, priorityLabels: TASK_PRIORITY });
  });

  r.put('/:id', (req, res) => {
    const t = load(req.user, Number(req.params.id));
    const b = parse(taskSchema, req.body);
    const assignee = b.assignee_id || t.assignee_id;
    if (assignee !== t.assignee_id && !has(req.user, 'tasks.assign')) throw forbidden('Bạn không có quyền giao lại công việc.');
    const ts = nowIso();
    db.transaction(() => {
      const status = b.status || t.status;
      db.prepare(`UPDATE tasks SET title=?, description=?, priority=?, assignee_id=?, due_date=?, due_time=?, status=?, completed_at=CASE WHEN ?='done' THEN COALESCE(completed_at, ?) ELSE NULL END, updated_at=? WHERE id=?`)
        .run(b.title, b.description, b.priority, assignee, b.due_date, b.due_time, status, status, ts, ts, t.id);
      if (assignee !== t.assignee_id) {
        notify(db, assignee, { title: `Bạn được giao việc: ${b.title}`, link: `/tasks?id=${t.id}`, dedupeKey: `task-assign:${t.id}:${assignee}` });
        logActivity(db, { entityType: 'task', entityId: t.id, action: 'reassigned', summary: 'Giao lại công việc', userId: req.user.id });
      }
    })();
    res.json({ ok: true });
  });

  // Đổi trạng thái (nút/menu hoặc kéo thả Kanban). Lưu vị trí để reload vẫn đúng thứ tự.
  r.post('/:id/move', (req, res) => {
    const t = load(req.user, Number(req.params.id));
    const b = parse(z.object({ status: z.enum(Object.keys(TASK_STATUS)), before_id: v.optId() }), req.body);
    const ts = nowIso();
    db.transaction(() => {
      let pos;
      if (b.before_id) {
        const before = db.prepare('SELECT position FROM tasks WHERE id = ?').get(b.before_id);
        const prev = db.prepare('SELECT MAX(position) p FROM tasks WHERE status = ? AND position < ? AND id != ?').get(b.status, before?.position ?? 0, t.id).p;
        pos = before ? ((prev ?? before.position - 1) + before.position) / 2 : 0;
      } else {
        pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM tasks WHERE status = ? AND id != ?').get(b.status, t.id).p;
      }
      db.prepare(`UPDATE tasks SET status = ?, position = ?, completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, ?) ELSE NULL END, updated_at = ? WHERE id = ?`).run(b.status, pos, b.status, ts, ts, t.id);
      if (b.status !== t.status) {
        logActivity(db, { entityType: 'task', entityId: t.id, action: 'status', summary: `Chuyển trạng thái: ${TASK_STATUS[t.status]} → ${TASK_STATUS[b.status]}`, userId: req.user.id });
        if (t.created_by && t.created_by !== req.user.id && b.status === 'done') notify(db, t.created_by, { title: `Công việc đã hoàn thành: ${t.title}`, link: `/tasks?id=${t.id}`, dedupeKey: `task-done:${t.id}` });
      }
    })();
    res.json({ ok: true });
  });

  r.post('/:id/items', (req, res) => {
    const t = load(req.user, Number(req.params.id));
    const b = parse(z.object({ text: v.text(200, 'nội dung') }), req.body);
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM task_items WHERE task_id = ?').get(t.id).p;
    const id = Number(db.prepare('INSERT INTO task_items(task_id, text, position) VALUES (?,?,?)').run(t.id, b.text, pos).lastInsertRowid);
    res.status(201).json({ id });
  });
  r.put('/:id/items/:itemId', (req, res) => {
    const t = load(req.user, Number(req.params.id));
    const b = parse(z.object({ done: z.boolean() }), req.body);
    const ch = db.prepare('UPDATE task_items SET done = ?, done_by = ?, done_at = ? WHERE id = ? AND task_id = ?').run(b.done ? 1 : 0, b.done ? req.user.id : null, b.done ? nowIso() : null, Number(req.params.itemId), t.id);
    if (!ch.changes) throw notFound('Không tìm thấy mục checklist.');
    if (b.done && t.status === 'todo') db.prepare(`UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?`).run(nowIso(), t.id);
    res.json({ ok: true });
  });
  r.delete('/:id/items/:itemId', (req, res) => {
    const t = load(req.user, Number(req.params.id));
    if (t.template_key) throw conflict('Không xóa mục của checklist theo mẫu.');
    db.prepare('DELETE FROM task_items WHERE id = ? AND task_id = ?').run(Number(req.params.itemId), t.id);
    res.json({ ok: true });
  });

  r.post('/:id/comments', (req, res) => {
    const t = load(req.user, Number(req.params.id));
    const b = parse(z.object({ content: v.text(2000, 'bình luận') }), req.body);
    db.prepare('INSERT INTO task_comments(task_id, user_id, content, created_at) VALUES (?,?,?,?)').run(t.id, req.user.id, b.content, nowIso());
    for (const uid of new Set([t.assignee_id, t.created_by])) {
      if (uid && uid !== req.user.id) notify(db, uid, { title: `Bình luận mới: ${t.title}`, body: b.content.slice(0, 80), link: `/tasks?id=${t.id}` });
    }
    res.status(201).json({ ok: true });
  });

  return r;
}
