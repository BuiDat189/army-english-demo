import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, login } from './helpers.js';
import { findConflicts } from '../server/services/schedule.js';
import { vnToday, addDays } from '../server/lib/time.js';

describe('Xung đột lịch & sĩ số', () => {
  let ctx; let academic;
  beforeEach(async () => { ctx = makeApp(); academic = await login(ctx.app, 'giaovu'); });

  const futureSession = () => ctx.db.prepare(`SELECT s.*, c.code FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE s.status = 'scheduled' AND s.date > ? AND s.assistant_id IS NOT NULL ORDER BY s.date LIMIT 1`).get(vnToday());

  it('phát hiện trùng phòng, giáo viên, trợ giảng (ở cả hai vai trò) và học viên khi chồng lấn giờ', () => {
    const s = futureSession();
    const overlap = { date: s.date, start: s.start_time, end: s.end_time };
    expect(findConflicts(ctx.db, { ...overlap, roomId: s.room_id }).some((c) => c.type === 'room')).toBe(true);
    expect(findConflicts(ctx.db, { ...overlap, teacherId: s.teacher_id }).some((c) => c.type === 'staff')).toBe(true);
    // Trợ giảng của buổi đó được xếp làm GIÁO VIÊN ở buổi khác cùng giờ ⇒ vẫn trùng
    expect(findConflicts(ctx.db, { ...overlap, teacherId: s.assistant_id }).some((c) => c.type === 'staff')).toBe(true);
    const student = ctx.db.prepare(`SELECT student_id FROM enrollments WHERE class_id = ? AND status = 'active' LIMIT 1`).get(s.class_id).student_id;
    expect(findConflicts(ctx.db, { ...overlap, studentIds: [student] }).some((c) => c.type === 'student')).toBe(true);
    // Khung giờ nối tiếp (không chồng lấn) không bị coi là trùng
    expect(findConflicts(ctx.db, { date: s.date, start: s.end_time, end: '23:00', roomId: s.room_id }).filter((c) => c.sessionId === s.id)).toEqual([]);
  });

  it('buổi đã hủy không còn chiếm lịch', async () => {
    const s = futureSession();
    const r = await academic.post(`/api/sessions/${s.id}/cancel`).send({ reason: 'Giáo viên ốm' });
    expect(r.status).toBe(200);
    expect(findConflicts(ctx.db, { date: s.date, start: s.start_time, end: s.end_time, roomId: s.room_id }).filter((c) => c.sessionId === s.id)).toEqual([]);
    const again = await academic.post(`/api/sessions/${s.id}/cancel`).send({ reason: 'x' });
    expect(again.status).toBe(409);
  });

  it('đổi lịch vào khung trùng phòng bị từ chối kèm danh sách xung đột; hủy buổi bắt buộc có lý do', async () => {
    const s = futureSession();
    const other = ctx.db.prepare(`SELECT * FROM class_sessions WHERE date = ? AND id != ? AND status = 'scheduled' AND room_id != ? AND class_id IS NOT NULL LIMIT 1`).get(s.date, s.id, s.room_id)
      || ctx.db.prepare(`SELECT * FROM class_sessions WHERE date > ? AND id != ? AND status = 'scheduled' AND class_id IS NOT NULL AND class_id != ? LIMIT 1`).get(vnToday(), s.id, s.class_id);
    const r = await academic.put(`/api/sessions/${s.id}`).send({ date: other.date, start_time: other.start_time, end_time: other.end_time, room_id: other.room_id, teacher_id: s.teacher_id, assistant_id: s.assistant_id });
    expect(r.status).toBe(409);
    expect(r.body.conflicts.length).toBeGreaterThan(0);
    const noReason = await academic.post(`/api/sessions/${s.id}/cancel`).send({});
    expect(noReason.status).toBe(400);
  });

  it('tạo lớp trùng phòng/giáo viên bị chặn; sĩ số không vượt sức chứa phòng', async () => {
    const c = ctx.db.prepare(`SELECT * FROM classes WHERE code = 'ST1-A'`).get();
    const pattern = JSON.parse(c.schedule_json);
    const course = ctx.db.prepare('SELECT id FROM courses WHERE code = ?').get('MV1').id;
    const clash = await academic.post('/api/classes').send({ code: 'TEST-1', name: 'Lớp thử', course_id: course, room_id: c.room_id, teacher_id: 8, assistant_id: null, max_students: 10, start_date: vnToday(), schedule: pattern });
    expect(clash.status).toBe(409);
    expect(clash.body.conflicts.some((x) => x.type === 'room')).toBe(true);
    const big = await academic.post('/api/classes').send({ code: 'TEST-2', name: 'Lớp thử', course_id: course, room_id: c.room_id, teacher_id: 8, max_students: 30, start_date: addDays(vnToday(), 200), schedule: [{ weekday: 7, start: '20:00', end: '21:00' }] });
    expect(big.status).toBe(400);
    expect(big.body.fields.max_students).toBeTruthy();
    const ok = await academic.post('/api/classes').send({ code: 'TEST-3', name: 'Lớp thử', course_id: course, room_id: c.room_id, teacher_id: 8, max_students: 10, start_date: addDays(vnToday(), 200), schedule: [{ weekday: 7, start: '20:00', end: '21:00' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.sessions).toBe(24);
  });

  it('không xếp vượt sĩ số tối đa của lớp', async () => {
    const cls = ctx.db.prepare(`SELECT * FROM classes WHERE code = 'MV1-B'`).get();
    ctx.db.prepare('UPDATE classes SET max_students = (SELECT COUNT(*) FROM enrollments WHERE class_id = ? AND status = ?) WHERE id = ?').run(cls.id, 'active', cls.id);
    // Tạo một đăng ký Movers mới chưa xếp lớp
    const st = ctx.db.prepare(`SELECT id FROM students WHERE status = 'reserved' LIMIT 1`).get();
    const fee = ctx.db.prepare('SELECT tuition_fee FROM courses WHERE id = ?').get(cls.course_id).tuition_fee;
    // Giám đốc tạo ⇒ có hiệu lực ngay (người khác tạo phải chờ Giám đốc duyệt học phí)
    const boss = await login(ctx.app, 'quanly');
    const en = await boss.post('/api/enrollments').set('Idempotency-Key', 'cap-test-0001').send({ student_id: st.id, course_id: cls.course_id, enrolled_at: vnToday(), installments: [{ due_date: vnToday(), amount: fee }] });
    expect(en.status).toBe(201);
    const r = await academic.post(`/api/enrollments/${en.body.id}/assign-class`).send({ class_id: cls.id });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('class_full');
  });
});

describe('Bảo lưu đăng ký', () => {
  it('gói 1 năm được 1 lần bảo lưu 2 tuần – 3 tháng; rời lớp giải phóng chỗ, giữ công nợ; xếp lại đúng lớp cũ', async () => {
    const ctx = makeApp();
    const academic = await login(ctx.app, 'giaovu');
    const boss = await login(ctx.app, 'quanly');
    const e = ctx.db.prepare(`SELECT e.* FROM enrollments e WHERE e.status = 'active' AND e.class_id IS NOT NULL AND e.reserve_limit > 0 AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.status = 'pending' AND json_extract(a.payload, '$.enrollment_id') = e.id) LIMIT 1`).get();
    const noRight = ctx.db.prepare(`SELECT e.* FROM enrollments e WHERE e.status = 'active' AND e.class_id IS NOT NULL AND e.reserve_limit = 0 AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.status = 'pending' AND json_extract(a.payload, '$.enrollment_id') = e.id) LIMIT 1`).get();
    const { computeFinance } = await import('../server/services/finance.js');
    const debt0 = computeFinance(ctx.db, { enrollmentIds: [e.id] }).get(e.id).debt;
    const occ0 = (await academic.get(`/api/classes/${e.class_id}`)).body.class.occupancy;
    const req = (body) => academic.post('/api/approvals/requests').send({ type: 'reserve', reason: 'Đi du lịch', ...body });
    const t = vnToday();
    expect((await req({ enrollment_id: noRight.id, from: addDays(t, 1), to: addDays(t, 30) })).status).toBe(400); // gói không có quyền bảo lưu
    expect((await req({ enrollment_id: e.id, from: addDays(t, 1), to: addDays(t, 10) })).status).toBe(400); // dưới 2 tuần
    expect((await req({ enrollment_id: e.id, from: addDays(t, 1), to: addDays(t, 120) })).status).toBe(400); // quá 3 tháng
    const ok = await req({ enrollment_id: e.id, from: t, to: addDays(t, 29) });
    expect(ok.status).toBe(201);
    // Trưởng phòng học thuật gửi ⇒ đi thẳng Giám đốc duyệt cuối
    expect(ctx.db.prepare('SELECT stage FROM approvals WHERE id = ?').get(ok.body.approvalId).stage).toBe('final');
    expect((await academic.post(`/api/approvals/${ok.body.approvalId}/decide`).send({ decision: 'approved' })).status).toBe(403);
    expect((await boss.post(`/api/approvals/${ok.body.approvalId}/decide`).send({ decision: 'approved' })).status).toBe(200);
    const after = ctx.db.prepare('SELECT * FROM enrollments WHERE id = ?').get(e.id);
    expect(after.status).toBe('reserved');
    expect(after.reserve_count).toBe(1);
    expect(after.reserved_to).toBe(addDays(t, 29));
    expect((await academic.get(`/api/classes/${e.class_id}`)).body.class.occupancy).toBe(occ0 - 1);
    expect(computeFinance(ctx.db, { enrollmentIds: [e.id] }).get(e.id).debt).toBe(debt0);
    const other = ctx.db.prepare(`SELECT id FROM classes WHERE code = 'MV1-B'`).get().id;
    expect((await academic.post(`/api/enrollments/${e.id}/assign-class`).send({ class_id: other })).status).toBe(409);
    expect((await academic.post(`/api/enrollments/${e.id}/assign-class`).send({ class_id: e.class_id })).status).toBe(200);
    expect((await academic.get(`/api/classes/${e.class_id}`)).body.class.occupancy).toBe(occ0);
    // Đã dùng hết 1 lần bảo lưu
    expect((await req({ enrollment_id: e.id, from: addDays(t, 40), to: addDays(t, 60) })).status).toBe(400);
  });
});
