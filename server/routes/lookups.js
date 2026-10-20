import { Router } from 'express';
import { has } from '../auth/middleware.js';
import { visibleClassIds, visibleStudentIds, inList } from '../lib/scope.js';
import { nowIso } from '../lib/time.js';

import { LEAD_SOURCES } from '../services/leads.js';

export { LEAD_SOURCES };

export function lookupRoutes({ db }) {
  const r = Router();

  r.get('/lookups', (req, res) => {
    const staff = db.prepare(`SELECT u.id, u.full_name, u.title, u.status, group_concat(r.role) AS roles
      FROM users u LEFT JOIN user_roles r ON r.user_id = u.id GROUP BY u.id ORDER BY u.full_name`).all()
      .map((s) => ({ ...s, roles: s.roles ? s.roles.split(',') : [] }));
    const ids = visibleClassIds(db, req.user);
    const classes = db.prepare(`SELECT c.id, c.code, c.name, c.course_id, c.status, c.max_students, c.teacher_id, c.assistant_id, c.room_id, c.homeroom_id FROM classes c
      ${ids === null ? '' : `WHERE c.id IN (${inList(ids)})`} ORDER BY c.status = 'finished', c.code`).all();
    res.json({
      staff,
      rooms: db.prepare('SELECT * FROM rooms ORDER BY name').all(),
      courses: db.prepare('SELECT * FROM courses ORDER BY id').all(),
      packages: db.prepare(`SELECT * FROM fee_packages WHERE status = 'active' ORDER BY course_id, kind, sessions`).all(),
      classes,
      leadSources: LEAD_SOURCES,
    });
  });

  // Tìm kiếm nhanh toàn cục (theo quyền)
  r.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const results = [];
    const sIds = visibleStudentIds(db, req.user);
    if (sIds === null || sIds.length) {
      const contacts = has(req.user, 'students.contacts');
      const rows = db.prepare(`SELECT DISTINCT s.id, s.code, s.full_name, s.status FROM students s
        LEFT JOIN student_contacts sc ON sc.student_id = s.id LEFT JOIN parents p ON p.id = sc.parent_id
        WHERE (s.full_name LIKE ? OR s.code LIKE ? ${contacts ? `OR p.full_name LIKE ? ${digits.length >= 3 ? 'OR p.phone LIKE ?' : ''}` : ''})
        ${sIds === null ? '' : `AND s.id IN (${inList(sIds)})`} LIMIT 8`)
        .all(...[like, like, ...(contacts ? [like, ...(digits.length >= 3 ? [`%${digits}%`] : [])] : [])]);
      for (const x of rows) results.push({ type: 'student', id: x.id, title: x.full_name, subtitle: `Học viên · ${x.code}`, link: `/students/${x.id}` });
    }
    if (has(req.user, 'leads.view')) {
      const rows = db.prepare(`SELECT id, code, parent_name, student_name, phone FROM leads WHERE status NOT IN ('enrolled')
        AND (parent_name LIKE ? OR student_name LIKE ? OR code LIKE ? ${digits.length >= 3 ? 'OR phone LIKE ?' : ''}) LIMIT 6`)
        .all(like, like, like, ...(digits.length >= 3 ? [`%${digits}%`] : []));
      for (const x of rows) results.push({ type: 'lead', id: x.id, title: `${x.student_name} (PH: ${x.parent_name})`, subtitle: `Khách quan tâm · ${x.code}`, link: `/leads/${x.id}` });
    }
    const cIds = visibleClassIds(db, req.user);
    if (cIds === null || cIds.length) {
      const rows = db.prepare(`SELECT id, code, name FROM classes WHERE (code LIKE ? OR name LIKE ?) ${cIds === null ? '' : `AND id IN (${inList(cIds)})`} LIMIT 5`).all(like, like);
      for (const x of rows) results.push({ type: 'class', id: x.id, title: x.name, subtitle: `Lớp · ${x.code}`, link: `/classes/${x.id}` });
    }
    res.json({ results });
  });

  r.get('/notifications', (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
    res.json({ items: rows, unread });
  });
  r.post('/notifications/read-all', (req, res) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), req.user.id);
    res.json({ ok: true });
  });
  r.post('/notifications/:id/read', (req, res) => {
    db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?').run(nowIso(), Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  return r;
}
