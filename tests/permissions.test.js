import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { makeApp, login } from './helpers.js';
import { DEMO_PASSWORD } from '../server/db/seed.js';

describe('Phân quyền kiểm tra ở backend (gọi API trực tiếp)', () => {
  let ctx;
  beforeAll(() => { ctx = makeApp(); });

  it('chưa đăng nhập ⇒ 401; thiếu header ứng dụng khi ghi ⇒ 403 (chống CSRF)', async () => {
    expect((await request(ctx.app).get('/api/students')).status).toBe(401);
    const s = await login(ctx.app, 'quanly');
    const r = await s.agent.post('/api/tasks').send({ title: 'x' });
    expect(r.status).toBe(403);
  });

  it('mật khẩu được băm, không lưu plaintext; đăng nhập sai bị từ chối', async () => {
    const rows = ctx.db.prepare('SELECT password_hash FROM users').all();
    for (const r of rows) { expect(r.password_hash).toMatch(/^\$2[aby]\$/); expect(r.password_hash).not.toContain(DEMO_PASSWORD); }
    const bad = await request(ctx.app).post('/api/auth/login').set('X-Requested-With', 'army-app').send({ username: 'quanly', password: 'sai' });
    expect(bad.status).toBe(401);
  });

  it('chủ nhiệm (CM) chỉ xem lớp/học viên mình dạy hoặc chủ nhiệm; thấy tiền đã đóng + ngày hết phí, không xem công nợ chi tiết', async () => {
    const t = await login(ctx.app, 'giaovien'); // Đỗ Thanh Tâm — CM lớp ST1-A, ST2-A
    const classes = (await t.get('/api/classes?status=all')).body.items;
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.every((c) => c.teacher_id === 4 || c.assistant_id === 4 || c.homeroom_id === 4)).toBe(true);
    const other = ctx.db.prepare('SELECT id FROM classes WHERE teacher_id != 4 AND (assistant_id IS NULL OR assistant_id != 4) AND (homeroom_id IS NULL OR homeroom_id != 4) LIMIT 1').get();
    expect((await t.get(`/api/classes/${other.id}`)).status).toBe(403);
    const foreignStudent = ctx.db.prepare(`SELECT e.student_id FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE c.teacher_id = 7 AND e.student_id NOT IN (SELECT e2.student_id FROM enrollments e2 JOIN classes c2 ON c2.id = e2.class_id WHERE c2.teacher_id = 4 OR c2.assistant_id = 4 OR c2.homeroom_id = 4) LIMIT 1`).get().student_id;
    expect((await t.get(`/api/students/${foreignStudent}`)).status).toBe(403);
    expect((await t.get('/api/finance/receivables')).status).toBe(403);
    // CM nhập data khách & đẩy tái phí ⇒ có khu vực khách của mình
    const leads = await t.get('/api/leads');
    expect(leads.status).toBe(200);
    expect(leads.body.scope).toBe('mine');
    const own = (await t.get('/api/students')).body.items.find((x) => x.classes.length);
    expect(own.paid).toBeTypeOf('number');
    expect(own.debt).toBeUndefined();
    const cls = (await t.get(`/api/classes/${classes.find((c) => c.homeroom_id === 4).id}`)).body;
    expect(cls.students[0].expected_end).toBeTruthy();
    expect(cls.students[0].paid).toBeTypeOf('number');
    // Không điểm danh được buổi của lớp khác
    const s = ctx.db.prepare(`SELECT id FROM class_sessions WHERE class_id = ? AND date <= date('now') LIMIT 1`).get(other.id);
    expect((await t.put(`/api/sessions/${s.id}/attendance`).send({ records: [] })).status).toBe(403);
  });

  it('tư vấn không tự duyệt giảm phí, không thu tiền', async () => {
    const c = await login(ctx.app, 'tuvan');
    const pending = ctx.db.prepare(`SELECT id FROM approvals WHERE type = 'discount' AND status = 'pending' LIMIT 1`).get();
    expect((await c.post(`/api/approvals/${pending.id}/decide`).send({ decision: 'approved' })).status).toBe(403);
    expect((await c.post('/api/finance/receipts').set('Idempotency-Key', 'perm-test-1').send({ enrollment_id: 1, amount: 1000, paid_at: '2026-01-01', method: 'cash' })).status).toBe(403);
  });

  it('vận hành không xem dữ liệu tài chính hoặc thông tin phụ huynh', async () => {
    const o = await login(ctx.app, 'vanhanh');
    for (const url of ['/api/finance/receivables', '/api/finance/receipts', '/api/students', '/api/students/1', '/api/leads', '/api/reports/finance', '/api/reports/export/receivables']) {
      expect((await o.get(url)).status, url).toBe(403);
    }
    const parent = ctx.db.prepare('SELECT phone FROM parents LIMIT 1').get();
    const search = (await o.get(`/api/search?q=${parent.phone}`)).body.results;
    expect(search.filter((r) => r.type === 'student' || r.type === 'lead')).toEqual([]);
    const dash = (await o.get('/api/dashboard')).body;
    expect(dash.kpis.income).toBeUndefined();
    expect(dash.kpis.receivablesDue).toBeUndefined();
  });

  it('chỉ quản lý được reset demo; thu ngân không duyệt đề xuất', async () => {
    const cashier = await login(ctx.app, 'thungan');
    expect((await cashier.post('/api/demo/reset').send({ confirm: 'RESET' })).status).toBe(403);
    const pending = ctx.db.prepare(`SELECT id FROM approvals WHERE status = 'pending' LIMIT 1`).get();
    expect((await cashier.post(`/api/approvals/${pending.id}/decide`).send({ decision: 'approved' })).status).toBe(403);
  });

  it('chuyển nhanh tài khoản đổi đúng menu quyền', async () => {
    const m = await login(ctx.app, 'quanly');
    const sw = await m.post('/api/auth/switch').send({ userId: 4 });
    expect(sw.status).toBe(200);
    const me = (await m.get('/api/auth/me')).body;
    expect(me.user.roles).toEqual(['teacher']);
    expect(me.permissions).not.toContain('finance.view');
    expect((await m.get('/api/finance/receivables')).status).toBe(403);
  });
});

describe('Ngoài chế độ demo', () => {
  it('tắt tài khoản demo, chuyển nhanh và reset', async () => {
    const ctx = makeApp({ demoMode: false });
    const login1 = await request(ctx.app).post('/api/auth/login').set('X-Requested-With', 'army-app').send({ username: 'quanly', password: DEMO_PASSWORD });
    expect(login1.status).toBe(401);
    const accounts = await request(ctx.app).get('/api/auth/demo-accounts');
    expect(accounts.body.accounts).toEqual([]);
    expect((await request(ctx.app).get('/api/auth/config')).body.demoMode).toBe(false);
    // Tài khoản thật (không phải demo) có quyền quản lý vẫn không reset/chuyển nhanh được
    ctx.db.prepare(`INSERT INTO users(id, code, full_name, username, password_hash, is_demo, status, created_at) VALUES (99, 'NV099', 'Quản lý thật', 'admin', ?, 0, 'active', ?)`).run(bcrypt.hashSync('Real@Pass123', 10), new Date().toISOString());
    ctx.db.prepare(`INSERT INTO user_roles(user_id, role) VALUES (99, 'manager')`).run();
    const real = await login(ctx.app, 'admin', 'Real@Pass123');
    expect((await real.post('/api/demo/reset').send({ confirm: 'RESET' })).status).toBe(403);
    expect((await real.post('/api/auth/switch').send({ userId: 4 })).status).toBe(403);
  });
});

describe('Thu ngân xem đủ dữ liệu cần cho thu tiền (hồi quy)', () => {
  it('hồ sơ học viên có đăng ký + công nợ; dashboard đếm học viên đúng như quản lý', async () => {
    const ctx = makeApp();
    const c = await login(ctx.app, 'thungan');
    const m = await login(ctx.app, 'quanly');
    const sid = ctx.db.prepare(`SELECT student_id FROM enrollments WHERE status = 'active' LIMIT 1`).get().student_id;
    const d = (await c.get(`/api/students/${sid}`)).body;
    expect(d.enrollments.length).toBeGreaterThan(0);
    expect(d.enrollments[0].finance).toBeTruthy();
    const list = (await c.get('/api/students')).body.items;
    expect(list.some((x) => x.classes.length > 0)).toBe(true);
    const dc = (await c.get('/api/dashboard')).body;
    const dm = (await m.get('/api/dashboard')).body;
    expect(dc.kpis.studying.value).toBe(dm.kpis.studying.value);
    expect(dc.kpis.classesToday).toBeTruthy(); // kế toán xem lịch trung tâm
    expect(dc.work.cash).toBeTruthy(); // thực thu ngày / tháng
  });
});
