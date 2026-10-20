// Kiểm thử các tính năng bổ sung theo CRM: gói phí & tái phí, BTVN/điểm/nhận xét, check-in, bổ trợ học tập,
// số dư (nạp tiền / trừ số dư), đề xuất nghiệp vụ (đổi gói, hủy hợp đồng, chuyển học phí), file đính kèm,
// phễu L0–L5, hiệu suất EC/CM, tag, nhập học viên từ file.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, login } from './helpers.js';
import { computeFinance, financeOf } from '../server/services/finance.js';
import { vnToday } from '../server/lib/time.js';
import { cashIn, balanceOf } from '../server/services/wallet.js';

const KEY = (n) => `test-key-${n}-${Math.random().toString(16).slice(2)}`;
const today = () => vnToday();

describe('Gói phí & tái phí', () => {
  let ctx; let consultant;
  beforeEach(async () => { ctx = makeApp(); consultant = await login(ctx.app, 'tuvan'); });

  it('đăng ký gói 1 năm: học phí = giá gói, 96 buổi, 4 buổi nghỉ không tính phí, 1 lần bảo lưu; học viên mới là "new"; chờ Giám đốc duyệt', async () => {
    const st = (await consultant.post('/api/students').send({ student: { full_name: 'Học viên Gói' }, parent: { mode: 'new', relationship: 'Mẹ', full_name: 'PH Gói', phone: '0000999111' } })).body;
    const pkg = ctx.db.prepare(`SELECT p.* FROM fee_packages p JOIN courses c ON c.id = p.course_id WHERE c.code = 'MV1' AND p.sessions = 96 AND p.kind = 'new'`).get();
    const res = await consultant.post('/api/enrollments').send({ student_id: st.id, course_id: pkg.course_id, package_id: pkg.id, enrolled_at: today(), installments: [{ due_date: today(), amount: pkg.price }] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_approval');
    const e = ctx.db.prepare('SELECT * FROM enrollments WHERE id = ?').get(res.body.id);
    expect(e.tuition_fee).toBe(pkg.price);
    expect(e.total_sessions).toBe(96);
    expect(e.free_absences).toBe(4);
    expect(e.reserve_limit).toBe(1);
    expect(e.kind).toBe('new');
    expect(financeOf(ctx.db, e.id).paymentStatus).toBe('awaiting');
    // Giám đốc từ chối ⇒ đăng ký hủy
    const manager = await login(ctx.app, 'quanly');
    expect((await manager.post(`/api/approvals/${e.approval_id}/decide`).send({ decision: 'rejected' })).status).toBe(400); // phải có lý do
    expect((await manager.post(`/api/approvals/${e.approval_id}/decide`).send({ decision: 'rejected', note: 'Sai giá' })).status).toBe(200);
    expect(ctx.db.prepare('SELECT status FROM enrollments WHERE id = ?').get(e.id).status).toBe('cancelled');
  });

  it('gói phí do trưởng phòng tạo phải chờ Giám đốc duyệt mới bán được', async () => {
    const academic = await login(ctx.app, 'giaovu');
    const manager = await login(ctx.app, 'quanly');
    const course = ctx.db.prepare(`SELECT id FROM courses WHERE code = 'KET'`).get().id;
    const r = await academic.post('/api/packages').send({ course_id: course, name: 'Gói thử nghiệm', kind: 'new', sessions: 30, bonus_sessions: 0, months: 4, price: 7000000, free_absences: 1, reserve_limit: 0 });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    const st = (await consultant.post('/api/students').send({ student: { full_name: 'HV Gói Chờ' }, parent: { mode: 'new', relationship: 'Mẹ', full_name: 'PH Gói Chờ', phone: '0000999333' } })).body;
    const body = { student_id: st.id, course_id: course, package_id: r.body.id, enrolled_at: today(), installments: [{ due_date: today(), amount: 7000000 }] };
    expect((await consultant.post('/api/enrollments').send(body)).status).toBe(400);
    const aid = ctx.db.prepare('SELECT approval_id FROM fee_packages WHERE id = ?').get(r.body.id).approval_id;
    expect((await manager.post(`/api/approvals/${aid}/decide`).send({ decision: 'approved' })).status).toBe(200);
    expect((await consultant.post('/api/enrollments').send(body)).status).toBe(201);
  });

  it('gói phí của khóa khác bị từ chối; lịch thanh toán phải bằng giá gói', async () => {
    const st = (await consultant.post('/api/students').send({ student: { full_name: 'HV Sai Gói' }, parent: { mode: 'new', relationship: 'Mẹ', full_name: 'PH Sai Gói', phone: '0000999222' } })).body;
    const ket = ctx.db.prepare(`SELECT id FROM courses WHERE code = 'KET'`).get().id;
    const mvPkg = ctx.db.prepare(`SELECT p.* FROM fee_packages p JOIN courses c ON c.id = p.course_id WHERE c.code = 'MV1' LIMIT 1`).get();
    const r1 = await consultant.post('/api/enrollments').send({ student_id: st.id, course_id: ket, package_id: mvPkg.id, enrolled_at: today(), installments: [{ due_date: today(), amount: mvPkg.price }] });
    expect(r1.status).toBe(400);
    expect(r1.body.fields.package_id).toBeTruthy();
    const r2 = await consultant.post('/api/enrollments').send({ student_id: st.id, course_id: mvPkg.course_id, package_id: mvPkg.id, enrolled_at: today(), installments: [{ due_date: today(), amount: mvPkg.price - 1000 }] });
    expect(r2.status).toBe(400);
  });

  it('học viên đã từng học ⇒ đăng ký mới là "renew"; có ngày dự kiến hết học phí cho đăng ký đang học', async () => {
    const manager = await login(ctx.app, 'quanly');
    const e = ctx.db.prepare(`SELECT e.* FROM enrollments e WHERE e.status = 'active' AND e.class_id IS NOT NULL LIMIT 1`).get();
    const detail = (await manager.get(`/api/students/${e.student_id}`)).body;
    const en = detail.enrollments.find((x) => x.id === e.id);
    expect(en.expected_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(en.expected_end >= today()).toBe(true);
    const other = ctx.db.prepare(`SELECT p.* FROM fee_packages p WHERE p.kind = 'renew' AND p.status = 'active'
      AND p.course_id NOT IN (SELECT course_id FROM enrollments WHERE student_id = ? AND status NOT IN ('cancelled','completed')) LIMIT 1`).get(e.student_id);
    const res = await consultant.post('/api/enrollments').send({ student_id: e.student_id, course_id: other.course_id, package_id: other.id, enrolled_at: today(), installments: [{ due_date: today(), amount: other.price }] });
    expect(res.status).toBe(201);
    expect(ctx.db.prepare('SELECT kind FROM enrollments WHERE id = ?').get(res.body.id).kind).toBe('renew');
  });
});

describe('BTVN, điểm, nhận xét & bổ trợ học tập', () => {
  let ctx; let teacher; let academic;
  beforeEach(async () => { ctx = makeApp(); teacher = await login(ctx.app, 'giaovien'); academic = await login(ctx.app, 'giaovu'); });

  function todaySessionOfTeacher() {
    return ctx.db.prepare(`SELECT s.* FROM class_sessions s WHERE s.date = ? AND s.teacher_id = 4 AND s.status = 'scheduled'`).get(today());
  }

  it('lưu BTVN/điểm/nhận xét kèm điểm danh; lưu lại không đổi ⇒ 0 thay đổi; chỉ đổi nhận xét không tạo việc chăm sóc', async () => {
    const s = todaySessionOfTeacher();
    const detail = (await teacher.get(`/api/sessions/${s.id}`)).body;
    const records = detail.roster.map((x, i) => ({ student_id: x.id, status: 'present', homework_status: i === 0 ? 'missing' : 'done', homework_score: i === 0 ? '' : 8.5, comment: i === 1 ? 'Phát biểu tốt' : null }));
    const r1 = await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records, topic: 'Unit 5', homework: 'Workbook trang 20' });
    expect(r1.status).toBe(200);
    const a = ctx.db.prepare('SELECT * FROM attendance WHERE session_id = ? AND student_id = ?').get(s.id, records[1].student_id);
    expect(a.homework_status).toBe('done');
    expect(a.homework_score).toBe(8.5);
    expect(a.comment).toBe('Phát biểu tốt');
    expect(ctx.db.prepare('SELECT homework FROM class_sessions WHERE id = ?').get(s.id).homework).toBe('Workbook trang 20');
    const r2 = await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records, topic: 'Unit 5', homework: 'Workbook trang 20' });
    expect(r2.body.changed).toBe(0);
    const cases = ctx.db.prepare('SELECT COUNT(*) n FROM care_cases').get().n;
    records[2].comment = 'Cần luyện phát âm';
    const r3 = await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records, topic: 'Unit 5', homework: 'Workbook trang 20' });
    expect(r3.body.changed).toBe(1);
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM care_cases').get().n).toBe(cases);
  });

  it('điểm BTVN ngoài 0–10 bị từ chối; vắng thì không lưu điểm BTVN', async () => {
    const s = todaySessionOfTeacher();
    const detail = (await teacher.get(`/api/sessions/${s.id}`)).body;
    const bad = detail.roster.map((x) => ({ student_id: x.id, status: 'present', homework_status: 'done', homework_score: 11 }));
    expect((await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records: bad })).status).toBe(400);
    const recs = detail.roster.map((x, i) => ({ student_id: x.id, status: i === 0 ? 'excused' : 'present', homework_status: 'done', homework_score: 9 }));
    await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records: recs });
    const a = ctx.db.prepare('SELECT * FROM attendance WHERE session_id = ? AND student_id = ?').get(s.id, recs[0].student_id);
    expect(a.homework_status).toBeNull();
    expect(a.homework_score).toBeNull();
  });

  it('nhập điểm kiểm tra cả lớp; giáo viên không nhập được lớp người khác; điểm vượt thang bị chặn', async () => {
    const own = ctx.db.prepare('SELECT * FROM classes WHERE teacher_id = 4 AND status = ? LIMIT 1').get('active');
    const other = ctx.db.prepare('SELECT * FROM classes WHERE teacher_id != 4 AND (assistant_id IS NULL OR assistant_id != 4) AND status = ? LIMIT 1').get('active');
    const roster = ctx.db.prepare(`SELECT student_id FROM enrollments WHERE class_id = ? AND status = 'active'`).all(own.id);
    const body = (cls, sc) => ({ class_id: cls.id, title: 'Kiểm tra thử', kind: 'unit', taken_at: today(), max_score: 10, scores: roster.map((x) => ({ student_id: x.student_id, score: sc })) });
    expect((await teacher.post('/api/learning/assessments').send(body(other, 8))).status).toBe(403);
    expect((await teacher.post('/api/learning/assessments').send(body(own, 12))).status).toBe(400);
    const ok = await teacher.post('/api/learning/assessments').send(body(own, 7.5));
    expect(ok.status).toBe(201);
    expect(ok.body.count).toBe(roster.length);
    expect((await teacher.post('/api/learning/assessments').send(body(own, 7.5))).status).toBe(409);
    const list = (await academic.get(`/api/learning/assessments?class_id=${own.id}`)).body.items;
    expect(list.filter((x) => x.title === 'Kiểm tra thử').length).toBe(roster.length);
  });

  it('bổ trợ học tập: học viên học yếu được gợi ý; xác nhận tạo việc chăm sóc "Bổ trợ học tập"; không xác nhận trùng', async () => {
    const res = (await academic.get('/api/learning/support')).body;
    const needed = res.items.filter((x) => x.state === 'needed');
    expect(needed.length).toBeGreaterThan(0);
    expect(needed[0].reasons.length).toBeGreaterThan(0);
    const st = needed[0];
    const r1 = await academic.post('/api/learning/support').send({ student_id: st.id, month: res.month, status: 'confirmed', note: 'Kèm thêm 2 buổi/tuần' });
    expect(r1.status).toBe(201);
    const c = ctx.db.prepare('SELECT * FROM care_cases WHERE id = ?').get(r1.body.caseId);
    expect(c.type).toBe('support');
    expect((await academic.post('/api/learning/support').send({ student_id: st.id, month: res.month, status: 'confirmed' })).status).toBe(409);
    expect((await academic.post('/api/learning/support').send({ student_id: needed[1]?.id || st.id, month: res.month, status: 'not_needed' })).status).toBe(400);
  });

  it('danh sách chưa chấm BTVN/nhận xét có dữ liệu mẫu; giáo viên chỉ thấy lớp mình', async () => {
    const all = (await academic.get('/api/learning/todo')).body;
    expect(all.ungraded.length).toBeGreaterThan(0);
    const mine = (await teacher.get('/api/learning/todo')).body;
    const myClasses = ctx.db.prepare('SELECT id FROM classes WHERE teacher_id = 4 OR assistant_id = 4').all().map((x) => x.id);
    for (const s of mine.ungraded) expect(myClasses).toContain(s.class_id);
  });
});

describe('Check-in tại quầy', () => {
  it('check-in một lần/ngày (gọi lại không trùng); thu ngân được, giáo viên không; hoàn tác trong ngày', async () => {
    const ctx = makeApp();
    const cashier = await login(ctx.app, 'thungan');
    const teacher = await login(ctx.app, 'giaovien');
    const list = (await cashier.get('/api/learning/checkins')).body;
    expect(list.total).toBeGreaterThan(0);
    const sid = list.items.find((x) => !x.checkin).id;
    const r1 = await cashier.post('/api/learning/checkins').send({ student_id: sid });
    expect(r1.status).toBe(201);
    const r2 = await cashier.post('/api/learning/checkins').send({ student_id: sid });
    expect(r2.body.duplicate).toBe(true);
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM checkins WHERE student_id = ? AND date = ?').get(sid, vnToday()).n).toBe(1);
    expect((await teacher.post('/api/learning/checkins').send({ student_id: sid })).status).toBe(403);
    expect((await cashier.del(`/api/learning/checkins/${r1.body.id}`)).status).toBe(200);
  });
});

describe('Số dư: nạp tiền, trừ số dư', () => {
  let ctx; let cashier;
  beforeEach(async () => { ctx = makeApp(); cashier = await login(ctx.app, 'thungan'); });

  it('nạp tiền (idempotent) → dùng số dư đóng học phí: công nợ giảm, tiền thực thu không bị cộng hai lần', async () => {
    const fin = computeFinance(ctx.db);
    const [eid, f] = [...fin.entries()].find(([id, x]) => x.debt > 1000000 && ctx.db.prepare('SELECT status FROM enrollments WHERE id = ?').get(id).status === 'active');
    const e = ctx.db.prepare('SELECT * FROM enrollments WHERE id = ?').get(eid);
    const before = cashIn(ctx.db, today(), today()).total;
    const key = KEY('topup');
    const body = { student_id: e.student_id, amount: 1000000, paid_at: today(), method: 'cash' };
    const t1 = await cashier.post('/api/finance/wallet/topup').set('Idempotency-Key', key).send(body);
    const t2 = await cashier.post('/api/finance/wallet/topup').set('Idempotency-Key', key).send(body);
    expect(t1.status).toBe(201);
    expect(t2.body.duplicate).toBe(true);
    const bal0 = balanceOf(ctx.db, e.student_id);
    expect(bal0).toBeGreaterThanOrEqual(1000000);
    expect((await cashier.post('/api/finance/wallet/apply').set('Idempotency-Key', KEY('ap')).send({ enrollment_id: eid, amount: bal0 + 1 })).status).toBe(400);
    const ap = await cashier.post('/api/finance/wallet/apply').set('Idempotency-Key', KEY('ap')).send({ enrollment_id: eid, amount: 1000000 });
    expect(ap.status).toBe(201);
    expect(financeOf(ctx.db, eid).debt).toBe(f.debt - 1000000);
    expect(balanceOf(ctx.db, e.student_id)).toBe(bal0 - 1000000);
    expect(ctx.db.prepare('SELECT method FROM receipts WHERE id = ?').get(ap.body.id).method).toBe('wallet');
    // Tiền thực thu hôm nay tăng đúng 1.000.000 (phiếu nạp), không tăng thêm phiếu trừ số dư
    expect(cashIn(ctx.db, today(), today()).total).toBe(before + 1000000);
    // Hủy phiếu nạp bị chặn vì số dư đã dùng; hủy phiếu trừ số dư ⇒ trả lại số dư
    const topupId = ctx.db.prepare('SELECT id FROM wallet_entries WHERE code = ?').get(t1.body.code).id;
    expect((await cashier.post(`/api/finance/wallet/${topupId}/cancel`).send({ reason: 'Nhập nhầm' })).status).toBe(409);
    expect((await cashier.post(`/api/finance/receipts/${ap.body.id}/cancel`).send({ reason: 'Trừ nhầm' })).status).toBe(200);
    expect(balanceOf(ctx.db, e.student_id)).toBe(bal0);
    expect((await cashier.post(`/api/finance/wallet/${topupId}/cancel`).send({ reason: 'Nhập nhầm' })).status).toBe(200);
  });
});

describe('Đề xuất nghiệp vụ cần duyệt', () => {
  let ctx; let consultant; let manager; let cashier; let teacher;
  beforeEach(async () => {
    ctx = makeApp();
    consultant = await login(ctx.app, 'tuvan'); manager = await login(ctx.app, 'quanly'); cashier = await login(ctx.app, 'thungan'); teacher = await login(ctx.app, 'giaovien');
  });

  it('đổi gói phí: duyệt ⇒ học phí, số buổi theo gói mới và thêm đợt thanh toán phần chênh lệch', async () => {
    const e = ctx.db.prepare(`SELECT e.* FROM enrollments e JOIN fee_packages p ON p.id = e.package_id WHERE e.status = 'active' AND p.sessions = 24 AND p.kind = 'new'
      AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.status = 'pending' AND json_extract(a.payload, '$.enrollment_id') = e.id) LIMIT 1`).get();
    const p2 = ctx.db.prepare(`SELECT * FROM fee_packages WHERE course_id = ? AND sessions = 96 AND kind = 'new'`).get(e.course_id);
    const r = await consultant.post('/api/approvals/requests').send({ type: 'package_change', enrollment_id: e.id, package_id: p2.id, reason: 'Phụ huynh muốn học dài hạn' });
    expect(r.status).toBe(201);
    expect((await consultant.post('/api/approvals/requests').send({ type: 'reserve', enrollment_id: e.id, reason: 'x', from: today(), to: today() })).status).toBe(409);
    const d = await manager.post(`/api/approvals/${r.body.approvalId}/decide`).send({ decision: 'approved' });
    expect(d.status).toBe(200);
    const after = ctx.db.prepare('SELECT * FROM enrollments WHERE id = ?').get(e.id);
    expect(after.tuition_fee).toBe(p2.price);
    expect(after.total_sessions).toBe(p2.sessions + p2.bonus_sessions);
    expect(after.free_absences).toBe(4);
    expect(after.reserve_limit).toBe(1);
    const plan = ctx.db.prepare('SELECT COALESCE(SUM(amount),0) s FROM installments WHERE enrollment_id = ?').get(e.id).s;
    expect(plan).toBe(financeOf(ctx.db, e.id).net);
  });

  it('hủy hợp đồng kèm hoàn phí: duyệt ⇒ đăng ký hủy, hoàn phí chờ chi; thu ngân chi ⇒ hoàn phí đã chi', async () => {
    const fin = computeFinance(ctx.db);
    const [eid, f] = [...fin.entries()].find(([id, x]) => x.paid > 2000000 && ctx.db.prepare('SELECT status FROM enrollments WHERE id = ?').get(id).status === 'active');
    expect((await consultant.post('/api/approvals/requests').send({ type: 'contract_cancel', enrollment_id: eid, amount: f.paid + 1000, reason: 'Chuyển nhà' })).status).toBe(400);
    const r = await consultant.post('/api/approvals/requests').send({ type: 'contract_cancel', enrollment_id: eid, amount: 1000000, reason: 'Chuyển nhà' });
    expect(r.status).toBe(201);
    const d = await manager.post(`/api/approvals/${r.body.approvalId}/decide`).send({ decision: 'approved' });
    expect(d.body.approval.payment_status).toBe('unpaid');
    expect(ctx.db.prepare('SELECT status FROM enrollments WHERE id = ?').get(eid).status).toBe('cancelled');
    const rf = ctx.db.prepare('SELECT * FROM refunds WHERE approval_id = ?').get(r.body.approvalId);
    expect(rf.status).toBe('approved');
    const pay = await cashier.post(`/api/approvals/${r.body.approvalId}/pay`).send({ method: 'transfer', paid_at: today() });
    expect(pay.status).toBe(200);
    expect(ctx.db.prepare('SELECT status FROM refunds WHERE id = ?').get(rf.id).status).toBe('paid');
  });

  it('chuyển học phí (số dư) giữa hai học viên: kiểm tra lại số dư khi duyệt', async () => {
    const from = ctx.db.prepare(`SELECT student_id FROM wallet_entries WHERE kind = 'topup' AND status = 'confirmed' LIMIT 1`).get().student_id;
    const to = ctx.db.prepare('SELECT id FROM students WHERE id != ? LIMIT 1').get(from).id;
    const bal = balanceOf(ctx.db, from);
    expect((await consultant.post('/api/approvals/requests').send({ type: 'fee_transfer', from_student_id: from, to_student_id: to, amount: bal + 1000, reason: 'Chuyển cho em' })).status).toBe(400);
    const r = await consultant.post('/api/approvals/requests').send({ type: 'fee_transfer', from_student_id: from, to_student_id: to, amount: 500000, reason: 'Chuyển cho em' });
    expect(r.status).toBe(201);
    await manager.post(`/api/approvals/${r.body.approvalId}/decide`).send({ decision: 'approved' });
    expect(balanceOf(ctx.db, from)).toBe(bal - 500000);
    expect(balanceOf(ctx.db, to)).toBeGreaterThanOrEqual(500000);
    // Duyệt khi số dư không còn đủ ⇒ báo lỗi, đề xuất vẫn chờ duyệt
    const r2 = await consultant.post('/api/approvals/requests').send({ type: 'fee_transfer', from_student_id: from, to_student_id: to, amount: bal - 500000, reason: 'Chuyển nốt' });
    ctx.db.prepare(`INSERT INTO wallet_entries(code, student_id, kind, amount, paid_at, status, created_at) VALUES ('SD-TEST', ?, 'transfer_out', ?, ?, 'confirmed', ?)`).run(from, -(bal - 500000), today(), new Date().toISOString());
    expect((await manager.post(`/api/approvals/${r2.body.approvalId}/decide`).send({ decision: 'approved' })).status).toBe(409);
    expect(ctx.db.prepare('SELECT status FROM approvals WHERE id = ?').get(r2.body.approvalId).status).toBe('pending');
  });

  it('cơ sở vật chất không gửi được đề nghị nghiệp vụ; CM gửi chuyển lớp ⇒ Trưởng phòng học thuật duyệt cấp 1 ⇒ Giám đốc duyệt cuối', async () => {
    const ops = await login(ctx.app, 'vanhanh');
    const academic = await login(ctx.app, 'giaovu');
    const e = ctx.db.prepare(`SELECT e.* FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.status = 'active' AND c.code = 'ST1-A'
      AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.status = 'pending' AND json_extract(a.payload, '$.enrollment_id') = e.id) LIMIT 1`).get();
    expect((await ops.post('/api/approvals/requests').send({ type: 'class_transfer', enrollment_id: e.id, reason: 'x' })).status).toBe(403);
    // Lớp đích cùng khóa ST1: tạo nhanh một lớp còn chỗ
    const st1 = ctx.db.prepare(`SELECT * FROM classes WHERE code = 'ST1-A'`).get();
    const newCls = await academic.post('/api/classes').send({ code: 'ST1-B', name: 'Starters 1 – B', course_id: st1.course_id, room_id: 4, teacher_id: 8, max_students: 10, start_date: today(), schedule: [{ weekday: 7, start: '07:00', end: '08:00' }] });
    expect(newCls.status).toBe(201);
    const r = await teacher.post('/api/approvals/requests').send({ type: 'class_transfer', enrollment_id: e.id, class_id: newCls.body.id, reason: 'Trùng lịch học bơi' });
    expect(r.status).toBe(201);
    const a0 = ctx.db.prepare('SELECT * FROM approvals WHERE id = ?').get(r.body.approvalId);
    expect(a0.stage).toBe('lead');
    // Giám đốc chưa thấy trong "chờ duyệt" (chưa qua trưởng phòng); trưởng phòng thấy
    expect((await manager.get('/api/approvals?view=to_decide')).body.items.some((x) => x.id === a0.id)).toBe(false);
    expect((await academic.get('/api/approvals?view=to_decide')).body.items.some((x) => x.id === a0.id)).toBe(true);
    expect((await academic.post(`/api/approvals/${a0.id}/decide`).send({ decision: 'approved', note: 'Đồng ý' })).status).toBe(200);
    const a1 = ctx.db.prepare('SELECT * FROM approvals WHERE id = ?').get(a0.id);
    expect(a1.status).toBe('pending');
    expect(a1.stage).toBe('final');
    expect(ctx.db.prepare('SELECT class_id FROM enrollments WHERE id = ?').get(e.id).class_id).toBe(e.class_id); // chưa có hiệu lực
    expect((await academic.post(`/api/approvals/${a0.id}/decide`).send({ decision: 'approved' })).status).toBe(403);
    expect((await manager.post(`/api/approvals/${a0.id}/decide`).send({ decision: 'approved' })).status).toBe(200);
    expect(ctx.db.prepare('SELECT class_id FROM enrollments WHERE id = ?').get(e.id).class_id).toBe(newCls.body.id);
  });

  it('lên level mới: chuyển đăng ký sang khóa cao hơn, giữ học phí và số buổi đã học', async () => {
    const lv = ctx.db.prepare(`SELECT * FROM approvals WHERE type = 'level_up' AND status = 'pending'`).get();
    const p = JSON.parse(lv.payload);
    const before = ctx.db.prepare('SELECT * FROM enrollments WHERE id = ?').get(p.enrollment_id);
    const academic = await login(ctx.app, 'giaovu');
    expect((await academic.post(`/api/approvals/${lv.id}/decide`).send({ decision: 'approved' })).status).toBe(200);
    expect((await manager.post(`/api/approvals/${lv.id}/decide`).send({ decision: 'approved' })).status).toBe(200);
    const after = ctx.db.prepare('SELECT * FROM enrollments WHERE id = ?').get(p.enrollment_id);
    expect(after.course_id).toBe(p.course_id);
    expect(after.class_id).toBe(p.class_id);
    expect(after.tuition_fee).toBe(before.tuition_fee);
  });

  it('file đính kèm: tải lên, tải về đúng nội dung; chặn định dạng lạ', async () => {
    const r = await manager.get('/api/approvals?view=to_decide');
    const a = r.body.items.find((x) => x.requested_by !== 1);
    const own = await consultant.post('/api/approvals/requests').send({ type: 'contract_cancel', enrollment_id: ctx.db.prepare(`SELECT e.id FROM enrollments e WHERE e.status = 'active' AND NOT EXISTS (SELECT 1 FROM approvals p WHERE p.status = 'pending' AND json_extract(p.payload, '$.enrollment_id') = e.id) LIMIT 1`).get().id, reason: 'Ốm dài ngày' });
    const content = Buffer.from('%PDF-1.4 bao gia demo');
    const up = await consultant.post(`/api/approvals/${own.body.approvalId}/files`).send({ name: 'bao-gia.pdf', mime: 'application/pdf', data: content.toString('base64') });
    expect(up.status).toBe(201);
    expect((await consultant.post(`/api/approvals/${own.body.approvalId}/files`).send({ name: 'x.exe', mime: 'application/x-msdownload', data: content.toString('base64') })).status).toBe(400);
    const dl = await manager.get(`/api/approvals/${own.body.approvalId}/files/${up.body.id}`).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body, content)).toBe(0);
    const detail = (await manager.get(`/api/approvals/${own.body.approvalId}`)).body;
    expect(detail.files.length).toBe(1);
    expect(a).toBeTruthy();
  });
});

describe('Phễu L0–L5, hiệu suất EC/CM, tag, nhập file, báo cáo', () => {
  let ctx; let manager; let consultant; let teacher;
  beforeEach(async () => { ctx = makeApp(); manager = await login(ctx.app, 'quanly'); consultant = await login(ctx.app, 'tuvan'); teacher = await login(ctx.app, 'giaovien'); });

  it('phễu: khách đã đăng ký và đóng đủ là L5, chưa đủ là L4; bộ đếm khớp số khách đang theo dõi', async () => {
    const r = (await manager.get('/api/leads?status=all')).body;
    const total = Object.values(r.levelCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(ctx.db.prepare(`SELECT COUNT(*) n FROM leads WHERE status != 'unfit'`).get().n);
    // Tư vấn viên chỉ đếm khách của mình
    const mine = (await consultant.get('/api/leads?status=all')).body;
    expect(Object.values(mine.levelCounts).reduce((a, b) => a + b, 0)).toBe(ctx.db.prepare(`SELECT COUNT(*) n FROM leads WHERE status != 'unfit' AND (owner_id = 2 OR created_by = 2)`).get().n);
    for (const l of r.items.filter((x) => x.status === 'enrolled')) {
      const e = ctx.db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND status != 'cancelled' ORDER BY enrolled_at, id LIMIT 1`).get(l.converted_student_id);
      expect(l.level).toBe(financeOf(ctx.db, e.id).debt === 0 ? 'L5' : 'L4');
    }
    const l4 = (await manager.get('/api/leads?status=all&level=L4')).body.items;
    expect(l4.every((x) => x.level === 'L4')).toBe(true);
  });

  it('hiệu suất EC/CM: có dòng cho tư vấn viên và chủ nhiệm; giáo viên không xem được', async () => {
    const ec = (await manager.get('/api/performance/ec')).body;
    expect(ec.rows.map((x) => x.id)).toContain(2);
    const cm = (await manager.get('/api/performance/cm')).body;
    const lan = cm.rows.find((x) => x.id === 3);
    expect(lan.classes).toBeGreaterThan(0);
    expect(lan.fullfee + lan.deposit + lan.unpaid).toBe(lan.students);
    expect((await teacher.get('/api/performance/ec')).status).toBe(403);
  });

  it('tag: gắn, lọc danh sách theo tag', async () => {
    const st = ctx.db.prepare('SELECT id FROM students LIMIT 1').get();
    const r = await manager.put(`/api/students/${st.id}/tags`).send({ tags: ['VIP', ' Thi chứng chỉ ', 'VIP'] });
    expect(r.body.tags).toEqual(['VIP', 'Thi chứng chỉ']);
    const list = (await manager.get('/api/students?status=all&tag=VIP')).body.items;
    expect(list.map((x) => x.id)).toContain(st.id);
    expect(list.every((x) => x.tags.includes('VIP'))).toBe(true);
  });

  it('nhập học viên từ file: kiểm tra trước, chỉ tạo dòng hợp lệ, liên kết phụ huynh có sẵn theo SĐT', async () => {
    const parent = ctx.db.prepare('SELECT * FROM parents LIMIT 1').get();
    const rows = [
      { student_name: 'Nguyễn Văn Nhập', dob: '15/03/2016', gender: 'Nam', parent_name: 'Trần Thị Nhập', phone: '0000 888 001', relationship: 'Mẹ', tags: 'VIP; Anh chị em' },
      { student_name: 'Con Thứ Hai', dob: '2015-01-01', parent_name: parent.full_name, phone: parent.phone },
      { student_name: '', parent_name: 'Thiếu tên', phone: '0000888002' },
      { student_name: 'Sai Số', parent_name: 'PH', phone: '12345' },
      { student_name: 'Nguyễn Văn Nhập', parent_name: 'Trần Thị Nhập', phone: '0000888001' },
    ];
    const dry = (await consultant.post('/api/students/import').send({ rows, commit: false })).body;
    expect(dry.valid).toBe(2);
    expect(dry.invalid).toBe(3);
    expect(dry.results[1].warnings.join(' ')).toMatch(/phụ huynh có sẵn/);
    expect(dry.created).toBe(0);
    const before = ctx.db.prepare('SELECT COUNT(*) n FROM students').get().n;
    const done = (await consultant.post('/api/students/import').send({ rows, commit: true })).body;
    expect(done.created).toBe(2);
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM students').get().n).toBe(before + 2);
    const linked = ctx.db.prepare(`SELECT sc.parent_id FROM students s JOIN student_contacts sc ON sc.student_id = s.id WHERE s.full_name = 'Con Thứ Hai'`).get();
    expect(linked.parent_id).toBe(parent.id);
    expect(ctx.db.prepare(`SELECT tags, dob, gender FROM students WHERE full_name = 'Nguyễn Văn Nhập'`).get()).toEqual({ tags: 'VIP,Anh chị em', dob: '2016-03-15', gender: 'male' });
    expect((await teacher.post('/api/students/import').send({ rows, commit: false })).status).toBe(403);
  });

  it('báo cáo mới mở được; Live trên tổng quan có doanh số mới/tái phí và tới hạn tái phí', async () => {
    for (const t of ['sales', 'renewal', 'learning', 'checkin']) {
      const r = await manager.get(`/api/reports/${t}?period=month`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.rows)).toBe(true);
    }
    const d = (await manager.get('/api/dashboard')).body;
    expect(d.live.sales).toBeTruthy();
    expect(d.live.renewal.thisMonth).toBeInstanceOf(Array);
    expect(d.live.learning.ungradedCount).toBeGreaterThan(0);
  });
});
