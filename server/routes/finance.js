import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest } from '../lib/http.js';
import { nextCode, logActivity, notify, usersWithRole } from '../db/index.js';
import { nowIso, vnToday, addDays, periodRange } from '../lib/time.js';
import { computeFinance, financeOf, PAYMENT_STATUS_LABEL } from '../services/finance.js';
import { createApproval } from '../services/approvals.js';
import { topup, applyWallet, cancelTopup, restoreWalletForReceipt, cashIn, walletBalances, WALLET_KIND } from '../services/wallet.js';

export const METHOD_LABEL = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Quẹt thẻ', wallet: 'Trừ số dư' };

// Quẹt thẻ tín dụng: bắt buộc số CCCD chủ thẻ, ngày cấp thẻ, đơn vị cấp thẻ
function checkCard(b) {
  if (b.method !== 'card') return;
  const f = {};
  if (!/^\d{12}$/.test(b.card_id_no || '')) f.card_id_no = 'Số CCCD gồm 12 chữ số.';
  if (!b.card_issue_date) f.card_issue_date = 'Chọn ngày cấp thẻ.';
  else if (b.card_issue_date > vnToday()) f.card_issue_date = 'Ngày cấp thẻ không được ở tương lai.';
  if (!b.card_issuer) f.card_issuer = 'Nhập đơn vị cấp thẻ (ngân hàng).';
  if (Object.keys(f).length) throw badRequest('Thanh toán quẹt thẻ cần thông tin CCCD và thẻ.', f);
}

export function financeRoutes({ db }) {
  const r = Router();

  // Danh sách khoản phải thu theo đăng ký khóa
  r.get('/receivables', can('finance.view'), (req, res) => {
    const { status, q, enrollment } = req.query;
    const where = [];
    const args = [];
    if (q) { where.push('(s.full_name LIKE ? OR s.code LIKE ? OR e.code LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (enrollment) { where.push('e.id = ?'); args.push(Number(enrollment)); }
    const rows = db.prepare(`SELECT e.id, e.code, e.status, e.enrolled_at, e.student_id, s.full_name AS student_name, s.code AS student_code, co.name AS course_name, c.code AS class_code,
        (SELECT p.full_name || ' · ' || p.phone FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id WHERE sc.student_id = s.id AND sc.is_primary = 1) AS parent
      FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses co ON co.id = e.course_id LEFT JOIN classes c ON c.id = e.class_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.enrolled_at DESC`).all(...args);
    const fin = computeFinance(db, { enrollmentIds: rows.map((x) => x.id) });
    let items = rows.map((x) => ({ ...x, finance: fin.get(x.id) }));
    if (status === 'debt') items = items.filter((x) => x.finance.debt > 0);
    else if (status === 'due') items = items.filter((x) => x.finance.overdue > 0 || x.finance.dueSoon > 0);
    else if (status && status !== 'all') items = items.filter((x) => x.finance.paymentStatus === status);
    const totals = items.reduce((t, x) => ({
      net: t.net + (x.status === 'cancelled' ? 0 : x.finance.net), paid: t.paid + x.finance.paid, debt: t.debt + x.finance.debt,
      overdue: t.overdue + x.finance.overdue, dueSoon: t.dueSoon + x.finance.dueSoon,
    }), { net: 0, paid: 0, debt: 0, overdue: 0, dueSoon: 0 });
    res.json({ items, totals, statusLabels: PAYMENT_STATUS_LABEL });
  });

  r.get('/receipts', can('finance.view'), (req, res) => {
    const { from, to } = periodRange(req.query.period || 'custom', vnToday(), req.query.from, req.query.to);
    const where = ['r.paid_at BETWEEN ? AND ?'];
    const args = [from, to];
    if (req.query.method) { where.push('r.method = ?'); args.push(req.query.method); }
    if (req.query.status && req.query.status !== 'all') { where.push('r.status = ?'); args.push(req.query.status); }
    if (req.query.q) { where.push('(s.full_name LIKE ? OR r.code LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    if (req.query.kind) { where.push('e.kind = ?'); args.push(req.query.kind); }
    const items = db.prepare(`SELECT r.*, s.full_name AS student_name, s.code AS student_code, e.code AS enrollment_code, e.kind AS enrollment_kind, co.name AS course_name, u.full_name AS collector,
        sb.full_name AS sold_by_name
      FROM receipts r LEFT JOIN users sb ON sb.id = (SELECT sold_by FROM enrollments WHERE id = r.enrollment_id) JOIN students s ON s.id = r.student_id JOIN enrollments e ON e.id = r.enrollment_id JOIN courses co ON co.id = e.course_id LEFT JOIN users u ON u.id = r.collected_by
      WHERE ${where.join(' AND ')} ORDER BY r.paid_at DESC, r.id DESC`).all(...args);
    const confirmed = items.filter((x) => x.status === 'confirmed');
    // Tổng thực thu không tính phiếu "Trừ số dư" (tiền đã vào lúc nạp)
    const cash = confirmed.filter((x) => x.method !== 'wallet');
    const byKind = { new: 0, renew: 0 };
    for (const x of cash) byKind[x.enrollment_kind === 'renew' ? 'renew' : 'new'] += x.amount;
    const byMethod = {};
    for (const x of cash) byMethod[x.method] = (byMethod[x.method] || 0) + x.amount;
    res.json({ from, to, items, byKind, byMethod, total: cash.reduce((s, x) => s + x.amount, 0), count: cash.length, walletTotal: confirmed.filter((x) => x.method === 'wallet').reduce((s, x) => s + x.amount, 0), methodLabels: METHOD_LABEL });
  });

  r.get('/receipts/:id', can('finance.view'), (req, res) => {
    const rc = db.prepare(`SELECT r.*, s.full_name AS student_name, s.code AS student_code, e.code AS enrollment_code, co.name AS course_name, c.code AS class_code,
        u.full_name AS collector, cu.full_name AS cancelled_by_name,
        (SELECT p.full_name FROM student_contacts sc JOIN parents p ON p.id = sc.parent_id WHERE sc.student_id = s.id AND sc.is_primary = 1) AS parent_name
      FROM receipts r JOIN students s ON s.id = r.student_id JOIN enrollments e ON e.id = r.enrollment_id JOIN courses co ON co.id = e.course_id
      LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN users u ON u.id = r.collected_by LEFT JOIN users cu ON cu.id = r.cancelled_by WHERE r.id = ?`).get(Number(req.params.id));
    if (!rc) throw notFound('Không tìm thấy phiếu thu.');
    res.json({ receipt: { ...rc, idempotency_key: undefined }, finance: financeOf(db, rc.enrollment_id), methodLabels: METHOD_LABEL });
  });

  // Ghi nhận phiếu thu. Idempotency-Key bắt buộc: gửi lại cùng khóa trả về đúng phiếu cũ, không tạo phiếu thứ hai.
  r.post('/receipts', can('finance.collect'), (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length < 8 || key.length > 100) throw badRequest('Thiếu mã chống gửi trùng (Idempotency-Key).');
    const b = parse(z.object({
      enrollment_id: v.id('khoản phải thu'), amount: v.money('số tiền thu'), paid_at: v.date('ngày thu'),
      method: z.enum(['cash', 'transfer', 'card'], { error: 'Chọn phương thức thanh toán.' }), payer_name: v.optText(120), note: v.optText(500),
      card_id_no: v.optText(20), card_issue_date: v.optDate(), card_issuer: v.optText(120),
    }), req.body);
    checkCard(b);
    const today = vnToday();
    if (b.paid_at > today) throw badRequest('Ngày thu không được ở tương lai.', { paid_at: 'Ngày thu không được ở tương lai.' });
    if (b.paid_at < addDays(today, -60)) throw badRequest('Ngày thu quá xa (tối đa lùi 60 ngày).', { paid_at: 'Tối đa lùi 60 ngày.' });
    const out = db.transaction(() => {
      const ex = db.prepare('SELECT id, code FROM receipts WHERE idempotency_key = ?').get(key);
      if (ex) return { id: ex.id, code: ex.code, duplicate: true };
      const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(b.enrollment_id);
      if (!e) throw notFound('Không tìm thấy đăng ký.');
      if (e.status === 'cancelled') throw conflict('Đăng ký đã hủy, không thu thêm.');
      if (e.status === 'pending_approval') throw conflict('Học phí đăng ký đang chờ Giám đốc duyệt, chưa thu được. Nếu khách đặt cọc, ghi nhận bằng "Nạp tiền".');
      const f = financeOf(db, e.id);
      if (f.debt <= 0) throw conflict('Khoản này đã thu đủ.');
      if (b.amount > f.debt) {
        throw badRequest(`Số tiền vượt công nợ còn lại (${f.debt.toLocaleString('vi-VN')} đ). Bản demo chưa hỗ trợ ghi nhận tiền thừa.`, { amount: `Tối đa ${f.debt.toLocaleString('vi-VN')} đ.` });
      }
      const code = nextCode(db, 'receipt', 'PT-', 6);
      const card = b.method === 'card' ? b : {};
      const id = Number(db.prepare(`INSERT INTO receipts(code, enrollment_id, student_id, amount, paid_at, method, payer_name, note, status, collected_by, idempotency_key, created_at, card_id_no, card_issue_date, card_issuer)
        VALUES (?,?,?,?,?,?,?,?,'confirmed',?,?,?,?,?,?)`).run(code, e.id, e.student_id, b.amount, b.paid_at, b.method, b.payer_name, b.note, req.user.id, key, nowIso(),
        card.card_id_no ?? null, card.card_issue_date ?? null, card.card_issuer ?? null).lastInsertRowid);
      logActivity(db, { entityType: 'enrollment', entityId: e.id, action: 'receipt', summary: `Thu ${b.amount.toLocaleString('vi-VN')} đ (${code}, ${METHOD_LABEL[b.method]})`, userId: req.user.id });
      return { id, code, duplicate: false };
    })();
    res.status(out.duplicate ? 200 : 201).json({ ...out, finance: financeOf(db, b.enrollment_id) });
  });

  // Không xóa cứng phiếu đã xác nhận: hủy có lý do, giữ lịch sử
  r.post('/receipts/:id/cancel', can('finance.cancel'), (req, res) => {
    const id = Number(req.params.id);
    const b = parse(z.object({ reason: v.text(500, 'lý do hủy phiếu') }), req.body);
    db.transaction(() => {
      const rc = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
      if (!rc) throw notFound('Không tìm thấy phiếu thu.');
      const resu = db.prepare(`UPDATE receipts SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE id = ? AND status = 'confirmed'`).run(b.reason, req.user.id, nowIso(), id);
      if (!resu.changes) throw conflict('Phiếu thu đã được hủy trước đó.');
      if (rc.method === 'wallet') restoreWalletForReceipt(db, id, { reason: `Hủy phiếu thu ${rc.code}: ${b.reason}`, user: req.user });
      const refunded = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE enrollment_id = ? AND status IN ('requested','approved','paid')`).get(rc.enrollment_id).s;
      const paidLeft = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE enrollment_id = ? AND status = 'confirmed'`).get(rc.enrollment_id).s;
      if (paidLeft < refunded) throw conflict('Không thể hủy: khoản hoàn phí đã đề nghị/đã chi lớn hơn số tiền còn lại sau khi hủy.');
      logActivity(db, { entityType: 'enrollment', entityId: rc.enrollment_id, action: 'receipt_cancelled', summary: `Hủy phiếu thu ${rc.code} (${rc.amount.toLocaleString('vi-VN')} đ): ${b.reason}`, userId: req.user.id });
      logActivity(db, { entityType: 'student', entityId: rc.student_id, action: 'receipt_cancelled', summary: `Hủy phiếu thu ${rc.code}: ${b.reason}`, userId: req.user.id });
      for (const m of usersWithRole(db, 'manager')) notify(db, m, { title: `Phiếu thu ${rc.code} đã bị hủy`, body: b.reason, link: `/finance/receipts/${id}`, dedupeKey: `receipt-cancel:${id}` });
    })();
    res.json({ ok: true });
  });

  // Đề nghị hoàn phí ⇒ tạo đề xuất chờ duyệt. Duyệt xong vẫn chờ thu ngân xác nhận đã chi.
  r.post('/refunds', can('finance.refund_request'), (req, res) => {
    const b = parse(z.object({ enrollment_id: v.id('đăng ký'), amount: v.money('số tiền hoàn'), reason: v.text(500, 'lý do hoàn phí') }), req.body);
    const out = db.transaction(() => {
      const e = db.prepare(`SELECT e.*, s.full_name FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.id = ?`).get(b.enrollment_id);
      if (!e) throw notFound('Không tìm thấy đăng ký.');
      const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE enrollment_id = ? AND status = 'confirmed'`).get(e.id).s;
      const reserved = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE enrollment_id = ? AND status IN ('requested','approved','paid')`).get(e.id).s;
      if (b.amount > paid - reserved) throw badRequest(`Số tiền hoàn vượt số đã thu còn có thể hoàn (${(paid - reserved).toLocaleString('vi-VN')} đ).`, { amount: `Tối đa ${(paid - reserved).toLocaleString('vi-VN')} đ.` });
      const rid = Number(db.prepare(`INSERT INTO refunds(code, enrollment_id, student_id, amount, reason, status, requested_by, created_at) VALUES (?,?,?,?,?,'requested',?,?)`)
        .run(nextCode(db, 'refund', 'HP-', 4), e.id, e.student_id, b.amount, b.reason, req.user.id, nowIso()).lastInsertRowid);
      const aid = createApproval(db, { type: 'refund', title: `Hoàn phí – ${e.full_name}`, description: b.reason, amount: b.amount, requestedBy: req.user.id, refType: 'refund', refId: rid });
      db.prepare('UPDATE refunds SET approval_id = ? WHERE id = ?').run(aid, rid);
      logActivity(db, { entityType: 'enrollment', entityId: e.id, action: 'refund_requested', summary: `Đề nghị hoàn ${b.amount.toLocaleString('vi-VN')} đ, chờ duyệt`, userId: req.user.id });
      return { id: rid, approvalId: aid };
    })();
    res.status(201).json(out);
  });

  r.get('/refunds', can('finance.view'), (_req, res) => {
    const items = db.prepare(`SELECT f.*, s.full_name AS student_name, e.code AS enrollment_code, a.code AS approval_code, a.status AS approval_status, a.payment_status, u.full_name AS requested_by_name
      FROM refunds f JOIN students s ON s.id = f.student_id JOIN enrollments e ON e.id = f.enrollment_id LEFT JOIN approvals a ON a.id = f.approval_id LEFT JOIN users u ON u.id = f.requested_by
      ORDER BY f.created_at DESC`).all();
    res.json({ items });
  });

  r.get('/summary', can('finance.view'), (req, res) => {
    const { from, to } = periodRange(req.query.period || 'month', vnToday(), req.query.from, req.query.to);
    const cash = cashIn(db, from, to);
    const income = { s: cash.total, n: cash.receiptCount + cash.topupCount };
    const refunds = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE status = 'paid' AND paid_at BETWEEN ? AND ?`).get(from, to).s;
    const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM approvals WHERE type IN ('purchase','expense') AND payment_status = 'paid' AND paid_at BETWEEN ? AND ?`).get(from, to).s;
    res.json({ from, to, income: income.s, receiptCount: income.n, receiptIncome: cash.receipts, topupIncome: cash.topups, refunds, expenses, net: income.s - refunds - expenses, canPay: has(req.user, 'finance.pay') });
  });

  // ---------- Số dư: nạp tiền, đóng học phí từ số dư ----------
  r.get('/wallet', can('finance.view'), (req, res) => {
    const { from, to } = periodRange(req.query.period || 'month', vnToday(), req.query.from, req.query.to);
    const items = db.prepare(`SELECT w.*, s.full_name AS student_name, s.code AS student_code, u.full_name AS created_by_name FROM wallet_entries w
      JOIN students s ON s.id = w.student_id LEFT JOIN users u ON u.id = w.created_by WHERE w.paid_at BETWEEN ? AND ? ORDER BY w.created_at DESC`).all(from, to);
    const holders = db.prepare(`SELECT s.id, s.code, s.full_name, SUM(w.amount) AS balance FROM wallet_entries w JOIN students s ON s.id = w.student_id
      WHERE w.status = 'confirmed' GROUP BY s.id HAVING balance > 0 ORDER BY balance DESC`).all();
    const topupTotal = items.filter((x) => x.kind === 'topup' && x.status === 'confirmed').reduce((t, x) => t + x.amount, 0);
    res.json({ from, to, items, holders, topupTotal, balanceTotal: holders.reduce((t, x) => t + x.balance, 0), kindLabels: WALLET_KIND, methodLabels: METHOD_LABEL });
  });

  r.get('/wallet/:studentId', can('finance.view'), (req, res) => {
    const sid = Number(req.params.studentId);
    const items = db.prepare(`SELECT w.*, u.full_name AS created_by_name, r.code AS receipt_code FROM wallet_entries w LEFT JOIN users u ON u.id = w.created_by LEFT JOIN receipts r ON r.id = w.receipt_id
      WHERE w.student_id = ? ORDER BY w.created_at DESC`).all(sid);
    res.json({ balance: walletBalances(db, [sid]).get(sid), items, kindLabels: WALLET_KIND });
  });

  r.post('/wallet/topup', can('finance.collect'), (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length < 8 || key.length > 100) throw badRequest('Thiếu mã chống gửi trùng (Idempotency-Key).');
    const b = parse(z.object({
      student_id: v.id('học viên'), amount: v.money('số tiền nạp'), paid_at: v.date('ngày nạp'),
      method: z.enum(['cash', 'transfer', 'card'], { error: 'Chọn phương thức thanh toán.' }), payer_name: v.optText(120), note: v.optText(500),
      card_id_no: v.optText(20), card_issue_date: v.optDate(), card_issuer: v.optText(120),
    }), req.body);
    checkCard(b);
    if (b.method === 'card') b.note = [b.note, `Quẹt thẻ — CCCD ${b.card_id_no}, cấp ${b.card_issue_date.split('-').reverse().join('/')}, ${b.card_issuer}`].filter(Boolean).join('. ');
    const today = vnToday();
    if (b.paid_at > today) throw badRequest('Ngày nạp không được ở tương lai.', { paid_at: 'Ngày nạp không được ở tương lai.' });
    if (b.paid_at < addDays(today, -60)) throw badRequest('Ngày nạp quá xa (tối đa lùi 60 ngày).', { paid_at: 'Tối đa lùi 60 ngày.' });
    const out = topup(db, { studentId: b.student_id, amount: b.amount, method: b.method, paidAt: b.paid_at, payerName: b.payer_name, note: b.note, key, user: req.user });
    res.status(out.duplicate ? 200 : 201).json({ ...out, balance: walletBalances(db, [b.student_id]).get(b.student_id) });
  });

  r.post('/wallet/apply', can('finance.collect'), (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length < 8 || key.length > 100) throw badRequest('Thiếu mã chống gửi trùng (Idempotency-Key).');
    const b = parse(z.object({ enrollment_id: v.id('đăng ký'), amount: v.money('số tiền') }), req.body);
    const out = applyWallet(db, { enrollmentId: b.enrollment_id, amount: b.amount, key, user: req.user });
    res.status(out.duplicate ? 200 : 201).json({ ...out, finance: financeOf(db, b.enrollment_id) });
  });

  r.post('/wallet/:id/cancel', can('finance.cancel'), (req, res) => {
    const b = parse(z.object({ reason: v.text(500, 'lý do hủy') }), req.body);
    cancelTopup(db, { id: Number(req.params.id), reason: b.reason, user: req.user });
    res.json({ ok: true });
  });

  return r;
}
