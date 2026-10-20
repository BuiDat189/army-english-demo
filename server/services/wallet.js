import { nextCode, logActivity } from '../db/index.js';
import { nowIso, vnToday } from '../lib/time.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { financeOf } from './finance.js';

// ===== SỐ DƯ HỌC VIÊN =====
// Nạp tiền (phiếu nạp NT-…) là tiền vào thật, chưa gắn khóa học — dùng cho đặt cọc hoặc đóng trước.
// Khi đóng học phí từ số dư: tạo phiếu thu phương thức "Trừ số dư" gắn đăng ký + bút toán trừ số dư.
// Phiếu thu "Trừ số dư" KHÔNG phải tiền vào mới ⇒ không cộng vào tiền thực thu (đã tính lúc nạp).
export const WALLET_KIND = { topup: 'Nạp tiền', apply: 'Đóng học phí từ số dư', transfer_in: 'Nhận chuyển số dư', transfer_out: 'Chuyển số dư đi' };

export function walletBalances(db, studentIds) {
  const out = new Map(studentIds.map((id) => [id, 0]));
  if (!studentIds.length) return out;
  for (const r of db.prepare(`SELECT student_id, SUM(amount) s FROM wallet_entries WHERE status = 'confirmed' AND student_id IN (${studentIds.map(() => '?').join(',')}) GROUP BY student_id`).all(...studentIds)) {
    out.set(r.student_id, r.s);
  }
  return out;
}
export const balanceOf = (db, studentId) => walletBalances(db, [studentId]).get(studentId);

/** Tiền thực thu trong kỳ = phiếu thu đã xác nhận (trừ phiếu "Trừ số dư") + phiếu nạp tiền đã xác nhận */
export function cashIn(db, from, to) {
  const rc = db.prepare(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM receipts WHERE status = 'confirmed' AND method != 'wallet' AND paid_at BETWEEN ? AND ?`).get(from, to);
  const tp = db.prepare(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM wallet_entries WHERE kind = 'topup' AND status = 'confirmed' AND paid_at BETWEEN ? AND ?`).get(from, to);
  return { total: rc.s + tp.s, receipts: rc.s, receiptCount: rc.n, topups: tp.s, topupCount: tp.n };
}

export function topup(db, { studentId, amount, method, paidAt, payerName = null, note = null, key, user }) {
  return db.transaction(() => {
    const ex = db.prepare('SELECT id, code FROM wallet_entries WHERE idempotency_key = ?').get(key);
    if (ex) return { id: ex.id, code: ex.code, duplicate: true };
    const st = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!st) throw notFound('Không tìm thấy học viên.');
    if (st.status === 'archived') throw conflict('Hồ sơ đã lưu trữ.');
    const code = nextCode(db, 'topup', 'NT-', 6);
    const id = Number(db.prepare(`INSERT INTO wallet_entries(code, student_id, kind, amount, method, paid_at, payer_name, note, status, idempotency_key, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,'confirmed',?,?,?)`).run(code, studentId, 'topup', amount, method, paidAt, payerName, note, key, user.id, nowIso()).lastInsertRowid);
    logActivity(db, { entityType: 'student', entityId: studentId, action: 'topup', summary: `Nạp ${amount.toLocaleString('vi-VN')} đ vào số dư (${code})`, userId: user.id });
    return { id, code, duplicate: false };
  })();
}

/** Đóng học phí cho một đăng ký bằng số dư của học viên */
export function applyWallet(db, { enrollmentId, amount, key, user }) {
  return db.transaction(() => {
    const ex = db.prepare('SELECT id, code FROM receipts WHERE idempotency_key = ?').get(key);
    if (ex) return { id: ex.id, code: ex.code, duplicate: true };
    const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
    if (!e) throw notFound('Không tìm thấy đăng ký.');
    if (e.status === 'cancelled') throw conflict('Đăng ký đã hủy.');
    if (e.status === 'pending_approval') throw conflict('Học phí đăng ký đang chờ Giám đốc duyệt, chưa thu được. Có thể nạp tiền cọc vào số dư.');
    const debt = financeOf(db, enrollmentId).debt;
    const bal = balanceOf(db, e.student_id);
    if (debt <= 0) throw conflict('Khoản này đã thu đủ.');
    if (bal <= 0) throw conflict('Học viên chưa có số dư.');
    const max = Math.min(debt, bal);
    if (amount > max) throw badRequest(`Tối đa ${max.toLocaleString('vi-VN')} đ (số dư ${bal.toLocaleString('vi-VN')} đ, công nợ ${debt.toLocaleString('vi-VN')} đ).`, { amount: `Tối đa ${max.toLocaleString('vi-VN')} đ.` });
    const ts = nowIso();
    const code = nextCode(db, 'receipt', 'PT-', 6);
    const rid = Number(db.prepare(`INSERT INTO receipts(code, enrollment_id, student_id, amount, paid_at, method, note, status, collected_by, idempotency_key, created_at)
      VALUES (?,?,?,?,?,'wallet','Trừ từ số dư','confirmed',?,?,?)`).run(code, e.id, e.student_id, amount, vnToday(), user.id, key, ts).lastInsertRowid);
    db.prepare(`INSERT INTO wallet_entries(code, student_id, kind, amount, paid_at, receipt_id, note, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,'confirmed',?,?)`)
      .run(nextCode(db, 'wallet', 'SD-', 6), e.student_id, 'apply', -amount, vnToday(), rid, `Đóng học phí ${e.code} (${code})`, user.id, ts);
    logActivity(db, { entityType: 'enrollment', entityId: e.id, action: 'receipt', summary: `Trừ số dư ${amount.toLocaleString('vi-VN')} đ (${code})`, userId: user.id });
    return { id: rid, code, duplicate: false };
  })();
}

/** Hủy phiếu thu "Trừ số dư" ⇒ trả lại số dư */
export function restoreWalletForReceipt(db, receiptId, { reason, user }) {
  db.prepare(`UPDATE wallet_entries SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE receipt_id = ? AND status = 'confirmed'`)
    .run(reason, user.id, nowIso(), receiptId);
}

/** Hủy phiếu nạp: chỉ khi số dư còn đủ để trừ lại */
export function cancelTopup(db, { id, reason, user }) {
  return db.transaction(() => {
    const w = db.prepare('SELECT * FROM wallet_entries WHERE id = ?').get(id);
    if (!w || w.kind !== 'topup') throw notFound('Không tìm thấy phiếu nạp.');
    if (w.status !== 'confirmed') throw conflict('Phiếu nạp đã được hủy trước đó.');
    if (balanceOf(db, w.student_id) < w.amount) throw conflict('Không thể hủy: số dư đã được dùng để đóng học phí. Hủy phiếu thu trừ số dư trước.');
    db.prepare(`UPDATE wallet_entries SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE id = ?`).run(reason, user.id, nowIso(), id);
    logActivity(db, { entityType: 'student', entityId: w.student_id, action: 'topup_cancelled', summary: `Hủy phiếu nạp ${w.code}: ${reason}`, userId: user.id });
  })();
}

/** Chuyển số dư giữa hai học viên (thực hiện khi đề xuất "Chuyển học phí" được duyệt) */
export function transferBalance(db, { fromStudentId, toStudentId, amount, approvalId, note, user }) {
  if (fromStudentId === toStudentId) throw badRequest('Học viên nhận phải khác học viên chuyển.');
  const bal = balanceOf(db, fromStudentId);
  if (amount > bal) throw conflict(`Số dư hiện tại (${bal.toLocaleString('vi-VN')} đ) không đủ để chuyển.`);
  const ts = nowIso();
  const from = db.prepare('SELECT full_name FROM students WHERE id = ?').get(fromStudentId);
  const to = db.prepare('SELECT full_name FROM students WHERE id = ?').get(toStudentId);
  for (const [sid, kind, amt, text] of [[fromStudentId, 'transfer_out', -amount, `Chuyển sang ${to.full_name}`], [toStudentId, 'transfer_in', amount, `Nhận từ ${from.full_name}`]]) {
    db.prepare(`INSERT INTO wallet_entries(code, student_id, kind, amount, paid_at, approval_id, note, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,'confirmed',?,?)`)
      .run(nextCode(db, 'wallet', 'SD-', 6), sid, kind, amt, vnToday(), approvalId, note ? `${text}: ${note}` : text, user.id, ts);
    logActivity(db, { entityType: 'student', entityId: sid, action: kind, summary: `${text} ${amount.toLocaleString('vi-VN')} đ`, userId: user.id });
  }
}
