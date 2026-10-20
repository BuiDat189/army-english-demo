import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, login } from './helpers.js';
import { sessionUsage } from '../server/services/attendance.js';
import { runReminders } from '../server/services/reminders.js';
import { sessionStudentIds } from '../server/services/schedule.js';
import { seedDemo } from '../server/db/seed.js';
import { vnToday, addDays } from '../server/lib/time.js';

describe('Điểm danh, học bù, nhắc việc — an toàn khi lặp lại', () => {
  let ctx; let teacher; let academic;
  beforeEach(async () => { ctx = makeApp(); teacher = await login(ctx.app, 'giaovien'); academic = await login(ctx.app, 'giaovu'); });

  const todaySession = () => ctx.db.prepare(`SELECT * FROM class_sessions WHERE date = ? AND teacher_id = 4 AND status = 'scheduled' LIMIT 1`).get(vnToday());

  it('lưu điểm danh nhiều lần không nhân đôi bản ghi, số buổi và việc chăm sóc', async () => {
    const s = todaySession();
    const ids = sessionStudentIds(ctx.db, s.id);
    const records = ids.map((id, i) => ({ student_id: id, status: i === 0 ? 'absent' : 'present' }));
    const enrollmentIds = ctx.db.prepare(`SELECT id FROM enrollments WHERE class_id = ? AND status = 'active'`).all(s.class_id).map((x) => x.id);
    const before = sessionUsage(ctx.db, enrollmentIds);
    const r1 = await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records, topic: 'Unit 9' });
    expect(r1.status).toBe(200);
    expect(r1.body.careCreated).toBe(1);
    const r2 = await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records, topic: 'Unit 9' });
    const r3 = await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records, topic: 'Unit 9' });
    expect(r2.body.changed).toBe(0);
    expect(r3.body.careCreated).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM attendance WHERE session_id = ?').get(s.id).n).toBe(ids.length);
    const after = sessionUsage(ctx.db, enrollmentIds);
    for (const id of enrollmentIds) expect(after.get(id).used - before.get(id).used).toBe(1);
    const abs = ctx.db.prepare('SELECT id FROM attendance WHERE session_id = ? AND student_id = ?').get(s.id, ids[0]).id;
    expect(ctx.db.prepare(`SELECT COUNT(*) n FROM care_cases WHERE source_key = ?`).get(`absence:${abs}`).n).toBe(1);
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM teaching_logs WHERE session_id = ?').get(s.id).n).toBe(s.assistant_id ? 2 : 1);
    // Mở lại vẫn đúng
    const reopened = (await teacher.get(`/api/sessions/${s.id}`)).body;
    expect(reopened.roster.find((x) => x.id === ids[0]).attendance.status).toBe('absent');
    expect(reopened.session.topic).toBe('Unit 9');
  });

  it('thiếu trạng thái của học viên ⇒ không lưu; buổi tương lai không điểm danh trước', async () => {
    const s = todaySession();
    const ids = sessionStudentIds(ctx.db, s.id);
    const r = await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records: [{ student_id: ids[0], status: 'present' }] });
    expect(r.status).toBe(400);
    const future = ctx.db.prepare(`SELECT id FROM class_sessions WHERE date > ? AND teacher_id = 4 AND status = 'scheduled' LIMIT 1`).get(vnToday());
    expect((await teacher.put(`/api/sessions/${future.id}/attendance`).send({ records: [] })).status).toBe(409);
  });

  it('nghỉ có phép/không phép đều tính nghỉ; buổi nghỉ trong hạn mức gói không tính phí; học bù không trừ thêm; không xếp bù hai lần', async () => {
    const s = todaySession();
    const ids = sessionStudentIds(ctx.db, s.id);
    const [excusedId, absentId] = ids;
    const enrollOf = (sid) => ctx.db.prepare(`SELECT id FROM enrollments WHERE class_id = ? AND student_id = ? AND status = 'active'`).get(s.class_id, sid).id;
    // Hết hạn mức nghỉ không tính phí ⇒ mỗi buổi nghỉ (có phép hay không) đều trừ 1 buổi
    ctx.db.prepare('UPDATE enrollments SET free_absences = 0 WHERE id IN (?, ?)').run(enrollOf(excusedId), enrollOf(absentId));
    const before = sessionUsage(ctx.db, [enrollOf(excusedId), enrollOf(absentId)]);
    await teacher.put(`/api/sessions/${s.id}/attendance`).send({ records: ids.map((id) => ({ student_id: id, status: id === excusedId ? 'excused' : id === absentId ? 'absent' : 'present' })) });
    const usage0 = sessionUsage(ctx.db, [enrollOf(excusedId), enrollOf(absentId)]);
    expect(usage0.get(enrollOf(excusedId)).used - before.get(enrollOf(excusedId)).used).toBe(1);
    expect(usage0.get(enrollOf(absentId)).used - before.get(enrollOf(absentId)).used).toBe(1);
    // Gói có 4 buổi nghỉ không tính phí (gói 96 buổi) ⇒ các buổi nghỉ trong hạn mức được hoàn lại
    ctx.db.prepare('UPDATE enrollments SET free_absences = 4 WHERE id = ?').run(enrollOf(excusedId));
    const u4 = sessionUsage(ctx.db, [enrollOf(excusedId)]).get(enrollOf(excusedId));
    expect(u4.freeUsed).toBe(Math.min(4, u4.absences));
    expect(u4.used).toBe(u4.marked - Math.min(4, u4.absences));
    ctx.db.prepare('UPDATE enrollments SET free_absences = 0 WHERE id = ?').run(enrollOf(excusedId));
    const att = (sid) => ctx.db.prepare('SELECT id FROM attendance WHERE session_id = ? AND student_id = ?').get(s.id, sid).id;
    // Buổi bù riêng ngày mai
    const mk = async (sid, start) => academic.post('/api/sessions/makeup').send({ attendance_id: att(sid), new_session: { date: addDays(vnToday(), 1), start_time: start, end_time: `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00`, room_id: 4, teacher_id: 10 } });
    const m1 = await mk(excusedId, '08:00');
    expect(m1.status).toBe(201);
    expect((await mk(excusedId, '09:00')).status).toBe(409); // không xếp bù hai lần
    const m2 = await mk(absentId, '10:00');
    expect(m2.status).toBe(201);
    // Đánh dấu "đã học bù" bằng cách đẩy ngày buổi bù về hôm nay rồi điểm danh (giáo vụ có quyền điểm danh mọi lớp)
    ctx.db.prepare('UPDATE class_sessions SET date = ? WHERE id IN (?, ?)').run(vnToday(), m1.body.sessionId, m2.body.sessionId);
    for (const [m, sid] of [[m1, excusedId], [m2, absentId]]) {
      const r = await academic.put(`/api/sessions/${m.body.sessionId}/attendance`).send({ records: [{ student_id: sid, status: 'present' }] });
      expect(r.status).toBe(200);
      await academic.put(`/api/sessions/${m.body.sessionId}/attendance`).send({ records: [{ student_id: sid, status: 'present' }] });
    }
    const usage1 = sessionUsage(ctx.db, [enrollOf(excusedId), enrollOf(absentId)]);
    // Học bù không trừ thêm buổi nào
    expect(usage1.get(enrollOf(excusedId)).used - usage0.get(enrollOf(excusedId)).used).toBe(0);
    expect(usage1.get(enrollOf(absentId)).used - usage0.get(enrollOf(absentId)).used).toBe(0);
  });

  it('quét nhắc việc chạy lại không sinh trùng', () => {
    const counts = () => ({ care: ctx.db.prepare('SELECT COUNT(*) n FROM care_cases').get().n, notif: ctx.db.prepare('SELECT COUNT(*) n FROM notifications').get().n });
    runReminders(ctx.db);
    const a = counts();
    const again = runReminders(ctx.db);
    expect(again).toEqual({ absenceCases: 0, renewalCases: 0, paymentNotices: 0, leadFollowups: 0 });
    expect(counts()).toEqual(a);
  });

  it('checklist từ mẫu không tạo trùng trong cùng ngày', async () => {
    const ops = await login(ctx.app, 'vanhanh');
    const date = addDays(vnToday(), 1);
    const r1 = await ops.post('/api/tasks/from-template').send({ template_key: 'close', date });
    const r2 = await ops.post('/api/tasks/from-template').send({ template_key: 'close', date });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);
    expect(r2.body.id).toBe(r1.body.id);
  });

  it('reset demo khôi phục dữ liệu nhất quán, không nhân đôi', () => {
    const snap = () => Object.fromEntries(['users', 'students', 'parents', 'leads', 'classes', 'class_sessions', 'enrollments', 'receipts', 'attendance', 'care_cases', 'tasks', 'approvals'].map((t) => [t, ctx.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
    const a = snap();
    ctx.db.prepare(`UPDATE students SET full_name = 'ĐÃ SỬA' WHERE id = 1`).run();
    seedDemo(ctx.db);
    seedDemo(ctx.db);
    expect(snap()).toEqual(a);
    expect(ctx.db.prepare('SELECT full_name FROM students WHERE id = 1').get().full_name).not.toBe('ĐÃ SỬA');
    expect(ctx.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
