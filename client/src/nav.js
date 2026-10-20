import {
  LayoutDashboard, UserPlus, GraduationCap, BookOpen, CalendarDays, ClipboardCheck, Wallet, HeartHandshake,
  ListChecks, FileCheck2, Users, Package, Library, Megaphone, BarChart3, UserCog, BookOpenCheck, Trophy, CalendarCheck,
} from 'lucide-react';

// Menu theo quyền. `perms`: cần ít nhất một quyền; không khai = ai đăng nhập cũng thấy.
export const NAV = [
  { group: null, items: [
    { to: '/', label: 'Tổng quan', icon: LayoutDashboard, perms: ['dashboard.view'], end: true },
  ] },
  { group: 'Học vụ', items: [
    { to: '/leads', label: 'Data khách hàng', icon: UserPlus, perms: ['leads.view'] },
    { to: '/students', label: 'Học viên – Phụ huynh', icon: GraduationCap, perms: ['students.view', 'students.view_own'] },
    { to: '/classes', label: 'Lớp & Khóa học', icon: BookOpen, perms: ['classes.view', 'classes.view_own'] },
    { to: '/schedule', label: 'Lịch học', icon: CalendarDays, perms: ['classes.view', 'classes.view_own'] },
    { to: '/class-events', label: 'Test – Họp PH – Lịch nghỉ', icon: CalendarCheck, perms: ['classes.view', 'classes.view_own'] },
    { to: '/training', label: 'Điểm danh – Đào tạo', icon: ClipboardCheck, perms: ['attendance.edit', 'attendance.edit_own', 'makeup.edit'] },
    { to: '/learning', label: 'Học tập – Check-in', icon: BookOpenCheck, perms: ['checkin.edit', 'learning.edit', 'learning.edit_own', 'support.view'] },
    { to: '/care', label: 'Chăm sóc – Tái đăng ký', icon: HeartHandshake, perms: ['care.view'] },
  ] },
  { group: 'Tài chính', items: [
    { to: '/finance', label: 'Học phí – Thu chi', icon: Wallet, perms: ['finance.view'] },
    { to: '/approvals', label: 'Đề xuất – Phê duyệt', icon: FileCheck2 },
  ] },
  { group: 'Vận hành', items: [
    { to: '/tasks', label: 'Công việc', icon: ListChecks },
    { to: '/hr', label: 'Nhân sự – Giờ dạy', labelLimited: 'Lịch làm & giờ dạy', icon: Users, perms: ['hr.view', 'teaching.log'] },
    { to: '/assets', label: 'Tài sản', icon: Package, perms: ['assets.view', 'assets.report'] },
    { to: '/inventory', label: 'Giáo trình – Vật tư', icon: Library, perms: ['inventory.view'] },
    { to: '/notices', label: 'Thông báo', icon: Megaphone },
    { to: '/performance', label: 'Hiệu suất EC/CM', icon: Trophy, perms: ['performance.view'] },
    { to: '/reports', label: 'Báo cáo', icon: BarChart3, perms: ['reports.enrollment', 'reports.attendance', 'reports.finance', 'reports.teaching', 'reports.tasks', 'reports.daily', 'reports.staff_ec', 'reports.staff_cm', 'assets.view'] },
  ] },
  { group: 'Hệ thống', items: [
    { to: '/account', label: 'Tài khoản & phân quyền', icon: UserCog },
  ] },
];

export function visibleNav(can) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perms || can(...i.perms)) })).filter((g) => g.items.length);
}

export const PAGE_TITLES = [
  ['/leads', 'Data khách hàng'], ['/class-events', 'Test – Họp PH – Lịch nghỉ'], ['/students', 'Học viên – Phụ huynh'], ['/classes', 'Lớp & Khóa học'], ['/schedule', 'Lịch học'],
  ['/training', 'Điểm danh – Đào tạo'], ['/learning', 'Học tập – Check-in'], ['/performance', 'Hiệu suất EC/CM'], ['/care', 'Chăm sóc – Tái đăng ký'], ['/finance', 'Học phí – Thu chi'], ['/approvals', 'Đề xuất – Phê duyệt'],
  ['/tasks', 'Công việc'], ['/hr', 'Nhân sự – Giờ dạy'], ['/assets', 'Tài sản'], ['/inventory', 'Giáo trình – Vật tư'], ['/notices', 'Thông báo'],
  ['/reports', 'Báo cáo'], ['/account', 'Tài khoản & phân quyền'], ['/', 'Tổng quan'],
];
