import { vnToday, addDays } from '../lib/time.js';

// ===== QUY TẮC CÔNG NỢ (giả định demo, áp dụng thống nhất ở mọi màn hình và báo cáo) =====
// Phải thu sau điều chỉnh = Học phí niêm yết − Tổng giảm phí ĐÃ DUYỆT
// Đã thu                   = Tổng phiếu thu trạng thái "Đã xác nhận" (phiếu đã hủy không tính)
// Công nợ                  = Phải thu sau điều chỉnh − Đã thu
// Hoàn phí là dòng tiền chi ra riêng (sau khi xác nhận đã chi); không làm thay đổi công nợ.
// Đăng ký đã hủy: phần chưa thu được xóa (không còn là công nợ).
// Lịch thanh toán: tiền đã thu được phân bổ lần lượt vào các đợt theo thứ tự đến hạn.
// "Sắp đến hạn" = đợt chưa thu đủ, hạn trong 7 ngày tới. "Quá hạn" = hạn trước hôm nay mà chưa thu đủ.
export const DUE_SOON_DAYS = 7;

export function computeFinance(db, { enrollmentIds = null, today = vnToday() } = {}) {
  const filter = enrollmentIds ? `WHERE e.id IN (${enrollmentIds.map(() => '?').join(',') || 'NULL'})` : '';
  const args = enrollmentIds || [];
  const enrolls = db.prepare(`
    SELECT e.id, e.status, e.tuition_fee,
      COALESCE((SELECT SUM(amount) FROM discounts d WHERE d.enrollment_id = e.id AND d.status = 'approved'), 0) AS discount,
      COALESCE((SELECT SUM(amount) FROM receipts r WHERE r.enrollment_id = e.id AND r.status = 'confirmed'), 0) AS paid,
      COALESCE((SELECT SUM(amount) FROM refunds f WHERE f.enrollment_id = e.id AND f.status = 'paid'), 0) AS refunded
    FROM enrollments e ${filter}`).all(...args);
  const inst = db.prepare(`SELECT i.* FROM installments i ${enrollmentIds ? `WHERE i.enrollment_id IN (${args.map(() => '?').join(',') || 'NULL'})` : ''} ORDER BY i.enrollment_id, i.seq`).all(...args);
  const byEnroll = new Map();
  for (const i of inst) {
    if (!byEnroll.has(i.enrollment_id)) byEnroll.set(i.enrollment_id, []);
    byEnroll.get(i.enrollment_id).push(i);
  }
  const soonLimit = addDays(today, DUE_SOON_DAYS);
  const out = new Map();
  for (const e of enrolls) {
    const net = e.tuition_fee - e.discount;
    const cancelled = e.status === 'cancelled';
    // Đăng ký chờ Giám đốc duyệt học phí: chưa phát sinh công nợ, chưa thu
    const awaiting = e.status === 'pending_approval';
    const debt = cancelled || awaiting ? 0 : Math.max(0, net - e.paid);
    let remainingPaid = e.paid;
    let overdue = 0;
    let dueSoon = 0;
    let nextDue = null;
    const installments = (byEnroll.get(e.id) || []).map((i) => {
      const covered = Math.min(i.amount, Math.max(0, remainingPaid));
      remainingPaid -= covered;
      const left = i.amount - covered;
      let status = 'paid';
      if (left > 0) {
        if (cancelled) status = 'waived';
        else if (awaiting) status = 'upcoming';
        else if (i.due_date < today) { status = 'overdue'; overdue += left; }
        else if (i.due_date <= soonLimit) { status = 'due_soon'; dueSoon += left; }
        else status = covered > 0 ? 'partial' : 'upcoming';
        if (!cancelled && !awaiting && !nextDue) nextDue = { date: i.due_date, amount: left, seq: i.seq };
      }
      return { ...i, paid: covered, remaining: left, status };
    });
    let paymentStatus;
    if (cancelled) paymentStatus = 'closed';
    else if (awaiting) paymentStatus = 'awaiting';
    else if (debt === 0) paymentStatus = 'paid';
    else if (overdue > 0) paymentStatus = 'overdue';
    else if (dueSoon > 0) paymentStatus = 'due_soon';
    else if (e.paid > 0) paymentStatus = 'partial';
    else paymentStatus = 'unpaid';
    out.set(e.id, {
      fee: e.tuition_fee, discount: e.discount, net, paid: e.paid, refunded: e.refunded,
      debt, overdue, dueSoon, nextDue, installments, paymentStatus,
    });
  }
  return out;
}

export function financeOf(db, enrollmentId, today) {
  return computeFinance(db, { enrollmentIds: [enrollmentId], today }).get(enrollmentId);
}

/** Sau khi giảm phí được duyệt: trừ dần vào các đợt cuối để tổng lịch thanh toán = phải thu sau điều chỉnh. */
export function rebalanceInstallments(db, enrollmentId) {
  const f = financeOf(db, enrollmentId);
  const rows = db.prepare('SELECT * FROM installments WHERE enrollment_id = ? ORDER BY seq DESC').all(enrollmentId);
  let excess = rows.reduce((s, r) => s + r.amount, 0) - f.net;
  for (const r of rows) {
    if (excess <= 0) break;
    const cut = Math.min(excess, r.amount);
    excess -= cut;
    if (r.amount - cut === 0) db.prepare('DELETE FROM installments WHERE id = ?').run(r.id);
    else db.prepare('UPDATE installments SET amount = ? WHERE id = ?').run(r.amount - cut, r.id);
  }
}

/** Kiểm tra lịch thanh toán: tổng các đợt phải bằng số phải thu, hạn tăng dần. */
export function validateInstallments(plan, total) {
  if (!Array.isArray(plan) || plan.length === 0) return 'Cần ít nhất một đợt thanh toán.';
  if (plan.length > 12) return 'Tối đa 12 đợt thanh toán.';
  let sum = 0;
  let prev = '';
  for (const [i, p] of plan.entries()) {
    if (!Number.isInteger(p.amount) || p.amount <= 0) return `Đợt ${i + 1}: số tiền phải là số nguyên dương.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.due_date || '')) return `Đợt ${i + 1}: hạn thanh toán không hợp lệ.`;
    if (p.due_date < prev) return `Đợt ${i + 1}: hạn thanh toán phải sau đợt trước.`;
    prev = p.due_date;
    sum += p.amount;
  }
  if (sum !== total) return `Tổng các đợt (${sum.toLocaleString('vi-VN')} đ) phải bằng số phải thu (${total.toLocaleString('vi-VN')} đ).`;
  return null;
}

export const PAYMENT_STATUS_LABEL = {
  awaiting: 'Chờ GĐ duyệt học phí', paid: 'Đã đóng đủ', partial: 'Đóng một phần', unpaid: 'Chưa đóng', due_soon: 'Sắp đến hạn', overdue: 'Quá hạn', closed: 'Đã đóng hồ sơ',
};
