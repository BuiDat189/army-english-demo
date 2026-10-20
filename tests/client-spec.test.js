// Kiểm thử theo file yêu cầu của trung tâm (6 vai trò): nghỉ do trung tâm, lịch test/họp PH,
// KPI EC/CM đổi màu, báo cáo ngày của kế toán, sự cố theo phòng, phạm vi xem của EC.
import { describe, it, expect, beforeEach } from 'vitest';
import { makeApp, login } from './helpers.js';
import { vnToday, addDays } from '../server/lib/time.js';
import { sessionUsage } from '../server/services/attendance.js';

describe('Yêu cầu trung tâm', () => {
  let ctx; let manager; let academic; let ec; let cm; let cashier; let salesLead;
  beforeEach(async () => {
    ctx = makeApp();
    [manager, academic, ec, cm, cashier, salesLead] = await Promise.all(['quanly', 'giaovu', 'tuvan', 'giaovien', 'thungan', 'truongsales'].map((u) => login(ctx.app, u)));
  });

  it('nghỉ do trung tâm: hủy buổi trong khoảng, bù đủ buổi cuối khóa ⇒ số buổi còn lại của học viên không đổi', async () => {
    const today = vnToday();
    const cls = ctx.db.prepare(`SELECT * FROM classes WHERE code = 'ST1-A'`).get();
    const from = addDays(today, 1); const to = addDays(today, 10);
    const eids = ctx.db.prepare(`SELECT id FROM enrollments WHERE class_id = ? AND status = 'active'`).all(cls.id).map((x) => x.id);
    const before = sessionUsage(ctx.db, eids);
    const count = (st) => ctx.db.prepare(`SELECT COUNT(*) n FROM class_sessions WHERE class_id = ? AND status = ?`).get(cls.id, st).n;
    const sched0 = count('scheduled');
    const inRange = ctx.db.prepare(`SELECT COUNT(*) n FROM class_sessions WHERE class_id = ? AND status = 'scheduled' AND date BETWEEN ? AND ?`).get(cls.id, from, to).n;
    expect(inRange).toBeGreaterThan(0);
    expect((await cm.post('/api/closures').send({ from_date: from, to_date: to, reason: 'Nghỉ Tết sớm', class_ids: [cls.id] })).status).toBe(403);
    const pv = await academic.post('/api/closures/preview').send({ from_date: from, to_date: to, reason: 'Nghỉ Tết sớm', class_ids: [cls.id] });
    expect(pv.body.total).toBe(inRange);
    const r = await academic.post('/api/closures').send({ from_date: from, to_date: to, reason: 'Nghỉ Tết sớm', class_ids: [cls.id] });
    expect(r.status).toBe(201);
    expect(r.body.cancelled).toBe(inRange);
    expect(r.body.added).toBe(inRange);
    expect(count('scheduled')).toBe(sched0); // hủy bao nhiêu, bù bấy nhiêu
    expect(ctx.db.prepare(`SELECT COUNT(*) n FROM class_sessions WHERE class_id = ? AND status = 'scheduled' AND date BETWEEN ? AND ?`).get(cls.id, from, to).n).toBe(0);
    const after = sessionUsage(ctx.db, eids);
    for (const id of eids) expect(after.get(id).remaining).toBe(before.get(id).remaining);
    expect((await academic.get('/api/closures')).body.items[0].reason).toBe('Nghỉ Tết sớm');
  });

  it('lịch test / họp PH: hạn trả kết quả = ngày test + 5; quá hạn được cảnh báo và nhắc việc cho CM', async () => {
    const today = vnToday();
    const own = ctx.db.prepare(`SELECT * FROM classes WHERE homeroom_id = 4 AND status = 'active' LIMIT 1`).get();
    const other = ctx.db.prepare(`SELECT * FROM classes WHERE homeroom_id != 4 AND teacher_id != 4 AND status = 'active' LIMIT 1`).get();
    expect((await cm.post('/api/class-events').send({ class_id: other.id, kind: 'test', date: today })).status).toBe(403);
    const t = await cm.post('/api/class-events').send({ class_id: own.id, kind: 'test', date: addDays(today, -6), start_time: '17:30' });
    expect(t.status).toBe(201);
    const ev = ctx.db.prepare('SELECT * FROM class_events WHERE id = ?').get(t.body.id);
    expect(ev.results_due).toBe(addDays(today, -1));
    expect((await cm.post(`/api/class-events/${ev.id}/results-returned`).send({})).status).toBe(409); // chưa tổ chức
    expect((await cm.post(`/api/class-events/${ev.id}/done`).send({})).status).toBe(200);
    const list = (await cm.get('/api/class-events')).body;
    expect(list.items.find((x) => x.id === ev.id).results_overdue).toBe(true);
    const { runReminders } = await import('../server/services/reminders.js');
    runReminders(ctx.db);
    const task = ctx.db.prepare('SELECT * FROM tasks WHERE source_key = ?').get(`test-results:${ev.id}`);
    expect(task.assignee_id).toBe(own.homeroom_id);
    expect((await cm.post(`/api/class-events/${ev.id}/results-returned`).send({})).status).toBe(200);
    expect(ctx.db.prepare('SELECT status FROM tasks WHERE id = ?').get(task.id).status).toBe('done');
  });

  it('KPI EC: check-in hôm nay & data tiềm năng tháng có màu; KPI CM điểm danh/chấm BTVN hôm nay', async () => {
    const d = (await ec.get('/api/dashboard')).body;
    const k = Object.fromEntries(d.work.ec.kpis.map((x) => [x.key, x]));
    expect(k.checkin_today.target).toBe(1);
    expect(k.potential_month.target).toBe(25);
    expect(['good', 'warn', 'bad']).toContain(k.potential_month.tone);
    expect(k.checkin_today.tone).toBe(k.checkin_today.value >= 1 ? 'good' : 'bad');
    const dc = (await cm.get('/api/dashboard')).body;
    expect(dc.work.cm.kpis.map((x) => x.key)).toEqual(['attendance_today', 'homework_today']);
    // "Đề xuất cần xử lý": CM có việc đón khách check-in / học thử do EC đẩy sang
    expect(dc.work.proposals.length).toBeGreaterThan(0);
    // Trưởng phòng sales xem KPI từng EC; CM không xem được
    const rep = await salesLead.get('/api/reports/staff_ec');
    expect(rep.status).toBe(200);
    expect(rep.body.rows.map((x) => x.id)).toEqual(expect.arrayContaining([2, 11, 12]));
    expect((await cm.get('/api/reports/staff_ec')).status).toBe(403);
    expect((await academic.get('/api/reports/staff_cm')).status).toBe(200);
    expect((await manager.get('/api/reports/department')).body.extra.rows.length).toBe(6);
  });

  it('báo cáo ngày của kế toán đủ 7 chỉ số; thực thu tháng là lũy kế', async () => {
    const r = (await cashier.get('/api/reports/daily?period=month')).body;
    expect(r.columns.map((c) => c.key)).toEqual(['date', 'checkins', 'renew', 'completed_new', 'deposits', 'deposit_amount', 'debt', 'cash_day', 'cash_month']);
    const asc = [...r.rows].reverse();
    let sum = 0;
    for (const row of asc) { sum += row.cash_day; expect(row.cash_month).toBe(sum); }
    expect((await ec.get('/api/reports/daily')).status).toBe(403);
    // Phiếu thu tách học viên mới / tái phí
    const rc = (await cashier.get('/api/finance/receipts?period=month')).body;
    expect(rc.byKind.new + rc.byKind.renew).toBe(rc.total);
  });

  it('báo sự cố cơ sở vật chất theo phòng (phát sinh mới) kèm thời gian đề xuất xử lý', async () => {
    const bad = await cm.post('/api/assets/issues').send({ description: 'Hỏng' });
    expect(bad.status).toBe(400);
    const r = await cm.post('/api/assets/issues').send({ room_id: 1, title: 'Rèm cửa rách', description: 'Rèm cửa sổ bị rách, nắng chiếu vào bảng.', requested_due: addDays(vnToday(), 2) });
    expect(r.status).toBe(201);
    const i = ctx.db.prepare('SELECT * FROM asset_issues WHERE id = ?').get(r.body.id);
    expect(i.asset_id).toBeNull();
    expect(i.room_id).toBe(1);
    const rep = (await salesLead.get('/api/reports/facilities')).body;
    expect(rep.rows.some((x) => x.code === i.code && x.item === 'Rèm cửa rách')).toBe(true);
  });

  it('EC xem danh sách học viên: số tiền đã đóng + ngày hết phí, KHÔNG có liên hệ phụ huynh', async () => {
    const items = (await ec.get('/api/students?status=studying')).body.items;
    const x = items.find((s) => s.fee_end);
    expect(x.paid).toBeGreaterThan(0);
    expect(x.fee_days_left).toBeTypeOf('number');
    expect(items.every((s) => s.parent === null)).toBe(true);
    expect((await ec.get(`/api/students/${x.id}`)).body.contacts).toBeNull();
  });
});
