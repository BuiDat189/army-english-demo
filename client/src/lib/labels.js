// Nhãn trạng thái dùng chung: luôn có CHỮ, màu chỉ là phụ trợ.
// tone: neutral | info | success | warning | danger | brand | purple
export const STATUS = {
  // Phân loại khách theo quy trình trung tâm
  lead: {
    potential: ['Tiềm năng tháng', 'info'], appointing: ['Đang lên hẹn', 'purple'], checkin_booked: ['Đăng ký check-in', 'warning'],
    checked_in: ['Đã check-in', 'brand'], trial_booked: ['Đăng ký học thử', 'warning'], trial_done: ['Đã học thử', 'brand'],
    nurturing: ['Chăm sóc thêm', 'neutral'], enrolled: ['Đã đăng ký', 'success'], unfit: ['Không phù hợp', 'neutral'],
  },
  student: { active: ['Đang học', 'success'], reserved: ['Bảo lưu', 'warning'], inactive: ['Đã nghỉ', 'neutral'], archived: ['Lưu trữ', 'neutral'] },
  enrollment: { pending_approval: ['Chờ GĐ duyệt học phí', 'purple'], pending_class: ['Chờ xếp lớp', 'warning'], active: ['Đang học', 'success'], completed: ['Hoàn thành', 'info'], reserved: ['Bảo lưu', 'warning'], cancelled: ['Đã hủy', 'neutral'] },
  payment: { awaiting: ['Chờ GĐ duyệt học phí', 'purple'], paid: ['Đã đóng đủ', 'success'], partial: ['Đóng một phần', 'info'], unpaid: ['Chưa đóng', 'neutral'], due_soon: ['Sắp đến hạn', 'warning'], overdue: ['Quá hạn', 'danger'], closed: ['Đã đóng hồ sơ', 'neutral'] },
  installment: { paid: ['Đã thu', 'success'], partial: ['Thu một phần', 'info'], upcoming: ['Chưa đến hạn', 'neutral'], due_soon: ['Sắp đến hạn', 'warning'], overdue: ['Quá hạn', 'danger'], waived: ['Không thu', 'neutral'] },
  class: { planned: ['Sắp khai giảng', 'info'], active: ['Đang học', 'success'], finished: ['Đã kết thúc', 'neutral'], cancelled: ['Đã hủy', 'neutral'] },
  session: { scheduled: ['Chưa diễn ra', 'neutral'], done: ['Đã điểm danh', 'success'], cancelled: ['Đã hủy', 'danger'] },
  attendance: { present: ['Có mặt', 'success'], late: ['Đi muộn', 'warning'], excused: ['Vắng có phép', 'info'], absent: ['Vắng không phép', 'danger'] },
  makeup: { scheduled: ['Đã xếp học bù', 'info'], done: ['Đã học bù', 'success'], missed: ['Vắng buổi bù', 'danger'], cancelled: ['Hủy học bù', 'neutral'] },
  trial: { scheduled: ['Đã hẹn', 'warning'], done: ['Đã học thử', 'success'], no_show: ['Không đến', 'danger'], cancelled: ['Đã hủy', 'neutral'] },
  receipt: { confirmed: ['Đã xác nhận', 'success'], cancelled: ['Đã hủy', 'danger'] },
  refund: { requested: ['Chờ duyệt', 'warning'], approved: ['Đã duyệt – chưa chi', 'info'], rejected: ['Từ chối', 'neutral'], paid: ['Đã hoàn tiền', 'success'] },
  discount: { pending: ['Chờ duyệt', 'warning'], approved: ['Đã duyệt', 'success'], rejected: ['Từ chối', 'neutral'] },
  care: { new: ['Mới', 'info'], in_progress: ['Đang xử lý', 'warning'], waiting: ['Chờ phản hồi', 'purple'], done: ['Hoàn thành', 'success'] },
  task: { todo: ['Cần làm', 'neutral'], in_progress: ['Đang làm', 'info'], review: ['Chờ kiểm tra', 'purple'], done: ['Hoàn thành', 'success'] },
  priority: { low: ['Thấp', 'neutral'], normal: ['Bình thường', 'info'], high: ['Cao', 'warning'], urgent: ['Khẩn cấp', 'danger'] },
  approval: { pending: ['Chờ duyệt', 'warning'], approved: ['Đã duyệt', 'success'], rejected: ['Từ chối', 'danger'], cancelled: ['Đã hủy', 'neutral'] },
  approvalPayment: { none: ['Không phát sinh chi', 'neutral'], unpaid: ['Đã duyệt – chưa chi', 'warning'], paid: ['Đã chi', 'success'] },
  asset: { good: ['Hoạt động tốt', 'success'], damaged: ['Hỏng – chờ xử lý', 'danger'], repairing: ['Đang sửa', 'warning'], disposed: ['Đã thanh lý', 'neutral'] },
  classEvent: { scheduled: ['Chưa tổ chức', 'info'], done: ['Đã tổ chức', 'success'], cancelled: ['Đã hủy', 'neutral'] },
  package: { active: ['Đang áp dụng', 'success'], pending: ['Chờ GĐ duyệt', 'warning'], rejected: ['Không được duyệt', 'danger'], archived: ['Ngừng bán', 'neutral'] },
  issue: { reported: ['Mới báo', 'danger'], in_progress: ['Đang xử lý', 'warning'], waiting_approval: ['Chờ duyệt chi', 'purple'], resolved: ['Đã xử lý', 'success'], cancelled: ['Đã hủy', 'neutral'] },
  teachingLog: { pending: ['Chờ duyệt', 'warning'], approved: ['Đã duyệt', 'success'], rejected: ['Từ chối', 'danger'] },
  leave: { pending: ['Chờ duyệt', 'warning'], approved: ['Đã duyệt', 'success'], rejected: ['Từ chối', 'neutral'] },
  staff: { active: ['Đang làm việc', 'success'], inactive: ['Ngừng hoạt động', 'neutral'] },
};

export const LEAD_SOURCES = ['Khách hàng giới thiệu', 'Vãng lai', 'Fanpage', 'Thị trường', 'Telesales', 'Kênh online', 'Sự kiện', 'Đối tác'];
export const OPEN_LEAD_STATUSES = ['potential', 'appointing', 'checkin_booked', 'checked_in', 'trial_booked', 'trial_done', 'nurturing'];
export const MANUAL_LEAD_STATUSES = ['potential', 'appointing', 'nurturing'];
export const METHODS = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Quẹt thẻ' };
export const CONTACT_TYPES = { call: 'Gọi điện', message: 'Nhắn tin', meeting: 'Gặp trực tiếp', note: 'Ghi chú' };
export const CARE_CHANNELS = { call: 'Gọi điện', zalo: 'Zalo', sms: 'SMS', meeting: 'Gặp trực tiếp', email: 'Email', note: 'Ghi chú nội bộ' };
export const CARE_TYPES = { absence: 'Vắng học', feedback: 'Phản hồi', complaint: 'Khiếu nại', renewal: 'Tái đăng ký', payment: 'Học phí', support: 'Bổ trợ học tập', general: 'Chăm sóc chung' };
export const APPROVAL_TYPES = {
  purchase: 'Mua sắm', expense: 'Chi phí', leave: 'Nghỉ phép', discount: 'Giảm học phí', refund: 'Hoàn phí',
  package_change: 'Đổi gói phí', reserve: 'Bảo lưu khóa học', contract_cancel: 'Hủy hợp đồng', fee_transfer: 'Chuyển học phí',
  enrollment: 'Duyệt học phí đăng ký', package: 'Duyệt gói phí', class_transfer: 'Chuyển lớp', level_up: 'Lên level mới',
};
export const STAGE_LABELS = { lead: 'Chờ Trưởng phòng học thuật', final: 'Chờ Giám đốc duyệt cuối' };
export const EVENT_KINDS = { test: 'Kiểm tra định kỳ', parent_meeting: 'Họp phụ huynh' };
export const ROLE_LABELS = { manager: 'Giám đốc trung tâm', sales_lead: 'Trưởng phòng sales', consultant: 'Tư vấn viên (EC)', academic: 'Trưởng phòng học thuật', teacher: 'Giáo viên / Chủ nhiệm (CM)', cashier: 'Hành chính – Kế toán', operations: 'Cơ sở vật chất' };
export const RELATIONSHIPS = ['Mẹ', 'Bố', 'Ông', 'Bà', 'Người giám hộ'];
export const LEAVE_KINDS = { annual: 'Nghỉ phép năm', sick: 'Nghỉ ốm', personal: 'Việc riêng' };
export const MATERIAL_KINDS = { textbook: 'Giáo trình', supply: 'Vật tư' };
