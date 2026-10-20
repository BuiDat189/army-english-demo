import { Router } from 'express';
import { z } from 'zod';
import { can } from '../auth/middleware.js';
import { parse, v, notFound } from '../lib/http.js';
import { vnToday } from '../lib/time.js';
import { createEnrollment, assignClass, cancelEnrollment, requestDiscount, classOccupancy, reserveEnrollment } from '../services/enrollments.js';
import { financeOf } from '../services/finance.js';
import { sessionUsage } from '../services/attendance.js';
import { describePattern } from '../services/schedule.js';

export const ENROLLMENT_STATUS = { pending_approval: 'Chờ GĐ duyệt học phí', pending_class: 'Chờ xếp lớp', active: 'Đang học', completed: 'Hoàn thành', reserved: 'Bảo lưu', cancelled: 'Đã hủy' };

export function enrollmentRoutes({ db }) {
  const r = Router();

  // Lớp có thể xếp cho một khóa học (kèm sĩ số hiện tại)
  r.get('/available-classes', can('enrollments.create', 'classes.edit'), (req, res) => {
    const courseId = Number(req.query.course_id);
    const rows = db.prepare(`SELECT c.*, r.name AS room_name, t.full_name AS teacher_name FROM classes c LEFT JOIN rooms r ON r.id = c.room_id LEFT JOIN users t ON t.id = c.teacher_id
      WHERE c.course_id = ? AND c.status IN ('planned','active') ORDER BY c.start_date`).all(courseId);
    res.json({ items: rows.map((c) => ({ ...c, occupancy: classOccupancy(db, c.id), schedule: describePattern(JSON.parse(c.schedule_json)) })) });
  });

  r.post('/', can('enrollments.create'), (req, res) => {
    const b = parse(z.object({
      student_id: v.id('học viên'), course_id: v.id('khóa học'), package_id: v.optId(), class_id: v.optId(), enrolled_at: v.date('ngày đăng ký'),
      installments: z.array(z.object({ due_date: z.string(), amount: z.coerce.number() }), { error: 'Cần lịch thanh toán.' }),
      discount: z.object({ kind: z.enum(['percent', 'amount']), value: z.coerce.number().int(), reason: z.string() }).optional().nullable(),
      previous_enrollment_id: v.optId(), note: v.optText(500),
    }), req.body);
    const out = createEnrollment(db, {
      studentId: b.student_id, courseId: b.course_id, packageId: b.package_id, classId: b.class_id, enrolledAt: b.enrolled_at, installments: b.installments,
      discount: b.discount, previousEnrollmentId: b.previous_enrollment_id, note: b.note, idempotencyKey: req.get('Idempotency-Key') || null, user: req.user,
    });
    res.status(out.duplicate ? 200 : 201).json(out);
  });

  r.get('/:id', can('finance.view', 'enrollments.create'), (req, res) => {
    const id = Number(req.params.id);
    const e = db.prepare(`SELECT e.*, s.full_name AS student_name, s.code AS student_code, co.name AS course_name, c.code AS class_code
      FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses co ON co.id = e.course_id LEFT JOIN classes c ON c.id = e.class_id WHERE e.id = ?`).get(id);
    if (!e) throw notFound('Không tìm thấy đăng ký.');
    const history = db.prepare(`SELECT l.*, u.full_name AS by_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id WHERE entity_type = 'enrollment' AND entity_id = ? ORDER BY created_at DESC`).all(id);
    res.json({ enrollment: { ...e, idempotency_key: undefined }, finance: financeOf(db, id), usage: sessionUsage(db, [id]).get(id), history });
  });

  r.post('/:id/assign-class', can('classes.edit', 'enrollments.create'), (req, res) => {
    const b = parse(z.object({ class_id: v.id('lớp') }), req.body);
    const cls = assignClass(db, { enrollmentId: Number(req.params.id), classId: b.class_id, user: req.user });
    res.json({ ok: true, class: { id: cls.id, code: cls.code } });
  });

  r.post('/:id/cancel', can('classes.edit', 'finance.refund_request'), (req, res) => {
    const b = parse(z.object({ reason: v.text(500, 'lý do hủy') }), req.body);
    cancelEnrollment(db, { enrollmentId: Number(req.params.id), reason: b.reason, user: req.user });
    res.json({ ok: true });
  });

  // Bảo lưu trực tiếp chỉ dành cho Giám đốc; nhân sự khác gửi đề xuất (Trưởng phòng học thuật → Giám đốc)
  r.post('/:id/reserve', can('approvals.decide'), (req, res) => {
    const b = parse(z.object({ reason: v.text(500, 'lý do bảo lưu'), from: v.optDate(), to: v.optDate() }), req.body);
    reserveEnrollment(db, { enrollmentId: Number(req.params.id), reason: b.reason, from: b.from, to: b.to, user: req.user });
    res.json({ ok: true });
  });

  r.post('/:id/discount', can('finance.discount_request'), (req, res) => {
    const b = parse(z.object({ kind: z.enum(['percent', 'amount'], { error: 'Chọn loại giảm.' }), value: v.money('giá trị giảm'), reason: v.text(500, 'lý do giảm phí') }), req.body);
    const out = db.transaction(() => requestDiscount(db, { enrollmentId: Number(req.params.id), ...b, user: req.user }))();
    res.status(201).json(out);
  });

  r.get('/', can('finance.view', 'enrollments.create'), (req, res) => {
    const studentId = Number(req.query.student_id || 0);
    const rows = db.prepare(`SELECT e.id, e.code, e.status, e.course_id, co.name AS course_name, c.code AS class_code FROM enrollments e JOIN courses co ON co.id = e.course_id LEFT JOIN classes c ON c.id = e.class_id
      WHERE e.student_id = ? ORDER BY e.enrolled_at DESC`).all(studentId);
    res.json({ items: rows, today: vnToday() });
  });

  return r;
}
