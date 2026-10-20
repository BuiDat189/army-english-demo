// Duyệt các trang trên server DEV (Vite, React chế độ phát triển) để bắt cảnh báo React (thiếu key, prop sai…).
// Cần đang chạy: npm run dev. Chạy: node tests/e2e/dev-warnings.js [http://127.0.0.1:5173]
import { launch } from './lib.js';
import { DEMO_PASSWORD } from '../../server/db/seed.js';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const pages = ['/', '/leads', '/leads/40', '/students', '/students/1', '/students/1?tab=classes', '/students/1?tab=attendance', '/students/1?tab=finance', '/students/1?tab=care',
  '/classes', '/classes?tab=courses', '/classes/1', '/classes/1?tab=sessions', '/schedule', '/schedule?view=day', '/training', '/training?tab=absences', '/training?tab=rules',
  '/finance', '/finance?tab=receipts', '/finance?tab=refunds', '/finance?tab=cashflow', '/care', '/care?tab=renewals', '/care?id=1', '/tasks', '/tasks?mode=kanban', '/tasks?id=1',
  '/hr', '/hr?tab=schedule', '/hr?tab=leaves', '/hr?tab=teaching', '/approvals', '/approvals?id=1', '/assets', '/assets?tab=issues', '/assets/issues/1', '/inventory', '/notices',
  '/reports', '/reports?type=finance', '/account', '/finance/receipts/1'];
const browser = await launch();
const issues = [];
for (const user of ['quanly', 'giaovien']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN' });
  const page = await ctx.newPage();
  let cur = '';
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/status of 4\d\d|Download the React DevTools/.test(m.text())) issues.push(`[${user} ${cur}] ${m.type()}: ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => issues.push(`[${user} ${cur}] pageerror: ${e.message}`));
  const r = await ctx.request.post(`${base}/api/auth/login`, { headers: { 'X-Requested-With': 'army-app' }, data: { username: user, password: DEMO_PASSWORD } });
  if (!r.ok()) throw new Error(`login ${user}: ${r.status()}`);
  for (const p of pages) {
    cur = p;
    await page.goto(base + p);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(250);
  }
  await ctx.close();
}
await browser.close();
console.log(issues.length ? issues.join('\n') : 'Không có cảnh báo/lỗi console ở chế độ dev.');
process.exitCode = issues.length ? 1 : 0;
