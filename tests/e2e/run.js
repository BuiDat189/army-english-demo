// Kiểm thử trình duyệt thật (Chrome ẩn) cho 3 kịch bản demo + phân quyền giao diện + bố cục responsive.
// Chạy: npm run build && npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launch, loggedInPage, settle, layoutIssues, ROOT } from './lib.js';
import { vnToday, addDays } from '../../server/lib/time.js';
import { formsSection } from './forms-section.js';
import { crmSection } from './crm-section.js';

const OUT = path.join(ROOT, 'tests', 'e2e', 'report');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let current = null;
function assert(cond, msg) { if (!cond) throw new Error(`Kiểm tra thất bại: ${msg}`); }
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✓ ${name}`); } catch (e) {
    const msg = e.message.split('\n').filter(Boolean).slice(0, 4);
    results.push({ name, ok: false, error: msg.join(' | ') });
    console.log(`  ✗ ${name}\n      ${msg.join('\n      ')}`);
    if (current) await current.screenshot({ path: path.join(OUT, `FAIL_${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`), fullPage: true }).catch(() => {});
    throw e;
  }
}
// Chờ thông báo, rồi chờ modal/drawer đang chạy hiệu ứng đóng biến mất hẳn khỏi DOM
const toast = async (page, text) => {
  await page.getByRole('status').filter({ hasText: text }).first().waitFor({ timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][data-state="closed"]'), null, { timeout: 3000 }).catch(() => {});
};

const srv = await startServer();
const browser = await launch();
const consoleErrors = [];
const as = async (user, width = 1440) => {
  const s = await loggedInPage(browser, srv.url, user, { width, height: width < 500 ? 844 : 900 });
  s.page.on('console', (m) => {
    // 4xx là phản hồi kiểm tra dữ liệu/quyền có chủ đích trong kịch bản; vẫn bắt lỗi 5xx và lỗi JS
    if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) consoleErrors.push(`[${user}] ${m.text()}`);
  });
  s.page.on('pageerror', (e) => consoleErrors.push(`[${user}] pageerror: ${e.message}`));
  current = s.page;
  return s;
};
const today = vnToday();
const db = srv.db;

try {
  // ===================== KỊCH BẢN 1 =====================
  console.log('Kịch bản 1: Data khách → Check-in → Học thử → GĐ duyệt học phí → Thu tiền → Xếp lớp');
  const tv = await as('tuvan');
  let p = tv.page;
  let leadId; let studentId; let enrollmentId;
  const dashBefore = db.prepare(`SELECT COUNT(DISTINCT st.id) n FROM students st JOIN enrollments e ON e.student_id = st.id WHERE e.status = 'active' AND st.status = 'active'`).get().n;

  await step('KB1.1 EC nhập data khách (nguồn, phân loại, ngày liên hệ lại bắt buộc)', async () => {
    await p.goto(`${srv.url}/leads`); await settle(p);
    await p.getByRole('button', { name: 'Nhập data khách' }).first().click();
    const d = p.getByRole('dialog');
    // Lỗi kiểm tra dữ liệu hiện cạnh trường, giữ dữ liệu đã nhập
    await d.getByLabel('Họ tên phụ huynh').fill('Lê Thị Demo');
    await d.getByRole('button', { name: 'Tạo hồ sơ' }).click();
    await d.getByText('Vui lòng nhập số điện thoại.').waitFor();
    await d.getByText('Chọn ngày liên hệ lại để hệ thống nhắc việc.').waitFor();
    assert(await d.getByLabel('Họ tên phụ huynh').inputValue() === 'Lê Thị Demo', 'giữ dữ liệu khi lỗi');
    await d.getByLabel('Số điện thoại').fill('0000 777 001');
    await d.getByLabel('Họ tên học viên').fill('Lê Minh Demo');
    await d.getByLabel('Ngày sinh').fill('2017-03-15');
    await d.getByLabel('Khóa quan tâm').selectOption({ label: 'Army Movers 1 (8–10 tuổi)' });
    await d.getByLabel('Nguồn khách').selectOption('Fanpage');
    await d.getByLabel('Phân loại').selectOption({ label: 'Tiềm năng tháng' });
    await d.getByLabel('Ngày liên hệ lại').fill(addDays(today, 1));
    await d.getByRole('button', { name: 'Tạo hồ sơ' }).click();
    await p.waitForURL(/\/leads\/\d+$/);
    leadId = Number(p.url().split('/').pop());
    await p.getByRole('heading', { name: 'Lê Minh Demo' }).waitFor();
    await p.getByText('Tiềm năng tháng').first().waitFor();
  });

  await step('KB1.2 Ghi tư vấn + đổi phân loại "Đang lên hẹn"', async () => {
    await p.getByRole('button', { name: 'Ghi tư vấn / phân loại' }).first().click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('Nội dung').fill('Tư vấn lộ trình Movers, phụ huynh quan tâm lịch tối thứ 3–6');
    await dlg.getByLabel('Kết quả').fill('Hẹn lên trung tâm');
    await dlg.getByLabel('Phân loại').selectOption({ label: 'Đang lên hẹn' });
    await dlg.getByRole('button', { name: 'Lưu' }).click();
    await toast(p, 'Đã ghi lịch sử tư vấn');
    await p.getByText('Tư vấn lộ trình Movers').waitFor();
    await p.getByText('Đang lên hẹn').first().waitFor();
  });

  await step('KB1.3 Đăng ký check-in ⇒ đề xuất cho tất cả CM; khách check-in ⇒ khóa người phụ trách', async () => {
    await p.getByRole('button', { name: 'Đăng ký check-in' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Đăng ký' }).click();
    await toast(p, 'Đã đăng ký check-in');
    await p.getByText('Đề xuất đã đẩy cho CM').waitFor();
    const cms = db.prepare(`SELECT COUNT(*) n FROM tasks WHERE related_type = 'lead' AND related_id = ?`).get(leadId).n;
    assert(cms >= 3, `đề xuất cho mọi CM (có ${cms})`);
    await p.getByRole('button', { name: 'Khách đã check-in' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Xác nhận check-in' }).click();
    await toast(p, 'Đã ghi nhận khách check-in');
    await p.getByText('Theo quy định, khách thuộc về').waitFor();
    assert(db.prepare('SELECT owner_locked FROM leads WHERE id = ?').get(leadId).owner_locked === 1, 'khóa người phụ trách');
  });

  await step('KB1.4 Đăng ký học thử (lịch riêng hôm nay) và ghi kết quả', async () => {
    await p.getByRole('button', { name: 'Đăng ký học thử' }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByRole('radio', { name: 'Lịch riêng' }).click();
    await dlg.getByLabel('Ngày').fill(today);
    await dlg.getByLabel('Bắt đầu').fill('21:00');
    await dlg.getByLabel('Kết thúc').fill('21:40');
    await dlg.getByLabel('Phòng').selectOption({ label: 'P202' });
    await dlg.getByLabel('Giáo viên').selectOption({ label: 'Đỗ Thanh Tâm' });
    await dlg.getByRole('button', { name: 'Đặt lịch' }).click();
    await toast(p, 'Đã đăng ký học thử');
    await p.getByText('Đăng ký học thử').first().waitFor();
    await p.getByRole('button', { name: 'Ghi kết quả' }).click();
    const d2 = p.getByRole('dialog');
    await d2.getByLabel('Trình độ đánh giá').fill('A1 Movers');
    await d2.getByLabel('Khóa đề xuất').selectOption({ label: 'Army Movers 1' });
    await d2.getByLabel('Nhận xét của giáo viên').fill('Phản xạ tốt, phù hợp lớp Movers 1');
    await d2.getByRole('button', { name: 'Lưu kết quả' }).click();
    await toast(p, 'Đã lưu kết quả');
    await p.getByText('Đã học thử').first().waitFor();
  });

  await step('KB1.5–6 Chuyển thành học viên + đăng ký khóa ⇒ học phí chờ Giám đốc duyệt', async () => {
    await p.getByRole('button', { name: 'Chuyển thành học viên' }).click();
    const dlg = p.getByRole('dialog');
    assert(await dlg.getByLabel('Họ tên').first().inputValue() === 'Lê Minh Demo', 'tên học viên điền sẵn');
    assert(await dlg.getByLabel('Số điện thoại').inputValue() === '0000777001', 'SĐT phụ huynh điền sẵn');
    assert((await dlg.getByLabel('Khóa học').inputValue()) !== '', 'khóa học đề xuất điền sẵn');
    await dlg.getByText('Giám đốc trung tâm duyệt').first().waitFor();
    await dlg.getByText('Tổng: 5.400.000 đ / 5.400.000 đ').waitFor();
    await dlg.getByRole('button', { name: 'Tạo học viên & đăng ký khóa' }).click();
    await p.waitForURL(/\/students\/\d+\?tab=classes/);
    studentId = Number(new URL(p.url()).pathname.split('/').pop());
    enrollmentId = db.prepare('SELECT id FROM enrollments WHERE student_id = ?').get(studentId).id;
    await p.getByText('Học phí đang chờ Giám đốc duyệt').first().waitFor();
    assert(db.prepare('SELECT status FROM enrollments WHERE id = ?').get(enrollmentId).status === 'pending_approval', 'đăng ký chờ duyệt');
    assert(db.prepare('SELECT COUNT(*) n FROM students WHERE lead_id = ?').get(leadId).n === 1, 'đúng 1 học viên cho khách');
  });

  await step('KB1.6b Giám đốc duyệt học phí đăng ký', async () => {
    const m = await as('quanly'); p = m.page;
    await p.goto(`${srv.url}/approvals`); await settle(p);
    await p.getByText('Đăng ký mới Army Movers 1 – Lê Minh Demo').first().click();
    const dlg = p.getByRole('dialog');
    await dlg.getByText('Khi duyệt: đăng ký có hiệu lực').waitFor();
    await dlg.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await toast(p, 'Đăng ký có hiệu lực');
    assert(db.prepare('SELECT status FROM enrollments WHERE id = ?').get(enrollmentId).status === 'pending_class', 'đăng ký chờ xếp lớp sau khi duyệt');
  });

  await step('KB1.7 Thu ngân thu một phần học phí (bấm xác nhận 2 lần liên tiếp)', async () => {
    const cs = await as('thungan'); p = cs.page;
    await p.goto(`${srv.url}/students/${studentId}?tab=finance`); await settle(p);
    await p.getByRole('button', { name: 'Thu tiền' }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('Số tiền thu').fill('');
    await dlg.getByLabel('Số tiền thu').fill('9000000');
    await dlg.getByRole('button', { name: 'Xác nhận thu tiền' }).click();
    await dlg.getByText(/Không vượt công nợ còn lại/).waitFor();
    await dlg.getByLabel('Số tiền thu').fill('2000000');
    const btn = dlg.getByRole('button', { name: 'Xác nhận thu tiền' });
    await btn.dblclick();
    await toast(p, 'Thu tiền thành công');
    await settle(p);
    assert(db.prepare(`SELECT COUNT(*) n FROM receipts WHERE enrollment_id = ? AND status = 'confirmed'`).get(enrollmentId).n === 1, 'chỉ 1 phiếu thu');
    await p.getByText('3.400.000 đ').first().waitFor();
    await p.screenshot({ path: path.join(OUT, 'KB1_hoc_phi_sau_thu.png'), fullPage: true });
  });

  await step('KB1.8 Giáo vụ xếp lớp', async () => {
    const gv = await as('giaovu'); p = gv.page;
    await p.goto(`${srv.url}/students/${studentId}?tab=classes`); await settle(p);
    await p.getByRole('button', { name: 'Xếp lớp' }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByRole('radio').first().check();
    await dlg.getByRole('button', { name: 'Xếp vào lớp' }).click();
    await toast(p, 'Đã xếp vào lớp');
    await settle(p);
    const cls = db.prepare('SELECT c.code, c.id FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.id = ?').get(enrollmentId);
    assert(cls, 'đăng ký đã có lớp');
    await p.reload(); await settle(p);
    await p.getByRole('link', { name: cls.code }).first().waitFor();
    await p.goto(`${srv.url}/classes/${cls.id}`); await settle(p);
    await p.getByRole('link', { name: 'Lê Minh Demo' }).first().waitFor();
  });

  await step('KB1.9 Tổng quan cập nhật (học viên đang học +1)', async () => {
    const m = await as('quanly'); p = m.page;
    await p.goto(`${srv.url}/`); await settle(p);
    const tile = p.getByRole('button', { name: /Học viên đang học/ });
    const txt = await tile.getAttribute('aria-label');
    assert(txt.includes(String(dashBefore + 1)), `thẻ học viên đang học = ${dashBefore + 1} (thực tế: ${txt.replace(/\n/g, ' ')})`);
    await tile.click();
    await p.waitForURL(/\/students\?status=studying/);
    await p.getByText('Lê Minh Demo').first().waitFor();
  });

  // ===================== KỊCH BẢN 2 =====================
  console.log('Kịch bản 2: Điểm danh → Chăm sóc → Học bù');
  const sess = db.prepare(`SELECT s.*, c.code FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE s.date = ? AND s.teacher_id = 4 AND s.status = 'scheduled'`).get(today);
  let absentName;
  await step('KB2.1 Giáo viên mở lớp hôm nay và điểm danh 1 học viên vắng', async () => {
    const t = await as('giaovien'); p = t.page;
    await p.goto(`${srv.url}/training`); await settle(p);
    await p.getByRole('button', { name: 'Điểm danh' }).first().click();
    const dlg = p.getByRole('dialog');
    await dlg.getByText('Điểm danh (').waitFor();
    const firstGroup = dlg.getByRole('radiogroup').first();
    absentName = (await firstGroup.getAttribute('aria-label')).replace('Điểm danh ', '');
    await firstGroup.getByRole('radio', { name: 'Vắng có phép' }).click();
    await dlg.getByPlaceholder('Ghi chú (lý do vắng, đến muộn…)').first().fill('Ốm, mẹ báo qua Zalo');
    await dlg.getByRole('button', { name: 'Chưa chọn → Có mặt' }).click();
    await dlg.getByLabel('Chủ đề / nội dung đã dạy').fill('Unit 11 – Food & drinks');
    await dlg.getByRole('button', { name: 'Lưu điểm danh' }).click();
    await toast(p, 'Tạo 1 việc chăm sóc vắng học');
  });

  await step('KB2.2 Lưu lại / mở lại không nhân đôi', async () => {
    const dlg = p.getByRole('dialog');
    await dlg.getByText('Đã điểm danh lúc').waitFor();
    // Đổi ghi chú rồi lưu lần nữa
    await dlg.getByLabel('Nhận xét chung của giáo viên').fill('Lớp hào hứng');
    await dlg.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await toast(p, 'Đã lưu điểm danh (0 thay đổi)');
    await p.reload(); await settle(p);
    const n = db.prepare('SELECT COUNT(*) n FROM attendance WHERE session_id = ?').get(sess.id).n;
    const roster = db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE class_id = ? AND status = 'active'`).get(sess.class_id).n;
    assert(n === roster, `số bản ghi điểm danh = sĩ số (${n}/${roster})`);
    const care = db.prepare(`SELECT COUNT(*) n FROM care_cases c JOIN attendance a ON a.id = c.attendance_id WHERE a.session_id = ?`).get(sess.id).n;
    assert(care === 1, `đúng 1 việc chăm sóc (thực tế ${care})`);
  });

  await step('KB2.3 Giáo vụ ghi kết quả liên hệ trong việc chăm sóc', async () => {
    const gv = await as('giaovu'); p = gv.page;
    await p.goto(`${srv.url}/care?type=absence`); await settle(p);
    await p.getByRole('row', { name: new RegExp(absentName) }).first().click();
    const dlg = p.getByRole('dialog');
    await dlg.getByText('Ghi kết quả liên hệ').waitFor();
    await dlg.getByLabel('Nội dung').fill('Gọi hỏi thăm, bé ốm sốt 2 ngày');
    await dlg.getByLabel('Kết quả').fill('Phụ huynh đồng ý học bù');
    await dlg.getByRole('button', { name: 'Lưu liên hệ' }).click();
    await toast(p, 'Đã ghi kết quả liên hệ');
    await dlg.getByText('Gọi hỏi thăm, bé ốm sốt 2 ngày').waitFor();
  });

  await step('KB2.4 Xếp học bù liên kết với buổi nghỉ', async () => {
    const dlg = p.getByRole('dialog', { name: /Liên hệ vì vắng/ });
    await dlg.getByRole('button', { name: 'Xếp học bù' }).click();
    const m = p.getByRole('dialog', { name: 'Xếp lịch học bù' });
    await m.getByRole('radio', { name: 'Tạo buổi học bù riêng' }).click();
    await m.getByLabel('Ngày').fill(addDays(today, 2));
    await m.getByLabel('Bắt đầu').fill('08:00');
    await m.getByLabel('Kết thúc').fill('09:00');
    await m.getByLabel('Phòng').selectOption({ label: 'P202 (10 chỗ)' });
    await m.getByLabel('Giáo viên/Trợ giảng phụ trách').selectOption({ label: 'Đặng Thu Trang' });
    await m.getByRole('button', { name: 'Xếp học bù' }).click();
    await toast(p, 'Đã xếp lịch học bù');
    await dlg.getByText('Học bù:').waitFor();
    const mk = db.prepare(`SELECT m.* FROM makeups m JOIN attendance a ON a.id = m.absence_attendance_id WHERE a.session_id = ?`).all(sess.id);
    assert(mk.length === 1 && mk[0].status === 'scheduled', 'đúng 1 lịch học bù gắn buổi nghỉ');
    await p.goto(`${srv.url}/training?tab=absences`); await settle(p);
    await p.getByRole('row', { name: new RegExp(absentName) }).getByText('Đã xếp học bù').first().waitFor();
    await p.screenshot({ path: path.join(OUT, 'KB2_hoc_vien_vang.png'), fullPage: true });
  });

  // ===================== KỊCH BẢN 3 =====================
  console.log('Kịch bản 3: Báo hỏng → Đề xuất → Phê duyệt');
  let issueUrl;
  await step('KB3.1 Nhân viên báo hỏng thiết bị', async () => {
    const t = await as('giaovien'); p = t.page;
    await p.goto(`${srv.url}/assets`); await settle(p);
    await p.getByRole('button', { name: 'Báo hỏng' }).first().click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('Tài sản').selectOption({ label: 'P101 · Máy chiếu Epson EB-X51 (TS-001)' });
    await dlg.locator('textarea').first().fill('Máy chiếu tắt đột ngột sau 10 phút');
    await dlg.getByRole('radio', { name: 'Cao – ảnh hưởng giờ học' }).click();
    await dlg.getByRole('button', { name: 'Gửi báo cáo' }).click();
    await p.waitForURL(/\/assets\/issues\/\d+/);
    issueUrl = p.url();
    await p.getByText('Mới báo').first().waitFor();
  });

  await step('KB3.2 Vận hành tạo công việc xử lý và đề xuất chi', async () => {
    const o = await as('vanhanh'); p = o.page;
    await p.goto(issueUrl); await settle(p);
    await p.getByRole('button', { name: 'Tạo công việc xử lý' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Tạo công việc' }).click();
    await toast(p, 'Đã tạo công việc xử lý');
    await p.getByRole('button', { name: 'Tạo đề xuất chi' }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('Chi phí dự kiến').fill('2400000');
    await dlg.getByLabel('Mô tả / báo giá').fill('Thay bóng đèn chính hãng');
    await dlg.getByRole('button', { name: 'Gửi đề xuất' }).click();
    await toast(p, 'Đã gửi đề xuất chi');
    await p.getByText('Chờ duyệt chi').first().waitFor();
    assert(await p.getByRole('button', { name: 'Xác nhận đã xử lý' }).isDisabled(), 'chưa duyệt thì chưa xác nhận xử lý');
  });

  await step('KB3.3 Quản lý duyệt đề xuất (bấm 2 lần không tạo tác động kép)', async () => {
    const m = await as('quanly'); p = m.page;
    await p.goto(`${srv.url}/approvals`); await settle(p);
    await p.getByRole('row', { name: /Chi sửa chữa: Máy chiếu Epson/ }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('Ghi chú khi duyệt / lý do từ chối').fill('Đồng ý, ưu tiên xử lý trong tuần');
    const btn = dlg.getByRole('button', { name: 'Duyệt', exact: true });
    await btn.dblclick();
    await dlg.getByText('Đã duyệt nhưng chưa chi tiền').waitFor();
    const a = db.prepare(`SELECT * FROM approvals WHERE ref_type = 'asset_issue' ORDER BY id DESC LIMIT 1`).get();
    assert(a.status === 'approved' && a.payment_status === 'unpaid', 'đã duyệt, chưa chi');
    assert(db.prepare(`SELECT COUNT(*) n FROM approval_events WHERE approval_id = ? AND action = 'approved'`).get(a.id).n === 1, 'chỉ 1 sự kiện duyệt');
  });

  await step('KB3.4 Người phụ trách xác nhận đã xử lý; lịch sử đầy đủ', async () => {
    const o = await as('vanhanh'); p = o.page;
    await p.goto(issueUrl); await settle(p);
    await p.getByRole('button', { name: 'Xác nhận đã xử lý' }).click();
    await p.getByRole('dialog').getByLabel('Kết quả xử lý').fill('Đã thay bóng đèn, chạy thử 2 giờ ổn định');
    await p.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
    await toast(p, 'Đã xác nhận xử lý xong');
    for (const t of ['Báo sự cố: ', 'Tạo công việc xử lý', 'Tạo đề xuất chi', 'Quản lý đã duyệt', 'Xác nhận đã xử lý']) await p.getByText(t).first().waitFor();
    await p.getByText('Đã duyệt – chưa chi').first().waitFor();
    await p.screenshot({ path: path.join(OUT, 'KB3_bao_hong_da_xu_ly.png'), fullPage: true });
  });

  await step('KB3.5 Thu ngân xác nhận đã chi (bước riêng sau khi duyệt)', async () => {
    const c = await as('thungan'); p = c.page;
    await p.goto(`${srv.url}/approvals?view=to_pay`); await settle(p);
    await p.getByRole('row', { name: /Chi sửa chữa: Máy chiếu Epson/ }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Xác nhận đã chi' }).click();
    await p.getByRole('dialog', { name: 'Xác nhận đã chi tiền' }).getByRole('button', { name: 'Xác nhận đã chi' }).click();
    await toast(p, 'Đã xác nhận chi tiền');
    const a = db.prepare(`SELECT * FROM approvals WHERE ref_type = 'asset_issue' ORDER BY id DESC LIMIT 1`).get();
    assert(a.payment_status === 'paid', 'đã chi');
  });

  // ===================== PHÂN QUYỀN QUA GIAO DIỆN =====================
  console.log('Phân quyền qua giao diện');
  await step('Chủ nhiệm CM: không có menu Học phí; vào URL trực tiếp bị chặn', async () => {
    const t = await as('giaovien'); p = t.page;
    await p.goto(`${srv.url}/`); await settle(p);
    const nav = p.getByRole('complementary', { name: 'Điều hướng chính' });
    assert(!(await nav.getByText('Học phí – Thu chi').count()), 'không thấy menu Học phí');
    await nav.getByText('Data khách hàng').waitFor(); // CM nhập data khách & đẩy tái phí
    await nav.getByText('Test – Họp PH – Lịch nghỉ').waitFor();
    await p.goto(`${srv.url}/finance`); await settle(p);
    await p.getByText('Bạn không có quyền xem nội dung này').waitFor();
  });
  await step('Vận hành: không thấy học viên/phụ huynh/tài chính', async () => {
    const o = await as('vanhanh'); p = o.page;
    await p.goto(`${srv.url}/`); await settle(p);
    const nav = p.getByRole('complementary', { name: 'Điều hướng chính' });
    for (const label of ['Học viên – Phụ huynh', 'Học phí – Thu chi', 'Data khách hàng']) assert(!(await nav.getByText(label).count()), `ẩn ${label}`);
    assert(!(await p.getByText('Tiền thực thu trong kỳ').count()), 'không thấy thẻ tiền thu');
    await p.goto(`${srv.url}/students/1`); await settle(p);
    await p.getByText('Bạn không có quyền xem nội dung này').waitFor();
  });
  await step('Chuyển nhanh tài khoản demo đổi menu theo vai trò', async () => {
    const m = await as('quanly'); p = m.page;
    await p.goto(`${srv.url}/account`); await settle(p);
    await p.getByRole('button', { name: /Bùi Quang Huy/ }).click();
    await p.waitForURL(`${srv.url}/`); await settle(p);
    const nav = p.getByRole('complementary', { name: 'Điều hướng chính' });
    await nav.getByText('Học phí – Thu chi').waitFor();
    assert(!(await nav.getByText('Data khách hàng').count()), 'kế toán không thấy Data khách hàng');
  });

  // ===================== DỮ LIỆU GIỮ SAU RELOAD & XUẤT CSV =====================
  await step('Reload giữ dữ liệu, bộ lọc trên URL', async () => {
    const m = await as('quanly'); p = m.page;
    await p.goto(`${srv.url}/leads?status=all&q=Lê%20Minh%20Demo`); await settle(p);
    await p.getByText('Lê Minh Demo').first().waitFor();
    await p.reload(); await settle(p);
    await p.getByText('Lê Minh Demo').first().waitFor();
    assert(await p.getByRole('searchbox', { name: 'Tìm kiếm' }).inputValue() === 'Lê Minh Demo', 'giữ ô tìm kiếm');
  });

  // ===================== BỐ CỤC RESPONSIVE =====================
  console.log('Bố cục 1440 / 1024 / 390');
  const pages = ['/', '/leads', `/leads/${leadId}`, '/students', `/students/${studentId}?tab=finance`, '/classes', '/schedule', '/training', '/finance', '/care', '/tasks', '/tasks?mode=kanban', '/hr?tab=schedule', '/approvals', '/assets', '/inventory', '/notices', '/reports', '/account', '/learning', '/learning?tab=support', '/performance', '/performance?tab=cm', '/finance?tab=wallet', '/classes?tab=packages', '/class-events', '/class-events?tab=closures', '/reports?type=daily', '/reports?type=staff_ec', '/reports?type=staff_cm'];
  for (const w of [1440, 1024, 390]) {
    await step(`Bố cục ${w}px: không tràn ngang, không lỗi console`, async () => {
      const m = await as('quanly', w); p = m.page;
      const bad = [];
      for (const u of pages) {
        await p.goto(srv.url + u); await settle(p);
        const issues = await layoutIssues(p);
        if (issues.length) bad.push(`${u}: ${issues[0]}`);
        await p.screenshot({ path: path.join(OUT, `layout_${w}_${u.replace(/[^a-z0-9]+/gi, '_') || 'root'}.png`) });
      }
      assert(!bad.length, bad.join(' | '));
    });
  }
  await step('Điện thoại 390px: modal thu tiền hiển thị trọn, cuộn được', async () => {
    const c = await as('thungan', 390); p = c.page;
    await p.goto(`${srv.url}/students/${studentId}?tab=finance`); await settle(p);
    await p.getByRole('button', { name: 'Thu tiền' }).click();
    // Tấm trượt từ dưới lên: chờ hiệu ứng kết thúc rồi mới đo vị trí
    await p.getByRole('dialog').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = await p.getByRole('dialog').boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845, `modal nằm trong màn hình (${JSON.stringify(box)})`);
    await p.screenshot({ path: path.join(OUT, 'mobile_modal_thu_tien.png') });
    await p.keyboard.press('Escape');
    const m = await as('quanly', 390); p = m.page;
    await p.goto(`${srv.url}/schedule`); await settle(p);
    await p.getByRole('tablist', { name: 'Chọn ngày trong tuần' }).waitFor();
    await p.screenshot({ path: path.join(OUT, 'mobile_lich_ngay.png'), fullPage: true });
  });
  await formsSection({ as, step, assert, srv, db, toast, settle });
  await crmSection({ as, step, assert, srv, db, toast, settle });
} catch {
  // đã ghi nhận trong results
} finally {
  await browser.close();
  await srv.close();
}

const failed = results.filter((r) => !r.ok);
const report = { at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results, consoleErrors };
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2));
console.log(`\nKết quả: ${report.passed} đạt, ${report.failed} lỗi. Lỗi console: ${consoleErrors.length}`);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 10).join('\n'));
process.exitCode = failed.length || consoleErrors.length ? 1 : 0;
