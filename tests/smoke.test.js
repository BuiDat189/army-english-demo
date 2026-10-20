import { describe, it, expect, beforeAll } from 'vitest';
import { makeApp, login } from './helpers.js';

// Gọi mọi API đọc chính bằng từng vai trò: không được có lỗi 500, và trả 403 đúng chỗ.
const ENDPOINTS = [
  '/api/lookups', '/api/dashboard?period=month', '/api/search?q=Nguy', '/api/notifications',
  '/api/leads', '/api/leads?status=all', '/api/students', '/api/students?status=studying', '/api/classes', '/api/classes/courses',
  '/api/sessions', '/api/sessions/absences', '/api/finance/receivables', '/api/finance/receipts?period=month', '/api/finance/refunds', '/api/finance/summary',
  '/api/care', '/api/care/renewals', '/api/tasks', '/api/tasks?view=overdue', '/api/hr/staff', '/api/hr/schedule', '/api/hr/leaves', '/api/hr/teaching-logs', '/api/hr/teaching-summary',
  '/api/approvals', '/api/assets', '/api/assets/issues', '/api/inventory', '/api/notices', '/api/reports',
  '/api/reports/enrollment', '/api/reports/attendance', '/api/reports/finance', '/api/reports/cashflow', '/api/reports/teaching', '/api/reports/tasks',
  '/api/demo/status',
];
const USERS = ['quanly', 'tuvan', 'giaovu', 'giaovien', 'thungan', 'vanhanh', 'phuong'];

describe('smoke: mọi vai trò gọi API đọc không lỗi 500', () => {
  let ctx;
  beforeAll(() => { ctx = makeApp(); });

  for (const u of USERS) {
    it(`vai trò ${u}`, async () => {
      const s = await login(ctx.app, u);
      const failures = [];
      for (const url of ENDPOINTS) {
        const res = await s.get(url);
        if (res.status >= 500 || ![200, 403].includes(res.status)) failures.push(`${url} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
      }
      expect(failures).toEqual([]);
    });
  }

  it('quản lý xem được chi tiết mọi thực thể', async () => {
    const s = await login(ctx.app, 'quanly');
    const failures = [];
    const check = async (url) => { const r = await s.get(url); if (r.status !== 200) failures.push(`${url} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body; };
    const leads = await check('/api/leads?status=all');
    for (const l of leads.items.slice(0, 8)) await check(`/api/leads/${l.id}`);
    const students = await check('/api/students?status=all');
    for (const st of students.items) await check(`/api/students/${st.id}`);
    const classes = await check('/api/classes?status=all');
    for (const c of classes.items) await check(`/api/classes/${c.id}`);
    const sessions = await check('/api/sessions');
    for (const x of sessions.sessions) await check(`/api/sessions/${x.id}`);
    const care = await check('/api/care?status=all');
    for (const c of care.items.slice(0, 10)) await check(`/api/care/${c.id}`);
    const tasks = await check('/api/tasks');
    for (const t of tasks.items) await check(`/api/tasks/${t.id}`);
    const appr = await check('/api/approvals');
    for (const a of appr.items) await check(`/api/approvals/${a.id}`);
    const issues = await check('/api/assets/issues');
    for (const i of issues.items) await check(`/api/assets/issues/${i.id}`);
    const rc = await check('/api/finance/receipts?period=last30');
    for (const x of rc.items.slice(0, 5)) await check(`/api/finance/receipts/${x.id}`);
    const inv = await check('/api/inventory');
    for (const m of inv.items.slice(0, 3)) await check(`/api/inventory/${m.id}/moves`);
    expect(failures).toEqual([]);
  });
});
