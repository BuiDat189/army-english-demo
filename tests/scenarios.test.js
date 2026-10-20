import { describe, it, expect } from 'vitest';
import { makeApp, login } from './helpers.js';
import { vnToday, addDays } from '../server/lib/time.js';
import { sessionStudentIds } from '../server/services/schedule.js';
import { csvCell, toCsv } from '../server/lib/csv.js';

describe('Kịch bản 1: Data khách → Check-in → Học thử → Đăng ký (GĐ duyệt học phí) → Thu tiền → Xếp lớp', () => {
  it('chạy trọn vẹn qua API, dữ liệu liên thông, không tạo trùng khi gửi lại', async () => {
    const { app, db } = makeApp();
    const consultant = await login(app, 'tuvan');
    const otherEc = await login(app, 'yen');
    const cashier = await login(app, 'thungan');
    const academic = await login(app, 'giaovu');
    const manager = await login(app, 'quanly');
    const today = vnToday();
    const dash0 = (await manager.get('/api/dashboard')).body;

    // 1. EC nhập data khách: nguồn theo danh mục trung tâm, bắt buộc ngày liên hệ lại
    const base = { parent_name: 'Phạm Thu Trang', phone: '0000 999 001', email: 'kichban1@example.com', student_name: 'Phạm Minh Khang', student_dob: '2017-05-20', interest_course_id: 3, source: 'Fanpage' };
    expect((await consultant.post('/api/leads').send({ ...base, source: 'Facebook', next_contact_at: `${today} 10:00` })).status).toBe(400);
    expect((await consultant.post('/api/leads').send(base)).status).toBe(400); // thiếu ngày liên hệ lại
    const lead = await consultant.post('/api/leads').send({ ...base, next_contact_at: `${addDays(today, 1)} 10:00` });
    expect(lead.status).toBe(201);
    const leadId = lead.body.id;
    expect(db.prepare('SELECT status FROM leads WHERE id = ?').get(leadId).status).toBe('potential');
    // 2. Ghi tư vấn + phân loại "Đang lên hẹn"
    expect((await consultant.post(`/api/leads/${leadId}/activities`).send({ type: 'call', content: 'Tư vấn lộ trình Movers', status: 'appointing', next_contact_at: `${addDays(today, 1)} 10:00` })).status).toBe(201);
    // 3. Đăng ký check-in ⇒ "Đề xuất cần xử lý" cho TẤT CẢ CM
    const cms = db.prepare(`SELECT DISTINCT homeroom_id AS id FROM classes WHERE homeroom_id IS NOT NULL AND status IN ('active','planned')`).all().map((x) => x.id);
    const bk = await consultant.post(`/api/leads/${leadId}/book-checkin`).send({ checkin_at: `${today} 18:00` });
    expect(bk.status).toBe(200);
    expect(bk.body.notified).toBe(cms.length);
    expect(db.prepare(`SELECT COUNT(*) n FROM tasks WHERE related_type = 'lead' AND related_id = ? AND status = 'todo'`).get(leadId).n).toBe(cms.length);
    // 4. Khách check-in: tư vấn viên check-in trước giữ khách; nhân sự khác không tạo trùng để "giành" khách
    expect((await consultant.post(`/api/leads/${leadId}/checkin`).send({})).status).toBe(200);
    expect((await consultant.post(`/api/leads/${leadId}/checkin`).send({})).status).toBe(409);
    const l1 = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    expect(l1.status).toBe('checked_in');
    expect(l1.owner_locked).toBe(1);
    expect(l1.owner_id).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) n FROM tasks WHERE related_type = 'lead' AND related_id = ? AND status != 'done'`).get(leadId).n).toBe(0);
    const grab = await otherEc.post('/api/leads').send({ ...base, next_contact_at: `${addDays(today, 1)} 10:00` });
    expect(grab.status).toBe(409);
    // EC khác không thấy khách của người khác
    expect((await otherEc.get(`/api/leads/${leadId}`)).status).toBe(404);
    // 5. Đăng ký học thử lớp MV1-A ⇒ đề xuất cho CM của lớp
    const mv1a = db.prepare(`SELECT id, homeroom_id FROM classes WHERE code = 'MV1-A'`).get();
    const sess = db.prepare(`SELECT id FROM class_sessions WHERE class_id = ? AND date >= ? AND status = 'scheduled' ORDER BY date LIMIT 1`).get(mv1a.id, today);
    const trial = await consultant.post(`/api/leads/${leadId}/trials`).send({ type: 'trial', session_id: sess.id });
    expect(trial.status).toBe(201);
    expect(db.prepare('SELECT status, trial_class_id FROM leads WHERE id = ?').get(leadId)).toEqual({ status: 'trial_booked', trial_class_id: mv1a.id });
    expect(db.prepare(`SELECT assignee_id FROM tasks WHERE source_key = ?`).get(`lead-trial:${leadId}:${trial.body.id}`).assignee_id).toBe(mv1a.homeroom_id);
    // 6. Kết quả học thử
    const res = await consultant.post(`/api/leads/trials/${trial.body.id}/result`).send({ status: 'done', result_level: 'A1 Movers', recommended_course_id: 3, teacher_comment: 'Phù hợp Movers' });
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT status FROM leads WHERE id = ?').get(leadId).status).toBe('trial_done');
    // 7. Chuyển thành học viên + đăng ký gói 1 năm (96 buổi) ⇒ học phí chờ Giám đốc duyệt
    const pkg = db.prepare(`SELECT * FROM fee_packages WHERE course_id = 3 AND sessions = 96 AND kind = 'new' AND status = 'active'`).get();
    const fee = pkg.price;
    const body = {
      student: { full_name: 'Phạm Minh Khang', dob: '2017-05-20', gender: 'male' },
      parent: { mode: 'new', full_name: 'Phạm Thu Trang', phone: '0000999001', email: 'kichban1@example.com', relationship: 'Mẹ' },
      enrollment: { course_id: 3, package_id: pkg.id, enrolled_at: today, installments: [{ due_date: today, amount: fee / 2 }, { due_date: addDays(today, 30), amount: fee / 2 }] },
    };
    const [c1, c2] = await Promise.all([consultant.post(`/api/leads/${leadId}/convert`).send(body), consultant.post(`/api/leads/${leadId}/convert`).send(body)]);
    const created = c1.status === 201 ? c1 : c2;
    const repeated = c1.status === 201 ? c2 : c1;
    expect(created.status).toBe(201);
    expect(repeated.status).toBe(200);
    expect(repeated.body.already).toBe(true);
    expect(repeated.body.studentId).toBe(created.body.studentId);
    expect(db.prepare('SELECT COUNT(*) n FROM students WHERE lead_id = ?').get(leadId).n).toBe(1);
    const { studentId, enrollmentId } = created.body;
    const e0 = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
    expect(e0.status).toBe('pending_approval');
    expect(e0.free_absences).toBe(4);
    expect(e0.reserve_limit).toBe(1);
    expect(e0.sold_by).toBe(2);
    // Chưa duyệt ⇒ chưa thu được (khách đặt cọc thì ghi "Nạp tiền")
    expect((await cashier.post('/api/finance/receipts').set('Idempotency-Key', 'scenario-1-receipt-000').send({ enrollment_id: enrollmentId, amount: 2000000, paid_at: today, method: 'transfer' })).status).toBe(409);
    const ap = db.prepare(`SELECT id FROM approvals WHERE type = 'enrollment' AND ref_id = ?`).get(enrollmentId).id;
    expect((await academic.post(`/api/approvals/${ap}/decide`).send({ decision: 'approved' })).status).toBe(403);
    expect((await manager.post(`/api/approvals/${ap}/decide`).send({ decision: 'approved' })).status).toBe(200);
    expect(db.prepare('SELECT status FROM enrollments WHERE id = ?').get(enrollmentId).status).toBe('pending_class');
    // 8. Thu một phần học phí — quẹt thẻ phải có CCCD, ngày cấp thẻ, đơn vị cấp
    const card = { enrollment_id: enrollmentId, amount: 2000000, paid_at: today, method: 'card' };
    expect((await cashier.post('/api/finance/receipts').set('Idempotency-Key', 'scenario-1-receipt-card').send(card)).status).toBe(400);
    const r = await cashier.post('/api/finance/receipts').set('Idempotency-Key', 'scenario-1-receipt-001').send({ ...card, card_id_no: '000123456789', card_issue_date: addDays(today, -500), card_issuer: 'Ngân hàng Demo' });
    expect(r.status).toBe(201);
    expect(r.body.finance.debt).toBe(fee - 2000000);
    expect(db.prepare('SELECT card_issuer FROM receipts WHERE id = ?').get(r.body.id).card_issuer).toBe('Ngân hàng Demo');
    expect(r.body.finance.paymentStatus).toBe('due_soon');
    expect(r.body.finance.installments[0].remaining).toBe(fee / 2 - 2000000);
    // 9. Xếp lớp
    const occ0 = (await academic.get(`/api/classes/${mv1a.id}`)).body.class.occupancy;
    const a = await academic.post(`/api/enrollments/${enrollmentId}/assign-class`).send({ class_id: mv1a.id });
    expect(a.status).toBe(200);

    // Kiểm tra liên thông
    const st = (await manager.get(`/api/students/${studentId}`)).body;
    expect(st.student.full_name).toBe('Phạm Minh Khang');
    expect(st.contacts[0].phone).toBe('0000999001');
    expect(st.enrollments[0].class_code).toBe('MV1-A');
    expect(st.enrollments[0].finance.debt).toBe(fee - 2000000);
    expect(st.timeline.some((t) => t.kind === 'lead')).toBe(true);
    expect(st.timeline.some((t) => t.kind === 'trial')).toBe(true);
    const cls = (await academic.get(`/api/classes/${mv1a.id}`)).body;
    expect(cls.class.occupancy).toBe(occ0 + 1);
    expect(cls.students.some((s) => s.id === studentId)).toBe(true);
    const dash1 = (await manager.get('/api/dashboard')).body;
    expect(dash1.kpis.studying.value).toBe(dash0.kpis.studying.value + 1);
    expect(dash1.kpis.income.value).toBe(dash0.kpis.income.value + 2000000);
    expect(dash1.kpis.leadsOpen.value).toBe(dash0.kpis.leadsOpen.value);
    // Báo cáo ngày của kế toán: check-in hôm nay tăng 1, thực thu ngày tăng 2.000.000
    const daily = (await cashier.get(`/api/reports/daily?period=custom&from=${today}&to=${today}`)).body;
    expect(daily.rows[0].checkins).toBeGreaterThanOrEqual(1);
    expect(daily.rows[0].cash_day).toBe(dash1.work.cash.today);
  });
});

describe('Kịch bản 2: Điểm danh → Chăm sóc → Học bù', () => {
  it('liên kết đúng học viên và buổi nghỉ; không trùng việc/điểm danh; số buổi đúng quy tắc', async () => {
    const { app, db } = makeApp();
    const teacher = await login(app, 'giaovien');
    const academic = await login(app, 'giaovu');
    const today = vnToday();
    const s = db.prepare(`SELECT * FROM class_sessions WHERE date = ? AND teacher_id = 4 AND status = 'scheduled' LIMIT 1`).get(today);
    const ids = sessionStudentIds(db, s.id);
    const absentee = ids[1];
    const enr = db.prepare(`SELECT id FROM enrollments WHERE class_id = ? AND student_id = ? AND status = 'active'`).get(s.class_id, absentee).id;
    const u0 = (await academic.get(`/api/students/${absentee}`)).body.enrollments.find((e) => e.id === enr).usage;
    const used0 = u0.used;
    const freeUsed0 = u0.freeUsed;

    const save = () => teacher.put(`/api/sessions/${s.id}/attendance`).send({ records: ids.map((id) => ({ student_id: id, status: id === absentee ? 'excused' : 'present', note: id === absentee ? 'Ốm' : null })) });
    const r1 = await save();
    await save();
    expect(r1.body.careCreated).toBe(1);
    const att = db.prepare('SELECT id FROM attendance WHERE session_id = ? AND student_id = ?').get(s.id, absentee);
    const cases = (await academic.get('/api/care?type=absence&status=all')).body.items.filter((c) => c.attendance_id === att.id);
    expect(cases.length).toBe(1);
    const care = cases[0];
    expect(care.student_id).toBe(absentee);
    // Ghi kết quả liên hệ
    expect((await academic.post(`/api/care/${care.id}/logs`).send({ channel: 'call', content: 'Hỏi thăm, bé ốm', result: 'Phụ huynh muốn học bù cuối tuần' })).status).toBe(201);
    // Xếp học bù
    const opts = (await academic.get(`/api/sessions/makeup/options?attendance_id=${att.id}`)).body.items.filter((o) => !o.full && !o.conflict);
    const m = opts.length
      ? await academic.post('/api/sessions/makeup').send({ attendance_id: att.id, session_id: opts[0].id })
      : await academic.post('/api/sessions/makeup').send({ attendance_id: att.id, new_session: { date: addDays(today, 2), start_time: '08:00', end_time: '09:00', room_id: 4, teacher_id: 10 } });
    expect(m.status).toBe(201);
    const detail = (await academic.get(`/api/care/${care.id}`)).body;
    expect(detail.case.makeup_status).toBe('scheduled');
    expect(detail.logs.length).toBe(2); // ghi liên hệ + ghi chú tự động "đã xếp học bù"
    const sessionDetail = (await academic.get(`/api/sessions/${m.body.sessionId}`)).body;
    expect(sessionDetail.roster.some((x) => x.id === absentee && x.makeup?.absence_attendance_id === att.id)).toBe(true);
    // Nghỉ có phép vẫn tính là nghỉ: trừ 1 buổi, trừ khi còn hạn mức nghỉ không tính phí của gói
    const u1 = (await academic.get(`/api/students/${absentee}`)).body.enrollments.find((e) => e.id === enr).usage;
    expect(u1.used - used0).toBe(u1.freeUsed > freeUsed0 ? 0 : 1);
    expect(db.prepare('SELECT COUNT(*) n FROM attendance WHERE session_id = ?').get(s.id).n).toBe(ids.length);
  });
});

describe('Kịch bản 3: Báo hỏng → Đề xuất → Phê duyệt', () => {
  it('trạng thái liên thông, có lịch sử, duyệt không đồng nghĩa đã thanh toán', async () => {
    const { app, db } = makeApp();
    const teacher = await login(app, 'giaovien');
    const ops = await login(app, 'vanhanh');
    const manager = await login(app, 'quanly');
    const cashier = await login(app, 'thungan');
    const asset = db.prepare(`SELECT a.id FROM assets a WHERE a.status = 'good' AND a.room_id IS NOT NULL LIMIT 1`).get();
    const rep = await teacher.post('/api/assets/issues').send({ asset_id: asset.id, description: 'Máy chiếu không lên hình', severity: 'high' });
    expect(rep.status).toBe(201);
    expect((await teacher.post('/api/assets/issues').send({ asset_id: asset.id, description: 'lặp' })).status).toBe(409);
    const iid = rep.body.id;
    const task = await ops.post(`/api/assets/issues/${iid}/task`).send({ assignee_id: 6, due_date: addDays(vnToday(), 1) });
    expect(task.status).toBe(201);
    expect((await ops.post(`/api/assets/issues/${iid}/task`).send({ assignee_id: 6, due_date: vnToday() })).status).toBe(409);
    const ap = await ops.post(`/api/assets/issues/${iid}/approval`).send({ amount: 2400000, description: 'Thay bóng đèn' });
    expect(ap.status).toBe(201);
    // Chưa duyệt thì chưa xác nhận xử lý được
    expect((await ops.post(`/api/assets/issues/${iid}/resolve`).send({ resolution: 'xong' })).status).toBe(409);
    expect((await ops.post(`/api/approvals/${ap.body.approvalId}/decide`).send({ decision: 'approved' })).status).toBe(403);
    const d = await manager.post(`/api/approvals/${ap.body.approvalId}/decide`).send({ decision: 'approved', note: 'Đồng ý' });
    expect(d.status).toBe(200);
    expect(d.body.approval.payment_status).toBe('unpaid');
    const today = vnToday();
    const cash0 = (await manager.get(`/api/finance/summary?period=custom&from=${today}&to=${today}`)).body.expenses;
    const res = await ops.post(`/api/assets/issues/${iid}/resolve`).send({ resolution: 'Đã thay bóng đèn, máy chiếu hoạt động tốt' });
    expect(res.status).toBe(200);
    const issue = (await ops.get(`/api/assets/issues/${iid}`)).body;
    expect(issue.issue.status).toBe('resolved');
    expect(issue.task.status).toBe('done');
    expect(issue.approval.payment_status).toBe('unpaid'); // đã duyệt nhưng CHƯA thanh toán
    expect(issue.history.map((h) => h.action)).toEqual(expect.arrayContaining(['reported', 'task', 'approval', 'approval_approved', 'resolved']));
    expect((await manager.get(`/api/finance/summary?period=custom&from=${today}&to=${today}`)).body.expenses).toBe(cash0);
    // Thu ngân xác nhận chi ⇒ mới vào thu chi
    await cashier.post(`/api/approvals/${ap.body.approvalId}/pay`).send({ method: 'cash', paid_at: today });
    expect((await manager.get(`/api/finance/summary?period=custom&from=${today}&to=${today}`)).body.expenses).toBe(cash0 + 2400000);
    expect(db.prepare('SELECT status FROM assets WHERE id = ?').get(asset.id).status).toBe('good');
  });
});

describe('Xuất CSV', () => {
  it('chống công thức bảng tính, giữ tiếng Việt (BOM), escape dấu phẩy/ngoặc kép', async () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+84')).toBe("'+84");
    expect(csvCell('-1+2')).toBe("'-1+2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5000)).toBe('-5000');
    expect(csvCell('Nguyễn, Văn A')).toBe('"Nguyễn, Văn A"');
    const out = toCsv([{ key: 'a', label: 'Tên' }], [{ a: 'Học viên' }]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    const { app } = makeApp();
    const m = await login(app, 'quanly');
    const leads = await m.get('/api/reports/export/leads');
    expect(leads.status).toBe(200);
    expect(leads.headers['content-type']).toContain('text/csv');
    expect(leads.text).toContain('Phụ huynh');
  });
});
