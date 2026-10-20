// Phần E2E cho các biểu mẫu/luồng phụ — được run.js gọi.
import { vnToday, addDays } from '../../server/lib/time.js';

const vn = (iso) => iso.split('-').reverse().join('/');

export async function formsSection({ as, step, assert, srv, db, toast, settle }) {
  console.log('Các biểu mẫu & luồng khác');
  const today = vnToday();
  let p;

  await step('Tạo lớp mới qua giao diện (nhập ngày dd/mm/yyyy, sinh đủ buổi)', async () => {
    p = (await as('giaovu')).page;
    await p.goto(`${srv.url}/classes`); await settle(p);
    await p.getByRole('button', { name: 'Tạo lớp' }).click();
    const d = p.getByRole('dialog');
    await d.getByLabel('Mã lớp').fill('MV1-UI');
    await d.getByLabel('Tên lớp').fill('Movers 1 – lớp tạo thử');
    await d.getByLabel('Khóa học').selectOption({ label: 'Army Movers 1 (24 buổi)' });
    await d.getByLabel('Ngày khai giảng').fill(vn(addDays(today, 90)));
    await d.getByLabel('Phòng học').selectOption({ label: 'P202 · 10 chỗ' });
    await d.getByLabel('Sĩ số tối đa').fill('15');
    await d.getByLabel('Giáo viên').selectOption({ label: 'Sarah Johnson' });
    await d.getByRole('button', { name: 'Tạo lớp & sinh lịch' }).click();
    await d.getByText('Phòng P202 chỉ chứa 10 học viên.').waitFor();
    await d.getByLabel('Sĩ số tối đa').fill('10');
    await d.getByRole('button', { name: 'Tạo lớp & sinh lịch' }).click();
    await toast(p, 'Đã tạo lớp với 24 buổi học');
    await p.waitForURL(/\/classes\/\d+$/);
    await p.getByRole('heading', { name: /MV1-UI/ }).waitFor();
  });

  await step('Lịch theo phòng: bấm khoảng trống xếp buổi; xếp trùng giáo viên bị chặn', async () => {
    p = (await as('giaovu')).page;
    const day = addDays(today, 5);
    const cls = db.prepare(`SELECT id, code, teacher_id FROM classes WHERE status = 'active' AND teacher_id IS NOT NULL ORDER BY id LIMIT 1`).get();
    const room = (n) => db.prepare('SELECT id FROM rooms WHERE name = ?').get(n).id;
    const count = () => db.prepare(`SELECT COUNT(*) n FROM class_sessions WHERE date = ? AND start_time = '07:00' AND status <> 'cancelled'`).get(day).n;
    const before = count();
    await p.goto(`${srv.url}/schedule?view=rooms&date=${day}`); await settle(p);
    await p.getByRole('region', { name: 'Sơ đồ phòng' }).getByText('P301').first().waitFor();
    // Khung 07:00 là cột đầu lưới thời gian
    await p.locator(`#room-row-${room('P301')} > div`).nth(1).click({ position: { x: 6, y: 20 } });
    let d = p.getByRole('dialog');
    await d.getByText('Xếp buổi học vào P301').waitFor();
    assert(await d.getByLabel('Bắt đầu').inputValue() === '07:00', 'giờ bắt đầu điền sẵn theo ô bấm');
    await d.getByLabel('Lớp').selectOption(String(cls.id));
    assert(await d.getByLabel('Giáo viên').inputValue() === String(cls.teacher_id), 'giáo viên tự điền theo lớp');
    await d.getByRole('button', { name: 'Xếp buổi học' }).click();
    await toast(p, `Đã xếp buổi ${cls.code} vào P301`);
    assert(count() === before + 1, 'tạo đúng 1 buổi');
    await p.getByRole('button', { name: new RegExp(`07:00.*phòng P301`) }).first().waitFor();
    // Cùng lớp, cùng giờ, phòng khác → trùng giáo viên/học viên, không tạo thêm
    await p.locator(`#room-row-${room('P101')} > div`).nth(1).click({ position: { x: 6, y: 20 } });
    d = p.getByRole('dialog');
    await d.getByText('Xếp buổi học vào P101').waitFor();
    await d.getByLabel('Lớp').selectOption(String(cls.id));
    await d.getByRole('button', { name: 'Xếp buổi học' }).click();
    await d.getByRole('alert').first().waitFor();
    assert(count() === before + 1, 'không tạo buổi trùng');
    await p.keyboard.press('Escape');
  });

  await step('Công việc: tạo, tick checklist, đổi trạng thái; Kanban kéo thả lưu sau reload', async () => {
    p = (await as('quanly')).page;
    await p.goto(`${srv.url}/tasks`); await settle(p);
    await p.getByRole('button', { name: 'Tạo công việc' }).click();
    const d = p.getByRole('dialog');
    await d.getByLabel('Tiêu đề').fill('Kiểm tra bình chữa cháy tầng 2');
    await d.getByLabel('Người phụ trách').selectOption({ label: 'Ngô Văn Long' });
    await d.getByLabel('Checklist con').fill('Kiểm tra áp suất\nKiểm tra hạn sử dụng');
    await d.getByRole('button', { name: 'Tạo công việc' }).click();
    await toast(p, 'Đã tạo công việc');
    const dr = p.getByRole('dialog', { name: 'Kiểm tra bình chữa cháy tầng 2' });
    await dr.getByRole('checkbox', { name: /Kiểm tra áp suất/ }).check();
    await dr.getByText('Checklist (1/2)').waitFor();
    await dr.getByRole('radio', { name: 'Chờ kiểm tra' }).click();
    await toast(p, 'Đã chuyển sang Chờ kiểm tra');
    const id = db.prepare(`SELECT id FROM tasks WHERE title = 'Kiểm tra bình chữa cháy tầng 2'`).get().id;
    assert(db.prepare('SELECT status FROM tasks WHERE id = ?').get(id).status === 'review', 'lưu trạng thái');
    await p.keyboard.press('Escape');
    await p.goto(`${srv.url}/tasks?mode=kanban`); await settle(p);
    const card = p.locator('li[draggable]').filter({ hasText: 'Kiểm tra bình chữa cháy tầng 2' });
    // Kéo thả bằng chuột thật (giống người dùng): giữ thẻ, kéo sang đầu cột "Hoàn thành", thả
    await card.scrollIntoViewIfNeeded();
    const a = await card.boundingBox();
    const t = await p.getByRole('region', { name: 'Hoàn thành' }).boundingBox();
    await p.mouse.move(a.x + a.width / 2, a.y + 20); await p.mouse.down();
    await p.mouse.move(a.x + a.width / 2 + 10, a.y + 30, { steps: 3 });
    await p.mouse.move(t.x + t.width / 2, t.y + 60, { steps: 10 }); await p.mouse.up();
    await toast(p, 'sang Hoàn thành');
    await p.reload(); await settle(p);
    await p.getByRole('region', { name: 'Hoàn thành' }).getByText('Kiểm tra bình chữa cháy tầng 2').waitFor();
    assert(db.prepare('SELECT status FROM tasks WHERE id = ?').get(id).status === 'done', 'kéo thả lưu xuống DB');
  });

  await step('Kho: chặn xuất quá tồn, xuất hợp lệ cảnh báo tồn thấp', async () => {
    p = (await as('vanhanh')).page;
    await p.goto(`${srv.url}/inventory`); await settle(p);
    const row = p.getByRole('row', { name: /Giáo trình Movers/ });
    await row.getByRole('button', { name: 'Thao tác khác' }).click();
    await p.getByRole('menuitem', { name: 'Xuất kho' }).click();
    const d = p.getByRole('dialog');
    await d.getByLabel(/Số lượng/).fill('50');
    await d.getByLabel('Lý do').fill('Phát giáo trình lớp mới');
    await d.getByRole('button', { name: 'Xác nhận' }).click();
    await d.getByText(/Không đủ tồn/).waitFor();
    await d.getByLabel(/Số lượng/).fill('1');
    await d.getByRole('button', { name: 'Xác nhận' }).click();
    await toast(p, 'Dưới ngưỡng tối thiểu');
  });

  await step('Thông báo nội bộ chỉ tới đúng nhóm vai trò', async () => {
    p = (await as('giaovu')).page;
    await p.goto(`${srv.url}/notices`); await settle(p);
    await p.getByRole('button', { name: 'Tạo thông báo' }).click();
    const d = p.getByRole('dialog');
    await d.getByLabel('Tiêu đề').fill('Họp chuyên môn giáo viên thứ 7');
    await d.getByLabel('Nội dung').fill('Toàn bộ giáo viên họp lúc 13:30 tại P301.');
    await d.getByRole('checkbox', { name: 'Tất cả nhân sự' }).uncheck();
    await d.getByRole('checkbox', { name: 'Giáo viên / Chủ nhiệm (CM)' }).check();
    await d.getByRole('button', { name: 'Đăng thông báo' }).click();
    await toast(p, 'Đã đăng thông báo');
    p = (await as('giaovien')).page;
    await p.goto(`${srv.url}/notices`); await settle(p);
    await p.getByText('Họp chuyên môn giáo viên thứ 7').waitFor();
    p = (await as('thungan')).page;
    await p.goto(`${srv.url}/notices`); await settle(p);
    assert(!(await p.getByText('Họp chuyên môn giáo viên thứ 7').count()), 'thu ngân không thấy thông báo dành cho giáo viên');
  });

  await step('Giảm phí: tư vấn đề nghị → quản lý duyệt → công nợ giảm trên giao diện', async () => {
    const e = db.prepare(`SELECT e.id, e.student_id FROM enrollments e WHERE e.status = 'active' AND NOT EXISTS (SELECT 1 FROM discounts d WHERE d.enrollment_id = e.id)
      AND e.tuition_fee - (SELECT COALESCE(SUM(amount),0) FROM receipts r WHERE r.enrollment_id = e.id AND r.status = 'confirmed') > 1000000 LIMIT 1`).get();
    p = (await as('tuvan')).page;
    // Tư vấn không xem công nợ chi tiết: đề nghị giảm từ thẻ khóa học
    await p.goto(`${srv.url}/students/${e.student_id}?tab=classes`); await settle(p);
    const code = db.prepare('SELECT code FROM enrollments WHERE id = ?').get(e.id).code;
    await p.getByRole('button', { name: `Thao tác đăng ký ${code}` }).click();
    await p.getByRole('menuitem', { name: 'Đề nghị giảm học phí' }).click();
    const d = p.getByRole('dialog');
    await d.getByLabel('Hình thức').selectOption('amount');
    await d.getByLabel('Số tiền').fill('300000');
    await d.getByLabel('Lý do').fill('Ưu đãi giới thiệu bạn');
    await d.getByRole('button', { name: 'Gửi đề nghị' }).click();
    await toast(p, 'Đã gửi đề nghị giảm phí');
    const before = db.prepare(`SELECT tuition_fee - (SELECT COALESCE(SUM(amount),0) FROM receipts r WHERE r.enrollment_id = e.id AND r.status='confirmed') AS debt FROM enrollments e WHERE id = ?`).get(e.id).debt;
    p = (await as('quanly')).page;
    await p.goto(`${srv.url}/approvals`); await settle(p);
    await p.getByRole('row', { name: /Giảm 300\.000/ }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Duyệt', exact: true }).click();
    await toast(p, 'Đã duyệt đề xuất');
    await p.goto(`${srv.url}/students/${e.student_id}?tab=finance`); await settle(p);
    const after = (before - 300000).toLocaleString('vi-VN');
    await p.getByText(new RegExp(`${after.replace(/\./g, '\\.')}\\s*đ`)).first().waitFor();
  });

  await step('Thu ngân hủy phiếu thu có lý do; phiếu vẫn còn với trạng thái Đã hủy', async () => {
    const r = db.prepare(`SELECT id, code, student_id FROM receipts WHERE status = 'confirmed' ORDER BY id DESC LIMIT 1`).get();
    p = (await as('thungan')).page;
    await p.goto(`${srv.url}/finance?tab=receipts&period=last30`); await settle(p);
    const row = p.getByRole('row', { name: new RegExp(r.code) });
    await row.getByRole('button', { name: 'Thao tác khác' }).click();
    await p.getByRole('menuitem', { name: 'Hủy phiếu thu' }).click();
    const d = p.getByRole('dialog');
    assert(await d.getByRole('button', { name: 'Hủy phiếu thu' }).isDisabled(), 'bắt buộc nhập lý do');
    await d.getByLabel('Lý do hủy phiếu').fill('Ghi nhầm hình thức thanh toán');
    await d.getByRole('button', { name: 'Hủy phiếu thu' }).click();
    await toast(p, 'Đã hủy phiếu thu');
    await row.getByText('Đã hủy').waitFor();
    assert(db.prepare('SELECT status FROM receipts WHERE id = ?').get(r.id).status === 'cancelled', 'không xóa cứng');
  });

  await step('Giáo vụ duyệt giờ dạy hàng loạt', async () => {
    p = (await as('giaovu')).page;
    await p.goto(`${srv.url}/hr?tab=teaching&status=pending`); await settle(p);
    const before = db.prepare(`SELECT COUNT(*) n FROM teaching_logs WHERE status = 'pending'`).get().n;
    await p.getByRole('button', { name: 'Chọn tất cả chờ duyệt' }).click();
    await p.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await toast(p, 'Đã duyệt');
    const after = db.prepare(`SELECT COUNT(*) n FROM teaching_logs WHERE status = 'pending'`).get().n;
    assert(after < before, `giảm số dòng chờ duyệt (${before} → ${after})`);
  });

  await step('Báo cáo hiển thị và xuất CSV có BOM tiếng Việt', async () => {
    p = (await as('quanly')).page;
    await p.goto(`${srv.url}/reports?type=enrollment`); await settle(p);
    await p.getByRole('heading', { name: 'Báo cáo tuyển sinh' }).waitFor();
    await p.getByRole('tab', { name: 'thu chi' }).click(); await settle(p);
    await p.getByRole('heading', { name: 'Báo cáo thu chi' }).waitFor();
    const csv = await p.evaluate(async () => { const r = await fetch('/api/reports/finance?format=csv'); const b = new Uint8Array(await r.arrayBuffer()); return { type: r.headers.get('content-type'), bom: [b[0], b[1], b[2]] }; });
    assert(csv.type.includes('text/csv') && csv.bom.join(',') === '239,187,191', `CSV có BOM UTF-8 (${csv.bom})`);
  });

  await step('Tìm kiếm nhanh theo số điện thoại phụ huynh', async () => {
    const par = db.prepare(`SELECT p.phone, s.full_name FROM parents p JOIN student_contacts sc ON sc.parent_id = p.id JOIN students s ON s.id = sc.student_id LIMIT 1`).get();
    // Kế toán xem được thông tin phụ huynh (tư vấn EC thì không)
    p = (await as('thungan')).page;
    await p.goto(`${srv.url}/`); await settle(p);
    await p.getByRole('combobox', { name: 'Tìm kiếm nhanh' }).fill(par.phone.slice(-6));
    await p.getByRole('option', { name: new RegExp(par.full_name) }).first().click();
    await p.waitForURL(/\/students\/\d+/);
  });

  await step('Lọc kỳ tùy chọn trên Tổng quan khớp tổng phiếu thu', async () => {
    p = (await as('quanly')).page;
    await p.goto(`${srv.url}/?period=custom&from=${addDays(today, -60)}&to=${today}`); await settle(p);
    // Tiền thực thu = phiếu thu (không gồm phiếu trừ số dư) + phiếu nạp tiền
    const total = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE status = 'confirmed' AND method != 'wallet' AND paid_at BETWEEN ? AND ?`).get(addDays(today, -60), today).s
      + db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM wallet_entries WHERE kind = 'topup' AND status = 'confirmed' AND paid_at BETWEEN ? AND ?`).get(addDays(today, -60), today).s;
    await p.getByRole('button', { name: /Tiền thực thu trong kỳ/ }).getByText(total.toLocaleString('vi-VN'), { exact: false }).waitFor();
  });

  await step('Giáo viên ghi kết quả kiểm tra đầu vào từ lịch (không cần quyền tuyển sinh)', async () => {
    p = (await as('sarah')).page;
    await p.goto(`${srv.url}/schedule?view=day`); await settle(p);
    await p.getByRole('button', { name: /Kiểm tra đầu vào/ }).first().click();
    const d = p.getByRole('dialog', { name: 'Kết quả kiểm tra đầu vào' });
    await d.getByLabel('Trình độ đánh giá').fill('A2 Key');
    await d.getByLabel('Nhận xét của giáo viên').fill('Đọc hiểu tốt, nói còn chậm');
    await d.getByRole('button', { name: 'Lưu kết quả' }).click();
    await toast(p, 'Đã lưu kết quả');
    assert(db.prepare(`SELECT COUNT(*) n FROM trials WHERE type = 'placement' AND status = 'done' AND result_level = 'A2 Key'`).get().n === 1, 'đã lưu kết quả kiểm tra');
  });

  await step('Trưởng phòng học thuật đề nghị bảo lưu gói 1 năm (2 tuần – 3 tháng) ⇒ Giám đốc duyệt ⇒ rời lớp', async () => {
    const e = db.prepare(`SELECT e.id, e.code, e.student_id, e.class_id FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE c.code = 'KET-A' AND e.status = 'active' AND e.reserve_limit > 0
      AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.status = 'pending' AND json_extract(a.payload, '$.enrollment_id') = e.id) LIMIT 1`).get();
    p = (await as('giaovu')).page;
    await p.goto(`${srv.url}/students/${e.student_id}?tab=classes`); await settle(p);
    await p.getByRole('button', { name: `Thao tác đăng ký ${e.code}` }).click();
    await p.getByRole('menuitem', { name: /Đề nghị bảo lưu/ }).click();
    const d = p.getByRole('dialog');
    await d.getByLabel('Lý do').fill('Gia đình đi công tác 1 tháng');
    await d.getByRole('button', { name: 'Gửi đề xuất' }).click();
    await toast(p, 'Đã gửi đề xuất');
    const a = db.prepare(`SELECT * FROM approvals WHERE type = 'reserve' AND status = 'pending' AND json_extract(payload, '$.enrollment_id') = ?`).get(e.id);
    assert(a && a.stage === 'final', 'trưởng phòng gửi ⇒ chờ Giám đốc duyệt cuối');
    p = (await as('quanly')).page;
    await p.goto(`${srv.url}/approvals?id=${a.id}`); await settle(p);
    await p.getByRole('dialog').getByRole('button', { name: 'Duyệt', exact: true }).click();
    await toast(p, 'Học viên đã chuyển sang bảo lưu');
    assert(db.prepare('SELECT status FROM enrollments WHERE id = ?').get(e.id).status === 'reserved', 'đăng ký đã bảo lưu');
  });

  await step('Bàn phím: Enter trên dòng bảng mở chi tiết; đổi nền tối và giữ sau tải lại', async () => {
    p = (await as('quanly')).page;
    await p.goto(`${srv.url}/leads`); await settle(p);
    const row = p.locator('tbody tr').first();
    await row.focus();
    await p.keyboard.press('Enter');
    await p.waitForURL(/\/leads\/\d+$/);
    await p.getByRole('button', { name: /Đổi nền/ }).click();
    await p.getByRole('menuitem', { name: /Nền tối/ }).click();
    assert(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'đã chuyển nền tối');
    await p.reload(); await settle(p);
    assert(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'giữ nền tối sau tải lại');
  });

  await step('Reset demo (quản lý, gõ RESET) khôi phục dữ liệu mẫu', async () => {
    p = (await as('quanly')).page;
    await p.goto(`${srv.url}/account`); await settle(p);
    await p.getByRole('button', { name: 'Reset dữ liệu demo' }).click();
    const d = p.getByRole('dialog');
    assert(await d.getByRole('button', { name: 'Reset dữ liệu' }).isDisabled(), 'phải gõ RESET');
    await d.getByLabel('Gõ RESET để xác nhận').fill('RESET');
    await d.getByRole('button', { name: 'Reset dữ liệu' }).click();
    await toast(p, 'Đã khôi phục dữ liệu demo');
    assert(!db.prepare(`SELECT 1 FROM leads WHERE student_name = 'Lê Minh Demo'`).get(), 'dữ liệu trình diễn đã được xóa');
    assert(db.prepare('SELECT COUNT(*) n FROM students').get().n === 58, 'số học viên về mặc định (57 + 1 học viên mới chờ duyệt học phí)');
  });
}
