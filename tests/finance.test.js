import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, login } from './helpers.js';
import { computeFinance } from '../server/services/finance.js';

const KEY = (n) => `test-key-${n}-${Math.random().toString(16).slice(2)}`;

/** Tìm một đăng ký đang còn nợ */
function enrollmentWithDebt(db) {
  const fin = computeFinance(db);
  const [id, f] = [...fin.entries()].find(([eid, x]) => x.debt > 1000000 && db.prepare(`SELECT status FROM enrollments WHERE id = ?`).get(eid).status === 'active');
  return { id, f };
}

describe('Công nợ & phiếu thu', () => {
  let ctx; let cashier; let manager; let consultant;
  beforeEach(async () => {
    ctx = makeApp();
    cashier = await login(ctx.app, 'thungan');
    manager = await login(ctx.app, 'quanly');
    consultant = await login(ctx.app, 'tuvan');
  });

  it('công nợ = phải thu sau giảm đã duyệt − phiếu thu đã xác nhận', () => {
    const fin = computeFinance(ctx.db);
    for (const [id, f] of fin) {
      const e = ctx.db.prepare('SELECT * FROM enrollments WHERE id = ?').get(id);
      const disc = ctx.db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM discounts WHERE enrollment_id = ? AND status = 'approved'`).get(id).s;
      const paid = ctx.db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE enrollment_id = ? AND status = 'confirmed'`).get(id).s;
      // Đăng ký chờ Giám đốc duyệt học phí chưa phát sinh công nợ
      const expected = ['cancelled', 'pending_approval'].includes(e.status) ? 0 : e.tuition_fee - disc - paid;
      expect(f.debt).toBe(Math.max(0, expected));
      expect(Number.isInteger(f.debt)).toBe(true);
    }
  });

  it('thu một phần làm giảm đúng công nợ; gửi lại cùng Idempotency-Key không tạo phiếu thứ hai', async () => {
    const { id, f } = enrollmentWithDebt(ctx.db);
    const key = KEY('partial');
    const body = { enrollment_id: id, amount: 500000, paid_at: new Date().toISOString().slice(0, 10), method: 'cash' };
    const before = ctx.db.prepare('SELECT COUNT(*) n FROM receipts').get().n;
    const r1 = await cashier.post('/api/finance/receipts').set('Idempotency-Key', key).send(body);
    expect(r1.status).toBe(201);
    expect(r1.body.finance.debt).toBe(f.debt - 500000);
    // Gửi lại (double click / mạng chập chờn) ⇒ trả lại đúng phiếu cũ
    const [r2, r3] = await Promise.all([
      cashier.post('/api/finance/receipts').set('Idempotency-Key', key).send(body),
      cashier.post('/api/finance/receipts').set('Idempotency-Key', key).send(body),
    ]);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    expect(r2.body.id).toBe(r1.body.id);
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM receipts').get().n).toBe(before + 1);
    expect(computeFinance(ctx.db, { enrollmentIds: [id] }).get(id).debt).toBe(f.debt - 500000);
  });

  it('chặn số tiền âm, số lẻ, bằng 0, thu vượt công nợ và thiếu Idempotency-Key', async () => {
    const { id, f } = enrollmentWithDebt(ctx.db);
    const base = { enrollment_id: id, paid_at: new Date().toISOString().slice(0, 10), method: 'transfer' };
    for (const amount of [-100000, 0, 1500.5, 'abc', f.debt + 1000]) {
      const r = await cashier.post('/api/finance/receipts').set('Idempotency-Key', KEY('bad')).send({ ...base, amount });
      expect(r.status, `amount=${amount}`).toBe(400);
      expect(r.body.fields?.amount).toBeTruthy();
    }
    const noKey = await cashier.post('/api/finance/receipts').send({ ...base, amount: 100000 });
    expect(noKey.status).toBe(400);
    const future = await cashier.post('/api/finance/receipts').set('Idempotency-Key', KEY('future')).send({ ...base, amount: 100000, paid_at: '2099-01-01' });
    expect(future.status).toBe(400);
  });

  it('hủy phiếu thu có lý do: không xóa cứng, công nợ tăng lại, hủy lần hai bị chặn', async () => {
    const { id, f } = enrollmentWithDebt(ctx.db);
    const r = await cashier.post('/api/finance/receipts').set('Idempotency-Key', KEY('c')).send({ enrollment_id: id, amount: 300000, paid_at: new Date().toISOString().slice(0, 10), method: 'cash' });
    const noReason = await cashier.post(`/api/finance/receipts/${r.body.id}/cancel`).send({});
    expect(noReason.status).toBe(400);
    const c1 = await cashier.post(`/api/finance/receipts/${r.body.id}/cancel`).send({ reason: 'Ghi nhầm số tiền' });
    expect(c1.status).toBe(200);
    const row = ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(r.body.id);
    expect(row.status).toBe('cancelled');
    expect(row.cancel_reason).toBe('Ghi nhầm số tiền');
    expect(computeFinance(ctx.db, { enrollmentIds: [id] }).get(id).debt).toBe(f.debt);
    const c2 = await cashier.post(`/api/finance/receipts/${r.body.id}/cancel`).send({ reason: 'lần 2' });
    expect(c2.status).toBe(409);
  });

  it('giảm phí: tư vấn đề nghị nhưng không tự duyệt; chờ duyệt chưa giảm công nợ; duyệt hai lần chỉ tác động một lần', async () => {
    const { id, f } = enrollmentWithDebt(ctx.db);
    ctx.db.prepare(`UPDATE discounts SET status = 'rejected' WHERE enrollment_id = ? AND status = 'pending'`).run(id);
    const req = await consultant.post(`/api/enrollments/${id}/discount`).send({ kind: 'amount', value: 200000, reason: 'Ưu đãi thử nghiệm' });
    expect(req.status).toBe(201);
    expect(computeFinance(ctx.db, { enrollmentIds: [id] }).get(id).debt).toBe(f.debt);
    const self = await consultant.post(`/api/approvals/${req.body.approvalId}/decide`).send({ decision: 'approved' });
    expect(self.status).toBe(403);
    const [a1, a2] = await Promise.all([
      manager.post(`/api/approvals/${req.body.approvalId}/decide`).send({ decision: 'approved' }),
      manager.post(`/api/approvals/${req.body.approvalId}/decide`).send({ decision: 'approved' }),
    ]);
    expect([a1.status, a2.status].sort()).toEqual([200, 409]);
    const after = computeFinance(ctx.db, { enrollmentIds: [id] }).get(id);
    expect(after.debt).toBe(f.debt - 200000);
    expect(after.installments.reduce((s, i) => s + i.amount, 0)).toBe(after.net);
    expect(ctx.db.prepare(`SELECT COUNT(*) n FROM approval_events WHERE approval_id = ? AND action = 'approved'`).get(req.body.approvalId).n).toBe(1);
  });

  it('hoàn phí: duyệt ≠ đã hoàn; chỉ khi thu ngân xác nhận chi mới ghi nhận; xác nhận hai lần bị chặn', async () => {
    const e = ctx.db.prepare(`SELECT e.id FROM enrollments e WHERE e.status = 'active' AND (SELECT SUM(amount) FROM receipts r WHERE r.enrollment_id = e.id AND r.status='confirmed') > 1000000 LIMIT 1`).get();
    const req = await cashier.post('/api/finance/refunds').send({ enrollment_id: e.id, amount: 500000, reason: 'Hoàn một phần' });
    expect(req.status).toBe(201);
    const over = await cashier.post('/api/finance/refunds').send({ enrollment_id: e.id, amount: 999999999, reason: 'Quá số đã thu' });
    expect(over.status).toBe(400);
    await manager.post(`/api/approvals/${req.body.approvalId}/decide`).send({ decision: 'approved', note: 'OK' });
    let refund = ctx.db.prepare('SELECT * FROM refunds WHERE id = ?').get(req.body.id);
    expect(refund.status).toBe('approved');
    expect(ctx.db.prepare('SELECT payment_status FROM approvals WHERE id = ?').get(req.body.approvalId).payment_status).toBe('unpaid');
    const today = new Date().toISOString().slice(0, 10);
    const sumBefore = (await manager.get(`/api/finance/summary?period=custom&from=${today}&to=${today}`)).body.refunds;
    const p1 = await cashier.post(`/api/approvals/${req.body.approvalId}/pay`).send({ method: 'transfer', paid_at: today });
    expect(p1.status).toBe(200);
    const p2 = await cashier.post(`/api/approvals/${req.body.approvalId}/pay`).send({ method: 'transfer', paid_at: today });
    expect(p2.status).toBe(409);
    refund = ctx.db.prepare('SELECT * FROM refunds WHERE id = ?').get(req.body.id);
    expect(refund.status).toBe('paid');
    const sumAfter = (await manager.get(`/api/finance/summary?period=custom&from=${today}&to=${today}`)).body.refunds;
    expect(sumAfter - sumBefore).toBe(500000);
  });

  it('tổng hợp công nợ trên dashboard khớp danh sách công nợ', async () => {
    const d = (await manager.get('/api/dashboard')).body;
    const r = (await manager.get('/api/finance/receivables?status=due')).body;
    expect(d.kpis.receivablesDue.value).toBe(r.totals.overdue + r.totals.dueSoon);
    const month = d.period;
    const rc = (await manager.get(`/api/finance/receipts?period=custom&from=${month.from}&to=${month.to}`)).body;
    const wl = (await manager.get(`/api/finance/wallet?period=custom&from=${month.from}&to=${month.to}`)).body;
    // Tiền thực thu = phiếu thu (không gồm phiếu "Trừ số dư") + phiếu nạp tiền
    expect(d.kpis.income.value).toBe(rc.total + wl.topupTotal);
  });
});
