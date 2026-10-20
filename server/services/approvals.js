import { nextCode, logActivity, notify, usersWithRole } from '../db/index.js';
import { nowIso, vnToday } from '../lib/time.js';
import { conflict, forbidden, notFound, badRequest } from '../lib/http.js';
import { rebalanceInstallments } from './finance.js';
import { applyPackageChange, reserveEnrollment, cancelEnrollment, activateEnrollment, transferClass, levelUp } from './enrollments.js';
import { transferBalance } from './wallet.js';

export const APPROVAL_TYPES = {
  purchase: 'Mua sắm', expense: 'Chi phí', leave: 'Nghỉ phép', discount: 'Giảm học phí', refund: 'Hoàn phí',
  package_change: 'Đổi gói phí', reserve: 'Bảo lưu khóa học', contract_cancel: 'Hủy hợp đồng', fee_transfer: 'Chuyển học phí',
  enrollment: 'Duyệt học phí đăng ký', package: 'Duyệt gói phí', class_transfer: 'Chuyển lớp', level_up: 'Lên level mới',
};
// Hai cấp: Trưởng phòng học thuật duyệt trước ⇒ Giám đốc duyệt cuối (Giám đốc có thể duyệt thẳng)
export const TWO_LEVEL = new Set(['reserve', 'fee_transfer', 'class_transfer', 'level_up']);
export const STAGE_LABEL = { lead: 'Chờ Trưởng phòng học thuật', final: 'Chờ Giám đốc duyệt cuối' };
const isRole = (db, userId, role) => usersWithRole(db, role).includes(userId);
// Loại đề xuất có phát sinh chi tiền ⇒ sau khi duyệt còn bước "xác nhận đã chi" riêng.
// Hủy hợp đồng có kèm số tiền hoàn ⇒ cũng cần thu ngân xác nhận đã chi.
const NEEDS_PAYMENT = new Set(['purchase', 'expense', 'refund']);
const needsPayment = (a) => NEEDS_PAYMENT.has(a.type) || (a.type === 'contract_cancel' && a.amount > 0);

export function createApproval(db, { type, title, description, amount = null, requestedBy, refType = null, refId = null, payload = null }) {
  const code = nextCode(db, 'approval', 'DX-', 4);
  const ts = nowIso();
  const info = db.prepare(`INSERT INTO approvals(code, type, title, description, amount, requested_by, ref_type, ref_id, created_at, payload)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(code, type, title, description ?? null, amount, requestedBy, refType, refId, ts, payload ? JSON.stringify(payload) : null);
  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO approval_events(approval_id, action, user_id, note, created_at) VALUES (?,?,?,?,?)').run(id, 'created', requestedBy, null, ts);
  // Đề xuất 2 cấp: người gửi là trưởng phòng học thuật/Giám đốc ⇒ bỏ qua cấp trưởng phòng
  let stage = null;
  if (TWO_LEVEL.has(type)) stage = isRole(db, requestedBy, 'academic') || isRole(db, requestedBy, 'manager') ? 'final' : 'lead';
  if (stage) db.prepare('UPDATE approvals SET stage = ? WHERE id = ?').run(stage, id);
  const deciders = stage === 'lead' ? usersWithRole(db, 'academic') : usersWithRole(db, 'manager');
  for (const m of deciders) {
    if (m !== requestedBy) notify(db, m, { title: `Đề xuất chờ duyệt: ${title}`, body: `${code} · ${APPROVAL_TYPES[type]}`, link: `/approvals?id=${id}`, dedupeKey: `approval-created:${id}` });
  }
  return id;
}

/**
 * Duyệt / từ chối. Chạy trong transaction; câu UPDATE có điều kiện status='pending'
 * nên bấm duyệt hai lần (hoặc hai người cùng duyệt) chỉ có một lần có hiệu lực.
 */
export function decideApproval(db, { id, decision, note, user }) {
  return db.transaction(() => {
    const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    if (!a) throw notFound('Không tìm thấy đề xuất.');
    if (a.requested_by === user.id) throw forbidden('Không thể tự duyệt đề xuất của chính mình.');
    if (decision === 'rejected' && !note) throw badRequest('Vui lòng nhập lý do từ chối.', { note: 'Vui lòng nhập lý do từ chối.' });
    const ts = nowIso();
    const isFinal = user.perms?.has('approvals.decide');
    if (!isFinal) {
      // Trưởng phòng học thuật: chỉ duyệt cấp 1 của đề xuất 2 cấp
      if (!user.perms?.has('approvals.decide_lead') || a.stage !== 'lead') throw forbidden('Đề xuất này cần Giám đốc trung tâm duyệt.');
      if (a.status !== 'pending') throw conflict('Đề xuất này đã được xử lý trước đó. Dữ liệu không thay đổi.');
      if (decision === 'approved') {
        const r1 = db.prepare(`UPDATE approvals SET stage = 'final', lead_decided_by = ?, lead_decided_at = ?, lead_note = ? WHERE id = ? AND status = 'pending' AND stage = 'lead'`)
          .run(user.id, ts, note || null, id);
        if (r1.changes === 0) throw conflict('Đề xuất này đã được xử lý trước đó. Dữ liệu không thay đổi.');
        db.prepare('INSERT INTO approval_events(approval_id, action, user_id, note, created_at) VALUES (?,?,?,?,?)').run(id, 'lead_approved', user.id, note || null, ts);
        for (const m of usersWithRole(db, 'manager')) notify(db, m, { title: `Chờ duyệt cuối: ${a.title}`, body: `${a.code} · Trưởng phòng học thuật đã duyệt`, link: `/approvals?id=${id}`, dedupeKey: `approval-final:${id}` });
        notify(db, a.requested_by, { title: `Đề xuất ${a.code} đã qua Trưởng phòng, chờ Giám đốc`, body: a.title, link: `/approvals?id=${id}`, dedupeKey: `approval-lead:${id}` });
        return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
      }
      db.prepare('UPDATE approvals SET lead_decided_by = ?, lead_decided_at = ?, lead_note = ? WHERE id = ?').run(user.id, ts, note || null, id);
    }
    const status = decision === 'approved' ? 'approved' : 'rejected';
    const payment = status === 'approved' && needsPayment(a) ? 'unpaid' : 'none';
    const res = db.prepare(`UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, payment_status = ?, stage = NULL
      WHERE id = ? AND status = 'pending'`).run(status, user.id, ts, note || null, payment, id);
    if (res.changes === 0) throw conflict('Đề xuất này đã được xử lý trước đó. Dữ liệu không thay đổi.');
    db.prepare('INSERT INTO approval_events(approval_id, action, user_id, note, created_at) VALUES (?,?,?,?,?)').run(id, status, user.id, note || null, ts);

    // Đề xuất có tác động khi duyệt: thực hiện ngay trong cùng transaction — lỗi nghiệp vụ ⇒ hoàn tác cả quyết định duyệt
    if (status === 'approved') applyApprovedAction(db, a, user);
    else applyRejectedAction(db, a, user, note);

    // Cập nhật nghiệp vụ liên quan — chỉ chạy một lần vì đã chặn ở câu UPDATE trên
    if (a.ref_type === 'discount') {
      db.prepare('UPDATE discounts SET status = ? WHERE id = ?').run(status, a.ref_id);
      const d = db.prepare('SELECT enrollment_id FROM discounts WHERE id = ?').get(a.ref_id);
      if (status === 'approved') rebalanceInstallments(db, d.enrollment_id);
      logActivity(db, { entityType: 'enrollment', entityId: d.enrollment_id, action: `discount_${status}`, summary: `${status === 'approved' ? 'Duyệt' : 'Từ chối'} giảm phí ${a.amount?.toLocaleString('vi-VN')} đ (${a.code})`, userId: user.id });
    } else if (a.ref_type === 'refund') {
      db.prepare('UPDATE refunds SET status = ? WHERE id = ?').run(status, a.ref_id);
    } else if (a.ref_type === 'leave') {
      db.prepare('UPDATE leave_requests SET status = ? WHERE id = ?').run(status, a.ref_id);
    } else if (a.ref_type === 'asset_issue') {
      const issue = db.prepare('SELECT * FROM asset_issues WHERE id = ?').get(a.ref_id);
      if (issue && issue.status === 'waiting_approval') {
        db.prepare('UPDATE asset_issues SET status = ?, updated_at = ? WHERE id = ?').run('in_progress', ts, issue.id);
      }
      logActivity(db, { entityType: 'asset_issue', entityId: a.ref_id, action: `approval_${status}`, summary: `Quản lý ${status === 'approved' ? 'đã duyệt' : 'từ chối'} đề xuất chi ${a.code}${note ? `: ${note}` : ''}`, userId: user.id });
    }
    notify(db, a.requested_by, {
      title: `Đề xuất ${a.code} ${status === 'approved' ? 'đã được duyệt' : 'bị từ chối'}`,
      body: a.title, link: `/approvals?id=${id}`, dedupeKey: `approval-decided:${id}`,
    });
    if (payment === 'unpaid') {
      for (const c of usersWithRole(db, 'cashier')) notify(db, c, { title: `Chờ chi tiền: ${a.title}`, body: `${a.code} đã duyệt, chưa chi`, link: `/approvals?id=${id}`, dedupeKey: `approval-topay:${id}` });
    }
    return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  })();
}

/** Thu ngân xác nhận đã chi tiền thật. Duyệt ≠ đã chi. */
export function markApprovalPaid(db, { id, method, paidAt, note, user }) {
  return db.transaction(() => {
    const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    if (!a) throw notFound('Không tìm thấy đề xuất.');
    if (a.status !== 'approved') throw conflict('Chỉ xác nhận chi cho đề xuất đã được duyệt.');
    const ts = nowIso();
    const res = db.prepare(`UPDATE approvals SET payment_status = 'paid', paid_at = ?, paid_by = ?, payment_method = ?, payment_note = ?
      WHERE id = ? AND payment_status = 'unpaid'`).run(paidAt || vnToday(), user.id, method, note || null, id);
    if (res.changes === 0) throw conflict('Đề xuất này đã được xác nhận chi trước đó.');
    db.prepare('INSERT INTO approval_events(approval_id, action, user_id, note, created_at) VALUES (?,?,?,?,?)').run(id, 'paid', user.id, note || null, ts);
    if (a.ref_type === 'refund') {
      db.prepare(`UPDATE refunds SET status = 'paid', paid_at = ?, paid_by = ?, method = ? WHERE id = ?`).run(paidAt || vnToday(), user.id, method, a.ref_id);
      const rf = db.prepare('SELECT enrollment_id FROM refunds WHERE id = ?').get(a.ref_id);
      logActivity(db, { entityType: 'enrollment', entityId: rf.enrollment_id, action: 'refund_paid', summary: `Đã chi hoàn phí ${a.amount.toLocaleString('vi-VN')} đ (${a.code})`, userId: user.id });
    }
    if (a.type === 'contract_cancel') {
      db.prepare(`UPDATE refunds SET status = 'paid', paid_at = ?, paid_by = ?, method = ? WHERE approval_id = ?`).run(paidAt || vnToday(), user.id, method, id);
    }
    if (a.ref_type === 'asset_issue') {
      logActivity(db, { entityType: 'asset_issue', entityId: a.ref_id, action: 'paid', summary: `Thu ngân xác nhận đã chi ${a.amount?.toLocaleString('vi-VN')} đ cho ${a.code}`, userId: user.id });
    }
    notify(db, a.requested_by, { title: `Đã chi tiền cho đề xuất ${a.code}`, body: a.title, link: `/approvals?id=${id}`, dedupeKey: `approval-paid:${id}` });
    return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  })();
}

/** Người tạo hủy đề xuất khi còn chờ duyệt */
export function cancelApproval(db, { id, user, note }) {
  return db.transaction(() => {
    const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
    if (!a) throw notFound('Không tìm thấy đề xuất.');
    if (a.requested_by !== user.id) throw forbidden('Chỉ người tạo mới được hủy đề xuất.');
    const res = db.prepare(`UPDATE approvals SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(id);
    if (res.changes === 0) throw conflict('Chỉ hủy được đề xuất đang chờ duyệt.');
    db.prepare('INSERT INTO approval_events(approval_id, action, user_id, note, created_at) VALUES (?,?,?,?,?)').run(id, 'cancelled', user.id, note || null, nowIso());
    if (a.ref_type === 'discount') db.prepare(`UPDATE discounts SET status = 'rejected' WHERE id = ?`).run(a.ref_id);
    if (a.ref_type === 'refund') db.prepare(`UPDATE refunds SET status = 'rejected' WHERE id = ?`).run(a.ref_id);
    if (a.ref_type === 'leave') db.prepare(`UPDATE leave_requests SET status = 'rejected' WHERE id = ?`).run(a.ref_id);
    if (a.ref_type === 'asset_issue') {
      db.prepare(`UPDATE asset_issues SET status = 'in_progress', approval_id = NULL WHERE id = ? AND status = 'waiting_approval'`).run(a.ref_id);
    }
    applyRejectedAction(db, a, user, note || 'Người tạo hủy đề xuất');
  })();
}

/** Thực hiện nghiệp vụ của các loại đề xuất "duyệt là có hiệu lực" */
function applyApprovedAction(db, a, user) {
  const p = a.payload ? JSON.parse(a.payload) : {};
  if (a.type === 'package_change') applyPackageChange(db, { enrollmentId: p.enrollment_id, packageId: p.package_id, user });
  else if (a.type === 'contract_cancel') {
    cancelEnrollment(db, { enrollmentId: p.enrollment_id, reason: a.description || 'Hủy hợp đồng theo đề xuất', user });
    if (a.amount > 0) {
      const e = db.prepare('SELECT student_id FROM enrollments WHERE id = ?').get(p.enrollment_id);
      db.prepare(`INSERT INTO refunds(code, enrollment_id, student_id, amount, reason, status, approval_id, requested_by, created_at) VALUES (?,?,?,?,?,'approved',?,?,?)`)
        .run(nextCode(db, 'refund', 'HP-', 4), p.enrollment_id, e.student_id, a.amount, `Hoàn phí khi hủy hợp đồng (${a.code})`, a.id, a.requested_by, nowIso());
    }
  } else if (a.type === 'fee_transfer') {
    transferBalance(db, { fromStudentId: p.from_student_id, toStudentId: p.to_student_id, amount: a.amount, approvalId: a.id, note: a.description, user });
  } else if (a.type === 'enrollment') activateEnrollment(db, { enrollmentId: p.enrollment_id, user });
  else if (a.type === 'package') {
    db.prepare(`UPDATE fee_packages SET status = 'active' WHERE id = ?`).run(p.package_id);
    logActivity(db, { entityType: 'package', entityId: p.package_id, action: 'approved', summary: `Giám đốc duyệt gói phí (${a.code})`, userId: user.id });
  } else if (a.type === 'reserve') {
    reserveEnrollment(db, { enrollmentId: p.enrollment_id, reason: a.description || 'Theo đề xuất', from: p.from, to: p.to, user });
  } else if (a.type === 'class_transfer') transferClass(db, { enrollmentId: p.enrollment_id, classId: p.class_id, user });
  else if (a.type === 'level_up') levelUp(db, { enrollmentId: p.enrollment_id, courseId: p.course_id, classId: p.class_id, user });
}

/** Từ chối / hủy: hoàn trạng thái đối tượng đang chờ */
function applyRejectedAction(db, a, user, note) {
  const p = a.payload ? JSON.parse(a.payload) : {};
  if (a.type === 'enrollment') {
    const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(p.enrollment_id);
    if (e && e.status === 'pending_approval') {
      db.prepare(`UPDATE enrollments SET status = 'cancelled', cancel_reason = ? WHERE id = ?`).run(`Học phí không được duyệt: ${note || ''}`.trim(), e.id);
      logActivity(db, { entityType: 'student', entityId: e.student_id, action: 'enrollment_rejected', summary: `Đăng ký ${e.code} không được duyệt học phí${note ? `: ${note}` : ''}`, userId: user.id });
    }
  } else if (a.type === 'package') {
    db.prepare(`UPDATE fee_packages SET status = 'rejected' WHERE id = ? AND status = 'pending'`).run(p.package_id);
  }
}
