# Kịch bản trình diễn (khoảng 6–7 phút)

**Chuẩn bị (trước buổi demo, 1 phút):** chạy `npm start`, mở http://127.0.0.1:3000, đăng nhập **Quản lý** (nút đăng nhập nhanh),
vào *Tài khoản & phân quyền* → *Reset dữ liệu demo* → gõ `RESET`. Dữ liệu được tạo lại theo đúng ngày hôm nay nên trang Tổng quan
luôn có lớp học, lịch học thử, công nợ đến hạn và việc cần xử lý.

Chuyển vai trò nhanh bằng menu tài khoản (góc trên phải) → *Chuyển nhanh tài khoản demo*.

---

## 0. Mở đầu — Tổng quan (Quản lý) · 45 giây
1. Trang **Tổng quan**: chỉ ra 6 thẻ chỉ số; bấm *Định nghĩa chỉ số* để cho thấy mỗi số được định nghĩa rõ
   (“Tiền thực thu” là phiếu thu đã xác nhận trong kỳ — khác học phí đăng ký).
2. Đổi bộ lọc kỳ *Tháng này → 30 ngày qua*: thẻ tiền thu và biểu đồ đổi theo.
3. Bấm thẻ **Công nợ đến hạn/quá hạn** → mở thẳng danh sách công nợ đã lọc “Đến hạn hoặc quá hạn”. Quay lại.
4. Chỉ khối **Lịch hôm nay** (lớp, học thử, kiểm tra đầu vào) và **Cần xử lý** (học thử, học viên vắng, khoản quá hạn, chờ duyệt).

## 1. Kịch bản 1 — Tuyển sinh → Thu học phí → Xếp lớp · 2 phút 30
**Tư vấn (`tuvan`)**
1. *Tuyển sinh* → **Thêm khách**. Nhập: phụ huynh, SĐT `0000 777 001`, học viên, ngày sinh, khóa quan tâm *Army Movers 1*, nguồn *Facebook* → *Tạo hồ sơ*.
   - (Tùy chọn) nhập SĐT của một phụ huynh có sẵn để thấy **cảnh báo trùng số** — hệ thống không tự gộp.
2. Trong hồ sơ khách → **Ghi tư vấn**: nội dung + kết quả + hẹn gọi lại → trạng thái tự chuyển *Đã liên hệ*.
3. **Đặt lịch học thử** → *Ghép buổi của lớp* (chọn buổi MV1-A) hoặc *Lịch riêng* (thử chọn P202 lúc 15:10 hôm nay để thấy báo **trùng lịch**, rồi đổi 21:00).
4. Với lịch hôm nay: **Ghi kết quả** → trình độ, khóa đề xuất, nhận xét → trạng thái *Đã học thử*.
5. **Chuyển thành học viên**: mọi thông tin đã điền sẵn từ hồ sơ khách (không nhập lại), khóa đề xuất được chọn sẵn,
   lịch thanh toán *2 đợt* tự tính. Bấm *Tạo học viên & đăng ký khóa* → sang hồ sơ học viên, tab *Học phí*.

**Thu ngân (`thungan`)**
6. Mở hồ sơ học viên vừa tạo (ô tìm kiếm trên cùng, gõ tên hoặc SĐT) → tab *Học phí* → **Thu tiền**.
   Thử nhập số lớn hơn công nợ → bị chặn ngay cạnh trường. Nhập `2.000.000`, *Chuyển khoản* → *Xác nhận thu tiền* (bấm đúp cũng chỉ tạo **1 phiếu**).
7. Công nợ còn `3.400.000 đ`, đợt 1 *Sắp đến hạn* (còn 700.000 đ). Bấm số phiếu → **mẫu phiếu thu nội bộ** (ghi rõ không phải hóa đơn điện tử, số tiền bằng chữ) → *In phiếu*.

**Giáo vụ (`giaovu`)**
8. Hồ sơ học viên → tab *Khóa/lớp học* → **Xếp lớp** → chọn MV1-A (hiện sĩ số; lớp đủ sĩ số không chọn được) → *Xếp vào lớp*.
9. Mở lớp MV1-A: học viên có trong danh sách, sĩ số tăng. Tab *Tổng quan* của học viên: **lịch sử xuyên suốt** từ khách quan tâm → tư vấn → học thử → đăng ký → xếp lớp (tài khoản có quyền tài chính thấy thêm các phiếu thu).
10. (Quản lý) Tổng quan: *Học viên đang học* +1, *Tiền thực thu* +2.000.000 đ.

## 2. Kịch bản 2 — Điểm danh → Chăm sóc → Học bù · 1 phút 30
**Giáo viên (`giaovien`)** — chỉ thấy lớp mình dạy, menu không có Tuyển sinh/Học phí.
1. *Điểm danh – Đào tạo* → buổi ST1-A hôm nay → **Điểm danh**.
2. Chọn một học viên *Vắng có phép*, ghi chú “Ốm”; bấm *Chưa chọn → Có mặt* cho cả lớp; ghi nội dung buổi → *Lưu điểm danh*.
   Thông báo: “Tạo 1 việc chăm sóc vắng học”. Bấm lưu lại lần nữa → *0 thay đổi* (không nhân đôi).

**Giáo vụ (`giaovu`)**
3. *Chăm sóc – Tái đăng ký* → lọc *Vắng học* → mở việc của học viên vừa vắng (liên kết đúng học viên + buổi nghỉ).
4. **Ghi kết quả liên hệ**: *Gọi điện*, nội dung, kết quả → trạng thái *Đang xử lý*.
5. **Xếp học bù** ngay trong việc chăm sóc → *Ghép vào buổi có sẵn* (danh sách buổi cùng khóa, đã kiểm sĩ số & trùng lịch) hoặc *Tạo buổi học bù riêng* → việc chăm sóc ghi “Đã xếp lịch học bù”.
6. Tab *Quy tắc tính buổi* (trang Điểm danh – Đào tạo): giải thích vắng có phép chỉ trừ 1 buổi khi đã học bù; không trừ hai lần.
7. (Tùy chọn) bấm **Quét nhắc việc** ở trang Chăm sóc 2 lần: lần sau báo tạo mới 0 — nhắc việc không sinh trùng.

## 3. Kịch bản 3 — Báo hỏng → Đề xuất → Phê duyệt · 1 phút 30
**Giáo viên (`giaovien`)**
1. *Tài sản* → **Báo hỏng** → chọn “P101 · Máy chiếu…”, mô tả, mức *Cao* → *Gửi báo hỏng*.

**Vận hành (`vanhanh`)**
2. Trang báo hỏng → **Tạo công việc xử lý** (giao cho mình, có hạn) → **Tạo đề xuất chi** 2.400.000 đ kèm báo giá.
   Nút *Xác nhận đã xử lý* đang bị khóa vì đề xuất chưa duyệt.

**Quản lý (`quanly`)**
3. *Đề xuất – Phê duyệt* → tab *Chờ duyệt* → mở đề xuất → ghi chú → **Duyệt**. Trạng thái: *Đã duyệt – chưa chi*
   (duyệt KHÔNG phải đã thanh toán; lịch sử ghi người duyệt + thời gian).

**Vận hành (`vanhanh`)**
4. Trang báo hỏng → **Xác nhận đã xử lý** → nhập kết quả. Lịch sử hiển thị đủ: báo hỏng → tạo việc → đề xuất chi → quản lý duyệt → xác nhận xử lý; công việc liên quan tự hoàn thành.

**Thu ngân (`thungan`)**
5. *Đề xuất – Phê duyệt* → *Đã duyệt – chờ chi* → **Xác nhận đã chi**. Chỉ lúc này khoản chi mới vào *Học phí – Thu chi → Tổng hợp thu chi* và Báo cáo thu chi.

## 3b. (Tuỳ chọn) Sơ đồ phòng & xếp lịch phòng · 45 giây
**Giáo vụ (`giaovu`) hoặc Quản lý**
1. *Lịch học* → chế độ **Theo phòng**. Phía trên là sơ đồ theo tầng: mỗi phòng có sức chứa, đang dùng/trống đến mấy giờ, % sử dụng trong ngày, thiết bị đang hỏng.
2. Bấm vào thẻ phòng → cuộn tới dòng của phòng đó trên lưới giờ 7:00–22:00 (xanh = chính khóa, tím = học bù, vàng nét đứt = học thử/kiểm tra, vạch đỏ = giờ hiện tại).
3. Chọn một ngày tới → bấm vào khoảng trống trên dòng phòng → hộp *Xếp buổi học* điền sẵn phòng/giờ → chọn lớp (giáo viên tự điền) → **Xếp buổi học**.
4. Thử xếp cùng lớp, cùng giờ ở phòng khác → hệ thống báo trùng giáo viên/học viên và không tạo buổi.

## 4. Kết (30 giây)
- *Báo cáo*: đổi kỳ, xuất CSV (mở được bằng Excel, tiếng Việt đúng).
- Thu nhỏ cửa sổ / mở trên điện thoại: danh sách chuyển thành thẻ, lịch xem theo ngày, modal trượt từ dưới lên.
- Nhắc lại: dữ liệu giả, không gửi tin/không kết nối ngân hàng; phần nào chạy thật, phần nào mô phỏng ở README mục 5.
