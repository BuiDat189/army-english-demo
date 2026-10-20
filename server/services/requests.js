import { logActivity } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { createApproval } from './approvals.js';
import { financeOf } from './finance.js';
import { resolvePackage } from './packages.js';
import { balanceOf } from './wallet.js';
import { reserveCheck, checkClassAssignment } from './enrollments.js';

const ENROLL_TYPES = ['package_change', 'reserve', 'contract_cancel', 'class_transfer', 'level_up'];

// Đề nghị nghiệp vụ cần quản lý duyệt (giống mục "Hành động phê duyệt" của CRM):
// đổi gói phí, bảo lưu chương trình, hủy hợp đồng (kèm hoàn phí nếu có), chuyển học phí (số dư) giữa học viên.
// Kiểm tra điều kiện ngay khi gửi, và kiểm tra lại khi duyệt (dữ liệu có thể đã thay đổi).
export function createRequest(db, { type, enrollmentId = null, packageId = null, amount = null, fromStudentId = null, toStudentId = null, classId = null, courseId = null, from = null, to = null, reason, user }) {
  return db.transaction(() => {
    if (!reason || !reason.trim()) throw badRequest('Vui lòng nhập lý do.', { reason: 'Vui lòng nhập lý do.' });
    let e = null;
    if (ENROLL_TYPES.includes(type)) {
      e = db.prepare(`SELECT e.*, s.full_name, co.name AS course_name FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses co ON co.id = e.course_id WHERE e.id = ?`).get(enrollmentId);
      if (!e) throw notFound('Không tìm thấy đăng ký.');
      const pending = db.prepare(`SELECT code FROM approvals WHERE status = 'pending' AND type IN ('package_change','reserve','contract_cancel','class_transfer','level_up') AND json_extract(payload, '$.enrollment_id') = ?`).get(enrollmentId);
      if (pending) throw conflict(`Đăng ký ${e.code} đang có đề xuất ${pending.code} chờ duyệt.`);
    }
    let out;
    if (type === 'package_change') {
      if (['cancelled', 'completed'].includes(e.status)) throw conflict('Đăng ký đã kết thúc hoặc đã hủy.');
      const p = resolvePackage(db, { packageId, courseId: e.course_id });
      if (p.id === e.package_id) throw badRequest('Đăng ký đang dùng gói này.', { package_id: 'Chọn gói khác gói hiện tại.' });
      const f = financeOf(db, e.id);
      if (p.price - f.discount < f.paid) throw badRequest('Gói mới thấp hơn số đã thu, cần hoàn phí phần chênh lệch.', { package_id: 'Gói mới thấp hơn số đã thu.' });
      out = createApproval(db, {
        type, title: `Đổi gói phí ${e.code} – ${e.full_name}`, description: `${p.name} (${p.price.toLocaleString('vi-VN')} đ). Lý do: ${reason.trim()}`,
        amount: p.price - e.tuition_fee || null, requestedBy: user.id, refType: 'enrollment', refId: e.id, payload: { enrollment_id: e.id, package_id: p.id },
      });
    } else if (type === 'reserve') {
      const err = reserveCheck(e, from, to);
      if (err) throw badRequest(err, { [from && to ? 'to' : 'from']: err });
      const dmy = (d) => d.split('-').reverse().join('/');
      out = createApproval(db, {
        type, title: `Bảo lưu ${e.code} – ${e.full_name} (${dmy(from)} – ${dmy(to)})`, description: reason.trim(), requestedBy: user.id, refType: 'enrollment', refId: e.id,
        payload: { enrollment_id: e.id, from, to },
      });
    } else if (type === 'class_transfer') {
      if (!classId) throw badRequest('Chọn lớp mới.', { class_id: 'Chọn lớp mới.' });
      if (!['active', 'pending_class'].includes(e.status)) throw conflict('Chỉ chuyển lớp cho đăng ký đang học hoặc chờ xếp lớp.');
      if (e.class_id === classId) throw badRequest('Học viên đang ở lớp này.', { class_id: 'Chọn lớp khác lớp hiện tại.' });
      const cls = checkClassAssignment(db, { classId, courseId: e.course_id, studentId: e.student_id });
      out = createApproval(db, { type, title: `Chuyển lớp ${e.full_name} → ${cls.code}`, description: reason.trim(), requestedBy: user.id, refType: 'enrollment', refId: e.id, payload: { enrollment_id: e.id, class_id: classId } });
    } else if (type === 'level_up') {
      if (!courseId) throw badRequest('Chọn khóa/level mới.', { course_id: 'Chọn khóa/level mới.' });
      if (!['active', 'pending_class'].includes(e.status)) throw conflict('Chỉ lên level cho đăng ký đang học hoặc chờ xếp lớp.');
      if (courseId === e.course_id) throw badRequest('Level mới phải khác level hiện tại.', { course_id: 'Chọn level khác.' });
      const co = db.prepare(`SELECT * FROM courses WHERE id = ? AND status = 'active'`).get(courseId);
      if (!co) throw badRequest('Khóa học không hợp lệ.', { course_id: 'Chọn khóa đang mở.' });
      if (classId) checkClassAssignment(db, { classId, courseId, studentId: e.student_id });
      out = createApproval(db, { type, title: `Lên level ${e.full_name}: ${e.course_name} → ${co.name}`, description: reason.trim(), requestedBy: user.id, refType: 'enrollment', refId: e.id, payload: { enrollment_id: e.id, course_id: courseId, class_id: classId } });
    } else if (type === 'contract_cancel') {
      if (['cancelled', 'completed'].includes(e.status)) throw conflict('Đăng ký đã kết thúc hoặc đã hủy.');
      const refund = amount || 0;
      if (refund) {
        const paid = financeOf(db, e.id).paid;
        const reserved = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE enrollment_id = ? AND status IN ('requested','approved','paid')`).get(e.id).s;
        if (refund > paid - reserved) throw badRequest(`Số tiền hoàn tối đa ${(paid - reserved).toLocaleString('vi-VN')} đ.`, { amount: `Tối đa ${(paid - reserved).toLocaleString('vi-VN')} đ.` });
      }
      out = createApproval(db, {
        type, title: `Hủy hợp đồng ${e.code} – ${e.full_name}`, description: reason.trim(), amount: refund || null,
        requestedBy: user.id, refType: 'enrollment', refId: e.id, payload: { enrollment_id: e.id },
      });
    } else if (type === 'fee_transfer') {
      const from = db.prepare('SELECT * FROM students WHERE id = ?').get(fromStudentId);
      const to = db.prepare('SELECT * FROM students WHERE id = ?').get(toStudentId);
      if (!from || !to) throw notFound('Không tìm thấy học viên.');
      if (from.id === to.id) throw badRequest('Học viên nhận phải khác học viên chuyển.', { to_student_id: 'Chọn học viên khác.' });
      if (!amount || amount <= 0) throw badRequest('Nhập số tiền chuyển.', { amount: 'Nhập số tiền chuyển.' });
      const bal = balanceOf(db, from.id);
      if (amount > bal) throw badRequest(`Số dư hiện có ${bal.toLocaleString('vi-VN')} đ.`, { amount: `Tối đa ${bal.toLocaleString('vi-VN')} đ.` });
      out = createApproval(db, {
        type, title: `Chuyển ${amount.toLocaleString('vi-VN')} đ số dư: ${from.full_name} → ${to.full_name}`, description: reason.trim(), amount,
        requestedBy: user.id, refType: 'student', refId: from.id, payload: { from_student_id: from.id, to_student_id: to.id },
      });
    } else throw badRequest('Loại đề nghị không hợp lệ.');
    const sid = e ? e.student_id : fromStudentId;
    logActivity(db, { entityType: 'student', entityId: sid, action: 'request', summary: `Gửi đề xuất ${db.prepare('SELECT code, title FROM approvals WHERE id = ?').get(out).code}: ${reason.trim()}`, userId: user.id });
    return { approvalId: out };
  })();
}
