import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { ROLES } from '../auth/permissions.js';
import { notify } from '../db/index.js';

// Thông báo nội bộ chỉ hiển thị trong app. Bản demo KHÔNG gửi SMS/Zalo/email ra ngoài;
// nếu nhân viên đã tự gửi bằng kênh khác thì đánh dấu "Đã gửi ngoài (thủ công)" để phân biệt.
export const EXTERNAL_STATUS = { internal_only: 'Chỉ trong app', sent_manually: 'Đã gửi ngoài (thủ công)' };

function visibleTo(user, audience) {
  if (audience === 'all') return true;
  return audience.split(',').some((r) => user.roles.includes(r));
}

export function noticeRoutes({ db }) {
  const r = Router();

  r.get('/', (req, res) => {
    const rows = db.prepare(`SELECT n.*, u.full_name AS author, m.full_name AS external_marked_by_name,
        (SELECT read_at FROM notice_reads r WHERE r.notice_id = n.id AND r.user_id = ?) AS read_at,
        (SELECT COUNT(*) FROM notice_reads r WHERE r.notice_id = n.id) AS read_count
      FROM notices n LEFT JOIN users u ON u.id = n.created_by LEFT JOIN users m ON m.id = n.external_marked_by ORDER BY n.pinned DESC, n.created_at DESC`).all(req.user.id);
    const items = has(req.user, 'notices.create') && req.query.all === '1' ? rows : rows.filter((n) => visibleTo(req.user, n.audience));
    res.json({ items, unread: items.filter((n) => !n.read_at).length, roleLabels: ROLES, externalLabels: EXTERNAL_STATUS, canCreate: has(req.user, 'notices.create') });
  });

  r.post('/', can('notices.create'), (req, res) => {
    const b = parse(z.object({
      title: v.text(200, 'tiêu đề'), body: v.text(5000, 'nội dung'),
      audience: z.union([z.literal('all'), z.array(z.enum(Object.keys(ROLES))).min(1, 'Chọn ít nhất một nhóm nhận.')]),
      pinned: z.boolean().optional(),
    }), req.body);
    const audience = b.audience === 'all' ? 'all' : [...new Set(b.audience)].join(',');
    const id = db.transaction(() => {
      const id = Number(db.prepare('INSERT INTO notices(title, body, audience, pinned, created_by, created_at) VALUES (?,?,?,?,?,?)').run(b.title, b.body, audience, b.pinned ? 1 : 0, req.user.id, nowIso()).lastInsertRowid);
      const users = db.prepare(`SELECT u.id, group_concat(r.role) roles FROM users u JOIN user_roles r ON r.user_id = u.id WHERE u.status = 'active' GROUP BY u.id`).all();
      for (const u of users) {
        if (u.id !== req.user.id && visibleTo({ roles: u.roles.split(',') }, audience)) notify(db, u.id, { title: `Thông báo: ${b.title}`, link: `/notices?id=${id}`, dedupeKey: `notice:${id}` });
      }
      return id;
    })();
    res.status(201).json({ id });
  });

  r.post('/:id/read', (req, res) => {
    const n = db.prepare('SELECT * FROM notices WHERE id = ?').get(Number(req.params.id));
    if (!n || !visibleTo(req.user, n.audience)) throw notFound('Không tìm thấy thông báo.');
    db.prepare('INSERT INTO notice_reads(notice_id, user_id, read_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(n.id, req.user.id, nowIso());
    res.json({ ok: true });
  });

  r.post('/:id/external', can('notices.create'), (req, res) => {
    const b = parse(z.object({ note: v.text(300, 'kênh và người nhận đã gửi') }), req.body);
    const n = db.prepare('SELECT * FROM notices WHERE id = ?').get(Number(req.params.id));
    if (!n) throw notFound('Không tìm thấy thông báo.');
    if (n.external_status === 'sent_manually') throw conflict('Thông báo đã được đánh dấu gửi ngoài.');
    db.prepare(`UPDATE notices SET external_status = 'sent_manually', external_note = ?, external_marked_by = ?, external_marked_at = ? WHERE id = ?`).run(b.note, req.user.id, nowIso(), n.id);
    res.json({ ok: true });
  });

  return r;
}
