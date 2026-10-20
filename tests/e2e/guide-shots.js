// Chụp ảnh minh họa cho tài liệu hướng dẫn sử dụng (docs/huong-dan/img).
// Chạy: npm run build && node tests/e2e/guide-shots.js
// Dùng server thật trên DB tạm có dữ liệu demo; khung đỏ đánh số đánh dấu chỗ cần bấm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../server/db/index.js';
import { createApp } from '../../server/app.js';
import { seedDemo, DEMO_PASSWORD } from '../../server/db/seed.js';
import { launch, settle, ROOT } from './lib.js';
import { vnToday, addDays } from '../../server/lib/time.js';

const OUT = path.join(ROOT, 'docs', 'huong-dan', 'img');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const CODE = 'ARMY-DEMO';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'army-guide-'));
const db = openDb(path.join(dir, 'guide.sqlite'));
seedDemo(db);
const app = createApp({ db, config: { root: ROOT, demoMode: true, sessionSecret: 'guide-secret-guide-secret-1234567', secureCookie: false, timezone: 'Asia/Ho_Chi_Minh', env: 'test', accessCode: CODE } });
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const URL0 = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
const today = vnToday();
const W = 1280; const H = 800;

async function open(user, { width = W, height = H } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', deviceScaleFactor: width < 500 ? 2 : 1, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('army.theme', 'light'); } catch { /* bỏ qua */ } });
  await ctx.request.post(`${URL0}/access`, { form: { code: CODE, next: '/' }, maxRedirects: 0 });
  if (user) {
    const res = await ctx.request.post(`${URL0}/api/auth/login`, { headers: { 'X-Requested-With': 'army-app' }, data: { username: user, password: DEMO_PASSWORD } });
    if (!res.ok()) throw new Error(`login ${user} ${res.status()}`);
  }
  const page = await ctx.newPage();
  return page;
}
async function go(page, u) { await page.goto(URL0 + u); await settle(page); await page.waitForTimeout(250); }

/** Chụp ảnh: marks = danh sách locator được đóng khung + đánh số; clip = locator cắt khung (thường là hộp thoại) */
async function shot(page, name, { marks = [], clip = null, pad = 14 } = {}) {
  const boxes = [];
  for (const l of marks) {
    const b = await l.first().boundingBox().catch(() => null);
    if (!b) console.log(`   ! không thấy chỗ đánh dấu #${boxes.length + 1} trong ${name}`);
    boxes.push(b);
  }
  await page.evaluate((bs) => {
    bs.forEach((b, i) => {
      if (!b) return;
      const d = document.createElement('div');
      d.className = '__mk';
      Object.assign(d.style, { position: 'fixed', left: `${b.x - 4}px`, top: `${b.y - 4}px`, width: `${b.width + 8}px`, height: `${b.height + 8}px`, border: '3px solid #e11d48', borderRadius: '10px', zIndex: 2147483647, pointerEvents: 'none', boxShadow: '0 0 0 4px rgb(225 29 72 / .16)' });
      const n = document.createElement('span');
      n.textContent = String(i + 1);
      const lx = b.x - 4 < 16 ? 2 : -15; const ty = b.y - 4 < 16 ? 2 : -15;
      Object.assign(n.style, { position: 'absolute', left: `${lx}px`, top: `${ty}px`, width: '26px', height: '26px', borderRadius: '50%', background: '#e11d48', color: '#fff', font: '700 14px/26px system-ui, sans-serif', textAlign: 'center', boxShadow: '0 2px 6px rgb(0 0 0 / .3)' });
      d.appendChild(n);
      document.body.appendChild(d);
    });
  }, boxes);
  let opts = { path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 };
  if (clip) {
    const b = await clip.first().boundingBox();
    const vp = page.viewportSize();
    const x = Math.max(0, b.x - pad); const y = Math.max(0, b.y - pad);
    opts.clip = { x, y, width: Math.min(vp.width - x, b.width + pad * 2), height: Math.min(vp.height - y, b.height + pad * 2) };
  }
  await page.screenshot(opts);
  await page.evaluate(() => document.querySelectorAll('.__mk').forEach((e) => e.remove()));
}

const results = [];
async function S(name, fn) {
  if (only && !only.some((o) => name.startsWith(o))) return;
  try { await fn(); results.push([name, 'ok']); console.log(`  ✓ ${name}`); } catch (e) { results.push([name, e.message.split('\n')[0]]); console.log(`  ✗ ${name}: ${e.message.split('\n')[0]}`); }
}
const dlg = (p) => p.getByRole('dialog').last();
const btn = (p, name, exact = false) => p.getByRole('button', { name, exact });
const nav = (p) => p.getByRole('complementary', { name: 'Điều hướng chính' });

// Dữ liệu tham chiếu
const q = (sql, ...a) => db.prepare(sql).get(...a);
const leadAppointing = q(`SELECT id FROM leads WHERE status = 'appointing' AND owner_id = 2 ORDER BY id LIMIT 1`).id;
const leadChecked = q(`SELECT id FROM leads WHERE status = 'checked_in' AND owner_id = 2 ORDER BY id LIMIT 1`).id;
const debtStudent = q(`SELECT e.student_id id FROM enrollments e WHERE e.status = 'active' AND e.tuition_fee - COALESCE((SELECT SUM(amount) FROM receipts r WHERE r.enrollment_id = e.id AND r.status = 'confirmed'), 0) - COALESCE((SELECT SUM(amount) FROM discounts d WHERE d.enrollment_id = e.id AND d.status = 'approved'), 0) > 0 ORDER BY e.id LIMIT 1`).id;
const discountEnroll = q(`SELECT e.id, e.code, e.student_id FROM enrollments e WHERE e.status = 'active' AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.status = 'pending' AND json_extract(a.payload, '$.enrollment_id') = e.id) ORDER BY e.id LIMIT 1`);
const receiptId = q(`SELECT id FROM receipts WHERE status = 'confirmed' ORDER BY id DESC LIMIT 1`).id;
const st1a = q(`SELECT id FROM classes WHERE code = 'ST1-A'`).id;
const renewStudent = q(`SELECT e.student_id id FROM enrollments e WHERE e.class_id = ? AND e.status = 'active' AND NOT EXISTS (SELECT 1 FROM enrollments n WHERE n.previous_enrollment_id = e.id) AND e.total_sessions = 24 ORDER BY e.id LIMIT 1`, st1a)?.id;
const reserveEnroll = q(`SELECT e.id, e.code, e.student_id FROM enrollments e WHERE e.class_id = ? AND e.status = 'active' AND e.reserve_limit > 0
  AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.status = 'pending' AND json_extract(a.payload, '$.enrollment_id') = e.id) ORDER BY e.id LIMIT 1`, st1a);
const walletStudent = q(`SELECT student_id id FROM wallet_entries WHERE kind = 'topup' ORDER BY id LIMIT 1`).id;
const openIssue = q(`SELECT id FROM asset_issues WHERE status IN ('reported','in_progress') AND asset_id IS NOT NULL ORDER BY id LIMIT 1`)?.id;
const region = (p, name) => p.getByRole('region', { name });

try {
  console.log('Chung');
  await S('g01-ma-truy-cap', async () => {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'vi-VN', reducedMotion: 'reduce' });
    const p = await ctx.newPage(); await go(p, '/access');
    await p.locator('#code').fill('ARMY-XXX-XXX');
    await shot(p, 'g01-ma-truy-cap', { marks: [p.locator('#code'), p.getByRole('button', { name: 'Vào bản demo' })] });
    await ctx.close();
  });
  await S('g02-dang-nhap', async () => {
    const p = await open(null); await go(p, '/login');
    await shot(p, 'g02-dang-nhap', { marks: [p.getByLabel('Tên đăng nhập'), p.getByRole('button', { name: 'Đăng nhập', exact: true }), p.getByRole('button', { name: /Giám đốc trung tâm/ }).first()] });
    await p.context().close();
  });
  await S('g03-giao-dien-chung', async () => {
    const p = await open('quanly'); await go(p, '/');
    await shot(p, 'g03-giao-dien-chung', { marks: [nav(p), p.getByRole('combobox', { name: 'Tìm kiếm nhanh' }), p.getByRole('button', { name: /Đổi nền/ }), p.getByRole('button', { name: /^Thông báo/ }), p.getByRole('button', { name: 'Tài khoản' })] });
    await p.getByRole('combobox', { name: 'Tìm kiếm nhanh' }).click();
    await p.keyboard.type('ST1');
    await p.waitForTimeout(700);
    await shot(p, 'g04-tim-kiem-nhanh');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.getByRole('button', { name: 'Tài khoản' }).click(); await p.waitForTimeout(300);
    await shot(p, 'g05-menu-tai-khoan', { marks: [p.getByRole('menu')] });
    await p.keyboard.press('Escape');
    await p.context().close();
    const g = await open('giaovien'); await go(g, '/');
    await g.getByRole('button', { name: /^Thông báo/ }).click(); await g.waitForTimeout(500);
    await shot(g, 'g06-chuong-thong-bao');
    await g.context().close();
  });
  await S('g07-dien-thoai', async () => {
    const p = await open('giaovien', { width: 390, height: 844 }); await go(p, '/');
    await shot(p, 'g07-dien-thoai', { marks: [p.getByRole('button', { name: 'Mở menu' })] });
    await p.getByRole('button', { name: 'Mở menu' }).click(); await p.waitForTimeout(400);
    await shot(p, 'g08-dien-thoai-menu');
    await p.context().close();
  });

  console.log('Tư vấn viên EC');
  await S('ec01-khu-vuc', async () => {
    const p = await open('tuvan'); await go(p, '/');
    const r = region(p, 'KPI tư vấn');
    await shot(p, 'ec01-khu-vuc', { marks: [r.locator('> div').first(), region(p, 'Đề xuất cần xử lý'), r.getByRole('link').first()] });
    await p.context().close();
  });
  await S('ec02-data-khach', async () => {
    const p = await open('tuvan'); await go(p, '/leads');
    await shot(p, 'ec02-data-khach', { marks: [btn(p, 'Nhập data khách').first(), p.getByRole('tablist').first(), p.getByRole('group', { name: 'Phễu L0–L5' }), p.getByLabel('Lịch hẹn')] });
    await btn(p, 'Nhập data khách').first().click(); await p.waitForTimeout(400);
    const d = dlg(p);
    await d.getByLabel('Họ tên phụ huynh').fill('Phạm Thị Mẫu');
    await d.getByLabel('Số điện thoại').fill('0000 555 123');
    await d.getByLabel('Họ tên học viên').fill('Phạm Gia Minh');
    await d.getByLabel('Nguồn khách').selectOption('Fanpage');
    await d.getByLabel('Ngày liên hệ lại').fill(addDays(today, 1));
    await d.getByLabel('Ngày liên hệ lại').scrollIntoViewIfNeeded();
    await shot(p, 'ec03-nhap-data', { clip: d, marks: [d.getByLabel('Nguồn khách'), d.getByLabel('Phân loại'), d.getByLabel('Ngày liên hệ lại')] });
    await p.context().close();
  });
  await S('ec04-ho-so-khach', async () => {
    const p = await open('tuvan'); await go(p, `/leads/${leadAppointing}`);
    await shot(p, 'ec04-ho-so-khach', { marks: [btn(p, 'Ghi tư vấn / phân loại').first(), btn(p, 'Đăng ký check-in'), btn(p, 'Khách đã check-in'), btn(p, 'Đăng ký học thử'), btn(p, 'Chuyển thành học viên')] });
    await btn(p, 'Ghi tư vấn / phân loại').first().click(); await p.waitForTimeout(400);
    await shot(p, 'ec05-ghi-tu-van', { clip: dlg(p), marks: [dlg(p).getByLabel('Phân loại'), dlg(p).getByLabel('Ngày liên hệ lại')] });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await btn(p, 'Đăng ký check-in').click(); await p.waitForTimeout(400);
    await shot(p, 'ec06-dang-ky-checkin', { clip: dlg(p), marks: [dlg(p).getByLabel('Ngày giờ check-in'), btn(dlg(p), 'Đăng ký', true)] });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await btn(p, 'Đăng ký học thử').click(); await p.waitForTimeout(500);
    await shot(p, 'ec08-dang-ky-hoc-thu', { clip: dlg(p), marks: [dlg(p).getByLabel('Lớp'), dlg(p).getByLabel('Buổi học')] });
    await p.context().close();
  });
  await S('ec07-da-checkin', async () => {
    const p = await open('tuvan'); await go(p, `/leads/${leadChecked}`);
    await shot(p, 'ec07-da-checkin', { marks: [p.getByText('Theo quy định, khách thuộc về').first()] });
    await btn(p, 'Chuyển thành học viên').click(); await p.waitForTimeout(600);
    const d = dlg(p);
    const a = d.getByText('Giám đốc trung tâm duyệt').first();
    await a.scrollIntoViewIfNeeded();
    await shot(p, 'ec09-chuyen-hoc-vien', { clip: d, marks: [a, d.getByLabel('Gói phí')] });
    await p.context().close();
  });
  await S('ec10-hoc-vien', async () => {
    const p = await open('tuvan'); await go(p, '/students?status=studying');
    await shot(p, 'ec10-hoc-vien', { marks: [p.getByRole('columnheader', { name: 'Đã đóng' }), p.getByRole('columnheader', { name: 'Hết phí dự kiến' })] });
    await go(p, `/students/${discountEnroll.student_id}?tab=classes`);
    await btn(p, `Thao tác đăng ký ${discountEnroll.code}`).click(); await p.waitForTimeout(300);
    await shot(p, 'ec11-de-nghi-giam', { marks: [p.getByRole('menuitem', { name: 'Đề nghị giảm học phí' })] });
    await p.context().close();
  });

  console.log('Trưởng phòng sales');
  await S('ts01-data-toan-phong', async () => {
    const p = await open('truongsales'); await go(p, '/leads');
    await shot(p, 'ts01-data-toan-phong', { marks: [p.getByLabel('Người phụ trách'), p.getByRole('columnheader', { name: 'Phụ trách' })] });
    await go(p, '/reports?type=staff_ec');
    await shot(p, 'ts02-kpi-ec', { marks: [p.getByRole('tab', { name: /KPI từng tư vấn viên/ }), p.getByRole('columnheader', { name: 'Check-in' }), p.getByRole('columnheader', { name: 'Data mới' })] });
    await go(p, '/reports?type=facilities');
    await shot(p, 'ts03-su-co', { marks: [p.getByRole('tab', { name: 'Sự cố cơ sở vật chất' })] });
    await p.context().close();
  });

  console.log('Chủ nhiệm CM');
  await S('cm01-khu-vuc', async () => {
    const p = await open('giaovien'); await go(p, '/');
    const r = region(p, 'KPI chủ nhiệm');
    await shot(p, 'cm01-khu-vuc', { marks: [r.locator('> div').first(), r.locator('> div').nth(1), region(p, 'Đề xuất cần xử lý')] });
    await p.context().close();
  });
  await S('cm02-lop', async () => {
    const p = await open('giaovien'); await go(p, `/classes/${st1a}`);
    await shot(p, 'cm02-lop', { marks: [p.getByText(/học viên dưới ngưỡng 90%/).first(), p.getByRole('columnheader', { name: /Đã đóng/ }), p.getByRole('columnheader', { name: 'Dự kiến hết phí' })] });
    await p.context().close();
  });
  await S('cm03-diem-danh', async () => {
    const p = await open('giaovien'); await go(p, '/training');
    await btn(p, 'Điểm danh').first().click(); await p.waitForTimeout(700);
    const d = dlg(p);
    await btn(d, 'Chưa chọn → Có mặt').click(); await p.waitForTimeout(200);
    await d.getByRole('radiogroup').first().getByRole('radio', { name: 'Vắng có phép' }).click();
    const imp = d.getByPlaceholder(/Hướng cải thiện/).first();
    await imp.fill('Ôn lại 10 từ vựng mỗi tối, phụ huynh kiểm tra');
    await imp.scrollIntoViewIfNeeded();
    await shot(p, 'cm03-diem-danh', { clip: d, marks: [d.getByRole('radiogroup').nth(1), d.getByRole('radiogroup', { name: /^BTVN/ }).first(), imp] });
    const rep = btn(d, 'Báo sự cố phòng học');
    await rep.scrollIntoViewIfNeeded();
    await shot(p, 'cm04a-nut-bao-su-co', { clip: d, marks: [rep] });
    await rep.click(); await p.waitForTimeout(500);
    const m = dlg(p);
    await m.getByLabel('Tên sự cố').fill('Bóng đèn cuối phòng nhấp nháy');
    await m.locator('textarea').fill('Hai bóng đèn cuối phòng nhấp nháy, học viên khó nhìn bảng.');
    await shot(p, 'cm04-bao-su-co', { clip: m, marks: [m.getByLabel('Tài sản trong phòng'), m.getByLabel('Đề xuất xử lý trước ngày')] });
    await p.context().close();
  });
  await S('cm05-tai-phi', async () => {
    if (!renewStudent) throw new Error('không có học viên để tái phí');
    const p = await open('giaovien'); await go(p, `/students/${renewStudent}?tab=classes`);
    await btn(p, /Tái đăng ký/).first().click(); await p.waitForTimeout(600);
    await shot(p, 'cm05-tai-phi', { clip: dlg(p), marks: [dlg(p).getByText('Giám đốc trung tâm duyệt').first(), dlg(p).getByLabel('Gói phí')] });
    await p.context().close();
  });
  await S('cm06-de-nghi', async () => {
    const p = await open('giaovien'); await go(p, `/students/${reserveEnroll.student_id}?tab=classes`);
    await btn(p, `Thao tác đăng ký ${reserveEnroll.code}`).click(); await p.waitForTimeout(300);
    await shot(p, 'cm06-menu-de-nghi', { marks: [p.getByRole('menuitem', { name: /Đề nghị bảo lưu/ }), p.getByRole('menuitem', { name: 'Đề nghị chuyển lớp' }), p.getByRole('menuitem', { name: 'Đề nghị lên level mới' })] });
    await p.getByRole('menuitem', { name: /Đề nghị bảo lưu/ }).click(); await p.waitForTimeout(400);
    await shot(p, 'cm07-de-nghi-bao-luu', { clip: dlg(p), marks: [dlg(p).getByLabel('Bảo lưu từ ngày'), dlg(p).getByLabel('Đến ngày')] });
    await p.context().close();
  });
  await S('cm08-test-hop-ph', async () => {
    const p = await open('giaovien'); await go(p, '/class-events');
    await shot(p, 'cm08-test-hop-ph', { marks: [btn(p, 'Đặt lịch test / họp PH'), p.getByRole('columnheader', { name: 'Trả kết quả cho PH' })] });
    await btn(p, 'Đặt lịch test / họp PH').click(); await p.waitForTimeout(400);
    await shot(p, 'cm09-dat-lich-test', { clip: dlg(p), marks: [dlg(p).getByRole('radiogroup', { name: 'Loại lịch' })] });
    await p.context().close();
  });
  await S('cm10-gio-day', async () => {
    const p = await open('giaovien'); await go(p, '/hr?tab=teaching');
    await shot(p, 'cm10-gio-day', { marks: [p.getByRole('tab', { name: 'Giờ dạy thực tế' })] });
    await go(p, '/hr?tab=leaves');
    await btn(p, 'Tạo đơn nghỉ').click(); await p.waitForTimeout(400);
    await shot(p, 'cm11-don-nghi', { clip: dlg(p) });
    await p.context().close();
  });

  console.log('Trưởng phòng học thuật');
  await S('hk01-duyet-cap-1', async () => {
    const p = await open('giaovu'); await go(p, '/approvals');
    await shot(p, 'hk01-duyet-cap-1', { marks: [p.getByRole('tab', { name: /Chờ tôi duyệt/ }), p.getByText('Chờ Trưởng phòng học thuật').first()] });
    await p.getByRole('row').nth(1).click(); await p.waitForTimeout(600);
    await shot(p, 'hk02-chi-tiet-duyet', { clip: dlg(p), marks: [btn(dlg(p), /Duyệt cấp 1/), btn(dlg(p), 'Từ chối', true)] });
    await p.context().close();
  });
  await S('hk03-nghi-trung-tam', async () => {
    const p = await open('giaovu'); await go(p, '/class-events?tab=closures');
    await shot(p, 'hk03-nghi-trung-tam', { marks: [btn(p, 'Khai báo nghỉ')] });
    await btn(p, 'Khai báo nghỉ').click(); await p.waitForTimeout(400);
    const d = dlg(p);
    await d.getByLabel('Từ ngày').fill(addDays(today, 3));
    await d.getByLabel('Đến ngày').fill(addDays(today, 5));
    await d.getByLabel('Lý do').fill('Cúp điện toàn tòa nhà để bảo trì');
    await p.waitForTimeout(1200);
    await shot(p, 'hk04-khai-bao-nghi', { clip: d, marks: [d.getByLabel('Lý do'), d.getByText(/Sẽ hủy/).first()] });
    await p.context().close();
  });
  await S('hk05-kpi-cm', async () => {
    const p = await open('giaovu'); await go(p, '/reports?type=staff_cm');
    await shot(p, 'hk05-kpi-cm', { marks: [p.getByRole('columnheader', { name: /Điểm danh/ }), p.getByRole('columnheader', { name: /Chấm BTVN/ })] });
    await go(p, '/classes?tab=packages');
    await shot(p, 'hk06-goi-phi', { marks: [btn(p, 'Thêm gói phí'), p.getByRole('columnheader', { name: /Nghỉ miễn phí/ })] });
    await p.context().close();
  });
  await S('hk07-lop-hoc', async () => {
    const p = await open('giaovu'); await go(p, '/classes');
    await shot(p, 'hk07-lop-hoc', { marks: [btn(p, 'Tạo lớp'), p.getByRole('tab', { name: /Khóa học/ })] });
    await btn(p, 'Tạo lớp').click(); await p.waitForTimeout(400);
    await shot(p, 'hk08-tao-lop', { clip: dlg(p) });
    await p.keyboard.press('Escape');
    await p.context().close();
  });
  await S('hk09-lich', async () => {
    const p = await open('giaovu'); await go(p, '/schedule');
    await shot(p, 'hk09-lich-tuan', { marks: [p.getByRole('radiogroup', { name: 'Chế độ xem' })] });
    await go(p, `/schedule?view=rooms&date=${addDays(today, 1)}`);
    await shot(p, 'hk10-so-do-phong', { marks: [p.getByRole('region', { name: 'Sơ đồ phòng' })] });
    await p.context().close();
  });
  await S('hk11-cham-soc', async () => {
    const p = await open('giaovu'); await go(p, '/care');
    await shot(p, 'hk11-cham-soc', { marks: [p.getByRole('tablist').first()] });
    await go(p, '/learning?tab=support');
    await shot(p, 'hk12-bo-tro', { marks: [p.getByRole('tablist').first()] });
    await go(p, '/hr?tab=teaching');
    await shot(p, 'hk13-duyet-gio-day', { marks: [btn(p, 'Chọn tất cả chờ duyệt')] });
    await p.context().close();
  });

  console.log('Giám đốc');
  await S('gd01-tong-quan', async () => {
    const p = await open('quanly'); await go(p, '/');
    await shot(p, 'gd01-tong-quan', { marks: [p.getByLabel('Kỳ báo cáo'), p.getByRole('button', { name: /Học viên đang học/ }), p.getByRole('button', { name: /Định nghĩa chỉ số/ })] });
    await p.context().close();
  });
  await S('gd02-phe-duyet', async () => {
    const p = await open('quanly'); await go(p, '/approvals');
    await shot(p, 'gd02-phe-duyet', { marks: [p.getByRole('tab', { name: /Chờ Giám đốc duyệt/ }), p.getByRole('row', { name: /Đăng ký mới/ }).first(), p.getByRole('row', { name: /Chuyển lớp/ }).first()] });
    await p.getByRole('row', { name: /Đăng ký mới/ }).first().click(); await p.waitForTimeout(600);
    await shot(p, 'gd03-duyet-hoc-phi', { clip: dlg(p), marks: [dlg(p).getByText('Khi duyệt: đăng ký có hiệu lực').first(), btn(dlg(p), 'Duyệt', true)] });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.getByRole('row', { name: /Chuyển lớp/ }).first().click(); await p.waitForTimeout(600);
    await shot(p, 'gd04-duyet-cuoi', { clip: dlg(p), marks: [dlg(p).getByText('Trưởng phòng học thuật').first()] });
    await p.context().close();
  });
  await S('gd05-bao-cao', async () => {
    const p = await open('quanly'); await go(p, '/reports?type=department');
    await shot(p, 'gd05-phong-ban', { marks: [p.getByRole('tab', { name: 'Tổng hợp theo phòng ban' }), p.getByRole('heading', { name: 'Xu hướng 6 tháng' }), btn(p, 'Xuất CSV')] });
    await p.context().close();
  });
  await S('gd06-tai-khoan', async () => {
    const p = await open('quanly'); await go(p, '/account');
    await shot(p, 'gd06-tai-khoan', { marks: [p.getByRole('button', { name: /Trần Văn Hùng/ }).first(), btn(p, 'Reset dữ liệu demo')] });
    await go(p, '/hr?tab=staff');
    await shot(p, 'gd07-nhan-su', { marks: [p.getByRole('tablist').first()] });
    await p.context().close();
  });

  console.log('Kế toán');
  await S('kt01-tong-quan', async () => {
    const p = await open('thungan'); await go(p, '/');
    await shot(p, 'kt01-tong-quan', { marks: [region(p, 'Thực thu')] });
    await go(p, '/reports?type=daily');
    await shot(p, 'kt02-bao-cao-ngay', { marks: [p.getByRole('tab', { name: 'Ngày (kế toán)' }), p.getByRole('columnheader', { name: 'Số hoàn new' }), p.getByRole('columnheader', { name: /Thực thu tháng/ })] });
    await p.context().close();
  });
  await S('kt03-thu-tien', async () => {
    const p = await open('thungan'); await go(p, '/finance');
    await shot(p, 'kt03-cong-no', { marks: [p.getByRole('tablist').first(), btn(p, 'Thu tiền').first()] });
    await go(p, `/students/${debtStudent}?tab=finance`);
    await btn(p, 'Thu tiền').first().click(); await p.waitForTimeout(500);
    const d = dlg(p);
    await d.getByRole('radio', { name: 'Quẹt thẻ' }).click(); await p.waitForTimeout(200);
    await shot(p, 'kt04-thu-tien-the', { clip: d, marks: [d.getByRole('radio', { name: 'Quẹt thẻ' }), d.getByLabel('Số CCCD chủ thẻ'), d.getByLabel('Ngày cấp thẻ'), d.getByLabel('Đơn vị cấp thẻ')] });
    await p.context().close();
  });
  await S('kt05-phieu-thu', async () => {
    const p = await open('thungan'); await go(p, '/finance?tab=receipts');
    await shot(p, 'kt05-phieu-thu', { marks: [p.getByText(/^Khách mới:/).first(), p.getByRole('columnheader', { name: 'Nguồn doanh số' }), p.getByLabel('Nguồn doanh số')] });
    await go(p, `/finance/receipts/${receiptId}`);
    await shot(p, 'kt06-in-phieu', { marks: [btn(p, /In phiếu|Mở bản in/).first()] });
    await go(p, `/students/${walletStudent}?tab=finance`);
    await btn(p, 'Nạp tiền').first().click(); await p.waitForTimeout(400);
    await shot(p, 'kt07-nap-coc', { clip: dlg(p) });
    await p.keyboard.press('Escape');
    await go(p, '/approvals?view=to_pay');
    await shot(p, 'kt08-cho-chi', { marks: [p.getByRole('tab', { name: /chờ chi/ })] });
    await p.context().close();
  });

  console.log('Cơ sở vật chất');
  await S('o01-cong-viec', async () => {
    const p = await open('vanhanh'); await go(p, '/tasks');
    await shot(p, 'o01-cong-viec', { marks: [btn(p, 'Tạo công việc'), btn(p, 'Checklist từ mẫu')] });
    await p.context().close();
  });
  await S('o04-tai-san', async () => {
    const p = await open('vanhanh'); await go(p, '/assets?tab=issues');
    await shot(p, 'o04-su-co', { marks: [p.getByRole('columnheader', { name: 'Đề xuất xử lý' })] });
    if (openIssue) {
      await go(p, `/assets/issues/${openIssue}`);
      await shot(p, 'o05-xu-ly-su-co', { marks: [btn(p, 'Tạo công việc xử lý'), btn(p, 'Tạo đề xuất chi'), btn(p, 'Xác nhận đã xử lý')] });
    }
    await p.context().close();
  });
} finally {
  await browser.close();
  server.close(); db.close();
}
const bad = results.filter((r) => r[1] !== 'ok');
console.log(`\n${results.length - bad.length}/${results.length} nhóm ảnh xong. Ảnh ở ${OUT}`);
