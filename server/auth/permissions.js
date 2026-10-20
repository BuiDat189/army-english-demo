// Ma trận quyền theo yêu cầu của trung tâm (6 bộ phận). Một người có thể kiêm nhiều vai trò ⇒ quyền = hợp các vai trò.
// Backend kiểm tra quyền ở mọi route; frontend chỉ dùng danh sách này để ẩn/hiện menu.
// Mã vai trò giữ ổn định (manager, consultant…) để dữ liệu cũ không vỡ; tên hiển thị theo cách gọi của trung tâm.

export const ROLES = {
  manager: 'Giám đốc trung tâm',
  sales_lead: 'Trưởng phòng sales',
  consultant: 'Tư vấn viên (EC)',
  academic: 'Trưởng phòng học thuật',
  teacher: 'Giáo viên / Chủ nhiệm (CM)',
  cashier: 'Hành chính – Kế toán',
  operations: 'Cơ sở vật chất',
};

export const PERMISSIONS = {
  'dashboard.view': 'Xem tổng quan',
  'dashboard.finance': 'Xem chỉ số tài chính trên tổng quan',
  'leads.view': 'Xem khách quan tâm của mình',
  'leads.view_all': 'Xem khách của mọi nhân sự',
  'leads.edit': 'Nhập data khách, phân loại, ghi tư vấn, hẹn check-in/học thử',
  'leads.convert': 'Chuyển khách thành học viên',
  'leads.assign': 'Đổi nhân sự phụ trách khách (kể cả khách đã check-in)',
  'students.view': 'Xem tất cả học viên',
  'students.view_own': 'Xem học viên trong lớp mình dạy/chủ nhiệm',
  'students.edit': 'Tạo/sửa hồ sơ học viên',
  'students.contacts': 'Xem thông tin liên hệ phụ huynh',
  'enrollments.create': 'Tạo đăng ký khóa / tái phí (chờ Giám đốc duyệt học phí)',
  'classes.view': 'Xem tất cả lớp và lịch',
  'classes.view_own': 'Xem lớp mình dạy/chủ nhiệm',
  'classes.edit': 'Tạo/sửa lớp, xếp lớp, khóa học',
  'schedule.edit': 'Tạo/đổi/hủy buổi học',
  'closures.edit': 'Khai báo lịch nghỉ do trung tâm (không trừ học phí)',
  'attendance.edit': 'Điểm danh mọi lớp',
  'attendance.edit_own': 'Điểm danh lớp mình dạy/chủ nhiệm',
  'makeup.edit': 'Xếp học bù',
  'finance.view': 'Xem học phí, công nợ, phiếu thu',
  'finance.summary': 'Xem số tiền đã đóng và ngày hết phí của học viên',
  'finance.collect': 'Ghi nhận phiếu thu, nạp tiền',
  'finance.cancel': 'Hủy phiếu thu',
  'finance.discount_request': 'Đề nghị giảm phí',
  'finance.refund_request': 'Đề nghị hoàn phí',
  'finance.pay': 'Xác nhận chi tiền (hoàn phí, đề nghị chi)',
  'care.view': 'Xem chăm sóc học viên',
  'care.edit': 'Ghi chăm sóc, xử lý phản hồi',
  'tasks.view_all': 'Xem mọi công việc',
  'tasks.assign': 'Giao việc cho người khác',
  'hr.view': 'Xem danh sách nhân sự',
  'hr.edit': 'Sửa nhân sự, lịch làm việc',
  'teaching.log': 'Ghi nhận giờ dạy của mình',
  'teaching.approve': 'Duyệt giờ dạy',
  'approvals.create': 'Tạo đề xuất',
  'approvals.decide_lead': 'Duyệt cấp trưởng phòng (bảo lưu, chuyển học phí, chuyển lớp, lên level)',
  'approvals.decide': 'Duyệt cuối (Giám đốc): học phí, gói phí, đề xuất',
  'approvals.view_all': 'Xem mọi đề xuất',
  'assets.view': 'Xem tài sản và báo cáo sự cố cơ sở vật chất',
  'assets.report': 'Báo sự cố cơ sở vật chất',
  'assets.edit': 'Quản lý tài sản, xử lý sự cố',
  'inventory.view': 'Xem giáo trình/vật tư',
  'inventory.edit': 'Nhập/xuất kho',
  'notices.create': 'Tạo thông báo nội bộ',
  'reports.enrollment': 'Báo cáo tuyển sinh',
  'reports.attendance': 'Báo cáo điểm danh, học tập',
  'reports.finance': 'Báo cáo học phí, thu chi',
  'reports.daily': 'Báo cáo ngày (check-in, renew, hoàn new, cọc, công nợ, thực thu)',
  'reports.teaching': 'Báo cáo giờ dạy',
  'reports.tasks': 'Báo cáo công việc',
  'reports.staff_ec': 'Báo cáo từng nhân sự tư vấn (EC)',
  'reports.staff_cm': 'Báo cáo từng nhân sự chủ nhiệm (CM)',
  'learning.edit': 'Ghi BTVN, điểm kiểm tra, nhận xét mọi lớp',
  'learning.edit_own': 'Ghi BTVN, điểm kiểm tra, nhận xét lớp mình',
  'class_events.edit': 'Đặt lịch test / họp phụ huynh của lớp',
  'checkin.edit': 'Check-in học viên tại quầy',
  'support.view': 'Rà soát bổ trợ học tập',
  'performance.view': 'Xem hiệu suất EC/CM',
  'packages.edit': 'Đề xuất gói phí (Giám đốc duyệt)',
  'requests.create': 'Đề nghị đổi gói, bảo lưu, chuyển lớp, lên level, hủy hợp đồng, chuyển học phí',
  'students.import': 'Nhập học viên từ file Excel/CSV',
  'demo.reset': 'Reset dữ liệu demo',
};

const ALL = Object.keys(PERMISSIONS);

// Tư vấn viên EC: data khách của mình, xem lịch + danh sách học sinh (KHÔNG có liên hệ phụ huynh), số tiền đã đóng, ngày hết phí
const EC = [
  'dashboard.view', 'leads.view', 'leads.edit', 'leads.convert', 'students.view', 'students.edit', 'enrollments.create',
  'classes.view', 'finance.summary', 'finance.discount_request', 'approvals.create', 'assets.report', 'reports.enrollment',
  'requests.create', 'students.import', 'checkin.edit',
];
// Giáo viên chủ nhiệm CM: lớp mình (học sinh, điểm danh, tiền đóng, ngày hết phí), BTVN/nhận xét, tái phí, data khách, lịch test/họp PH
const CM = [
  'dashboard.view', 'students.view_own', 'students.contacts', 'classes.view_own', 'attendance.edit_own', 'learning.edit_own',
  'finance.summary', 'leads.view', 'leads.edit', 'leads.convert', 'enrollments.create', 'requests.create', 'class_events.edit',
  'teaching.log', 'approvals.create', 'assets.report', 'inventory.view', 'care.view', 'care.edit', 'makeup.edit',
];

export const ROLE_PERMISSIONS = {
  manager: ALL,
  // Trưởng phòng sales: như EC + xem toàn bộ EC, báo cáo từng nhân sự, báo cáo sự cố cơ sở vật chất
  sales_lead: [...EC, 'leads.view_all', 'leads.assign', 'reports.staff_ec', 'performance.view', 'assets.view', 'tasks.view_all', 'tasks.assign', 'reports.finance'],
  consultant: EC,
  // Trưởng phòng học thuật: như CM + xem toàn bộ CM/lớp, báo cáo từng nhân sự, duyệt cấp 1 (bảo lưu, chuyển học phí, chuyển lớp, lên level)
  academic: [
    ...CM, 'students.view', 'students.edit', 'classes.view', 'classes.edit', 'schedule.edit', 'closures.edit', 'attendance.edit', 'learning.edit',
    'approvals.decide_lead', 'reports.staff_cm', 'reports.attendance', 'reports.teaching', 'performance.view', 'support.view',
    'hr.view', 'teaching.approve', 'packages.edit', 'notices.create', 'tasks.assign', 'inventory.edit', 'leads.view_all',
  ],
  teacher: CM,
  // Hành chính – Kế toán: doanh số từng case, thông tin HS & PH, phương thức thanh toán; báo cáo ngày; nhận đề xuất/báo cáo các phòng
  cashier: [
    'dashboard.view', 'dashboard.finance', 'students.view', 'students.contacts', 'finance.view', 'finance.summary', 'finance.collect', 'finance.cancel',
    'finance.refund_request', 'finance.pay', 'approvals.create', 'approvals.view_all', 'assets.report', 'reports.finance', 'reports.daily',
    'reports.enrollment', 'checkin.edit', 'classes.view',
  ],
  operations: [
    'dashboard.view', 'classes.view', 'tasks.assign', 'hr.view', 'approvals.create', 'assets.view', 'assets.report', 'assets.edit',
    'inventory.view', 'inventory.edit', 'notices.create', 'reports.tasks',
  ],
};

export function permissionsFor(roles) {
  const set = new Set();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] || []) set.add(p);
  return set;
}

/** Thông tin quyền dạng dễ đọc, dùng cho README và trang tài khoản. */
export function describeRoles() {
  return Object.entries(ROLES).map(([key, label]) => ({
    key, label, permissions: [...new Set(ROLE_PERMISSIONS[key] || [])].map((p) => PERMISSIONS[p]),
  }));
}
