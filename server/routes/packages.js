import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict } from '../lib/http.js';
import { nextCode, logActivity } from '../db/index.js';
import { nowIso } from '../lib/time.js';
import { PACKAGE_KIND } from '../services/packages.js';
import { createApproval } from '../services/approvals.js';

export const PACKAGE_STATUS = { active: 'Đang áp dụng', pending: 'Chờ Giám đốc duyệt', rejected: 'Không được duyệt', archived: 'Ngừng bán' };

// Gói phí theo khóa học (NEW / TÁI PHÍ). Gói do trưởng phòng đề xuất phải được Giám đốc duyệt mới bán được.
// Mỗi gói có số buổi nghỉ không tính phí và số lần bảo lưu (gói 1 năm 96 buổi: 4 buổi nghỉ, 1 lần bảo lưu).
// Đổi giá gói không ảnh hưởng đăng ký cũ (học phí đã "đóng băng" lúc đăng ký).
const body = z.object({
  course_id: v.id('khóa học'), name: v.text(150, 'tên gói'), kind: z.enum(['new', 'renew'], { error: 'Chọn loại gói.' }),
  sessions: v.int(1, 400, 'số buổi'), bonus_sessions: v.int(0, 100, 'số buổi tặng'), months: z.union([z.literal(''), z.null(), z.coerce.number().int().min(1).max(36)]).optional().transform((x) => (x ? x : null)),
  price: v.money('giá gói'), note: v.optText(500),
  free_absences: v.int(0, 50, 'số buổi nghỉ không tính phí'), reserve_limit: v.int(0, 5, 'số lần bảo lưu'),
});

export function packageRoutes({ db }) {
  const r = Router();

  r.get('/', can('classes.view', 'enrollments.create', 'finance.view'), (req, res) => {
    const items = db.prepare(`SELECT p.*, c.name AS course_name, c.code AS course_code,
        (SELECT COUNT(*) FROM enrollments e WHERE e.package_id = p.id AND e.status != 'cancelled') AS used
      FROM fee_packages p JOIN courses c ON c.id = p.course_id ORDER BY c.id, p.kind, p.sessions`).all();
    res.json({ items, kindLabels: PACKAGE_KIND, statusLabels: PACKAGE_STATUS });
  });

  r.post('/', can('packages.edit'), (req, res) => {
    const b = parse(body, req.body);
    if (!db.prepare(`SELECT 1 FROM courses WHERE id = ? AND status = 'active'`).get(b.course_id)) throw notFound('Khóa học không hợp lệ.');
    const director = has(req.user, 'approvals.decide');
    const id = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO fee_packages(course_id, code, name, kind, sessions, bonus_sessions, months, price, note, status, created_at, free_absences, reserve_limit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(b.course_id, nextCode(db, 'package', 'GP-', 3), b.name, b.kind, b.sessions, b.bonus_sessions, b.months, b.price, b.note, director ? 'active' : 'pending', nowIso(), b.free_absences, b.reserve_limit).lastInsertRowid);
      logActivity(db, { entityType: 'package', entityId: id, action: 'created', summary: `Tạo gói phí ${b.name}${director ? '' : ' — chờ Giám đốc duyệt'}`, userId: req.user.id });
      if (!director) {
        const aid = createApproval(db, {
          type: 'package', title: `Gói phí mới: ${b.name}`, amount: b.price, requestedBy: req.user.id, refType: 'package', refId: id, payload: { package_id: id },
          description: `${b.sessions} buổi · ${b.free_absences} buổi nghỉ không tính phí · ${b.reserve_limit} lần bảo lưu${b.note ? `. ${b.note}` : ''}`,
        });
        db.prepare('UPDATE fee_packages SET approval_id = ? WHERE id = ?').run(aid, id);
      }
      return id;
    })();
    res.status(201).json({ id, status: director ? 'active' : 'pending' });
  });

  r.put('/:id', can('packages.edit'), (req, res) => {
    const id = Number(req.params.id);
    const p = db.prepare('SELECT * FROM fee_packages WHERE id = ?').get(id);
    if (!p) throw notFound('Không tìm thấy gói phí.');
    const b = parse(body, req.body);
    // Đổi giá / quyền lợi gói đang bán ⇒ cần Giám đốc (trưởng phòng chỉ sửa được gói đang chờ duyệt)
    if (!has(req.user, 'approvals.decide') && p.status !== 'pending' && (b.price !== p.price || b.sessions !== p.sessions || b.free_absences !== p.free_absences || b.reserve_limit !== p.reserve_limit)) {
      throw conflict('Đổi giá hoặc quyền lợi gói đang bán cần Giám đốc. Hãy tạo gói mới để gửi duyệt.');
    }
    if (b.course_id !== p.course_id && db.prepare('SELECT 1 FROM enrollments WHERE package_id = ?').get(id)) throw conflict('Gói đã có đăng ký, không đổi khóa học được. Tạo gói mới thay thế.');
    db.prepare('UPDATE fee_packages SET course_id=?, name=?, kind=?, sessions=?, bonus_sessions=?, months=?, price=?, note=?, free_absences=?, reserve_limit=? WHERE id=?')
      .run(b.course_id, b.name, b.kind, b.sessions, b.bonus_sessions, b.months, b.price, b.note, b.free_absences, b.reserve_limit, id);
    logActivity(db, { entityType: 'package', entityId: id, action: 'updated', summary: `Cập nhật gói phí ${b.name}`, userId: req.user.id });
    res.json({ ok: true });
  });

  // Ngừng bán / bán lại (không xóa vì đăng ký cũ còn tham chiếu)
  r.post('/:id/status', can('packages.edit'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ status: z.enum(['active', 'archived']) }), req.body);
    const p = db.prepare('SELECT * FROM fee_packages WHERE id = ?').get(id);
    if (!p) throw notFound('Không tìm thấy gói phí.');
    if (['pending', 'rejected'].includes(p.status)) throw conflict('Gói chưa được Giám đốc duyệt.');
    db.prepare('UPDATE fee_packages SET status = ? WHERE id = ?').run(b.status, id);
    res.json({ ok: true });
  });

  return r;
}
