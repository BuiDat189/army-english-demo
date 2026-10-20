import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, v, notFound, badRequest, forbidden } from '../lib/http.js';
import { vnToday, nowIso } from '../lib/time.js';
import { createRequest } from '../services/requests.js';
import { APPROVAL_TYPES, STAGE_LABEL, createApproval, decideApproval, markApprovalPaid, cancelApproval } from '../services/approvals.js';

export const APPROVAL_STATUS = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã hủy' };
export const PAYMENT_STATUS = { none: 'Không phát sinh chi', unpaid: 'Đã duyệt – chưa chi', paid: 'Đã chi' };

function scope(user) {
  if (has(user, 'approvals.view_all')) return { sql: '', args: [] };
  // Trưởng phòng học thuật: đề xuất của mình + mọi đề xuất 2 cấp (bảo lưu, chuyển học phí, chuyển lớp, lên level)
  if (has(user, 'approvals.decide_lead')) return { sql: `(a.requested_by = ? OR a.type IN ('reserve','fee_transfer','class_transfer','level_up'))`, args: [user.id] };
  if (has(user, 'finance.pay')) return { sql: `(a.requested_by = ? OR a.payment_status IN ('unpaid','paid') OR a.type IN ('discount','refund','package_change','contract_cancel','fee_transfer'))`, args: [user.id] };
  return { sql: 'a.requested_by = ?', args: [user.id] };
}

// File đính kèm (báo giá, đơn của phụ huynh…): tối đa 5 file/đề xuất, mỗi file ≤ 5 MB; lưu cạnh database, không công khai
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.ms-excel', 'text/plain']);
const MAX_FILE = 5 * 1024 * 1024;

export function approvalRoutes({ db, config = {} }) {
  const r = Router();
  const uploadDir = config.uploadDir || (config.dbFile ? path.join(path.dirname(config.dbFile), 'uploads') : path.join(os.tmpdir(), 'army-uploads'));
  const visible = (user, id) => {
    const sc = scope(user);
    return db.prepare(`SELECT a.* FROM approvals a WHERE a.id = ? ${sc.sql ? `AND ${sc.sql}` : ''}`).get(id, ...sc.args);
  };

  r.get('/', (req, res) => {
    const { status, type, view } = req.query;
    const sc = scope(req.user);
    const where = sc.sql ? [sc.sql] : [];
    const args = [...sc.args];
    if (view === 'mine') { where.push('a.requested_by = ?'); args.push(req.user.id); }
    if (view === 'to_decide') where.push(has(req.user, 'approvals.decide') ? `a.status = 'pending' AND COALESCE(a.stage,'') != 'lead'` : `a.status = 'pending' AND a.stage = 'lead'`);
    if (view === 'to_pay') where.push(`a.payment_status = 'unpaid'`);
    if (status && status !== 'all') { where.push('a.status = ?'); args.push(status); }
    if (type) { where.push('a.type = ?'); args.push(type); }
    const items = db.prepare(`SELECT a.*, u.full_name AS requester, d.full_name AS decider, p.full_name AS payer, (SELECT COUNT(*) FROM approval_files f WHERE f.approval_id = a.id) AS file_count
      FROM approvals a JOIN users u ON u.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by LEFT JOIN users p ON p.id = a.paid_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, CASE a.payment_status WHEN 'unpaid' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 500`).all(...args);
    const countsSc = scope(req.user);
    const stageSql = has(req.user, 'approvals.decide') ? `AND COALESCE(a.stage,'') != 'lead'` : has(req.user, 'approvals.decide_lead') ? `AND a.stage = 'lead'` : '';
    const pending = db.prepare(`SELECT COUNT(*) n FROM approvals a WHERE a.status = 'pending' ${stageSql} ${countsSc.sql ? `AND ${countsSc.sql}` : ''}`).get(...countsSc.args).n;
    const toPay = db.prepare(`SELECT COUNT(*) n FROM approvals a WHERE a.payment_status = 'unpaid' ${countsSc.sql ? `AND ${countsSc.sql}` : ''}`).get(...countsSc.args).n;
    res.json({ items, counts: { pending, toPay }, typeLabels: APPROVAL_TYPES, statusLabels: APPROVAL_STATUS, paymentLabels: PAYMENT_STATUS, stageLabels: STAGE_LABEL,
      can: { decide: has(req.user, 'approvals.decide') || has(req.user, 'approvals.decide_lead'), pay: has(req.user, 'finance.pay'), create: has(req.user, 'approvals.create') } });
  });

  // Đề xuất mua sắm / chi phí tạo trực tiếp. Nghỉ phép, giảm phí, hoàn phí tạo từ phân hệ tương ứng.
  r.post('/', can('approvals.create'), (req, res) => {
    const b = parse(z.object({ type: z.enum(['purchase', 'expense'], { error: 'Chọn loại đề xuất.' }), title: v.text(200, 'tiêu đề'), description: v.optText(2000), amount: v.money('số tiền đề xuất') }), req.body);
    const id = db.transaction(() => createApproval(db, { ...b, requestedBy: req.user.id }))();
    res.status(201).json({ id });
  });

  // Đề nghị nghiệp vụ: đổi gói phí, bảo lưu, hủy hợp đồng (kèm hoàn phí), chuyển học phí (số dư) — duyệt xong tự thực hiện
  r.post('/requests', can('requests.create'), (req, res) => {
    const b = parse(z.object({
      type: z.enum(['package_change', 'reserve', 'contract_cancel', 'fee_transfer', 'class_transfer', 'level_up'], { error: 'Chọn loại đề nghị.' }),
      enrollment_id: v.optId(), package_id: v.optId(), from_student_id: v.optId(), to_student_id: v.optId(), class_id: v.optId(), course_id: v.optId(),
      from: v.optDate(), to: v.optDate(),
      amount: z.union([z.literal(''), z.null(), v.money('số tiền')]).optional().transform((x) => (x ? x : null)),
      reason: v.text(1000, 'lý do'),
    }), req.body);
    if (['package_change', 'reserve', 'contract_cancel', 'class_transfer', 'level_up'].includes(b.type) && !b.enrollment_id) throw badRequest('Chọn đăng ký.', { enrollment_id: 'Chọn đăng ký.' });
    if (b.type === 'package_change' && !b.package_id) throw badRequest('Chọn gói phí mới.', { package_id: 'Chọn gói phí mới.' });
    if (b.type === 'fee_transfer' && (!b.from_student_id || !b.to_student_id)) throw badRequest('Chọn học viên chuyển và nhận.', { to_student_id: 'Chọn học viên nhận.' });
    const out = createRequest(db, { type: b.type, enrollmentId: b.enrollment_id, packageId: b.package_id, amount: b.amount, fromStudentId: b.from_student_id, toStudentId: b.to_student_id, classId: b.class_id, courseId: b.course_id, from: b.from, to: b.to, reason: b.reason, user: req.user });
    res.status(201).json(out);
  });

  r.post('/:id/files', can('approvals.create', 'approvals.decide', 'approvals.decide_lead', 'finance.pay'), (req, res) => {
    const id = Number(req.params.id);
    const a = visible(req.user, id);
    if (!a) throw notFound('Không tìm thấy đề xuất.');
    const b = parse(z.object({ name: v.text(200, 'tên file'), mime: z.string(), data: z.string().min(1, 'File rỗng.') }), req.body);
    if (!ALLOWED_MIME.has(b.mime)) throw badRequest('Chỉ nhận PDF, ảnh, Word, Excel hoặc văn bản.', { file: 'Định dạng file không được hỗ trợ.' });
    const buf = Buffer.from(b.data, 'base64');
    if (!buf.length) throw badRequest('File rỗng.', { file: 'File rỗng.' });
    if (buf.length > MAX_FILE) throw badRequest('File tối đa 5 MB.', { file: 'File tối đa 5 MB.' });
    if (db.prepare('SELECT COUNT(*) n FROM approval_files WHERE approval_id = ?').get(id).n >= 5) throw badRequest('Mỗi đề xuất tối đa 5 file.', { file: 'Mỗi đề xuất tối đa 5 file.' });
    fs.mkdirSync(uploadDir, { recursive: true });
    const stored = `${id}-${crypto.randomBytes(12).toString('hex')}`;
    fs.writeFileSync(path.join(uploadDir, stored), buf);
    const name = b.name.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 200);
    const fid = Number(db.prepare('INSERT INTO approval_files(approval_id, name, mime, size, stored_name, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, name, b.mime, buf.length, stored, req.user.id, nowIso()).lastInsertRowid);
    db.prepare('INSERT INTO approval_events(approval_id, action, user_id, note, created_at) VALUES (?,?,?,?,?)').run(id, 'file', req.user.id, `Đính kèm ${name}`, nowIso());
    res.status(201).json({ id: fid });
  });

  r.get('/:id/files/:fid', (req, res) => {
    const id = Number(req.params.id);
    if (!visible(req.user, id)) throw notFound('Không tìm thấy đề xuất.');
    const f = db.prepare('SELECT * FROM approval_files WHERE id = ? AND approval_id = ?').get(Number(req.params.fid), id);
    if (!f) throw notFound('Không tìm thấy file.');
    const full = path.join(uploadDir, f.stored_name);
    if (!fs.existsSync(full)) throw notFound('File không còn trên máy chủ.');
    res.set('Content-Type', f.mime);
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.sendFile(full);
  });

  r.delete('/:id/files/:fid', (req, res) => {
    const id = Number(req.params.id);
    const a = visible(req.user, id);
    if (!a) throw notFound('Không tìm thấy đề xuất.');
    const f = db.prepare('SELECT * FROM approval_files WHERE id = ? AND approval_id = ?').get(Number(req.params.fid), id);
    if (!f) throw notFound('Không tìm thấy file.');
    if (f.uploaded_by !== req.user.id || a.status !== 'pending') throw forbidden('Chỉ người tải lên được gỡ file khi đề xuất còn chờ duyệt.');
    db.prepare('DELETE FROM approval_files WHERE id = ?').run(f.id);
    fs.rmSync(path.join(uploadDir, f.stored_name), { force: true });
    res.json({ ok: true });
  });

  r.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    const sc = scope(req.user);
    const a = db.prepare(`SELECT a.*, u.full_name AS requester, d.full_name AS decider, p.full_name AS payer, ld.full_name AS lead_decider FROM approvals a JOIN users u ON u.id = a.requested_by
      LEFT JOIN users d ON d.id = a.decided_by LEFT JOIN users p ON p.id = a.paid_by LEFT JOIN users ld ON ld.id = a.lead_decided_by WHERE a.id = ? ${sc.sql ? `AND ${sc.sql}` : ''}`).get(id, ...sc.args);
    if (!a) throw notFound('Không tìm thấy đề xuất.');
    const events = db.prepare(`SELECT e.*, u.full_name AS user_name FROM approval_events e LEFT JOIN users u ON u.id = e.user_id WHERE approval_id = ? ORDER BY e.created_at, e.id`).all(id);
    let ref = null;
    if (a.ref_type === 'discount') ref = db.prepare(`SELECT d.*, e.code AS enrollment_code, e.student_id, s.full_name AS student_name, e.tuition_fee FROM discounts d JOIN enrollments e ON e.id = d.enrollment_id JOIN students s ON s.id = e.student_id WHERE d.id = ?`).get(a.ref_id);
    if (a.ref_type === 'refund') ref = db.prepare(`SELECT f.*, e.code AS enrollment_code, s.full_name AS student_name FROM refunds f JOIN enrollments e ON e.id = f.enrollment_id JOIN students s ON s.id = f.student_id WHERE f.id = ?`).get(a.ref_id);
    if (a.ref_type === 'leave') ref = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(a.ref_id);
    if (a.ref_type === 'asset_issue') ref = db.prepare(`SELECT i.*, COALESCE(s.name, i.title) AS asset_name, s.code AS asset_code, r.name AS room_name FROM asset_issues i LEFT JOIN assets s ON s.id = i.asset_id LEFT JOIN rooms r ON r.id = i.room_id WHERE i.id = ?`).get(a.ref_id);
    if (a.ref_type === 'package') ref = db.prepare('SELECT p.*, c.name AS course_name FROM fee_packages p JOIN courses c ON c.id = p.course_id WHERE p.id = ?').get(a.ref_id);
    if (a.ref_type === 'enrollment') ref = db.prepare(`SELECT e.id, e.code AS enrollment_code, e.student_id, e.status, e.tuition_fee, s.full_name AS student_name, co.name AS course_name, p.name AS package_name
      FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses co ON co.id = e.course_id LEFT JOIN fee_packages p ON p.id = e.package_id WHERE e.id = ?`).get(a.ref_id);
    if (a.ref_type === 'student') ref = db.prepare('SELECT id AS student_id, full_name AS student_name, code FROM students WHERE id = ?').get(a.ref_id);
    const files = db.prepare('SELECT f.id, f.name, f.mime, f.size, f.created_at, f.uploaded_by, u.full_name AS uploaded_by_name FROM approval_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.approval_id = ? ORDER BY f.id').all(id);
    res.json({ approval: a, events, ref, files, typeLabels: APPROVAL_TYPES, statusLabels: APPROVAL_STATUS, paymentLabels: PAYMENT_STATUS, stageLabels: STAGE_LABEL,
      can: {
        decide: a.status === 'pending' && a.requested_by !== req.user.id && (has(req.user, 'approvals.decide') || (has(req.user, 'approvals.decide_lead') && a.stage === 'lead')),
        decideLevel: has(req.user, 'approvals.decide') ? 'final' : 'lead',
        pay: has(req.user, 'finance.pay') && a.payment_status === 'unpaid',
        cancel: a.requested_by === req.user.id && a.status === 'pending',
        attach: a.status === 'pending' || a.payment_status === 'unpaid',
      } });
  });

  r.post('/:id/decide', can('approvals.decide', 'approvals.decide_lead'), (req, res) => {
    const b = parse(z.object({ decision: z.enum(['approved', 'rejected'], { error: 'Chọn duyệt hoặc từ chối.' }), note: v.optText(1000) }), req.body);
    const a = decideApproval(db, { id: Number(req.params.id), decision: b.decision, note: b.note, user: req.user });
    res.json({ approval: a });
  });

  r.post('/:id/pay', can('finance.pay'), (req, res) => {
    const b = parse(z.object({ method: z.enum(['cash', 'transfer'], { error: 'Chọn hình thức chi.' }), paid_at: v.date('ngày chi'), note: v.optText(500) }), req.body);
    if (b.paid_at > vnToday()) throw badRequest('Ngày chi không được ở tương lai.', { paid_at: 'Ngày chi không được ở tương lai.' });
    const a = markApprovalPaid(db, { id: Number(req.params.id), method: b.method, paidAt: b.paid_at, note: b.note, user: req.user });
    res.json({ approval: a });
  });

  r.post('/:id/cancel', can('approvals.create'), (req, res) => {
    const b = parse(z.object({ note: v.optText(500) }), req.body);
    cancelApproval(db, { id: Number(req.params.id), user: req.user, note: b.note });
    res.json({ ok: true });
  });

  return r;
}
