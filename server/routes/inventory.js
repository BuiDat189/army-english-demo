import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest } from '../lib/http.js';
import { nextCode, notify, usersWithRole } from '../db/index.js';
import { nowIso } from '../lib/time.js';

export const MATERIAL_KIND = { textbook: 'Giáo trình', supply: 'Vật tư' };

const materialSchema = z.object({
  name: v.text(150, 'tên'), kind: z.enum(Object.keys(MATERIAL_KIND), { error: 'Chọn loại.' }), unit: v.text(20, 'đơn vị tính'),
  min_stock: v.int(0, 100000, 'ngưỡng tồn tối thiểu'), course_id: v.optId(), note: v.optText(500),
});

export function inventoryRoutes({ db }) {
  const r = Router();

  r.get('/', can('inventory.view'), (req, res) => {
    const { q, kind, low } = req.query;
    const where = [];
    const args = [];
    if (q) { where.push('(m.name LIKE ? OR m.code LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    if (kind) { where.push('m.kind = ?'); args.push(kind); }
    if (low === '1') where.push('m.stock <= m.min_stock');
    const items = db.prepare(`SELECT m.*, c.name AS course_name FROM materials m LEFT JOIN courses c ON c.id = m.course_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.stock <= m.min_stock DESC, m.code`).all(...args);
    res.json({ items, kindLabels: MATERIAL_KIND, canEdit: has(req.user, 'inventory.edit') });
  });

  r.post('/', can('inventory.edit'), (req, res) => {
    const b = parse(materialSchema.extend({ stock: v.int(0, 100000, 'tồn đầu kỳ') }), req.body);
    const id = db.transaction(() => {
      const id = Number(db.prepare('INSERT INTO materials(code, name, kind, unit, stock, min_stock, course_id, note) VALUES (?,?,?,?,?,?,?,?)')
        .run(nextCode(db, 'material', 'VT-', 3), b.name, b.kind, b.unit, b.stock, b.min_stock, b.course_id, b.note).lastInsertRowid);
      if (b.stock > 0) db.prepare(`INSERT INTO stock_moves(material_id, type, qty, balance_after, reason, created_by, created_at) VALUES (?,'in',?,?,?,?,?)`).run(id, b.stock, b.stock, 'Tồn đầu kỳ', req.user.id, nowIso());
      return id;
    })();
    res.status(201).json({ id });
  });

  r.put('/:id', can('inventory.edit'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM materials WHERE id = ?').get(id)) throw notFound('Không tìm thấy vật tư.');
    const b = parse(materialSchema, req.body);
    db.prepare('UPDATE materials SET name=?, kind=?, unit=?, min_stock=?, course_id=?, note=? WHERE id=?').run(b.name, b.kind, b.unit, b.min_stock, b.course_id, b.note, id);
    res.json({ ok: true });
  });

  r.get('/:id/moves', can('inventory.view'), (req, res) => {
    const id = Number(req.params.id);
    const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
    if (!m) throw notFound('Không tìm thấy vật tư.');
    const items = db.prepare(`SELECT s.*, u.full_name AS by_name, st.full_name AS student_name, c.code AS class_code FROM stock_moves s LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN students st ON st.id = s.student_id LEFT JOIN classes c ON c.id = s.class_id WHERE s.material_id = ? ORDER BY s.created_at DESC, s.id DESC`).all(id);
    res.json({ material: m, items });
  });

  // Nhập/xuất kho. Chặn xuất quá tồn; Idempotency-Key chống bấm hai lần.
  r.post('/:id/moves', can('inventory.edit'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ type: z.enum(['in', 'out'], { error: 'Chọn nhập hoặc xuất.' }), qty: v.int(1, 100000, 'số lượng'), reason: v.text(300, 'lý do'), class_id: v.optId(), student_id: v.optId() }), req.body);
    const key = req.get('Idempotency-Key') || null;
    const out = db.transaction(() => {
      if (key) {
        const ex = db.prepare('SELECT id, balance_after FROM stock_moves WHERE idempotency_key = ?').get(key);
        if (ex) return { id: ex.id, balance: ex.balance_after, duplicate: true };
      }
      const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
      if (!m) throw notFound('Không tìm thấy vật tư.');
      if (b.type === 'out' && b.qty > m.stock) throw badRequest(`Không đủ tồn kho (còn ${m.stock} ${m.unit}).`, { qty: `Tối đa ${m.stock} ${m.unit}.` });
      const balance = b.type === 'in' ? m.stock + b.qty : m.stock - b.qty;
      const ch = db.prepare('UPDATE materials SET stock = ? WHERE id = ? AND stock = ?').run(balance, id, m.stock);
      if (!ch.changes) throw conflict('Tồn kho vừa thay đổi, vui lòng thử lại.');
      const mid = Number(db.prepare(`INSERT INTO stock_moves(material_id, type, qty, balance_after, reason, class_id, student_id, idempotency_key, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id, b.type, b.qty, balance, b.reason, b.class_id, b.student_id, key, req.user.id, nowIso()).lastInsertRowid);
      if (balance <= m.min_stock && m.stock > m.min_stock) {
        for (const uid of [...usersWithRole(db, 'academic'), ...usersWithRole(db, 'operations')]) notify(db, uid, { title: `Tồn thấp: ${m.name}`, body: `Còn ${balance} ${m.unit} (ngưỡng ${m.min_stock}).`, link: '/inventory', dedupeKey: `lowstock:${id}:${mid}` });
      }
      return { id: mid, balance, duplicate: false, low: balance <= m.min_stock };
    })();
    res.status(out.duplicate ? 200 : 201).json(out);
  });

  return r;
}
