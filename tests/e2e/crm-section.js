// Phần E2E cho các tính năng bổ sung theo CRM — được run.js gọi.
import { vnToday } from '../../server/lib/time.js';

export async function crmSection({ as, step, assert, srv, db, toast, settle }) {
  console.log('Tính năng bổ sung theo CRM');
  const today = vnToday();
  let p;

  await step('Check-in tại quầy: thu ngân bấm check-in, không tạo trùng', async () => {
    p = (await as('thungan')).page;
    await p.goto(`${srv.url}/learning`); await settle(p);
    await p.getByRole('button', { name: 'Check-in', exact: true }).first().click();
    await toast(p, 'Đã check-in');
    const n = db.prepare('SELECT COUNT(*) n FROM checkins WHERE date = ?').get(today).n;
    assert(n === 1, `1 lượt check-in hôm nay (thực tế ${n})`);
  });

  await step('Giáo viên điểm danh kèm chấm BTVN, cho điểm và nhận xét', async () => {
    const s = db.prepare(`SELECT id FROM class_sessions WHERE date = ? AND teacher_id = 4 AND status != 'cancelled' ORDER BY start_time LIMIT 1`).get(today);
    p = (await as('giaovien')).page;
    await p.goto(`${srv.url}/training?session=${s.id}`); await settle(p);
    const dlg = p.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Chưa chọn → Có mặt' }).click();
    const first = await dlg.getByRole('radiogroup').first().getAttribute('aria-label');
    const name = first.replace('Điểm danh ', '');
    await dlg.getByRole('radiogroup', { name: `BTVN ${name}` }).getByRole('radio', { name: 'Hoàn thành' }).click();
    await dlg.getByLabel(`Điểm BTVN ${name}`).fill('9');
    await dlg.getByLabel(`Nhận xét ${name}`).fill('Làm bài cẩn thận');
    await dlg.getByLabel('BTVN giao cho buổi sau').fill('Workbook trang 30');
    await dlg.getByRole('button', { name: /^Lưu (điểm danh|thay đổi)$/ }).click();
    await toast(p, 'Đã lưu điểm danh');
    const a = db.prepare('SELECT a.homework_status, a.homework_score, a.comment FROM attendance a JOIN students st ON st.id = a.student_id WHERE a.session_id = ? AND st.full_name = ?').get(s.id, name);
    assert(a.homework_status === 'done' && a.homework_score === 9 && a.comment === 'Làm bài cẩn thận', 'lưu BTVN, điểm, nhận xét');
    assert(db.prepare('SELECT homework FROM class_sessions WHERE id = ?').get(s.id).homework === 'Workbook trang 30', 'lưu BTVN giao buổi sau');
  });

  await step('Phễu L0–L5: bấm L5 chỉ còn khách đã đóng đủ học phí', async () => {
    p = (await as('tuvan')).page;
    await p.goto(`${srv.url}/leads`); await settle(p);
    await p.getByRole('group', { name: 'Phễu L0–L5' }).getByRole('button', { name: /^L5:/ }).click();
    await p.waitForURL(/level=L5/); await settle(p);
    const badges = await p.locator('table tbody tr').count();
    assert(badges > 0, 'có khách L5');
    const other = await p.locator('table tbody').getByText(/^L[0-4]$/).count();
    assert(other === 0, 'không còn khách cấp khác');
  });

  await step('Nhập học viên từ file CSV: kiểm tra trước, chỉ nhập dòng hợp lệ', async () => {
    p = (await as('tuvan')).page;
    await p.goto(`${srv.url}/students`); await settle(p);
    await p.getByRole('button', { name: 'Nhập từ Excel' }).click();
    const dlg = p.getByRole('dialog');
    const csv = '﻿Họ tên học viên,Ngày sinh,Giới tính,Họ tên phụ huynh,Số điện thoại\r\nNguyễn E2E Một,01/02/2016,Nam,Trần Thị E2E,0000 777 901\r\nLê E2E Hai,15/06/2015,Nữ,Phạm Văn E2E,0000 777 902\r\nThiếu Số,01/01/2015,Nam,Ai Đó,123\r\n';
    await dlg.getByLabel('Chọn file nhập học viên').setInputFiles({ name: 'hoc-vien.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await dlg.getByText('2 dòng hợp lệ', { exact: true }).waitFor();
    await dlg.getByText('1 dòng lỗi (sẽ bỏ qua)').waitFor();
    await dlg.getByRole('button', { name: 'Nhập 2 dòng hợp lệ' }).click();
    await toast(p, 'Đã nhập 2 học viên');
    assert(db.prepare(`SELECT COUNT(*) n FROM students WHERE full_name IN ('Nguyễn E2E Một','Lê E2E Hai')`).get().n === 2, 'tạo đúng 2 học viên');
  });

  await step('Đề nghị đổi gói phí (tư vấn) → quản lý đính kèm file và duyệt → học phí theo gói mới', async () => {
    const e = db.prepare(`SELECT e.* FROM enrollments e JOIN fee_packages p ON p.id = e.package_id WHERE e.status = 'active' AND p.sessions = 24 AND e.kind = 'new'
      AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.status = 'pending' AND json_extract(a.payload, '$.enrollment_id') = e.id) ORDER BY e.id LIMIT 1`).get();
    const p2 = db.prepare(`SELECT * FROM fee_packages WHERE course_id = ? AND sessions = 96 AND kind = 'new'`).get(e.course_id);
    p = (await as('tuvan')).page;
    await p.goto(`${srv.url}/students/${e.student_id}?tab=classes`); await settle(p);
    await p.getByRole('button', { name: `Thao tác đăng ký ${e.code}` }).click();
    await p.getByRole('menuitem', { name: 'Đề nghị đổi gói phí' }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('Gói phí mới').selectOption(String(p2.id));
    await dlg.getByLabel('Lý do').fill('Phụ huynh muốn học trọn lộ trình');
    await dlg.getByRole('button', { name: 'Gửi đề xuất' }).click();
    await toast(p, 'Đã gửi đề xuất');
    const a = db.prepare(`SELECT * FROM approvals WHERE type = 'package_change' ORDER BY id DESC LIMIT 1`).get();
    p = (await as('quanly')).page;
    await p.goto(`${srv.url}/approvals?id=${a.id}`); await settle(p);
    const d = p.getByRole('dialog');
    await d.locator('input[type=file]').setInputFiles({ name: 'don-phu-huynh.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') });
    await toast(p, 'Đã đính kèm don-phu-huynh.pdf');
    await d.getByRole('link', { name: 'don-phu-huynh.pdf' }).waitFor();
    await d.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await toast(p, 'Gói phí mới đã được áp dụng');
    const after = db.prepare('SELECT tuition_fee, total_sessions FROM enrollments WHERE id = ?').get(e.id);
    assert(after.tuition_fee === p2.price && after.total_sessions === p2.sessions + p2.bonus_sessions, 'học phí & số buổi theo gói mới');
  });

  await step('Nạp tiền rồi trừ số dư đóng học phí từ hồ sơ học viên', async () => {
    const e = db.prepare(`SELECT e.* FROM enrollments e WHERE e.status = 'active' AND e.id IN (SELECT enrollment_id FROM installments) ORDER BY e.id DESC LIMIT 20`).all()
      .find((x) => db.prepare(`SELECT ? - COALESCE((SELECT SUM(amount) FROM receipts WHERE enrollment_id = ? AND status = 'confirmed'),0) - COALESCE((SELECT SUM(amount) FROM discounts WHERE enrollment_id = ? AND status = 'approved'),0) d`).get(x.tuition_fee, x.id, x.id).d >= 500000);
    p = (await as('thungan')).page;
    await p.goto(`${srv.url}/students/${e.student_id}?tab=finance`); await settle(p);
    await p.getByRole('button', { name: 'Nạp tiền' }).click();
    let dlg = p.getByRole('dialog');
    await dlg.getByLabel('Số tiền nạp').fill('500000');
    await dlg.getByRole('button', { name: 'Xác nhận nạp tiền' }).click();
    await toast(p, 'Đã nạp tiền');
    await settle(p);
    await p.getByRole('button', { name: 'Trừ số dư' }).first().click();
    dlg = p.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Trừ số dư' }).click();
    await toast(p, 'Đã trừ số dư');
    const bal = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM wallet_entries WHERE student_id = ? AND status = 'confirmed'`).get(e.student_id).s;
    assert(bal === 0, `số dư về 0 sau khi trừ (thực tế ${bal})`);
  });

  await step('Hiệu suất EC/CM và trang Học tập mở được, không lỗi', async () => {
    p = (await as('quanly')).page;
    for (const u of ['/performance', '/performance?tab=cm', '/learning?tab=homework', '/learning?tab=support', '/classes?tab=packages', '/finance?tab=wallet']) {
      await p.goto(srv.url + u); await settle(p);
      await p.getByRole('heading', { level: 1 }).first().waitFor();
    }
    await p.goto(`${srv.url}/performance`); await settle(p);
    await p.getByText('Trần Văn Hùng').first().waitFor();
  });
}
