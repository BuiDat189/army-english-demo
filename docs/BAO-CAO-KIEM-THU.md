# Báo cáo kiểm thử thực tế

Ngày chạy: 12/10/2026 · Máy: Windows 11 Pro, Node.js 24.16.0, Google Chrome (chế độ ẩn qua playwright-core 1.64).
Mọi kết quả dưới đây là **lần chạy cuối** sau khi đã sửa các lỗi phát hiện trong quá trình kiểm thử.

## 1. Tổng hợp

| Nhóm | Lệnh | Kết quả |
|---|---|---|
| Lint JavaScript | `npm run lint` | **0 lỗi** |
| Build frontend | `npm run build` | **Thành công** |
| Test API (Vitest + Supertest) | `npm test` | **62/62 đạt** (8 file, gồm 20 test tính năng bổ sung theo CRM) |
| E2E trình duyệt thật | `npm run test:e2e` | **47/47 bước đạt, 0 lỗi console** (bố cục kiểm cả các trang Học tập, Hiệu suất, Số dư, Gói phí) |
| Hiệu ứng & giảm chuyển động | `node tests/e2e/motion-check.js` | Bình thường: 15 hiệu ứng trên Tổng quan, có hiệu ứng mở modal · Giảm chuyển động: mọi hiệu ứng 0 ms |
| Bảng màu nền tối | `node tests/e2e/theme-parity.js` | 31/31 biến được khai lại cho nền tối |
| Soát giao diện 152 luật | `soat-giao-dien.py client/src --muc medium` | 225 → 220; phần còn lại là báo oan đã kiểm (nút đã có `type` mặc định trong component, ô chọn đã gắn nhãn qua `Field`) |
| Cảnh báo React ở chế độ dev | `node tests/e2e/dev-warnings.js` (khi `npm run dev` đang chạy) | **0 cảnh báo/lỗi** trên 43 trang × 2 vai trò |
| Chạy theo hướng dẫn | `npm install` · `npm run seed` · `npm run dev` · `npm run build` · `npm start` | Đều chạy được; `npm start` phục vụ API + giao diện cùng origin, deep link `/students/1` trả trang app, API chưa đăng nhập trả 401 |

Test API mỗi ca tạo DB SQLite trong bộ nhớ rồi seed lại ⇒ độc lập, chạy lặp lại được. E2E chạy server thật trên DB tạm, cổng ngẫu nhiên.

**Kiểm tra độ tin cậy của test:** cố ý vô hiệu hóa cơ chế chống gửi trùng phiếu thu ⇒ test `finance` báo đỏ đúng ca; khôi phục ⇒ xanh lại.

## 2. Nội dung đã kiểm

### Test API (`tests/*.test.js`)
- **Công nợ** (`finance.test.js`): công thức công nợ trên toàn bộ đăng ký seed; thu một phần; gửi lại cùng `Idempotency-Key` (kể cả 2 yêu cầu song song) chỉ tạo 1 phiếu; chặn số âm, 0, số lẻ, chữ, vượt công nợ, ngày tương lai, thiếu khóa chống trùng; hủy phiếu bắt buộc lý do, không xóa cứng, công nợ tính lại, hủy lần 2 bị chặn; giảm phí: tư vấn không tự duyệt, chờ duyệt chưa giảm công nợ, **2 yêu cầu duyệt song song chỉ 1 có hiệu lực**, lịch thanh toán cân lại; hoàn phí: duyệt ≠ đã chi, chi 2 lần bị chặn, báo cáo thu chi chỉ tăng sau khi chi; thẻ dashboard khớp danh sách công nợ/phiếu thu.
- **Lịch** (`schedule.test.js`): trùng phòng, giáo viên, trợ giảng (kể cả khi đổi vai trò), học viên; giờ nối tiếp không bị coi là trùng; buổi đã hủy không chiếm lịch; đổi lịch vào khung trùng bị từ chối kèm danh sách xung đột; tạo lớp trùng bị chặn; sĩ số vượt sức chứa phòng bị chặn; xếp lớp đủ sĩ số bị chặn; bảo lưu giải phóng chỗ, giữ công nợ, xếp lại lớp cũ.
- **Phân quyền** (`permissions.test.js`): 401 khi chưa đăng nhập; 403 khi thiếu header chống CSRF; mật khẩu băm bcrypt; giáo viên chỉ thấy lớp/học viên của mình, không thấy SĐT phụ huynh, học phí, tuyển sinh, không điểm danh lớp khác; tư vấn không duyệt giảm phí/không thu tiền; vận hành bị 403 ở 7 API tài chính/học viên, tìm kiếm không trả học viên/khách; thu ngân không reset/duyệt; chuyển nhanh tài khoản đổi đúng quyền; **ngoài chế độ demo**: tài khoản demo không đăng nhập được, danh sách demo rỗng, tài khoản quản lý thật vẫn không reset/chuyển nhanh được; hồi quy: thu ngân thấy đủ dữ liệu học phí.
- **Điểm danh & lặp an toàn** (`attendance.test.js`): lưu điểm danh 3 lần không nhân đôi bản ghi/số buổi/việc chăm sóc; mở lại đúng; thiếu học viên ⇒ không lưu; không điểm danh trước ngày học; vắng có phép + học bù trừ đúng 1 buổi, vắng không phép + học bù không trừ thêm; không xếp bù 2 lần; quét nhắc việc chạy lại tạo 0 bản ghi mới; checklist mẫu không trùng trong ngày; reset 2 lần cho đúng số liệu ban đầu, không vi phạm khóa ngoại.
- **3 kịch bản qua API** (`scenarios.test.js`) + **CSV**: chống chèn công thức (`=`, `+`, `-`, `@`), BOM UTF‑8, escape dấu phẩy/ngoặc kép.
- **Smoke** (`smoke.test.js`): 38 API đọc × 7 vai trò không có lỗi 500; quản lý mở chi tiết mọi khách, học viên, lớp, buổi, việc, đề xuất, báo hỏng.

### E2E trình duyệt (`tests/e2e/run.js`) — thao tác thật trên giao diện
1. **Kịch bản 1** (9 bước): tạo khách (lỗi hiện cạnh trường, giữ dữ liệu đã nhập) → ghi tư vấn → hẹn kiểm tra đầu vào (thử khung trùng P202 ⇒ báo trùng, đổi giờ ⇒ được) → ghi kết quả → chuyển thành học viên (dữ liệu điền sẵn) → thu ngân thu 2.000.000 đ (thử vượt công nợ bị chặn; **bấm đúp chỉ 1 phiếu**) → giáo vụ xếp lớp → reload vẫn đúng → Tổng quan +1 học viên đang học, thẻ mở đúng danh sách lọc.
2. **Kịch bản 2** (4 bước): giáo viên điểm danh 1 học viên vắng có phép → lưu lại không nhân đôi, đúng 1 việc chăm sóc → giáo vụ ghi kết quả liên hệ → xếp học bù riêng, đúng 1 lịch bù gắn với buổi nghỉ.
3. **Kịch bản 3** (5 bước): giáo viên báo hỏng → vận hành tạo công việc + đề xuất chi (chưa duyệt thì nút xác nhận xử lý bị khóa) → quản lý duyệt (**bấm đúp chỉ 1 sự kiện duyệt**), trạng thái *Đã duyệt – chưa chi* → vận hành xác nhận xử lý, lịch sử đủ 5 bước → thu ngân xác nhận đã chi.
4. **Phân quyền qua giao diện**: menu giáo viên/vận hành ẩn đúng; vào URL trực tiếp hiện trang "không có quyền"; chuyển nhanh tài khoản đổi menu; bộ lọc lưu trên URL, reload giữ nguyên.
5. **Biểu mẫu khác**: tạo lớp (nhập ngày `dd/mm/yyyy`, chặn sĩ số > sức chứa phòng, sinh 24 buổi); công việc: checklist, đổi trạng thái, **kéo thả Kanban lưu sau reload**; kho: chặn xuất quá tồn, cảnh báo tồn thấp; thông báo chỉ tới đúng nhóm vai trò; giảm phí đề nghị → duyệt → công nợ giảm trên giao diện; hủy phiếu thu có lý do; duyệt giờ dạy hàng loạt; báo cáo + CSV có BOM; tìm kiếm theo SĐT phụ huynh; lọc kỳ tùy chọn khớp tổng phiếu thu; giáo viên ghi kết quả kiểm tra đầu vào từ lịch; bảo lưu đăng ký; reset demo (bắt buộc gõ `RESET`).
6. **Bàn phím & nền tối**: Enter trên dòng bảng mở chi tiết; đổi nền tối, tải lại vẫn giữ.
7. **Bố cục**: 19 trang × 3 bề rộng (1440, 1024, 390 px) không tràn ngang, không lỗi console; modal thu tiền trên điện thoại nằm trọn màn hình và cuộn được; lịch điện thoại chuyển sang xem theo ngày. Ảnh chụp lưu ở `tests/e2e/report/`.

### Kiểm tra bằng mắt (ảnh chụp Chrome ẩn)
Đã xem ảnh các trang: Tổng quan (1440/1024/390), Tuyển sinh (danh sách, chi tiết), Học viên (học phí 1440/1024/390), Lịch tuần/ngày, Công việc Kanban, Lịch làm việc nhân sự, Đăng nhập, Phiếu thu in, Modal thu tiền điện thoại.

## 3. Lỗi phát hiện trong quá trình kiểm thử và đã sửa
| # | Lỗi | Phát hiện bởi | Đã sửa |
|---|---|---|---|
| 1 | Trường chọn tùy chọn (người phụ trách, trợ giảng…) bị server coi là bắt buộc do khác biệt zod 4 ⇒ tạo khách/lớp/công việc lỗi 400 | Test API | Sửa bộ kiểm tra `optId` |
| 2 | Thu ngân không thấy đăng ký/học phí trong hồ sơ học viên; Tổng quan của thu ngân đếm học viên = 0 | E2E (ảnh chụp) | Chỉ giới hạn theo lớp với người chỉ được xem lớp mình; thêm test hồi quy |
| 3 | Trang học viên trắng khi giáo vụ bấm *Xếp lớp* (modal tài chính nhận nhầm dữ liệu) | E2E (ảnh trắng + `pageerror`) | Chỉ truyền dữ liệu cho đúng modal; modal tự chặn khi thiếu dữ liệu |
| 4 | Ô ngày/giờ gốc của trình duyệt hiện `mm/dd/yyyy`, có thể AM/PM | Ảnh chụp E2E | Ô ngày/giờ riêng luôn `dd/MM/yyyy` và 24h, vẫn có nút mở lịch |
| 5 | Tick checklist chỉ đổi sau khi server trả lời | E2E | Cập nhật lạc quan, lỗi thì hoàn tác |
| 6 | Kéo thả Kanban có thể mất do đọc trạng thái React cũ | E2E | Dùng `dataTransfer` chuẩn HTML5 |
| 7 | Tràn ngang 46px ở 390px (lưới không khai cột); số tiền tách chữ "đ" xuống dòng; mã phiếu bị ngắt dòng ở 1024px; tab đang chọn bị khuất trên điện thoại; dải ngày thiếu Chủ nhật | Đo bố cục + ảnh chụp | Khai `grid-cols-1`, khoảng trắng không ngắt, cột không xuống dòng, tự cuộn tab, thu hẹp ô ngày |
| 8 | Liên kết thẻ "Tiền thực thu" mất bộ lọc kỳ | Rà soát | Truyền kỳ vào URL tab phiếu thu |
| 9 | Ký tự BOM nằm trực tiếp trong mã CSV | Lint | Dùng `String.fromCharCode(0xfeff)` |
| 10 | Thiếu thao tác *Bảo lưu*; giáo viên không ghi được kết quả kiểm tra đầu vào lịch riêng | Rà soát yêu cầu | Thêm API + giao diện + test |

## 4. Lỗi/giới hạn còn lại (đã biết)
- Chưa có đổi/quên mật khẩu, quản lý tài khoản đăng nhập trên giao diện (chỉ sửa vai trò/thông tin nhân sự).
- Chưa hỗ trợ chuyển lớp giữa khóa khi đã có điểm danh, tiền thừa/ứng trước, chuyển phí giữa các đăng ký.
- Kéo thả Kanban không dùng được bằng bàn phím — thay thế bằng menu "…" trên thẻ / nút trạng thái trong chi tiết (đã kiểm).
- Danh sách tải tối đa 500–1000 dòng và phân trang phía client; đủ cho một chi nhánh demo, chưa tối ưu dữ liệu lớn.
- Lịch làm việc nhân sự chưa hiển thị lịch coi kiểm tra đầu vào như một ca dạy.
- Dữ liệu demo tương đối theo **ngày seed**: để qua ngày mà không reset thì các buổi đã qua chưa được điểm danh (nên reset trước buổi demo).
- Biểu đồ Tổng quan luôn hiển thị 6 tháng theo tháng (bộ lọc kỳ áp dụng cho thẻ số liệu và mốc kết thúc của biểu đồ).

## 5. Chưa kiểm thử
- Thiết bị thật (iPhone/Android), Safari, Firefox — chỉ kiểm bằng Chrome ẩn mô phỏng bề rộng 390/1024/1440.
- Trình đọc màn hình, phóng to 200%, chế độ tương phản cao — mới kiểm nhãn, focus, thao tác bàn phím cơ bản qua mã nguồn và vai trò ARIA (Radix).
- In ra giấy thật (đã xem bản xem trước phiếu thu trên màn hình).
- Nhiều tiến trình server cùng ghi một DB, tải cao, mạng chậm/mất mạng giữa chừng (đã có trạng thái lỗi và thử lại trên giao diện nhưng chưa giả lập mạng chậm).
- Chạy liên tục qua nửa đêm (đổi ngày) trong một phiên.
