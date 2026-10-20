# ARMY ENGLISH – Demo quản lý nội bộ một chi nhánh

Web app demo cho **một chi nhánh** trung tâm Anh ngữ ARMY ENGLISH: tuyển sinh, học viên – phụ huynh, lớp/lịch,
điểm danh – học bù, học phí – thu chi, chăm sóc – tái đăng ký, công việc, nhân sự – giờ dạy, đề xuất – phê duyệt,
tài sản, giáo trình – vật tư, thông báo và báo cáo. Mọi màn hình đọc/ghi **cùng một database SQLite** qua REST API.

> Toàn bộ dữ liệu là **dữ liệu giả**. Số điện thoại dạng `0000 xxx xxx` (đầu 00 không phải số di động thật tại Việt Nam),
> email miền `example.com`. Hệ thống **không gửi** SMS/Zalo/email và **không kết nối** ngân hàng/cổng thanh toán.

Tài liệu kèm theo:
- [docs/KICH-BAN-TRINH-DIEN.md](docs/KICH-BAN-TRINH-DIEN.md) — kịch bản trình diễn 5–7 phút, thao tác trên từng màn hình
- [docs/BAO-CAO-KIEM-THU.md](docs/BAO-CAO-KIEM-THU.md) — báo cáo kiểm thử thực tế: đạt, lỗi còn lại, phần chưa kiểm
- [docs/HUONG-DAN-SU-DUNG.pdf](docs/HUONG-DAN-SU-DUNG.pdf) (bản web: `docs/huong-dan/HUONG-DAN-SU-DUNG.html`) — hướng dẫn sử dụng cho khách theo 6 vai trò, có ảnh đánh số từng bước.
  Chụp lại ảnh và dựng lại sau khi đổi giao diện: `npm run build`, `node tests/e2e/guide-shots.js`, `node tests/e2e/guide-pdf.js`

---

## 1. Công nghệ

| Phần | Lựa chọn |
|---|---|
| Frontend | React 19 + Vite 8 (JavaScript/JSX), Tailwind CSS 4, Radix UI (Dialog, Dropdown, Popover) + bộ component tự viết, lucide-react, Recharts, font Be Vietnam Pro (tự host) |
| Backend | Node.js (≥ 22) + Express 5 (ES Modules), zod cho kiểm tra dữ liệu |
| Database | SQLite qua better-sqlite3 (WAL), migration theo `PRAGMA user_version` |
| Xác thực | Session cookie `HttpOnly`, `SameSite=Lax`, phiên lưu trong SQLite; mật khẩu băm bcrypt; khóa tạm khi đăng nhập sai 5 lần/phút |
| Kiểm thử | Vitest + Supertest (API), playwright-core lái Chrome có sẵn trên máy (E2E, chụp ảnh bố cục), ESLint |

Không có file TypeScript. Cấu trúc:

```
client/            Giao diện React (Vite root)
  src/components/  ui/ (bộ component), layout/, business/ (form & modal nghiệp vụ dùng chung)
  src/pages/       Mỗi phân hệ một thư mục
server/
  auth/            Ma trận quyền, session store, middleware, route đăng nhập
  db/              schema + migration, seed dữ liệu demo
  services/        Nghiệp vụ dùng chung: công nợ, xung đột lịch, tính buổi, phê duyệt, nhắc việc, đăng ký khóa
  routes/          REST API theo phân hệ
  lib/             Thời gian (múi giờ VN), kiểm tra dữ liệu, CSV an toàn, phạm vi dữ liệu theo quyền
tests/             *.test.js (API) · e2e/ (trình duyệt)
```

## 2. Cài đặt và chạy

Yêu cầu: Node.js 22+ (đã chạy thử trên Node 24.16, Windows 11). Google Chrome chỉ cần cho test E2E.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Mở **http://127.0.0.1:3000** — Express phục vụ cả API và giao diện đã build (cùng origin).
Lần chạy đầu, nếu database trống và `DEMO_MODE=true`, server tự tạo dữ liệu demo.

Chế độ phát triển (API cổng 3000 + Vite cổng 5173, proxy `/api`):

```bash
npm run dev
```

rồi mở http://127.0.0.1:5173.

### Các lệnh

| Lệnh | Việc làm |
|---|---|
| `npm install` | Cài thư viện |
| `npm run dev` | Chạy API (tự khởi động lại khi sửa `server/`) + Vite dev server |
| `npm run build` | Build frontend vào `client/dist` |
| `npm start` | Express phục vụ API + frontend đã build |
| `npm run seed` | Xóa dữ liệu demo cũ và tạo lại dữ liệu demo theo **ngày hôm nay** (từ chối khi `DEMO_MODE=false`) |
| `npm test` | 70 test API (Vitest + Supertest), mỗi test chạy trên DB trong bộ nhớ |
| `npm run test:e2e` | 48 bước trình duyệt thật: 3 kịch bản, xếp phòng theo sơ đồ, check-in, BTVN, phễu L0–L5, nhập Excel, đổi gói phí, số dư, phân quyền qua giao diện, biểu mẫu, bố cục 1440/1024/390 (cần `npm run build` trước) |
| `npm run lint` | ESLint toàn dự án |

### Cấu hình (`.env`, xem `.env.example`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT`, `HOST` | `3000`, `127.0.0.1` | Địa chỉ server |
| `DB_FILE` | `data/army-demo.sqlite` | File database |
| `DEMO_MODE` | `true` | Bật tài khoản demo, chuyển nhanh tài khoản, reset. **Đặt `false` ngoài môi trường demo** |
| `SESSION_SECRET` | trống | Khóa ký cookie. Trống thì server tự sinh và lưu trong DB local. Bắt buộc khi `NODE_ENV=production` và `DEMO_MODE=false` |
| `COOKIE_SECURE` | `false` | `true` khi chạy sau HTTPS |

### Reset dữ liệu demo

- Trên giao diện: đăng nhập **Quản lý** → *Tài khoản & phân quyền* → *Reset dữ liệu demo* → gõ `RESET`.
- Dòng lệnh: `npm run seed` (dừng server trước hoặc chạy khi server tắt).
- Reset chỉ xóa dữ liệu demo (nhân sự có `is_demo = 1` và dữ liệu nghiệp vụ), chạy trong một transaction; tài khoản thật (`is_demo = 0`) được giữ.
- **Nên reset ngay trước mỗi buổi trình diễn**: dữ liệu tính tương đối theo ngày seed; nếu để qua nhiều ngày, các buổi đã qua sẽ chưa được điểm danh.

## 3. Tài khoản demo

Mật khẩu chung: **`Army@2026`** (chỉ dùng được khi `DEMO_MODE=true`; trang đăng nhập có nút đăng nhập nhanh theo vai trò).

| Tài khoản | Người (giả) | Vai trò (theo file yêu cầu của trung tâm) | Quyền chính |
|---|---|---|---|
| `quanly` | Nguyễn Thị Minh Anh | **Giám đốc trung tâm** | Toàn quyền; duyệt học phí đăng ký/tái phí, gói phí, duyệt cuối đề xuất 2 cấp; báo cáo theo phòng ban; reset demo |
| `truongsales` | Lê Hoàng Nam | **Trưởng phòng sales** (+ EC) | Khu vực cá nhân như EC; xem data của mọi EC, đổi người phụ trách; KPI từng EC; báo cáo sự cố cơ sở vật chất |
| `tuvan` | Trần Văn Hùng | **Tư vấn viên (EC)** | Nhập data khách (8 nguồn), phân loại + ngày liên hệ lại, đăng ký check-in/học thử, chuyển học viên + đăng ký (chờ GĐ duyệt); xem lịch và học viên **không** có liên hệ phụ huynh, tiền đã đóng, ngày hết phí; KPI 1 check-in/ngày, 25 data/tháng |
| `giaovu` | Phạm Ngọc Lan | **Trưởng phòng học thuật** (+ CM lớp KET-A, PET-A) | Khu vực cá nhân như CM; xem mọi CM/lớp; duyệt cấp 1 bảo lưu/chuyển học phí/chuyển lớp/lên level; khai báo nghỉ do trung tâm; gói phí (GĐ duyệt) |
| `giaovien` | Đỗ Thanh Tâm | **Giáo viên chủ nhiệm (CM)** lớp ST1-A, ST2-A | Lớp mình: học viên, điểm danh, BTVN, nhận xét + hướng cải thiện, tiền đã đóng/ngày đóng/ngày hết phí, cảnh báo <90%; nhập tái phí; data khách; lịch test/họp PH; báo sự cố phòng; KPI điểm danh + chấm BTVN mỗi ngày |
| `thungan` | Bùi Quang Huy | **Hành chính – Kế toán** | Thu tiền (tiền mặt/CK/quẹt thẻ kèm CCCD, ngày cấp thẻ, đơn vị cấp), doanh thu tách khách mới/tái phí, báo cáo ngày, xác nhận chi; nhận đề xuất của các phòng |
| `vanhanh` | Ngô Văn Long | Cơ sở vật chất (giữ thêm) | Công việc, tài sản & sự cố, kho vật tư; **không** xem học viên/phụ huynh/tài chính |
| `phuong`, `trang` | Hoàng Mai Phương, Đặng Thu Trang | CM | Phương: FL1-A, MV1-A, MV1-B · Trang: IEF-A |
| `yen` | Vũ Hải Yến | EC + trợ giảng | Ví dụ kiêm vai trò (quyền là hợp các vai trò) |
| `david`, `sarah` | — | Giáo viên bản ngữ | Dữ liệu lịch dạy, chấm kiểm tra đầu vào |

**Chuyển nhanh tài khoản** (menu tài khoản góc phải hoặc trang *Tài khoản & phân quyền*): chỉ có khi `DEMO_MODE=true`
và chỉ giữa các tài khoản demo; menu, dữ liệu và quyền thay đổi ngay theo tài khoản mới.

Phân quyền được **kiểm tra ở backend** cho từng API (middleware `can(...)` + lọc phạm vi dữ liệu như "chỉ lớp mình dạy").
Frontend chỉ ẩn/hiện menu theo cùng danh sách quyền. Toàn bộ ma trận ở `server/auth/permissions.js` và hiển thị ở trang *Tài khoản & phân quyền*.

## 3b. Tính năng bổ sung theo CRM hiện có của trung tâm (13/10/2026)

| Nhóm | Có gì | Ở đâu |
|---|---|---|
| Gói phí & tái phí | Gói theo khóa (1 khóa, 2 khóa tặng buổi, tái phí −5%/−10%), đăng ký tự nhận "mới"/"tái phí", ngày dự kiến hết học phí, danh sách tới hạn tái phí tháng này/tháng sau | Lớp & Khóa học → Gói phí; form đăng ký khóa; hồ sơ học viên; Tổng quan (Live); Báo cáo |
| Học tập | BTVN giao/chấm (Hoàn thành/Chưa đủ/Không làm), điểm BTVN, nhận xét từng học viên ngay khi điểm danh; điểm kiểm tra cả lớp; chỉ số chuyên cần/BTVN/KT; bổ trợ học tập hằng tháng (gợi ý theo ngưỡng, xác nhận tạo việc chăm sóc) | Điểm danh; Lớp → Điểm kiểm tra; Học viên → Học tập; Học tập – Check-in |
| Check-in | Quầy lễ tân check-in học viên khi đến (1 lần/ngày, hoàn tác trong ngày), thống kê theo nhân viên | Học tập – Check-in; hồ sơ học viên |
| EC/CM & phễu | Phễu L0–L5 (L4 đặt cọc/đóng một phần, L5 đóng đủ), hiệu suất tư vấn (doanh số mới/tái phí), chủ nhiệm lớp (ACS, tới hạn tái phí) | Tuyển sinh; Hiệu suất EC/CM; Sửa lớp → Chủ nhiệm |
| Số dư | Nạp tiền (đặt cọc/đóng trước), trừ số dư khi đóng học phí, chuyển số dư; tiền thực thu = phiếu thu (không gồm phiếu trừ số dư) + phiếu nạp | Học phí – Thu chi → Số dư & nạp tiền; hồ sơ học viên → Học phí |
| Phê duyệt mở rộng | Đổi gói phí, bảo lưu, hủy hợp đồng (kèm hoàn phí), chuyển học phí — duyệt xong tự thực hiện; file đính kèm (PDF/ảnh/Word/Excel ≤ 5 MB, tối đa 5 file) | Hồ sơ học viên (menu đăng ký); Đề xuất – Phê duyệt |
| Nhập dữ liệu & tag | Nhập học viên từ Excel/CSV (kiểm tra trước, liên kết phụ huynh trùng SĐT), gắn tag và lọc theo tag | Học viên – Phụ huynh |

Quyền mới: `learning.edit(_own)`, `checkin.edit`, `support.view`, `performance.view`, `packages.edit`, `requests.create`, `students.import` (xem ma trận ở trang Tài khoản & phân quyền).
File đính kèm lưu ở thư mục `uploads/` cạnh file database (không nằm trong repo).

## 3c. Khớp file yêu cầu của trung tâm (19/10/2026)

| Yêu cầu | Cách làm trong app |
|---|---|
| Data khách: 8 nguồn, 7 phân loại, ngày liên hệ lại để nhắc việc | Nguồn: Khách hàng giới thiệu, Vãng lai, Fanpage, Thị trường, Telesales, Kênh online, Sự kiện, Đối tác. Phân loại: Tiềm năng tháng, Đang lên hẹn, Đăng ký check-in, Đã check-in, Đăng ký học thử, Đã học thử, Chăm sóc thêm. Khách đang mở **bắt buộc** có ngày liên hệ lại; tới hạn ⇒ thông báo |
| Đăng ký check-in đẩy "Đề xuất xử lý" cho tất cả CM | Tạo việc "Đón khách check-in" cho mọi CM; khách check-in ⇒ việc tự hoàn tất |
| Đăng ký học thử chọn lớp ⇒ CM của lớp đó | Tạo việc cho chủ nhiệm lớp; ghi kết quả ⇒ Đã học thử (không đến ⇒ Chăm sóc thêm) |
| Ai check-in trước giữ khách | Check-in khóa người phụ trách; trùng SĐT đã check-in với người khác ⇒ chặn tạo/sửa; chỉ trưởng phòng/GĐ đổi được |
| Học phí đăng ký mới / tái phí, gói phí: Giám đốc duyệt | Đăng ký ở trạng thái "Chờ GĐ duyệt học phí", chưa thu được (có thể nạp cọc); duyệt ⇒ có hiệu lực; từ chối ⇒ hủy. Gói phí do trưởng phòng tạo chờ duyệt mới bán |
| Bảo lưu, chuyển học phí, chuyển lớp, lên level: TP học thuật duyệt rồi GĐ duyệt cuối | Đề xuất 2 cấp (`stage` lead → final); GĐ có thể duyệt thẳng; tác động chỉ xảy ra khi duyệt cuối |
| Gói 96 buổi: 4 buổi nghỉ không tính phí, nghỉ có/không phép đều tính nghỉ; 1 lần bảo lưu 2 tuần – 3 tháng | Mỗi gói có `free_absences`, `reserve_limit`; mọi buổi nghỉ trừ buổi, trừ các buổi trong hạn mức; bảo lưu kiểm tra 14–92 ngày và số lần còn lại, hết hạn tạo việc xếp lại lớp |
| Nghỉ do trung tâm (Tết sớm, cúp điện) không trừ học phí | Trang *Test – Họp PH – Lịch nghỉ* → Nghỉ do trung tâm: hủy buổi trong khoảng và bù đủ buổi cuối khóa (xem trước trước khi xác nhận) |
| CM: điểm danh, BTVN, nhận xét, **hướng cải thiện**; báo sự cố phòng có thời gian đề xuất xử lý | Ngăn buổi học; nút "Báo sự cố phòng học" (theo tài sản hoặc phát sinh mới) |
| Cảnh báo BTVN < 90%, chuyên cần < 90% | Danh sách lớp + Tổng quan CM + Bổ trợ học tập |
| Lịch test / họp PH hằng tháng, trả kết quả test ≤ 5 ngày | Trang *Test – Họp PH – Lịch nghỉ*; quá hạn ⇒ việc nhắc cho chủ nhiệm |
| KPI EC (1 check-in/ngày, 25 data/tháng) và KPI CM (điểm danh + chấm BTVN mỗi ngày), đổi màu nền | Tổng quan → "Khu vực của tôi"; báo cáo KPI từng EC / từng CM (xanh ≥100%, vàng 60–99%, đỏ <60%) |
| Kế toán: doanh thu từng case tách tái phí / khách mới; quẹt thẻ có CCCD, ngày cấp thẻ, đơn vị cấp; báo cáo ngày | Phiếu thu có cột "Nguồn doanh số"; quẹt thẻ bắt buộc 3 trường; Báo cáo → Ngày (kế toán): check-in, Renew, hoàn new, cọc, công nợ, thực thu ngày/tháng |
| GĐ: báo cáo chung theo phòng ban | Báo cáo → Tổng hợp theo phòng ban (+ xu hướng 6 tháng) |

## 4. Giả định nghiệp vụ đang dùng (cần trung tâm xác nhận)

**Học phí – công nợ**
- Tiền là số nguyên VNĐ. Học phí của đăng ký được "đóng băng" theo giá khóa tại thời điểm đăng ký.
- *Công nợ = Học phí − Giảm phí ĐÃ DUYỆT − Phiếu thu ĐÃ XÁC NHẬN.* Đề nghị giảm phí đang chờ duyệt chưa làm giảm công nợ.
- Lịch thanh toán nhiều đợt; tiền thu được phân bổ lần lượt vào các đợt theo hạn. *Sắp đến hạn* = đợt chưa thu đủ, hạn trong 7 ngày tới (gồm hôm nay); *Quá hạn* = hạn trước hôm nay.
- Khi giảm phí được duyệt, số giảm được trừ dần vào các đợt cuối để tổng lịch thanh toán khớp số phải thu.
- Không cho thu vượt công nợ (chưa hỗ trợ tiền thừa/ứng trước). Ngày thu không ở tương lai, lùi tối đa 60 ngày.
- Phiếu thu đã xác nhận không xóa được; chỉ **hủy có lý do** (lưu người hủy, thời điểm) và công nợ được tính lại.
- Hoàn phí: Đề nghị → Quản lý duyệt → Thu ngân **xác nhận đã chi**. Chỉ bước cuối mới ghi nhận tiền ra. Hoàn phí không làm thay đổi công nợ; số hoàn tối đa = đã thu − các khoản hoàn đang xử lý.
- Đăng ký bị hủy: phần chưa thu không còn là công nợ.
- *Tiền thực thu* trên Tổng quan = phiếu thu đã xác nhận có **ngày thu** trong kỳ — khác với "phải thu phát sinh" (học phí đăng ký).

**Tính buổi học** (áp dụng thống nhất ở hồ sơ, lớp, nhắc tái đăng ký, báo cáo)
- Có mặt / Đi muộn: trừ 1 buổi. Nghỉ có phép hay không phép **đều tính là nghỉ** và trừ 1 buổi (theo quy định trung tâm).
- Mỗi gói có số buổi nghỉ không tính phí (gói 96 buổi: 4; gói 48: 2; gói 24: 1 — **tỷ lệ cho gói khác là giả định**): các buổi nghỉ trong hạn mức được hoàn lại.
- Buổi trung tâm cho nghỉ: hủy và bù cuối khóa, không trừ. Buổi học bù không trừ thêm.
- Học viên còn ≤ 4 buổi được đưa vào "Sắp hết khóa" và tự sinh việc "Tư vấn tái đăng ký".

**Lịch & lớp**
- Hai khoảng thời gian trùng khi `bắt đầu A < kết thúc B` và `bắt đầu B < kết thúc A` (giờ nối tiếp không tính trùng).
- Kiểm tra trùng: phòng, giáo viên, trợ giảng (một người không ở hai buổi cùng lúc dù ở vai trò nào), học viên, và lịch kiểm tra đầu vào độc lập. Buổi đã hủy không chiếm lịch.
- Sĩ số tối đa không vượt sức chứa phòng; xếp lớp bị chặn khi đủ sĩ số (muốn tăng thì sửa sĩ số lớp nếu phòng cho phép).
- Đổi phòng/giáo viên của lớp áp dụng cho các buổi **chưa diễn ra**. Chưa hỗ trợ chuyển lớp giữa khóa khi đã có điểm danh.
- Chỉ điểm danh được từ ngày diễn ra buổi học; điểm danh lưu theo cặp (buổi, học viên) nên lưu nhiều lần không nhân đôi.
- Học viên vắng ⇒ tự sinh **một** việc chăm sóc (khóa `absence:<id>`); sửa thành có mặt ⇒ việc tự đóng nếu chưa ai xử lý.

**Phê duyệt & công việc**
- Không ai tự duyệt đề xuất của chính mình. Duyệt dùng câu lệnh có điều kiện `status = 'pending'` trong transaction ⇒ bấm hai lần/hai người cùng duyệt chỉ tác động một lần.
- Đề xuất có chi tiền (mua sắm, chi phí, hoàn phí): sau duyệt ở trạng thái *Đã duyệt – chưa chi*; chỉ khi thu ngân xác nhận chi mới vào báo cáo thu chi.
- Báo hỏng: chưa duyệt đề xuất chi thì chưa xác nhận xử lý xong; xác nhận xử lý tự hoàn thành công việc liên quan.
- Checklist mẫu (mở cửa, kiểm tra phòng, đóng cửa) chỉ tạo một lần cho mỗi ngày.

**Khác**
- Ngày nghiệp vụ theo `Asia/Ho_Chi_Minh`; hiển thị `dd/MM/yyyy`, giờ 24h (ô nhập ngày/giờ tự viết, không phụ thuộc ngôn ngữ trình duyệt).
- Không tính lương — chỉ tổng hợp giờ dạy đã duyệt.
- Cảnh báo trùng số điện thoại ở khách quan tâm nhưng **không tự gộp** (một phụ huynh có thể có nhiều con).
- Hồ sơ học viên đã phát sinh nghiệp vụ chỉ *lưu trữ* có lý do, không xóa cứng.

## 5. Chạy thật / mô phỏng / cần làm trước khi dùng chính thức

**Chạy thật trong demo (đọc/ghi database, có kiểm tra quyền ở server):**
tuyển sinh (khách, tư vấn, học thử/kiểm tra đầu vào, chuyển đổi), học viên – phụ huynh, khóa/lớp/lịch (sinh buổi, đổi lịch, hủy buổi,
kiểm tra trùng), điểm danh – học bù, công nợ – phiếu thu – hủy phiếu – giảm phí – hoàn phí, chăm sóc – tái đăng ký, quét nhắc việc,
công việc (bảng/Kanban, checklist, bình luận), nhân sự – ca làm – đơn nghỉ – giờ dạy, đề xuất – phê duyệt – xác nhận chi, tài sản – báo hỏng,
giáo trình – nhập/xuất kho, thông báo nội bộ, báo cáo, xuất CSV, mẫu phiếu thu in, đăng nhập/phiên/phân quyền, reset demo.

**Mô phỏng hoặc ghi nhận thủ công (không có tích hợp thật):**
- Chuyển khoản/quẹt thẻ: chỉ **ghi nhận** giao dịch đã xảy ra; không kết nối ngân hàng/cổng thanh toán.
- Gửi tin cho phụ huynh: không gửi SMS/Zalo/email. Thông báo nội bộ chỉ trong app; có thể đánh dấu "Đã gửi ngoài (thủ công)" để theo dõi.
- Phiếu thu là chứng từ nội bộ, **không phải hóa đơn điện tử**.
- Thông báo chuông chỉ trong app. Quét nhắc việc chạy khi khởi động server và mỗi giờ (không có hàng đợi/cron riêng).

**Cần làm trước khi dùng chính thức:**
- Xác nhận các giả định nghiệp vụ ở mục 4 (đặc biệt quy tắc tính buổi, chính sách hoàn phí, tiền thừa/bảo lưu, chuyển lớp).
- Tắt `DEMO_MODE`, đặt `SESSION_SECRET`, chạy sau HTTPS (`COOKIE_SECURE=true`), tạo tài khoản thật và quy trình đổi/quên mật khẩu (chưa có).
- Sao lưu định kỳ database; cân nhắc PostgreSQL nếu nhiều người dùng đồng thời hoặc nhiều tiến trình.
- Nhật ký kiểm toán đầy đủ cho mọi thay đổi (hiện có lịch sử cho các nghiệp vụ chính: tư vấn, đăng ký, phiếu thu, phê duyệt, báo hỏng, chăm sóc, buổi học).
- Tích hợp hóa đơn điện tử, cổng thanh toán, Zalo OA/SMS nếu cần; phân trang phía server khi dữ liệu lớn.
- Kiểm thử trên thiết bị thật (iOS Safari, Android), trình đọc màn hình, mạng chậm.
- Xác nhận quyền sử dụng logo/nhận diện thương hiệu (xem dưới).

## 6. Giao diện, nền tối và hiệu ứng

- Sidebar xanh quân đội, banner chào trên Tổng quan, thẻ chỉ số có ô icon theo mức độ, bóng đổ mềm.
- **Nền sáng / tối / theo hệ thống** (nút mặt trời–mặt trăng trên thanh đầu trang, lưu theo từng trình duyệt). Bảng màu tối khai riêng
  từng biến; `node tests/e2e/theme-parity.js` kiểm không thiếu biến nào. Phiếu thu luôn in nền sáng.
- **Hiệu ứng**: chuyển trang trồi nhẹ, thẻ/khối hiện lần lượt, số chỉ số chạy tới giá trị, modal phóng nhẹ (điện thoại: tấm trượt từ dưới),
  drawer trượt ngang, menu bung từ gốc, toast trượt vào/ra, gạch chân tab trượt, thanh tiến độ chạy dần, khung chờ có vệt sáng,
  chấm "Đang diễn ra" cho buổi học đang chạy, chuông lắc khi có thông báo mới, cột biểu đồ mọc lần lượt.
  Chỉ dùng `transform`/`opacity`; **tự tắt khi máy bật "giảm chuyển động"** (`node tests/e2e/motion-check.js` đo cả hai chế độ).
- Dòng bảng và thẻ danh sách mở được bằng bàn phím (Tab rồi Enter).

## 7. Nhận diện thương hiệu

Đã truy cập được https://army.edu.vn/: dùng tên **ARMY ENGLISH**, logo `army_logo.png` của website (thu nhỏ, cắt riêng biểu tượng cho
sidebar thu gọn và favicon) và màu xanh lá chủ đạo của website/logo (`#2D904F`, logo `#138A43`). Giao diện quản trị dùng thang màu
xanh này làm màu nhấn có tiết chế; đỏ của logo chỉ dùng cho trạng thái nguy hiểm. Không sao chép bố cục website giới thiệu.
Bảng màu biểu đồ (xanh Army → xanh dương → hổ phách, thứ tự cố định) đã kiểm tra độ tương phản và mù màu bằng công cụ kiểm tra bảng màu.

## 8. Bảo mật đã áp dụng

Mật khẩu băm bcrypt (không lưu plaintext) · cookie phiên `HttpOnly` + `SameSite=Lax` · tạo lại session id khi đăng nhập/chuyển tài khoản ·
header `X-Requested-With` bắt buộc cho mọi yêu cầu ghi (chống CSRF) · truy vấn SQL có tham số · transaction cho thao tác nhiều bản ghi
(thu tiền, đăng ký khóa, chuyển đổi khách, phê duyệt, điểm danh, kho, reset) · `Idempotency-Key` cho phiếu thu, đăng ký khóa, xuất/nhập kho ·
CSV chống chèn công thức (`=`, `+`, `-`, `@`…) · header `nosniff`, `X-Frame-Options`, `Referrer-Policy` · không có secret trong repo/frontend.
