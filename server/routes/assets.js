import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest } from '../lib/http.js';
import { nextCode, logActivity, notify, usersWithRole } from '../db/index.js';
import { nowIso, vnToday, addDays } from '../lib/time.js';
import { createApproval } from '../services/approvals.js';

export const ASSET_STATUS = { good: 'Hoạt động tốt', damaged: 'Hỏng – chờ xử lý', repairing: 'Đang sửa', disposed: 'Đã thanh lý' };
export const ISSUE_STATUS = { reported: 'Mới báo', in_progress: 'Đang xử lý', waiting_approval: 'Chờ duyệt chi', resolved: 'Đã xử lý', cancelled: 'Đã hủy' };
export const SEVERITY = { low: 'Thấp', normal: 'Trung bình', high: 'Cao' };

const assetSchema = z.object({
  name: v.text(150, 'tên tài sản'), category: v.text(80, 'nhóm'), room_id: v.optId(), location_note: v.optText(120),
  status: z.enum(Object.keys(ASSET_STATUS)).default('good'), purchased_at: v.optDate(), note: v.optText(500),
});

export function assetRoutes({ db }) {
  const r = Router();

  r.get('/', can('assets.view', 'assets.report'), (req, res) => {
    const { q, status, room_id, category } = req.query;
    const where = [];
    const args = [];
    if (q) { where.push('(a.name LIKE ? OR a.code LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    if (status) { where.push('a.status = ?'); args.push(status); }
    if (room_id) { where.push('a.room_id = ?'); args.push(Number(room_id)); }
    if (category) { where.push('a.category = ?'); args.push(category); }
    const items = db.prepare(`SELECT a.*, r.name AS room_name,
        (SELECT i.id FROM asset_issues i WHERE i.asset_id = a.id AND i.status NOT IN ('resolved','cancelled') ORDER BY i.id DESC LIMIT 1) AS open_issue_id
      FROM assets a LEFT JOIN rooms r ON r.id = a.room_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.code`).all(...args);
    const categories = db.prepare('SELECT DISTINCT category FROM assets ORDER BY category').all().map((x) => x.category);
    res.json({ items, categories, statusLabels: ASSET_STATUS, canEdit: has(req.user, 'assets.edit') });
  });

  r.post('/', can('assets.edit'), (req, res) => {
    const b = parse(assetSchema, req.body);
    const id = db.transaction(() => Number(db.prepare(`INSERT INTO assets(code, name, category, room_id, location_note, status, purchased_at, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(nextCode(db, 'asset', 'TS-', 3), b.name, b.category, b.room_id, b.location_note, b.status, b.purchased_at, b.note, nowIso()).lastInsertRowid))();
    res.status(201).json({ id });
  });
  r.put('/:id', can('assets.edit'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(id)) throw notFound('Không tìm thấy tài sản.');
    const b = parse(assetSchema, req.body);
    db.prepare('UPDATE assets SET name=?, category=?, room_id=?, location_note=?, status=?, purchased_at=?, note=? WHERE id=?').run(b.name, b.category, b.room_id, b.location_note, b.status, b.purchased_at, b.note, id);
    res.json({ ok: true });
  });

  // ---------- Báo hỏng ----------
  r.get('/issues', can('assets.view', 'assets.report'), (req, res) => {
    const where = [];
    const args = [];
    if (!has(req.user, 'assets.view')) { where.push('i.reported_by = ?'); args.push(req.user.id); }
    if (req.query.room_id) { where.push('i.room_id = ?'); args.push(Number(req.query.room_id)); }
    if (req.query.overdue === '1') { where.push(`i.requested_due < ? AND i.status NOT IN ('resolved','cancelled')`); args.push(vnToday()); }
    if (req.query.status === 'open') where.push(`i.status NOT IN ('resolved','cancelled')`);
    else if (req.query.status && req.query.status !== 'all') { where.push('i.status = ?'); args.push(req.query.status); }
    const items = db.prepare(`SELECT i.*, COALESCE(a.name, i.title) AS asset_name, a.code AS asset_code, r.name AS room_name, u.full_name AS reporter, h.full_name AS handler_name,
        t.status AS task_status, t.code AS task_code, ap.status AS approval_status, ap.code AS approval_code, ap.payment_status, ap.amount AS approval_amount
      FROM asset_issues i LEFT JOIN assets a ON a.id = i.asset_id LEFT JOIN rooms r ON r.id = COALESCE(i.room_id, a.room_id) LEFT JOIN users u ON u.id = i.reported_by LEFT JOIN users h ON h.id = i.handler_id
      LEFT JOIN tasks t ON t.id = i.task_id LEFT JOIN approvals ap ON ap.id = i.approval_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE WHEN i.status IN ('resolved','cancelled') THEN 1 ELSE 0 END, i.created_at DESC`).all(...args);
    res.json({ items, today: vnToday(), statusLabels: ISSUE_STATUS, severityLabels: SEVERITY });
  });

  r.post('/issues', can('assets.report'), (req, res) => {
    // Báo sự cố theo tài sản có trong danh mục HOẶC phát sinh mới theo phòng (tiêu đề tự nhập), kèm thời gian đề xuất xử lý
    const b = parse(z.object({
      asset_id: v.optId(), room_id: v.optId(), title: v.optText(150), session_id: v.optId(),
      description: v.text(1000, 'mô tả sự cố'), severity: z.enum(Object.keys(SEVERITY)).default('normal'), requested_due: v.optDate(),
    }), req.body);
    if (!b.asset_id && !(b.room_id && b.title)) throw badRequest('Chọn tài sản, hoặc chọn phòng và nhập tên sự cố.', { ...(b.room_id ? {} : { room_id: 'Chọn phòng.' }), ...(b.title ? {} : { title: 'Nhập tên sự cố.' }) });
    if (b.requested_due && b.requested_due < vnToday()) throw badRequest('Thời gian đề xuất xử lý phải từ hôm nay.', { requested_due: 'Phải từ hôm nay.' });
    const out = db.transaction(() => {
      let a = null;
      if (b.asset_id) {
        a = db.prepare('SELECT * FROM assets WHERE id = ?').get(b.asset_id);
        if (!a) throw notFound('Không tìm thấy tài sản.');
        if (a.status === 'disposed') throw conflict('Tài sản đã thanh lý.');
        const open = db.prepare(`SELECT id, code FROM asset_issues WHERE asset_id = ? AND status NOT IN ('resolved','cancelled')`).get(b.asset_id);
        if (open) throw conflict(`Tài sản này đang có báo hỏng ${open.code} chưa xử lý xong.`, { issueId: open.id });
      }
      const roomId = b.room_id || a?.room_id || null;
      const name = a ? a.name : b.title;
      const ts = nowIso();
      const code = nextCode(db, 'issue', 'BH-', 4);
      const id = Number(db.prepare(`INSERT INTO asset_issues(code, asset_id, room_id, title, description, severity, status, requested_due, session_id, reported_by, created_at, updated_at) VALUES (?,?,?,?,?,?,'reported',?,?,?,?,?)`)
        .run(code, b.asset_id, roomId, a ? null : b.title, b.description, b.severity, b.requested_due || addDays(vnToday(), b.severity === 'high' ? 1 : 3), b.session_id, req.user.id, ts, ts).lastInsertRowid);
      if (a) db.prepare(`UPDATE assets SET status = 'damaged' WHERE id = ?`).run(b.asset_id);
      logActivity(db, { entityType: 'asset_issue', entityId: id, action: 'reported', summary: `Báo sự cố: ${name} — ${b.description}`, userId: req.user.id });
      for (const uid of [...usersWithRole(db, 'operations'), ...usersWithRole(db, 'manager')]) {
        if (uid !== req.user.id) notify(db, uid, { title: `Sự cố cơ sở vật chất: ${name}`, body: b.description.slice(0, 100), link: `/assets/issues/${id}`, dedupeKey: `issue:${id}` });
      }
      return { id, code };
    })();
    res.status(201).json(out);
  });

  const loadIssue = (id) => {
    const i = db.prepare(`SELECT i.*, COALESCE(a.name, i.title) AS asset_name, a.code AS asset_code, a.status AS asset_status, r.name AS room_name, u.full_name AS reporter, h.full_name AS handler_name, rb.full_name AS resolved_by_name
      FROM asset_issues i LEFT JOIN assets a ON a.id = i.asset_id LEFT JOIN rooms r ON r.id = COALESCE(i.room_id, a.room_id) LEFT JOIN users u ON u.id = i.reported_by LEFT JOIN users h ON h.id = i.handler_id LEFT JOIN users rb ON rb.id = i.resolved_by WHERE i.id = ?`).get(id);
    if (!i) throw notFound('Không tìm thấy báo hỏng.');
    return i;
  };

  r.get('/issues/:id', can('assets.view', 'assets.report'), (req, res) => {
    const i = loadIssue(Number(req.params.id));
    if (!has(req.user, 'assets.view') && i.reported_by !== req.user.id) throw notFound('Không tìm thấy báo hỏng.');
    const history = db.prepare(`SELECT l.*, u.full_name AS by_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE entity_type = 'asset_issue' AND entity_id = ? ORDER BY created_at, id`).all(i.id);
    const task = i.task_id ? db.prepare('SELECT t.*, u.full_name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?').get(i.task_id) : null;
    const approval = i.approval_id ? db.prepare('SELECT a.*, d.full_name AS decider, p.full_name AS payer FROM approvals a LEFT JOIN users d ON d.id = a.decided_by LEFT JOIN users p ON p.id = a.paid_by WHERE a.id = ?').get(i.approval_id) : null;
    res.json({ issue: i, history, task, approval, statusLabels: ISSUE_STATUS, severityLabels: SEVERITY, can: { handle: has(req.user, 'assets.edit') } });
  });

  r.post('/issues/:id/task', can('assets.edit'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ assignee_id: v.id('người xử lý'), due_date: v.date('hạn xử lý'), title: v.optText(200), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('high') }), req.body);
    const out = db.transaction(() => {
      const i = loadIssue(id);
      if (['resolved', 'cancelled'].includes(i.status)) throw conflict('Báo hỏng đã đóng.');
      if (i.task_id) throw conflict('Báo hỏng này đã có công việc xử lý.', { taskId: i.task_id });
      const ts = nowIso();
      const title = b.title || `Xử lý: ${i.asset_name}${i.room_name ? ` (${i.room_name})` : ''}`;
      const tid = Number(db.prepare(`INSERT INTO tasks(code, title, description, status, priority, assignee_id, created_by, due_date, related_type, related_id, position, created_at, updated_at) VALUES (?,?,?,'todo',?,?,?,?,'asset_issue',?,0,?,?)`)
        .run(nextCode(db, 'task', 'CV-', 4), title, i.description, b.priority, b.assignee_id, req.user.id, b.due_date, id, ts, ts).lastInsertRowid);
      db.prepare(`UPDATE asset_issues SET task_id = ?, handler_id = ?, status = CASE WHEN status = 'reported' THEN 'in_progress' ELSE status END, updated_at = ? WHERE id = ?`).run(tid, b.assignee_id, ts, id);
      db.prepare(`UPDATE assets SET status = 'repairing' WHERE id = ? AND status = 'damaged'`).run(i.asset_id);
      const assignee = db.prepare('SELECT full_name FROM users WHERE id = ?').get(b.assignee_id).full_name;
      logActivity(db, { entityType: 'asset_issue', entityId: id, action: 'task', summary: `Tạo công việc xử lý, giao cho ${assignee}`, userId: req.user.id });
      notify(db, b.assignee_id, { title: `Bạn được giao xử lý: ${i.asset_name}`, link: `/tasks?id=${tid}`, dedupeKey: `task-assign:${tid}:${b.assignee_id}` });
      return { taskId: tid };
    })();
    res.status(201).json(out);
  });

  r.post('/issues/:id/approval', can('assets.edit'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ amount: v.money('chi phí dự kiến'), title: v.optText(200), description: v.text(1000, 'mô tả / báo giá') }), req.body);
    const out = db.transaction(() => {
      const i = loadIssue(id);
      if (['resolved', 'cancelled'].includes(i.status)) throw conflict('Báo hỏng đã đóng.');
      if (i.approval_id) {
        const a = db.prepare('SELECT status FROM approvals WHERE id = ?').get(i.approval_id);
        if (a.status === 'pending' || a.status === 'approved') throw conflict('Báo hỏng này đã có đề xuất chi.', { approvalId: i.approval_id });
      }
      const aid = createApproval(db, { type: 'expense', title: b.title || `Chi sửa chữa: ${i.asset_name}${i.room_name ? ` (${i.room_name})` : ''}`, description: b.description, amount: b.amount, requestedBy: req.user.id, refType: 'asset_issue', refId: id });
      db.prepare(`UPDATE asset_issues SET approval_id = ?, status = 'waiting_approval', updated_at = ? WHERE id = ?`).run(aid, nowIso(), id);
      logActivity(db, { entityType: 'asset_issue', entityId: id, action: 'approval', summary: `Tạo đề xuất chi ${b.amount.toLocaleString('vi-VN')} đ, chờ quản lý duyệt`, userId: req.user.id });
      return { approvalId: aid };
    })();
    res.status(201).json(out);
  });

  // Người phụ trách xác nhận đã xử lý xong
  r.post('/issues/:id/resolve', can('assets.edit'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ resolution: v.text(1000, 'kết quả xử lý'), asset_status: z.enum(['good', 'disposed']).default('good') }), req.body);
    db.transaction(() => {
      const i = loadIssue(id);
      if (['resolved', 'cancelled'].includes(i.status)) throw conflict('Báo hỏng đã đóng trước đó.');
      if (i.approval_id) {
        const a = db.prepare('SELECT status FROM approvals WHERE id = ?').get(i.approval_id);
        if (a.status === 'pending') throw conflict('Đề xuất chi cho báo hỏng này đang chờ duyệt. Chờ quản lý duyệt trước khi xác nhận xử lý.');
      }
      const ts = nowIso();
      db.prepare(`UPDATE asset_issues SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`).run(b.resolution, req.user.id, ts, ts, id);
      db.prepare('UPDATE assets SET status = ? WHERE id = ?').run(b.asset_status, i.asset_id);
      if (i.task_id) db.prepare(`UPDATE tasks SET status = 'done', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ? AND status != 'done'`).run(ts, ts, i.task_id);
      logActivity(db, { entityType: 'asset_issue', entityId: id, action: 'resolved', summary: `Xác nhận đã xử lý: ${b.resolution}`, userId: req.user.id });
      if (i.reported_by !== req.user.id) notify(db, i.reported_by, { title: `Đã xử lý xong: ${i.asset_name}`, body: b.resolution, link: `/assets/issues/${id}`, dedupeKey: `issue-resolved:${id}` });
    })();
    res.json({ ok: true });
  });

  r.post('/issues/:id/cancel', can('assets.edit'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ reason: v.text(500, 'lý do hủy') }), req.body);
    db.transaction(() => {
      const i = loadIssue(id);
      if (['resolved', 'cancelled'].includes(i.status)) throw conflict('Báo hỏng đã đóng.');
      if (i.approval_id && db.prepare(`SELECT 1 FROM approvals WHERE id = ? AND status IN ('pending','approved')`).get(i.approval_id)) {
        throw conflict('Báo hỏng có đề xuất chi đang hiệu lực. Hủy đề xuất trước.');
      }
      db.prepare(`UPDATE asset_issues SET status = 'cancelled', resolution = ?, updated_at = ? WHERE id = ?`).run(b.reason, nowIso(), id);
      db.prepare(`UPDATE assets SET status = 'good' WHERE id = ? AND status IN ('damaged','repairing')`).run(i.asset_id);
      logActivity(db, { entityType: 'asset_issue', entityId: id, action: 'cancelled', summary: `Hủy báo hỏng: ${b.reason}`, userId: req.user.id });
    })();
    res.json({ ok: true });
  });

  r.get('/meta/due', (_req, res) => res.json({ suggestedDue: addDays(vnToday(), 2) }));

  return r;
}
