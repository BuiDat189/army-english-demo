// Dữ liệu demo — HOÀN TOÀN GIẢ. Số điện thoại dạng 0000xxxxxx (đầu 00 không phải số di động thật
// tại Việt Nam nên không thể gọi nhầm), email dùng miền example.com.
// Mọi ngày được tính TƯƠNG ĐỐI theo "hôm nay" giờ Việt Nam, lịch lớp xoay theo thứ của hôm nay
// nên trang Tổng quan/Lịch hôm nay luôn có nội dung khi trình diễn.
import bcrypt from 'bcryptjs';
import { nextCode, setMeta } from './index.js';
import { vnToday, addDays, isoWeekday, startOfWeek } from '../lib/time.js';
import { generateDates } from '../services/schedule.js';
import { runReminders } from '../services/reminders.js';
import { proposeTask } from '../services/leads.js';

export const DEMO_PASSWORD = 'Army@2026';

// Bảng xóa khi reset (thứ tự con → cha)
const DATA_TABLES = [
  'class_events', 'center_closures', 'approval_files', 'wallet_entries', 'support_reviews', 'checkins', 'assessments',
  'notifications', 'notice_reads', 'notices', 'activity_log', 'stock_moves', 'materials', 'asset_issues', 'assets',
  'approval_events', 'teaching_logs', 'leave_requests', 'work_shifts', 'task_comments', 'task_items', 'tasks',
  'care_logs', 'care_cases', 'makeups', 'attendance', 'refunds', 'receipts', 'discounts', 'installments', 'approvals',
  'enrollments', 'student_contacts', 'students', 'trials', 'lead_activities', 'leads', 'parents',
  'class_sessions', 'classes', 'fee_packages', 'courses', 'rooms', 'counters',
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (date, time = '09:00') => new Date(`${date}T${time}:00+07:00`).toISOString();
const round1000 = (n) => Math.round(n / 1000) * 1000;

export function clearDemoData(db) {
  for (const t of DATA_TABLES) db.prepare(`DELETE FROM ${t}`).run();
  const demoIds = db.prepare('SELECT id FROM users WHERE is_demo = 1').all().map((r) => r.id);
  for (const id of demoIds) {
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

export function seedDemo(db, { today = vnToday() } = {}) {
  const run = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    clearDemoData(db);
    build(db, today);
  });
  run();
  runReminders(db, { today });
  ageCareCases(db, today);
  setMeta(db, 'demo_seeded_at', new Date().toISOString());
  setMeta(db, 'demo_seed_today', today);
}

function build(db, today) {
  const R = rng(20261012);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const chance = (p) => R() < p;
  const ins = (table, obj) => {
    const keys = Object.keys(obj);
    const info = db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => obj[k]));
    return Number(info.lastInsertRowid);
  };
  const log = (entityType, entityId, action, summary, userId, at) => ins('activity_log', { entity_type: entityType, entity_id: entityId, action, summary, user_id: userId, created_at: at });
  const nowTs = new Date().toISOString();
  const year = Number(today.slice(0, 4));
  const d0 = isoWeekday(today);
  const wd = (k) => ((d0 - 1 + k) % 7) + 1; // thứ của (hôm nay + k ngày)
  let phoneSeq = 120;
  const fakePhone = () => `0000${String(++phoneSeq * 37 % 1000000).padStart(6, '0')}`;

  // ---------- Nhân sự & tài khoản (id cố định để phiên đăng nhập còn hiệu lực sau reset) ----------
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const staff = [
    { id: 1, code: 'NV001', username: 'quanly', full_name: 'Nguyễn Thị Minh Anh', title: 'Giám đốc trung tâm', roles: ['manager'], employment: 'full_time' },
    { id: 2, code: 'NV002', username: 'tuvan', full_name: 'Trần Văn Hùng', title: 'Tư vấn viên (EC)', roles: ['consultant'], employment: 'full_time' },
    { id: 3, code: 'NV003', username: 'giaovu', full_name: 'Phạm Ngọc Lan', title: 'Trưởng phòng học thuật', roles: ['academic', 'teacher'], employment: 'full_time' },
    { id: 4, code: 'NV004', username: 'giaovien', full_name: 'Đỗ Thanh Tâm', title: 'Giáo viên chủ nhiệm (CM)', roles: ['teacher'], employment: 'full_time' },
    { id: 5, code: 'NV005', username: 'thungan', full_name: 'Bùi Quang Huy', title: 'Hành chính – Kế toán', roles: ['cashier'], employment: 'full_time' },
    { id: 6, code: 'NV006', username: 'vanhanh', full_name: 'Ngô Văn Long', title: 'Nhân viên cơ sở vật chất', roles: ['operations'], employment: 'full_time' },
    { id: 7, code: 'NV007', username: 'david', full_name: 'David Miller', title: 'Giáo viên bản ngữ', roles: ['teacher'], employment: 'part_time' },
    { id: 8, code: 'NV008', username: 'sarah', full_name: 'Sarah Johnson', title: 'Giáo viên bản ngữ', roles: ['teacher'], employment: 'part_time' },
    { id: 9, code: 'NV009', username: 'phuong', full_name: 'Hoàng Mai Phương', title: 'Giáo viên chủ nhiệm (CM)', roles: ['teacher'], employment: 'full_time' },
    { id: 10, code: 'NV010', username: 'trang', full_name: 'Đặng Thu Trang', title: 'Giáo viên chủ nhiệm (CM)', roles: ['teacher'], employment: 'full_time' },
    { id: 11, code: 'NV011', username: 'yen', full_name: 'Vũ Hải Yến', title: 'Tư vấn viên (EC) kiêm trợ giảng', roles: ['teacher', 'consultant'], employment: 'part_time' },
    { id: 12, code: 'NV012', username: 'truongsales', full_name: 'Lê Hoàng Nam', title: 'Trưởng phòng sales', roles: ['sales_lead', 'consultant'], employment: 'full_time' },
  ];
  for (const s of staff) {
    ins('users', {
      id: s.id, code: s.code, full_name: s.full_name, title: s.title, phone: fakePhone(), email: `${s.username}@example.com`,
      employment: s.employment, status: 'active', username: s.username, password_hash: hash, is_demo: 1,
      joined_at: addDays(today, -400 - s.id * 37), created_at: nowTs,
    });
    for (const r of s.roles) ins('user_roles', { user_id: s.id, role: r });
  }
  const U = { manager: 1, consultant: 2, academic: 3, tam: 4, cashier: 5, ops: 6, david: 7, sarah: 8, phuong: 9, trang: 10, yen: 11, sales: 12 };

  // ---------- Phòng học ----------
  const rooms = {};
  for (const [name, cap, floor] of [['P101', 12, 'Tầng 1'], ['P102', 12, 'Tầng 1'], ['P201', 16, 'Tầng 2'], ['P202', 10, 'Tầng 2'], ['P301', 20, 'Tầng 3']]) {
    rooms[name] = ins('rooms', { name, capacity: cap, floor, status: 'active' });
  }

  // ---------- Khóa học ----------
  const courseDefs = [
    ['ST1', 'Army Starters 1', 'Cambridge Young Learners', 'Pre-A1 Starters', '6–8 tuổi', 24, 90, 4800000],
    ['ST2', 'Army Starters 2', 'Cambridge Young Learners', 'Pre-A1 Starters', '6–8 tuổi', 24, 90, 4800000],
    ['MV1', 'Army Movers 1', 'Cambridge Young Learners', 'A1 Movers', '8–10 tuổi', 24, 90, 5400000],
    ['FL1', 'Army Flyers 1', 'Cambridge Young Learners', 'A2 Flyers', '10–12 tuổi', 24, 90, 5900000],
    ['KET', 'Pre-KET Pro', 'Cambridge Secondary', 'A2 Key', '11–13 tuổi', 30, 90, 7200000],
    ['PET', 'PET Elite', 'Cambridge Secondary', 'B1 Preliminary', '13–15 tuổi', 30, 90, 7800000],
    ['IEF', 'IELTS Foundation', 'IELTS', 'IELTS 4.0–5.0', '15 tuổi trở lên', 36, 90, 9600000],
  ];
  const courses = {};
  for (const [code, name, program, level, age, total, minutes, fee] of courseDefs) {
    courses[code] = ins('courses', { code, name, program, level, age_range: age, total_sessions: total, session_minutes: minutes, tuition_fee: fee, description: `Chương trình ${program}, trình độ ${level}.`, status: 'active' });
  }
  const nextOf = { ST1: 'ST2', ST2: 'MV1', MV1: 'FL1', FL1: 'KET', KET: 'PET', PET: 'IEF' };
  for (const [a, b] of Object.entries(nextOf)) db.prepare('UPDATE courses SET next_course_id = ? WHERE id = ?').run(courses[b], courses[a]);
  const courseRow = (code) => db.prepare('SELECT * FROM courses WHERE id = ?').get(courses[code]);
  const packages = {};
  for (const [code, , , , , total, , fee] of courseDefs) {
    // Học phí theo buổi của khóa; gói dài được giảm. Gói 1 năm 96 buổi: 4 buổi nghỉ không tính phí + 1 lần bảo lưu (2 tuần – 3 tháng)
    const per = fee / total;
    const defs = [
      ['3T', 'Gói 3 tháng · 24 buổi', 'new', 24, 3, round1000(per * 24), 1, 0, 'Nghỉ không tính phí 1 buổi'],
      ['6T', 'Gói 6 tháng · 48 buổi (−5%)', 'new', 48, 6, round1000(per * 48 * 0.95), 2, 0, 'Nghỉ không tính phí 2 buổi'],
      ['12T', 'Gói 1 năm · 96 buổi (−10%)', 'new', 96, 12, round1000(per * 96 * 0.9), 4, 1, '4 buổi nghỉ không tính phí, 1 lần bảo lưu 2 tuần – 3 tháng'],
      ['TP6', 'Tái phí 6 tháng · 48 buổi (−8%)', 'renew', 48, 6, round1000(per * 48 * 0.92), 2, 0, 'Ưu đãi học viên cũ đăng ký tiếp'],
      ['TP12', 'Tái phí 1 năm · 96 buổi (−15%)', 'renew', 96, 12, round1000(per * 96 * 0.85), 4, 1, 'Ưu đãi tái phí dài hạn, 4 buổi nghỉ không tính phí, 1 lần bảo lưu'],
    ];
    for (const [k, name, kind, sessions, months, price, free, reserve, note] of defs) {
      packages[`${code}:${k}`] = ins('fee_packages', { course_id: courses[code], code: nextCode(db, 'package', 'GP-', 3), name, kind, sessions, bonus_sessions: 0, months, price, note, status: 'active', free_absences: free, reserve_limit: reserve, created_at: nowTs });
    }
  }
  const pkgRow = (id) => db.prepare('SELECT * FROM fee_packages WHERE id = ?').get(id);

  // ---------- Lớp học & buổi học ----------
  // weeksAgo: lớp đã học bao nhiêu tuần; age: tuổi học viên
  const classDefs = [
    { code: 'ST1-A', name: 'Starters 1 – A', course: 'ST1', room: 'P101', teacher: U.tam, assistant: U.trang, homeroom: U.tam, days: [0, 3], start: '17:30', end: '19:00', weeksAgo: 11, size: 8, max: 12, age: 7 },
    { code: 'FL1-A', name: 'Flyers 1 – A', course: 'FL1', room: 'P201', teacher: U.david, assistant: null, homeroom: U.phuong, days: [0, 3], start: '19:15', end: '20:45', weeksAgo: 8, size: 9, max: 14, age: 11 },
    { code: 'MV1-A', name: 'Movers 1 – A', course: 'MV1', room: 'P102', teacher: U.phuong, assistant: null, homeroom: U.phuong, days: [1, 4], start: '17:30', end: '19:00', weeksAgo: 6, size: 8, max: 12, age: 9 },
    { code: 'KET-A', name: 'Pre-KET – A', course: 'KET', room: 'P201', teacher: U.sarah, assistant: U.yen, homeroom: U.academic, days: [1, 4], start: '19:15', end: '20:45', weeksAgo: 10, size: 7, max: 14, age: 12 },
    { code: 'PET-A', name: 'PET Elite – A', course: 'PET', room: 'P301', teacher: U.david, assistant: null, homeroom: U.academic, days: [5, 6], start: '08:30', end: '10:00', weeksAgo: 13, size: 6, max: 16, age: 14 },
    { code: 'ST2-A', name: 'Starters 2 – A', course: 'ST2', room: 'P101', teacher: U.tam, assistant: U.trang, homeroom: U.tam, days: [5, 6], start: '10:15', end: '11:45', weeksAgo: 3, size: 7, max: 12, age: 7 },
    { code: 'IEF-A', name: 'IELTS Foundation – A', course: 'IEF', room: 'P301', teacher: U.sarah, assistant: null, homeroom: U.trang, days: [2, 5], start: '18:00', end: '19:30', weeksAgo: 5, size: 6, max: 16, age: 16 },
    { code: 'MV1-B', name: 'Movers 1 – B (khai giảng)', course: 'MV1', room: 'P102', teacher: U.phuong, assistant: null, homeroom: U.phuong, days: [2, 6], start: '17:30', end: '19:00', weeksAgo: -1, size: 2, max: 12, age: 9 },
    // Lớp đã kết thúc: học viên của lớp này đã tái đăng ký sang Movers 1 – A
    { code: 'ST2-Z', name: 'Starters 2 – Z (đã kết thúc)', course: 'ST2', room: 'P102', teacher: U.phuong, assistant: null, homeroom: U.phuong, days: [1, 4], start: '17:30', end: '19:00', weeksAgo: 20, size: 5, max: 12, age: 8, finished: true },
  ];
  const classes = {};
  const classSessions = {};
  for (const c of classDefs) {
    const course = courseRow(c.course);
    const pattern = c.days.map((k) => ({ weekday: wd(k), start: c.start, end: c.end })).sort((a, b) => a.weekday - b.weekday);
    const startDate = c.weeksAgo >= 0 ? addDays(today, -7 * c.weeksAgo) : addDays(today, 7);
    const dates = generateDates({ startDate, pattern, count: course.total_sessions });
    const endDate = dates[dates.length - 1].date;
    const status = c.finished ? 'finished' : (startDate > today ? 'planned' : 'active');
    const id = ins('classes', {
      code: c.code, name: c.name, course_id: course.id, room_id: rooms[c.room], teacher_id: c.teacher, assistant_id: c.assistant, homeroom_id: c.homeroom,
      max_students: c.max, start_date: dates[0].date, end_date: endDate, schedule_json: JSON.stringify(pattern), status,
      note: null, created_at: iso(addDays(dates[0].date, -21)),
    });
    classes[c.code] = { ...c, id, course, pattern };
    classSessions[c.code] = dates.map((d, i) => ins('class_sessions', {
      class_id: id, date: d.date, start_time: d.start, end_time: d.end, room_id: rooms[c.room], teacher_id: c.teacher, assistant_id: c.assistant,
      kind: 'regular', seq_no: i + 1, status: d.date < today ? 'done' : 'scheduled', created_at: iso(addDays(dates[0].date, -21)),
    }));
  }
  // Một buổi do trung tâm hủy (mất điện) trong quá khứ ⇒ không tính buổi, đã dời bằng một buổi bổ sung
  {
    const sid = classSessions['FL1-A'][4];
    db.prepare(`UPDATE class_sessions SET status = 'cancelled', cancel_reason = 'Mất điện toàn tòa nhà, trung tâm báo nghỉ và bổ sung buổi cuối khóa' WHERE id = ?`).run(sid);
    const last = db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(classSessions['FL1-A'].at(-1));
    const extra = generateDates({ startDate: addDays(last.date, 1), pattern: classes['FL1-A'].pattern, count: 1 })[0];
    classSessions['FL1-A'].push(ins('class_sessions', { class_id: classes['FL1-A'].id, date: extra.date, start_time: extra.start, end_time: extra.end, room_id: last.room_id, teacher_id: last.teacher_id, kind: 'regular', seq_no: 25, status: 'scheduled', created_at: nowTs }));
    db.prepare('UPDATE classes SET end_date = ? WHERE id = ?').run(extra.date, classes['FL1-A'].id);
    const cd = db.prepare('SELECT date FROM class_sessions WHERE id = ?').get(sid).date;
    ins('center_closures', { from_date: cd, to_date: cd, reason: 'Mất điện toàn tòa nhà', class_ids: JSON.stringify([classes['FL1-A'].id]), sessions_cancelled: 1, sessions_added: 1, created_by: U.academic, created_at: iso(addDays(cd, -1), '16:00') });
  }

  // ---------- Phụ huynh & học viên ----------
  const ho = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Phan', 'Trịnh', 'Đinh', 'Mai', 'Tạ', 'Lương'];
  const demBoy = ['Minh', 'Gia', 'Đức', 'Quang', 'Hoàng', 'Anh', 'Bảo', 'Tuấn', 'Hải', 'Nhật'];
  const demGirl = ['Ngọc', 'Thu', 'Khánh', 'Bảo', 'Minh', 'Phương', 'Hà', 'Diệu', 'Tường', 'Thảo'];
  const tenBoy = ['Khang', 'Huy', 'Phúc', 'Nam', 'Long', 'Khôi', 'Duy', 'Phong', 'Lâm', 'Tùng', 'Kiên', 'Sơn', 'Vinh', 'Hiếu', 'Đạt'];
  const tenGirl = ['Linh', 'Vy', 'An', 'Ngân', 'Châu', 'Trâm', 'Hân', 'My', 'Nhi', 'Chi', 'Hương', 'Lam', 'Uyên', 'Giang', 'Thư'];
  const fatherNames = ['Hưng', 'Thắng', 'Dũng', 'Cường', 'Thành', 'Hải', 'Tú', 'Bình', 'Toàn', 'Kiên', 'Quân', 'Lực'];
  const motherNames = ['Hằng', 'Lan', 'Hoa', 'Thủy', 'Nga', 'Vân', 'Yến', 'Trang', 'Liên', 'Huệ', 'Oanh', 'Hạnh'];
  const schools = ['TH Kim Đồng', 'TH Nguyễn Du', 'THCS Lê Quý Đôn', 'THCS Trưng Vương', 'TH Ngôi Sao', 'THPT Chu Văn An', 'TH Đoàn Thị Điểm', 'THCS Giảng Võ'];
  const sources = ['Khách hàng giới thiệu', 'Vãng lai', 'Fanpage', 'Thị trường', 'Telesales', 'Kênh online', 'Sự kiện', 'Đối tác'];

  // Danh sách học viên cần tạo theo lớp
  const studentSlots = [];
  for (const c of Object.values(classes)) for (let i = 0; i < c.size; i++) studentSlots.push(c.code);
  // Học viên bảo lưu / đã nghỉ (không thuộc lớp đang học)
  studentSlots.push('RESERVED', 'RESERVED', 'WITHDRAWN', 'ALUMNI');

  const students = []; // {id, classCode, gender, family}
  const parents = [];
  let sIdx = 0;
  // Gom anh chị em: 5 gia đình 3 con, 16 gia đình 2 con, còn lại 1 con
  const familySizes = [];
  for (let i = 0; i < 5; i++) familySizes.push(3);
  for (let i = 0; i < 16; i++) familySizes.push(2);
  const slots = studentSlots.filter((s) => s !== 'ST2-Z'); // học viên lớp đã kết thúc sẽ dùng lại học viên MV1-A
  while (familySizes.reduce((a, b) => a + b, 0) < slots.length) familySizes.push(1);
  // xáo trộn vị trí để anh chị em học các lớp khác nhau
  const order = slots.map((s, i) => ({ s, k: R(), i })).sort((a, b) => a.k - b.k).map((x) => x.s);
  let pos = 0;
  for (const [fi, size] of familySizes.entries()) {
    const family = ho[fi % ho.length];
    const fatherName = `${family} Văn ${fatherNames[fi % fatherNames.length]}`;
    const motherName = `${ho[(fi + 7) % ho.length]} Thị ${motherNames[fi % motherNames.length]}`;
    const primaryIsMother = chance(0.65);
    const pid = ins('parents', {
      full_name: primaryIsMother ? motherName : fatherName, phone: fakePhone(), email: `phuhuynh${fi + 1}@example.com`,
      address: `Số ${10 + fi} ngõ ${(fi * 7) % 90 + 5}, phường Demo`, occupation: pick(['Kinh doanh', 'Kế toán', 'Kỹ sư', 'Giáo viên', 'Bác sĩ', 'Nhân viên văn phòng']), note: null, created_at: iso(addDays(today, -200 + fi)),
    });
    parents.push({ id: pid, family, relationship: primaryIsMother ? 'Mẹ' : 'Bố' });
    let secondId = null;
    if (fi % 8 === 0) {
      secondId = ins('parents', { full_name: primaryIsMother ? fatherName : motherName, phone: fakePhone(), email: `phuhuynh${fi + 1}b@example.com`, address: null, occupation: null, note: 'Liên hệ phụ', created_at: iso(addDays(today, -200 + fi)) });
    }
    for (let k = 0; k < size && pos < order.length; k++, pos++) {
      const classCode = order[pos];
      const c = classes[classCode];
      const gender = chance(0.5) ? 'male' : 'female';
      const age = c ? c.age + (chance(0.3) ? 1 : 0) : 10 + Math.floor(R() * 4);
      const name = `${family} ${gender === 'male' ? pick(demBoy) : pick(demGirl)} ${gender === 'male' ? tenBoy[(sIdx * 7) % tenBoy.length] : tenGirl[(sIdx * 5) % tenGirl.length]}`;
      const dob = `${year - age}-${String(1 + Math.floor(R() * 12)).padStart(2, '0')}-${String(1 + Math.floor(R() * 28)).padStart(2, '0')}`;
      sIdx++;
      const status = classCode === 'RESERVED' ? 'reserved' : classCode === 'WITHDRAWN' || classCode === 'ALUMNI' ? 'inactive' : 'active';
      const id = ins('students', {
        code: nextCode(db, 'student', 'HV-', 4), full_name: name, dob, gender, school: pick(schools), level: c?.course.level ?? null,
        status, note: null, created_at: iso(addDays(today, -120 - Math.floor(R() * 60))), updated_at: nowTs,
      });
      ins('student_contacts', { student_id: id, parent_id: pid, relationship: primaryIsMother ? 'Mẹ' : 'Bố', is_primary: 1 });
      if (secondId) ins('student_contacts', { student_id: id, parent_id: secondId, relationship: primaryIsMother ? 'Bố' : 'Mẹ', is_primary: 0 });
      students.push({ id, classCode, name, parentId: pid, family: fi, siblingIndex: k });
    }
  }

  // ---------- Đăng ký khóa, lịch thanh toán, phiếu thu ----------
  const receiptMethods = ['transfer', 'transfer', 'cash', 'card'];
  let cardSeq = 0;
  const addReceipt = (enrollmentId, studentId, amount, paidAt, by = U.cashier, method = pick(receiptMethods)) => ins('receipts', {
    code: nextCode(db, 'receipt', 'PT-', 6), enrollment_id: enrollmentId, student_id: studentId, amount, paid_at: paidAt, method,
    payer_name: null, note: null, status: 'confirmed', collected_by: by, created_at: iso(paidAt, '10:15'),
    // Quẹt thẻ: CCCD giả (đầu 000), ngày cấp thẻ, đơn vị cấp thẻ
    ...(method === 'card' ? { card_id_no: `000${String(100000000 + ++cardSeq * 7919).slice(-9)}`, card_issue_date: addDays(today, -400 - cardSeq * 31), card_issuer: pick(['Ngân hàng Demo A', 'Ngân hàng Demo B', 'Ngân hàng Demo C']) } : {}),
  });
  const addApproval = (o) => {
    const id = ins('approvals', { code: nextCode(db, 'approval', 'DX-', 4), payment_status: 'none', ...o });
    ins('approval_events', { approval_id: id, action: 'created', user_id: o.requested_by, note: null, created_at: o.created_at });
    if (o.status && o.status !== 'pending') ins('approval_events', { approval_id: id, action: o.status, user_id: o.decided_by, note: o.decision_note || null, created_at: o.decided_at });
    if (o.payment_status === 'paid') ins('approval_events', { approval_id: id, action: 'paid', user_id: o.paid_by, note: null, created_at: iso(o.paid_at, '15:00') });
    return id;
  };

  const enrollmentsByStudent = {};
  let scenarioIdx = 0;
  const scenarios = ['full', 'full', 'two_ontime', 'full', 'overdue', 'due_soon', 'full', 'partial_upcoming', 'two_ontime', 'full', 'overdue', 'full', 'due_soon'];

  function createEnrollment(st, classCode, { status = 'active', courseCode = null, enrolledAt, previous = null, scenario = null, discountPct = 0, pkg = null }) {
    const c = classCode ? classes[classCode] : null;
    const course = c ? c.course : courseRow(courseCode);
    const kind = previous || (enrollmentsByStudent[st.id] || []).length ? 'renew' : 'new';
    const pk = pkgRow(packages[`${course.code}:${pkg || (kind === 'renew' ? 'TP6' : '3T')}`]);
    // Doanh số: đăng ký mới ghi cho tư vấn viên (EC), tái phí ghi cho chủ nhiệm lớp (CM)
    const seller = kind === 'renew' ? (c?.homeroom || U.tam) : pick([U.consultant, U.consultant, U.yen, U.sales]);
    const fee = pk.price;
    const id = ins('enrollments', {
      code: nextCode(db, 'enrollment', 'DK-', 4), student_id: st.id, course_id: course.id, class_id: c?.id ?? null,
      class_joined_at: c ? db.prepare('SELECT start_date FROM classes WHERE id = ?').get(c.id).start_date : null,
      status, enrolled_at: enrolledAt, total_sessions: pk.sessions + pk.bonus_sessions, tuition_fee: fee, previous_enrollment_id: previous,
      package_id: pk.id, kind, bonus_sessions: pk.bonus_sessions, free_absences: pk.free_absences, reserve_limit: pk.reserve_limit, sold_by: seller,
      created_by: seller, created_at: iso(enrolledAt, '16:20'),
    });
    let discount = 0;
    if (discountPct) {
      discount = round1000((fee * discountPct) / 100);
      const reason = discountPct === 5 ? 'Ưu đãi anh chị em ruột cùng học' : 'Ưu đãi tái đăng ký sớm';
      const did = ins('discounts', { enrollment_id: id, kind: 'percent', value: discountPct, amount: discount, reason, status: 'approved', requested_by: U.consultant, created_at: iso(enrolledAt, '16:00') });
      const aid = addApproval({ type: 'discount', title: `Giảm ${discountPct}% học phí – ${st.name}`, description: reason, amount: discount, requested_by: U.consultant, status: 'approved', ref_type: 'discount', ref_id: did, decided_by: U.manager, decided_at: iso(enrolledAt, '17:00'), decision_note: 'Đồng ý theo chính sách', created_at: iso(enrolledAt, '16:00') });
      db.prepare('UPDATE discounts SET approval_id = ? WHERE id = ?').run(aid, did);
    }
    const net = fee - discount;
    scenario = scenario || scenarios[scenarioIdx++ % scenarios.length];
    let plan;
    if (scenario === 'full') plan = [{ due: enrolledAt, amount: net }];
    else if (scenario === 'two_ontime') { const a = round1000(net / 2); plan = [{ due: enrolledAt, amount: a }, { due: addDays(enrolledAt, 30), amount: net - a }]; }
    else if (scenario === 'overdue') { const a = round1000(net * 0.4); const b = round1000(net * 0.3); plan = [{ due: enrolledAt, amount: a }, { due: addDays(today, -(4 + Math.floor(R() * 12))), amount: b }, { due: addDays(today, 25), amount: net - a - b }]; }
    else if (scenario === 'due_soon') { const a = round1000(net / 2); plan = [{ due: enrolledAt, amount: a }, { due: addDays(today, 1 + Math.floor(R() * 5)), amount: net - a }]; }
    else if (scenario === 'partial_upcoming') { const a = round1000(net / 2); plan = [{ due: enrolledAt, amount: a }, { due: addDays(today, 18 + Math.floor(R() * 15)), amount: net - a }]; }
    else if (scenario === 'unpaid') plan = [{ due: addDays(today, 3), amount: net }];
    plan.sort((a, b) => a.due.localeCompare(b.due));
    plan.forEach((p, i) => ins('installments', { enrollment_id: id, seq: i + 1, due_date: p.due, amount: p.amount }));
    // Phiếu thu: trả đúng hạn những đợt đã tới hạn, trừ kịch bản quá hạn
    for (const [i, p] of plan.entries()) {
      if (p.due > today) break;
      if (scenario === 'overdue' && i === 1) {
        if (chance(0.5)) addReceipt(id, st.id, round1000(p.amount / 2), addDays(p.due, -1));
        break;
      }
      addReceipt(id, st.id, p.amount, p.due);
    }
    log('enrollment', id, 'created', `Đăng ký khóa ${course.name}${c ? `, xếp lớp ${c.code}` : ''}`, U.consultant, iso(enrolledAt, '16:20'));
    (enrollmentsByStudent[st.id] ||= []).push(id);
    return id;
  }

  const enrollmentIds = {};
  const studentsByClass = {};
  for (const st of students) {
    if (!classes[st.classCode]) continue;
    (studentsByClass[st.classCode] ||= []).push(st);
  }
  // Lớp đã kết thúc ST2-Z: dùng lại 5 học viên đầu của MV1-A (đã học xong Starters 2 rồi lên Movers 1)
  studentsByClass['ST2-Z'] = (studentsByClass['MV1-A'] || []).slice(0, 5);

  const classStart = (code) => db.prepare('SELECT start_date FROM classes WHERE id = ?').get(classes[code].id).start_date;
  for (const code of ['ST2-Z', ...Object.keys(classes).filter((k) => k !== 'ST2-Z')]) {
    const start = classStart(code);
    for (const [i, st] of (studentsByClass[code] || []).entries()) {
      const enrolledAt = addDays(start, -(3 + ((i * 5) % 18)));
      const sibling = st.siblingIndex > 0;
      if (code === 'ST2-Z') {
        enrollmentIds[`${code}:${st.id}`] = createEnrollment(st, code, { status: 'completed', enrolledAt, scenario: 'full' });
      } else if (code === 'MV1-A' && i < 5) {
        const prev = enrollmentIds[`ST2-Z:${st.id}`];
        enrollmentIds[`${code}:${st.id}`] = createEnrollment(st, code, { enrolledAt, previous: prev, pkg: i === 0 ? 'TP12' : 'TP6' });
      } else if (code === 'MV1-B') {
        enrollmentIds[`${code}:${st.id}`] = createEnrollment(st, code, { enrolledAt: addDays(today, -(2 + i * 3)), scenario: i === 0 ? 'unpaid' : 'two_ontime' });
      } else {
        // Một số học viên mua gói 2 khóa (tặng buổi) ⇒ ngày dự kiến hết học phí kéo dài qua khóa sau
        enrollmentIds[`${code}:${st.id}`] = createEnrollment(st, code, { enrolledAt, discountPct: sibling ? 5 : 0, pkg: ['ST1-A', 'KET-A', 'IEF-A'].includes(code) && i % 3 === 1 ? '12T' : ['FL1-A', 'PET-A'].includes(code) && i % 3 === 2 ? '6T' : null });
      }
    }
  }
  // Một học viên PET học song song IELTS Foundation (một học viên học nhiều khóa)
  const multi = studentsByClass['PET-A'][0];
  const multiEnroll = createEnrollment(multi, 'IEF-A', { enrolledAt: addDays(classStart('IEF-A'), -4), scenario: 'two_ontime' });
  (studentsByClass['IEF-A'] ||= []).push(multi);
  enrollmentIds[`IEF-A:${multi.id}`] = multiEnroll;

  // Học viên bảo lưu: đăng ký Flyers chưa xếp lớp, đã đóng đủ
  const others = students.filter((s) => !classes[s.classCode]);
  for (const st of others) {
    if (st.classCode === 'RESERVED') {
      const id = createEnrollment(st, null, { status: 'reserved', courseCode: 'FL1', enrolledAt: addDays(today, -40), scenario: 'full', pkg: '12T' });
      db.prepare(`UPDATE enrollments SET note = 'Bảo lưu do gia đình đi công tác, dự kiến học lại lớp khai giảng tháng sau', reserved_from = ?, reserved_to = ?, reserve_count = 1 WHERE id = ?`)
        .run(addDays(today, -20), addDays(today, 40), id);
    } else if (st.classCode === 'WITHDRAWN') {
      const id = createEnrollment(st, null, { status: 'cancelled', courseCode: 'KET', enrolledAt: addDays(today, -75), scenario: 'full' });
      db.prepare(`UPDATE enrollments SET cancel_reason = 'Chuyển nơi ở, xin thôi học' WHERE id = ?`).run(id);
      const amount = 3600000;
      const rid = ins('refunds', { code: nextCode(db, 'refund', 'HP-', 4), enrollment_id: id, student_id: st.id, amount, reason: 'Hoàn 50% học phí do chuyển nơi ở (học 6/30 buổi)', status: 'paid', paid_at: addDays(today, -38), paid_by: U.cashier, method: 'transfer', requested_by: U.cashier, created_at: iso(addDays(today, -45)) });
      const aid = addApproval({ type: 'refund', title: `Hoàn phí – ${st.name}`, description: 'Hoàn 50% học phí theo chính sách', amount, requested_by: U.cashier, status: 'approved', ref_type: 'refund', ref_id: rid, decided_by: U.manager, decided_at: iso(addDays(today, -44)), decision_note: 'Đồng ý hoàn 50%', payment_status: 'paid', paid_at: addDays(today, -38), paid_by: U.cashier, payment_method: 'transfer', created_at: iso(addDays(today, -45)) });
      db.prepare('UPDATE refunds SET approval_id = ? WHERE id = ?').run(aid, rid);
    } else if (st.classCode === 'ALUMNI') {
      createEnrollment(st, null, { status: 'completed', courseCode: 'FL1', enrolledAt: addDays(today, -170), scenario: 'full' });
    }
  }

  // ---------- Khách quan tâm: lịch sử (đã đăng ký) + đang tư vấn ----------
  const leadFor = (o) => {
    const code = nextCode(db, 'lead', 'KH-', 4);
    return ins('leads', { code, email: null, school: null, note: null, unfit_reason: null, next_contact_at: null, ...o });
  };
  const activity = (leadId, type, content, by, at, result = null) => ins('lead_activities', { lead_id: leadId, type, content, result, next_contact_at: null, created_by: by, created_at: at });

  // Khách đã chuyển thành học viên (để biểu đồ tuyển sinh & lịch sử xuyên suốt có dữ liệu)
  const converted = students.filter((s) => classes[s.classCode] && s.siblingIndex === 0).slice(0, 26);
  for (const st of converted) {
    const firstEnroll = db.prepare('SELECT * FROM enrollments WHERE student_id = ? ORDER BY enrolled_at LIMIT 1').get(st.id);
    const created = addDays(firstEnroll.enrolled_at, -(5 + Math.floor(R() * 14)));
    const parent = db.prepare('SELECT * FROM parents WHERE id = ?').get(st.parentId);
    const owner = pick([U.consultant, U.consultant, U.yen, U.sales]);
    const lid = leadFor({
      parent_name: parent.full_name, phone: parent.phone, email: parent.email, student_name: st.name, student_dob: null,
      interest_course_id: firstEnroll.course_id, source: pick(sources), owner_id: owner, status: 'enrolled', parent_id: parent.id,
      checked_in_at: iso(addDays(created, 2), '18:00'), checked_in_by: owner, owner_locked: 1,
      converted_student_id: st.id, converted_at: iso(firstEnroll.enrolled_at, '16:20'), created_by: owner, created_at: iso(created, '09:30'), updated_at: iso(firstEnroll.enrolled_at, '16:20'),
    });
    db.prepare('UPDATE students SET lead_id = ? WHERE id = ?').run(lid, st.id);
    activity(lid, 'call', 'Gọi tư vấn lần đầu, giới thiệu chương trình và lịch khai giảng.', owner, iso(created, '10:00'), 'Phụ huynh quan tâm, hẹn cho bé học thử');
    const trialDate = addDays(created, 3);
    ins('trials', { lead_id: lid, type: 'trial', date: trialDate, start_time: '17:30', end_time: '19:00', session_id: null, room_id: rooms.P202, teacher_id: U.tam, status: 'done', score: null, result_level: firstEnroll.course_id ? courseRow(Object.keys(courses).find((k) => courses[k] === firstEnroll.course_id)).level : null, recommended_course_id: firstEnroll.course_id, teacher_comment: 'Bé hợp tác tốt, phát âm khá. Phù hợp trình độ đề xuất.', created_by: owner, created_at: iso(created, '10:05'), updated_at: iso(trialDate, '19:30') });
    activity(lid, 'trial', 'Học thử xong, giáo viên đề xuất trình độ phù hợp.', owner, iso(trialDate, '19:30'));
    activity(lid, 'status', 'Chuyển thành học viên và tạo đăng ký khóa.', owner, iso(firstEnroll.enrolled_at, '16:20'));
  }
  // Khách đã đóng hồ sơ "Chưa phù hợp" trong quá khứ
  for (let i = 0; i < 6; i++) {
    const created = addDays(today, -(20 + i * 23));
    const lid = leadFor({ parent_name: `${pick(ho)} Thị ${pick(motherNames)}`, phone: fakePhone(), student_name: `${pick(ho)} ${pick(demGirl)} ${pick(tenGirl)}`, interest_course_id: courses[pick(Object.keys(courses))], source: pick(sources), owner_id: U.consultant, status: 'unfit', unfit_reason: pick(['Lịch học không phù hợp', 'Học phí vượt ngân sách', 'Gia đình chọn trung tâm gần nhà hơn']), created_by: U.consultant, created_at: iso(created), updated_at: iso(addDays(created, 6)) });
    activity(lid, 'call', 'Gọi tư vấn, gửi lịch khai giảng.', U.consultant, iso(created, '10:00'));
    activity(lid, 'status', 'Đóng hồ sơ: chưa phù hợp.', U.consultant, iso(addDays(created, 6), '11:00'));
  }

  // Khách đang tư vấn — đủ 7 phân loại theo quy trình trung tâm; khách đang mở luôn có ngày liên hệ lại
  const dom = Number(today.slice(8, 10));
  const inMonth = (k) => -Math.min(k, dom - 1); // lùi k ngày nhưng vẫn trong tháng này (để tính KPI data tháng)
  const openLeads = [
    // [phân loại, nguồn, khóa quan tâm, ngày tạo (lệch so với hôm nay), ngày liên hệ lại (lệch), nhân sự]
    ['potential', 'Fanpage', 'ST1', 0, 1, U.consultant], ['potential', 'Kênh online', 'MV1', 0, 2, U.consultant], ['potential', 'Telesales', 'KET', inMonth(1), 0, U.yen], ['potential', 'Sự kiện', 'IEF', inMonth(2), 3, U.sales],
    ['appointing', 'Khách hàng giới thiệu', 'FL1', inMonth(3), 0, U.consultant], ['appointing', 'Fanpage', 'ST1', inMonth(4), 1, U.yen], ['appointing', 'Thị trường', 'PET', inMonth(6), -1, U.consultant],
    ['checkin_booked', 'Vãng lai', 'MV1', inMonth(5), 0, U.consultant], ['checkin_booked', 'Đối tác', 'ST2', inMonth(3), 1, U.yen],
    ['checked_in', 'Fanpage', 'ST1', inMonth(4), 1, U.consultant], ['checked_in', 'Khách hàng giới thiệu', 'FL1', inMonth(7), 2, U.sales],
    ['trial_booked', 'Fanpage', 'ST1', inMonth(6), 0, U.consultant], ['trial_booked', 'Khách hàng giới thiệu', 'MV1', inMonth(5), 1, U.yen], ['trial_booked', 'Kênh online', 'KET', inMonth(4), 0, U.consultant],
    ['trial_done', 'Khách hàng giới thiệu', 'MV1', -9, 1, U.consultant], ['trial_done', 'Fanpage', 'FL1', -12, -2, U.yen],
    ['nurturing', 'Sự kiện', 'ST2', -16, 4, U.consultant], ['nurturing', 'Telesales', 'IEF', -20, 6, U.sales],
    ['unfit', 'Kênh online', 'PET', -14, null, U.consultant],
  ];
  // Data tiềm năng nhập trong tháng (để KPI 25 data/tháng có số liệu: tư vấn Hùng gần đạt, Yến còn thấp)
  // Một phần data đã lên check-in trong tháng (đang chăm sóc thêm) ⇒ KPI check-in có màu khác nhau giữa các EC
  for (const [owner, n, checked] of [[U.consultant, 15, 9], [U.yen, 3, 1], [U.sales, 5, 2]]) {
    for (let k = 0; k < n; k++) openLeads.push([k < checked ? 'nurturing' : 'potential', pick(sources), pick(Object.keys(courses)), inMonth(2 + ((k * 3) % 18)), 1 + (k % 6), owner]);
  }
  // Hồ sơ trùng số điện thoại với phụ huynh đã có (phụ huynh hỏi thêm cho con thứ hai) ⇒ cảnh báo, KHÔNG tự gộp
  const dupParent = db.prepare('SELECT * FROM parents WHERE id = ?').get(students.find((s) => s.siblingIndex === 0 && classes[s.classCode]).parentId);
  const classOfCourse = { ST1: 'ST1-A', ST2: 'ST2-A', MV1: 'MV1-A', FL1: 'FL1-A', KET: 'KET-A', PET: 'PET-A', IEF: 'IEF-A' };
  const futureSession = (code, k) => db.prepare(`SELECT * FROM class_sessions WHERE class_id = ? AND date >= ? AND status = 'scheduled' ORDER BY date, start_time`).all(classes[code].id, today)[k];
  const pastSession = (code) => db.prepare(`SELECT * FROM class_sessions WHERE class_id = ? AND date < ? AND status = 'done' ORDER BY date DESC LIMIT 1`).get(classes[code].id, today);
  const dmy = (d) => d.split('-').reverse().join('/');
  let checkedToday = false;
  for (const [i, [status, source, courseCode, createdOffset, nextOffset, owner]] of openLeads.entries()) {
    const created = addDays(today, createdOffset);
    const isDup = i === 1;
    const gender = chance(0.5);
    const nextAt = nextOffset === null ? null : `${addDays(today, nextOffset)} ${['09:30', '14:00', '18:30', '10:00'][i % 4]}`;
    // Khách đã check-in: nhân sự check-in trước giữ khách
    let checkedAt = null;
    if (status === 'checked_in') { checkedAt = !checkedToday ? iso(today, '09:40') : iso(addDays(today, -3), '18:10'); checkedToday = true; }
    if (['trial_booked', 'trial_done', 'nurturing'].includes(status)) checkedAt = iso(addDays(created, 1), '18:00');
    const lid = leadFor({
      parent_name: isDup ? dupParent.full_name : `${pick(ho)} ${gender ? 'Văn' : 'Thị'} ${gender ? pick(fatherNames) : pick(motherNames)}`,
      phone: isDup ? dupParent.phone : fakePhone(), email: isDup ? dupParent.email : (chance(0.4) ? `khach${i + 1}@example.com` : null),
      student_name: `${pick(ho)} ${gender ? pick(demBoy) : pick(demGirl)} ${gender ? pick(tenBoy) : pick(tenGirl)}`,
      student_dob: `${year - (classDefs.find((c) => c.course === courseCode)?.age || 10)}-0${1 + (i % 9)}-1${i % 9}`,
      school: pick(schools), interest_course_id: courses[courseCode], source, owner_id: owner, status,
      next_contact_at: nextAt,
      note: isDup ? 'Phụ huynh đã có con đang học tại trung tâm, hỏi thêm cho bé út.' : null,
      unfit_reason: status === 'unfit' ? 'Muốn học online hoàn toàn' : null,
      checked_in_at: checkedAt, checked_in_by: checkedAt ? owner : null, owner_locked: checkedAt ? 1 : 0,
      checkin_booked_at: status === 'checkin_booked' ? nextAt : null,
      created_by: owner, created_at: iso(created, '09:00'), updated_at: iso(created, '09:00'),
    });
    ins('lead_activities', { lead_id: lid, type: 'note', content: `Tạo data khách (nguồn ${source}).`, result: null, next_contact_at: null, created_by: owner, created_at: iso(created, '09:00') });
    if (status !== 'potential') activity(lid, 'call', 'Gọi tư vấn lần đầu: giới thiệu lộ trình, học phí, lịch học.', owner, iso(created, '10:30'), 'Phụ huynh quan tâm, hẹn lên trung tâm');
    if (status === 'checkin_booked') {
      activity(lid, 'status', `Đăng ký check-in ${dmy(nextAt.slice(0, 10))} lúc ${nextAt.slice(11)}.`, owner, iso(created, '10:40'));
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lid);
      for (const cm of db.prepare(`SELECT DISTINCT homeroom_id AS id FROM classes WHERE homeroom_id IS NOT NULL AND status IN ('active','planned')`).all()) {
        proposeTask(db, { assigneeId: cm.id, title: `Đón khách check-in: ${lead.student_name} (PH ${lead.parent_name})`, description: `Khách hẹn check-in lúc ${nextAt.slice(11)} ngày ${dmy(nextAt.slice(0, 10))}.`,
          dueDate: nextAt.slice(0, 10), dueTime: nextAt.slice(11), leadId: lid, key: `lead-checkin:${lid}:${cm.id}:${nextAt}`, by: owner });
      }
    }
    if (checkedAt) activity(lid, 'status', 'Khách check-in tại trung tâm — khách thuộc về nhân sự check-in trước.', owner, checkedAt);
    if (status === 'trial_booked' && courseCode === 'KET') {
      // Kiểm tra đầu vào riêng hôm nay 15:00 tại P202 (giáo viên bản ngữ chấm)
      const ts = iso(addDays(today, -1), '11:00');
      ins('trials', { lead_id: lid, type: 'placement', date: today, start_time: '15:00', end_time: '15:45', session_id: null, room_id: rooms.P202, teacher_id: U.sarah, status: 'scheduled', created_by: owner, created_at: ts, updated_at: ts });
      db.prepare('UPDATE leads SET next_contact_at = ? WHERE id = ?').run(`${today} 15:00`, lid);
      activity(lid, 'trial', 'Đăng ký kiểm tra đầu vào hôm nay 15:00 tại P202.', owner, ts);
    } else if (status === 'trial_booked') {
      const code = classOfCourse[courseCode];
      const sess = futureSession(code, i % 2);
      const ts = iso(addDays(today, -1), '11:00');
      const tid = ins('trials', { lead_id: lid, type: 'trial', date: sess.date, start_time: sess.start_time, end_time: sess.end_time, session_id: sess.id, room_id: sess.room_id, teacher_id: sess.teacher_id, status: 'scheduled', created_by: owner, created_at: ts, updated_at: ts });
      db.prepare('UPDATE leads SET trial_class_id = ?, next_contact_at = ? WHERE id = ?').run(classes[code].id, `${sess.date} ${sess.start_time}`, lid);
      activity(lid, 'trial', `Đăng ký học thử lớp ${code} ngày ${dmy(sess.date)} lúc ${sess.start_time}.`, owner, ts);
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lid);
      proposeTask(db, { assigneeId: classes[code].homeroom, title: `Học thử lớp ${code}: ${lead.student_name}`, description: `Học thử ngày ${dmy(sess.date)} ${sess.start_time}. Sau buổi học ghi kết quả để tư vấn chốt đăng ký.`,
        dueDate: sess.date, dueTime: sess.start_time, leadId: lid, key: `lead-trial:${lid}:${tid}`, by: owner });
    }
    if (status === 'trial_done') {
      const code = classOfCourse[courseCode];
      const sess = pastSession(code);
      const ts = iso(addDays(today, -4), '11:00');
      ins('trials', { lead_id: lid, type: 'trial', date: sess.date, start_time: sess.start_time, end_time: sess.end_time, session_id: sess.id, room_id: sess.room_id, teacher_id: sess.teacher_id, status: 'done', score: null, result_level: courseRow(courseCode).level, recommended_course_id: courses[courseCode], teacher_comment: 'Nghe hiểu tốt, cần luyện thêm phản xạ nói. Đề xuất vào lớp phù hợp độ tuổi.', created_by: owner, created_at: ts, updated_at: iso(sess.date, '19:30') });
      db.prepare('UPDATE leads SET trial_class_id = ? WHERE id = ?').run(classes[code].id, lid);
      activity(lid, 'trial', `Đã học thử lớp ${code}. Giáo viên đề xuất khóa ${courseRow(courseCode).name}.`, owner, iso(sess.date, '19:30'));
    }
    if (status === 'nurturing') activity(lid, 'call', 'Phụ huynh chưa sắp xếp được lịch, hẹn gọi lại sau kỳ thi của bé.', owner, iso(addDays(created, 3), '19:00'), 'Chăm sóc thêm');
    if (status === 'unfit') activity(lid, 'status', 'Đóng hồ sơ: phụ huynh muốn học online hoàn toàn.', owner, iso(addDays(created, 2), '11:00'));
  }

  // ---------- Điểm danh lịch sử ----------
  const attStmt = db.prepare(`INSERT INTO attendance(session_id, student_id, enrollment_id, status, note, is_makeup, makeup_id, marked_by, marked_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  const hwStmt = db.prepare('UPDATE attendance SET homework_status = ?, homework_score = ?, comment = ? WHERE id = ?');
  const homeworks = ['Workbook trang 12–13', 'Học thuộc 10 từ mới Unit, chép mỗi từ 3 lần', 'Luyện nghe track 2.4 và trả lời câu hỏi', 'Viết 5 câu mô tả bức tranh', 'Đọc đoạn văn và gạch chân động từ', 'Ôn tập chuẩn bị kiểm tra unit', 'Làm đề Reading Part 1–2', 'Chuẩn bị bài nói 1 phút về sở thích'];
  const goodComments = ['Tích cực phát biểu, phát âm tiến bộ.', 'Làm bài tập đầy đủ, chữ viết cẩn thận.', 'Phản xạ nghe tốt, cần mạnh dạn nói hơn.', 'Hợp tác tốt khi làm việc nhóm.', 'Nắm chắc từ vựng bài mới.'];
  const weakComments = ['Chưa tập trung, hay nói chuyện riêng. Cần phụ huynh nhắc làm BTVN.', 'Chưa thuộc từ vựng buổi trước, cần ôn thêm ở nhà.', 'Còn rụt rè, chưa hoàn thành bài viết.'];
  // Học viên học yếu (để có danh sách bổ trợ học tập & cảnh báo thiếu BTVN)
  const weak = new Set([studentsByClass['ST1-A']?.[2]?.id, studentsByClass['KET-A']?.[3]?.id, studentsByClass['FL1-A']?.[4]?.id, studentsByClass['MV1-A']?.[6]?.id].filter(Boolean));
  const score = (lo, hi) => Math.round((lo + R() * (hi - lo)) * 2) / 2;
  // Buổi gần nhất của hai lớp để trống phần chấm BTVN/nhận xét ⇒ có việc "chưa chấm" trên trang Học tập
  const ungradedSessions = new Set(['FL1-A', 'KET-A'].map((code) => db.prepare(`SELECT id FROM class_sessions WHERE class_id = ? AND status = 'done' ORDER BY date DESC, start_time DESC LIMIT 1`).get(classes[code].id)?.id));
  const topics = ['Unit review & vocabulary game', 'Phonics: short vowels', 'Speaking: describing pictures', 'Listening practice Part 2', 'Reading & comprehension', 'Grammar: present continuous', 'Writing: short story', 'Mock test & feedback', 'Project presentation', 'Song & chant – new words'];
  const absences = [];
  for (const [code, ids] of Object.entries(classSessions)) {
    const c = classes[code];
    for (const sid of ids) {
      const s = db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(sid);
      if (s.status !== 'done') continue;
      const markedAt = iso(s.date, s.end_time);
      db.prepare('UPDATE class_sessions SET topic = ?, teacher_note = ?, homework = ?, attendance_saved_at = ?, attendance_saved_by = ? WHERE id = ?')
        .run(topics[s.seq_no % topics.length], s.seq_no % 4 === 0 ? 'Lớp tập trung tốt, cần ôn thêm từ vựng buổi trước.' : null, homeworks[s.seq_no % homeworks.length], markedAt, c.teacher, sid);
      for (const st of studentsByClass[code] || []) {
        const eid = enrollmentIds[`${code}:${st.id}`];
        if (!eid) continue;
        const r = R();
        const recent = s.date >= addDays(today, -6);
        const isWeak = weak.has(st.id);
        let status = isWeak ? (r < 0.62 ? 'present' : r < 0.72 ? 'late' : r < 0.86 ? 'excused' : 'absent') : (r < 0.93 ? 'present' : r < 0.975 ? 'late' : r < 0.99 ? 'excused' : 'absent');
        if (recent && status !== 'present' && status !== 'late' && !chance(isWeak ? 0.3 : 0.6)) status = 'present';
        const aid = Number(attStmt.run(sid, st.id, eid, status, status === 'late' ? 'Đến muộn 10 phút' : null, 0, null, c.teacher, markedAt).lastInsertRowid);
        if ((status === 'present' || status === 'late') && !ungradedSessions.has(sid) && s.seq_no > 1) {
          const h = R();
          const hw = isWeak ? (h < 0.35 ? 'done' : h < 0.6 ? 'partial' : 'missing') : (h < 0.95 ? 'done' : h < 0.985 ? 'partial' : 'missing');
          const sc = hw === 'missing' ? null : hw === 'done' ? score(isWeak ? 5 : 7, isWeak ? 7 : 10) : score(isWeak ? 3.5 : 5, isWeak ? 5.5 : 7);
          const cm = chance(recent ? 0.5 : 0.15) ? (isWeak ? pick(weakComments) : pick(goodComments)) : null;
          hwStmt.run(hw, sc, cm, aid);
          if (isWeak && hw !== 'done' && chance(0.5)) db.prepare('UPDATE attendance SET improvement = ? WHERE id = ?').run(pick(['Ôn lại 10 từ vựng mỗi tối, phụ huynh kiểm tra.', 'Luyện nghe 15 phút/ngày theo track của bài.', 'Đặt góc học tập, hoàn thành BTVN trước khi chơi.']), aid);
        }
        if (status === 'excused' || status === 'absent') absences.push({ aid, st, eid, date: s.date, code, status });
      }
      // Giờ dạy thực tế
      const minutes = 90;
      for (const [uid, role] of [[c.teacher, 'teacher'], [c.assistant, 'assistant']]) {
        if (!uid) continue;
        const old = s.date < addDays(today, -7);
        ins('teaching_logs', { session_id: sid, user_id: uid, role, minutes, status: old ? 'approved' : 'pending', note: null, reviewed_by: old ? U.academic : null, reviewed_at: old ? iso(addDays(s.date, 2)) : null, created_at: markedAt });
      }
    }
  }

  // Học bù: một số buổi vắng có phép trong quá khứ đã học bù (buổi bù riêng), một buổi bù lên lịch ngày mai
  const pastExcused = absences.filter((a) => a.status === 'excused' && a.date < addDays(today, -10) && a.code !== 'ST2-Z').slice(0, 4);
  for (const [i, a] of pastExcused.entries()) {
    const date = addDays(a.date, 3);
    const s = db.prepare('SELECT * FROM class_sessions WHERE class_id = ? AND date = ?').get(classes[a.code].id, a.date);
    const sid = ins('class_sessions', { class_id: null, date, start_time: '15:30', end_time: '16:30', room_id: rooms.P202, teacher_id: classes[a.code].teacher, kind: 'makeup', status: 'done', topic: `Học bù: ${s.topic}`, title: `Học bù ${a.code}`, attendance_saved_at: iso(date, '16:30'), attendance_saved_by: classes[a.code].teacher, created_at: iso(addDays(a.date, 1)) });
    const mid = ins('makeups', { absence_attendance_id: a.aid, student_id: a.st.id, enrollment_id: a.eid, makeup_session_id: sid, status: 'done', note: null, created_by: U.academic, created_at: iso(addDays(a.date, 1)) });
    attStmt.run(sid, a.st.id, a.eid, 'present', null, 1, mid, classes[a.code].teacher, iso(date, '16:30'));
    if (i === 0) log('student', a.st.id, 'makeup', `Đã học bù cho buổi nghỉ ngày ${a.date.split('-').reverse().join('/')}`, U.academic, iso(date, '16:30'));
  }
  const recentExcused = absences.find((a) => a.status === 'excused' && a.date >= addDays(today, -6) && a.date < today && a.code !== 'ST2-Z');
  if (recentExcused) {
    const date = addDays(today, 1);
    const s = db.prepare('SELECT * FROM class_sessions WHERE class_id = ? AND date = ?').get(classes[recentExcused.code].id, recentExcused.date);
    const sid = ins('class_sessions', { class_id: null, date, start_time: '15:30', end_time: '16:30', room_id: rooms.P202, teacher_id: U.trang, kind: 'makeup', status: 'scheduled', title: `Học bù ${recentExcused.code}`, topic: `Học bù: ${s.topic}`, created_at: nowTs });
    ins('makeups', { absence_attendance_id: recentExcused.aid, student_id: recentExcused.st.id, enrollment_id: recentExcused.eid, makeup_session_id: sid, status: 'scheduled', note: 'Phụ huynh xác nhận qua điện thoại', created_by: U.academic, created_at: nowTs });
  }

  // ---------- Điểm kiểm tra ----------
  for (const code of ['ST1-A', 'FL1-A', 'MV1-A', 'KET-A', 'PET-A', 'ST2-A', 'IEF-A']) {
    const done = db.prepare(`SELECT date, seq_no FROM class_sessions WHERE class_id = ? AND status = 'done' AND seq_no IS NOT NULL ORDER BY seq_no`).all(classes[code].id);
    const tests = [];
    if (done.length >= 8) tests.push(['Kiểm tra Unit 1–4', 'unit', done[7].date]);
    if (done.length >= 16) tests.push(['Kiểm tra giữa khóa', 'midterm', done[15].date]);
    if (done.length >= 20) tests.push(['Kiểm tra Unit 9–10', 'unit', done[19].date]);
    for (const [title, kind, date] of tests) {
      for (const st of studentsByClass[code] || []) {
        const eid = enrollmentIds[`${code}:${st.id}`];
        if (!eid) continue;
        const sc = weak.has(st.id) ? score(4, 6.5) : score(6.5, 9.5);
        ins('assessments', { class_id: classes[code].id, student_id: st.id, enrollment_id: eid, title, kind, score: sc, max_score: 10, taken_at: date, comment: sc < 6.5 ? 'Cần ôn lại ngữ pháp và từ vựng.' : null, created_by: classes[code].teacher, created_at: iso(date, '20:00') });
      }
    }
  }

  // ---------- Check-in tại quầy (10 ngày gần nhất) ----------
  const desk = [U.consultant, U.cashier, U.yen, U.academic];
  const ckStmt = db.prepare('INSERT OR IGNORE INTO checkins(student_id, date, checked_at, session_id, checked_by, note) VALUES (?,?,?,?,?,?)');
  for (const row of db.prepare(`SELECT a.student_id, s.id AS session_id, s.date, s.start_time FROM attendance a JOIN class_sessions s ON s.id = a.session_id
      WHERE a.status IN ('present','late') AND s.date BETWEEN ? AND ? ORDER BY s.date, s.start_time`).all(addDays(today, -10), addDays(today, -1))) {
    if (!chance(0.88)) continue;
    const [hh, mm] = row.start_time.split(':').map(Number);
    const t = hh * 60 + mm - (3 + Math.floor(R() * 14));
    ckStmt.run(row.student_id, row.date, iso(row.date, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`), row.session_id, desk[Math.floor(R() * desk.length)], null);
  }

  // ---------- Tag học viên ----------
  const addTag = (sid, tag) => {
    const cur = db.prepare('SELECT tags FROM students WHERE id = ?').get(sid).tags;
    const list = cur ? cur.split(',') : [];
    if (!list.includes(tag)) db.prepare('UPDATE students SET tags = ? WHERE id = ?').run([...list, tag].join(','), sid);
  };
  for (const st of students) if (st.siblingIndex > 0) addTag(st.id, 'Anh chị em');
  for (const sid of weak) addTag(sid, 'Cần quan tâm');
  for (const st of studentsByClass['IEF-A'] || []) addTag(st.id, 'Thi chứng chỉ');
  for (const st of [studentsByClass['PET-A']?.[1], studentsByClass['FL1-A']?.[0]].filter(Boolean)) addTag(st.id, 'VIP');

  // ---------- Số dư: đặt cọc / nạp trước ----------
  const topupRow = (st, amount, daysAgo, note, method = 'transfer') => ins('wallet_entries', {
    code: nextCode(db, 'topup', 'NT-', 6), student_id: st.id, kind: 'topup', amount, method, paid_at: addDays(today, -daysAgo), payer_name: null, note, status: 'confirmed', created_by: U.cashier, created_at: iso(addDays(today, -daysAgo), '17:05'),
  });
  {
    // Học viên lớp mới MV1-B đã đặt cọc nhưng chưa đóng học phí ⇒ thu ngân dùng số dư để đóng
    const st = studentsByClass['MV1-B'][0];
    topupRow(st, 2000000, 2, 'Đặt cọc giữ chỗ lớp Movers 1 – B', 'cash');
    log('student', st.id, 'topup', 'Nạp 2.000.000 đ vào số dư (đặt cọc giữ chỗ)', U.cashier, iso(addDays(today, -2), '17:05'));
    // Học viên sắp hết khóa ST1-A đặt cọc trước cho khóa tiếp theo
    const st2 = studentsByClass['ST1-A'][0];
    topupRow(st2, 1500000, 1, 'Đặt cọc tái phí khóa Starters 2');
    log('student', st2.id, 'topup', 'Nạp 1.500.000 đ vào số dư (đặt cọc tái phí)', U.cashier, iso(addDays(today, -1), '17:05'));
  }

  // ---------- Ca làm việc văn phòng (tuần này và tuần sau) ----------
  const shiftDefs = [[U.manager, '08:00', '17:00', [1, 2, 3, 4, 5]], [U.consultant, '13:30', '21:00', [1, 2, 3, 4, 6]], [U.academic, '13:00', '21:00', [1, 2, 3, 5, 6]], [U.cashier, '13:00', '21:00', [1, 2, 4, 5, 6]], [U.ops, '07:30', '16:30', [1, 2, 3, 4, 5, 6]], [U.yen, '14:00', '18:00', [3, 6]]];
  const monday = startOfWeek(today);
  for (let d = 0; d < 14; d++) {
    const date = addDays(monday, d);
    for (const [uid, st, en, days] of shiftDefs) if (days.includes(isoWeekday(date))) ins('work_shifts', { user_id: uid, date, start_time: st, end_time: en, note: null });
  }

  // ---------- Đơn nghỉ & đề xuất ----------
  const leave1 = ins('leave_requests', { user_id: U.sarah, kind: 'personal', from_date: addDays(today, 9), to_date: addDays(today, 10), reason: 'Gia hạn visa lao động', status: 'pending', created_at: iso(addDays(today, -1)) });
  const la1 = addApproval({ type: 'leave', title: 'Nghỉ phép 2 ngày – Sarah Johnson', description: 'Gia hạn visa lao động. Đề nghị giáo viên Tâm dạy thay lớp Pre-KET.', amount: null, requested_by: U.sarah, status: 'pending', ref_type: 'leave', ref_id: leave1, created_at: iso(addDays(today, -1), '20:50') });
  db.prepare('UPDATE leave_requests SET approval_id = ? WHERE id = ?').run(la1, leave1);
  const leave2 = ins('leave_requests', { user_id: U.tam, kind: 'sick', from_date: addDays(today, -20), to_date: addDays(today, -20), reason: 'Ốm, có giấy khám', status: 'approved', created_at: iso(addDays(today, -21)) });
  const la2 = addApproval({ type: 'leave', title: 'Nghỉ ốm 1 ngày – Đỗ Thanh Tâm', description: 'Ốm, có giấy khám.', requested_by: U.tam, status: 'approved', ref_type: 'leave', ref_id: leave2, decided_by: U.manager, decided_at: iso(addDays(today, -21), '08:30'), decision_note: 'Đồng ý, giáo vụ sắp xếp dạy thay', created_at: iso(addDays(today, -21), '07:10') });
  db.prepare('UPDATE leave_requests SET approval_id = ? WHERE id = ?').run(la2, leave2);

  // Giảm phí đang chờ duyệt (do tư vấn đề nghị — tư vấn không tự duyệt được)
  {
    const st = studentsByClass['MV1-B'][0];
    const eid = enrollmentIds[`MV1-B:${st.id}`];
    const fee = db.prepare('SELECT tuition_fee FROM enrollments WHERE id = ?').get(eid).tuition_fee;
    const amount = round1000(fee * 0.1);
    const did = ins('discounts', { enrollment_id: eid, kind: 'percent', value: 10, amount, reason: 'Ưu đãi khai giảng lớp mới (đăng ký trước 2 tuần)', status: 'pending', requested_by: U.consultant, created_at: iso(addDays(today, -1)) });
    const aid = addApproval({ type: 'discount', title: `Giảm 10% học phí – ${st.name}`, description: 'Ưu đãi khai giảng lớp Movers 1 – B, đăng ký trước 2 tuần.', amount, requested_by: U.consultant, status: 'pending', ref_type: 'discount', ref_id: did, created_at: iso(addDays(today, -1), '17:40') });
    db.prepare('UPDATE discounts SET approval_id = ? WHERE id = ?').run(aid, did);
  }
  {
    const st = studentsByClass['MV1-A'][5];
    const eid = enrollmentIds[`MV1-A:${st.id}`];
    const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(eid);
    if (e && e.kind === 'new') {
      const p2 = pkgRow(packages['MV1:12T']);
      addApproval({ type: 'package_change', title: `Đổi gói phí ${e.code} – ${st.name}`, description: `${p2.name} (${p2.price.toLocaleString('vi-VN')} đ). Lý do: Phụ huynh muốn chuyển sang gói 1 năm để được giảm 10% và có quyền bảo lưu.`,
        amount: p2.price - e.tuition_fee, requested_by: U.consultant, status: 'pending', ref_type: 'enrollment', ref_id: eid, payload: JSON.stringify({ enrollment_id: eid, package_id: p2.id }), created_at: iso(today, '09:10') });
    }
  }
  addApproval({ type: 'expense', title: 'In tài liệu ôn thi Pre-KET', description: '30 bộ đề luyện thi, in 2 mặt.', amount: 650000, requested_by: U.academic, status: 'approved', decided_by: U.manager, decided_at: iso(addDays(today, -1), '10:00'), decision_note: 'Đồng ý', payment_status: 'unpaid', created_at: iso(addDays(today, -2), '15:00') });
  addApproval({ type: 'purchase', title: 'Văn phòng phẩm tháng này', description: 'Bút lông bảng, giấy A4, kẹp tài liệu.', amount: 1250000, requested_by: U.ops, status: 'approved', decided_by: U.manager, decided_at: iso(addDays(today, -9), '09:00'), decision_note: null, payment_status: 'paid', paid_at: addDays(today, -8), paid_by: U.cashier, payment_method: 'cash', created_at: iso(addDays(today, -10), '14:00') });
  addApproval({ type: 'purchase', title: 'Mua loa bluetooth mới cho P301', description: 'Loa hiện tại vẫn dùng được.', amount: 2900000, requested_by: U.ops, status: 'rejected', decided_by: U.manager, decided_at: iso(addDays(today, -5), '11:00'), decision_note: 'Loa cũ còn tốt, để quý sau xem xét', created_at: iso(addDays(today, -6), '10:00') });
  addApproval({ type: 'expense', title: 'Chi phí tổ chức Halloween cho học viên', description: 'Trang trí, quà tặng 60 học viên.', amount: 3500000, requested_by: U.academic, status: 'pending', created_at: iso(today, '08:40') });

  // ---------- Tài sản & báo hỏng ----------
  const assetDefs = [
    ['Máy chiếu Epson EB-X51', 'Thiết bị trình chiếu', 'P101', 'good'], ['Loa kéo JBL', 'Âm thanh', 'P101', 'damaged'], ['Điều hòa Daikin 12000BTU', 'Điều hòa', 'P101', 'good'],
    ['Tivi Samsung 65 inch', 'Thiết bị trình chiếu', 'P102', 'good'], ['Điều hòa Panasonic 12000BTU', 'Điều hòa', 'P102', 'damaged'],
    ['Máy chiếu Epson EB-X51', 'Thiết bị trình chiếu', 'P201', 'repairing'], ['Điều hòa Daikin 18000BTU', 'Điều hòa', 'P201', 'good'], ['Bảng tương tác', 'Thiết bị trình chiếu', 'P201', 'good'],
    ['Tivi LG 55 inch', 'Thiết bị trình chiếu', 'P202', 'good'], ['Điều hòa Daikin 9000BTU', 'Điều hòa', 'P202', 'good'],
    ['Máy chiếu Sony VPL', 'Thiết bị trình chiếu', 'P301', 'good'], ['Loa Bluetooth Sony', 'Âm thanh', 'P301', 'good'], ['Điều hòa Daikin 24000BTU', 'Điều hòa', 'P301', 'good'],
    ['Máy in Canon LBP', 'Văn phòng', null, 'good'], ['Laptop Dell giáo viên #1', 'Máy tính', null, 'good'], ['Laptop Dell giáo viên #2', 'Máy tính', null, 'good'],
    ['Máy tính quầy lễ tân', 'Máy tính', null, 'good'], ['Camera an ninh tầng 1', 'An ninh', null, 'good'], ['Bình chữa cháy CO2 (tầng 2)', 'An toàn', null, 'good'], ['Tủ đựng giáo trình', 'Nội thất', null, 'good'],
  ];
  const assets = assetDefs.map(([name, category, room, status], i) => ins('assets', {
    code: `TS-${String(i + 1).padStart(3, '0')}`, name, category, room_id: room ? rooms[room] : null, location_note: room ? null : (i >= 17 ? 'Hành lang' : 'Văn phòng'),
    status, purchased_at: addDays(today, -300 - i * 41), note: null, created_at: nowTs,
  }));
  const issue = (o) => {
    const id = ins('asset_issues', { code: nextCode(db, 'issue', 'BH-', 4), ...o, updated_at: o.created_at });
    log('asset_issue', id, 'reported', `Báo hỏng: ${o.description}`, o.reported_by, o.created_at);
    return id;
  };
  issue({ asset_id: assets[1], description: 'Loa rè, lúc phát lúc không khi cắm dây.', severity: 'normal', status: 'reported', reported_by: U.tam, created_at: iso(today, '07:55') });
  {
    // Điều hòa P102 hỏng ⇒ đã tạo việc + đề xuất chi, đang chờ duyệt
    const created = iso(addDays(today, -2), '18:10');
    const tid = ins('tasks', { code: nextCode(db, 'task', 'CV-', 4), title: 'Xử lý điều hòa P102 không mát', description: 'Gọi thợ kiểm tra gas và vệ sinh dàn lạnh.', status: 'in_progress', priority: 'high', assignee_id: U.ops, created_by: U.ops, due_date: addDays(today, 1), related_type: 'asset_issue', position: 1, created_at: created, updated_at: created });
    const iid = issue({ asset_id: assets[4], description: 'Điều hòa chạy nhưng không mát, phòng nóng trong giờ học.', severity: 'high', status: 'waiting_approval', reported_by: U.phuong, handler_id: U.ops, task_id: tid, created_at: created });
    db.prepare('UPDATE tasks SET related_id = ? WHERE id = ?').run(iid, tid);
    const aid = addApproval({ type: 'expense', title: 'Sửa điều hòa P102 (nạp gas, vệ sinh)', description: 'Báo giá thợ: nạp gas 1.200.000 đ, vệ sinh 600.000 đ.', amount: 1800000, requested_by: U.ops, status: 'pending', ref_type: 'asset_issue', ref_id: iid, created_at: iso(addDays(today, -1), '09:20') });
    db.prepare('UPDATE asset_issues SET approval_id = ? WHERE id = ?').run(aid, iid);
    log('asset_issue', iid, 'task', 'Tạo công việc xử lý, giao cho Ngô Văn Long', U.ops, created);
    log('asset_issue', iid, 'approval', 'Tạo đề xuất chi 1.800.000 đ, chờ quản lý duyệt', U.ops, iso(addDays(today, -1), '09:20'));
  }
  {
    const created = iso(addDays(today, -4), '19:00');
    const tid = ins('tasks', { code: nextCode(db, 'task', 'CV-', 4), title: 'Thay bóng đèn máy chiếu P201', description: 'Đã đặt bóng đèn chính hãng, chờ giao hàng.', status: 'in_progress', priority: 'normal', assignee_id: U.ops, created_by: U.ops, due_date: addDays(today, 2), related_type: 'asset_issue', position: 2, created_at: created, updated_at: created });
    const iid = issue({ asset_id: assets[5], description: 'Máy chiếu báo lỗi đèn, hình mờ.', severity: 'normal', status: 'in_progress', reported_by: U.david, handler_id: U.ops, task_id: tid, created_at: created });
    db.prepare('UPDATE tasks SET related_id = ? WHERE id = ?').run(iid, tid);
    log('asset_issue', iid, 'task', 'Tạo công việc xử lý, giao cho Ngô Văn Long', U.ops, created);
  }
  {
    const created = iso(addDays(today, -25), '10:00');
    const iid = issue({ asset_id: assets[13], description: 'Máy in kẹt giấy liên tục.', severity: 'low', status: 'resolved', reported_by: U.cashier, handler_id: U.ops, resolution: 'Vệ sinh trục kéo giấy, thay miếng đệm.', resolved_by: U.ops, resolved_at: iso(addDays(today, -24), '15:00'), created_at: created });
    log('asset_issue', iid, 'resolved', 'Đã xử lý: vệ sinh trục kéo giấy, thay miếng đệm.', U.ops, iso(addDays(today, -24), '15:00'));
  }

  // Sự cố phát sinh mới theo phòng (không có trong danh mục tài sản), báo từ buổi học kèm thời gian đề xuất xử lý
  issue({ asset_id: null, room_id: rooms.P202, title: 'Bóng đèn P202 nhấp nháy', description: 'Hai bóng đèn cuối phòng nhấp nháy, học viên khó nhìn bảng.', severity: 'normal', status: 'reported', requested_due: addDays(today, -1), reported_by: U.trang, created_at: iso(addDays(today, -3), '19:40') });
  issue({ asset_id: null, room_id: rooms.P301, title: 'Ổ cắm gần bục giảng lỏng', description: 'Cắm sạc laptop hay bị mất điện, nguy cơ chập.', severity: 'high', status: 'reported', requested_due: addDays(today, 1), reported_by: U.academic, created_at: iso(today, '08:10') });

  // ---------- Đề xuất theo quy trình trung tâm ----------
  // 1) Học phí đăng ký mới do EC tạo ⇒ chờ Giám đốc duyệt (chưa thu được tiền, có thể nạp cọc)
  {
    const lead = db.prepare(`SELECT * FROM leads WHERE status = 'trial_done' ORDER BY id LIMIT 1`).get();
    const pid = ins('parents', { full_name: lead.parent_name, phone: lead.phone, email: lead.email, address: null, occupation: null, note: null, created_at: iso(today, '09:00') });
    const sid = ins('students', { code: nextCode(db, 'student', 'HV-', 4), full_name: lead.student_name, dob: lead.student_dob, gender: null, school: lead.school, level: courseRow('MV1').level, status: 'active', lead_id: lead.id, note: null, created_at: iso(today, '09:05'), updated_at: nowTs });
    ins('student_contacts', { student_id: sid, parent_id: pid, relationship: 'Mẹ', is_primary: 1 });
    db.prepare(`UPDATE leads SET status = 'enrolled', converted_student_id = ?, converted_at = ?, parent_id = ?, next_contact_at = NULL WHERE id = ?`).run(sid, iso(today, '09:05'), pid, lead.id);
    activity(lead.id, 'status', 'Chuyển thành học viên, tạo đăng ký — học phí chờ Giám đốc duyệt.', lead.owner_id, iso(today, '09:05'));
    db.prepare(`UPDATE tasks SET status = 'done', completed_at = ? WHERE related_type = 'lead' AND related_id = ?`).run(iso(today, '09:05'), lead.id);
    const pk = pkgRow(packages['MV1:12T']);
    const eid = ins('enrollments', { code: nextCode(db, 'enrollment', 'DK-', 4), student_id: sid, course_id: courses.MV1, class_id: classes['MV1-B'].id, class_joined_at: null, status: 'pending_approval', enrolled_at: today,
      total_sessions: pk.sessions, tuition_fee: pk.price, package_id: pk.id, kind: 'new', bonus_sessions: 0, free_absences: pk.free_absences, reserve_limit: pk.reserve_limit, sold_by: lead.owner_id, created_by: lead.owner_id, created_at: iso(today, '09:10') });
    ins('installments', { enrollment_id: eid, seq: 1, due_date: today, amount: round1000(pk.price / 2) });
    ins('installments', { enrollment_id: eid, seq: 2, due_date: addDays(today, 30), amount: pk.price - round1000(pk.price / 2) });
    const aid = addApproval({ type: 'enrollment', title: `Đăng ký mới Army Movers 1 – ${lead.student_name}`, description: `${pk.name} · lớp MV1-B`, amount: pk.price, requested_by: lead.owner_id, status: 'pending', ref_type: 'enrollment', ref_id: eid, payload: JSON.stringify({ enrollment_id: eid }), created_at: iso(today, '09:10') });
    db.prepare('UPDATE enrollments SET approval_id = ? WHERE id = ?').run(aid, eid);
    ins('wallet_entries', { code: nextCode(db, 'topup', 'NT-', 6), student_id: sid, kind: 'topup', amount: 1000000, method: 'cash', paid_at: today, payer_name: lead.parent_name, note: 'Đặt cọc giữ chỗ lớp Movers 1 – B (chờ duyệt học phí)', status: 'confirmed', created_by: U.cashier, created_at: iso(today, '09:20') });
  }
  // 2) Tái phí do CM nhập ⇒ chờ Giám đốc duyệt
  {
    const st = studentsByClass['ST1-A'][0];
    const prev = enrollmentIds[`ST1-A:${st.id}`];
    const pk = pkgRow(packages['ST2:TP12']);
    const eid = ins('enrollments', { code: nextCode(db, 'enrollment', 'DK-', 4), student_id: st.id, course_id: courses.ST2, class_id: null, status: 'pending_approval', enrolled_at: today, previous_enrollment_id: prev,
      total_sessions: pk.sessions, tuition_fee: pk.price, package_id: pk.id, kind: 'renew', bonus_sessions: 0, free_absences: pk.free_absences, reserve_limit: pk.reserve_limit, sold_by: U.tam, created_by: U.tam, created_at: iso(today, '08:30') });
    ins('installments', { enrollment_id: eid, seq: 1, due_date: addDays(today, 7), amount: pk.price });
    const aid = addApproval({ type: 'enrollment', title: `Tái phí Army Starters 2 – ${st.name}`, description: `${pk.name}. Phụ huynh đã đặt cọc 1.500.000 đ.`, amount: pk.price, requested_by: U.tam, status: 'pending', ref_type: 'enrollment', ref_id: eid, payload: JSON.stringify({ enrollment_id: eid }), created_at: iso(today, '08:30') });
    db.prepare('UPDATE enrollments SET approval_id = ? WHERE id = ?').run(aid, eid);
  }
  // 3) Gói phí mới do Trưởng phòng học thuật đề xuất ⇒ chờ Giám đốc duyệt
  {
    const pid = ins('fee_packages', { course_id: courses.ST1, code: nextCode(db, 'package', 'GP-', 3), name: 'Gói hè 2 tháng · 16 buổi', kind: 'new', sessions: 16, bonus_sessions: 0, months: 2, price: 3600000, note: 'Gói ngắn hạn mùa hè', status: 'pending', free_absences: 0, reserve_limit: 0, created_at: iso(today, '08:00') });
    const aid = addApproval({ type: 'package', title: 'Gói phí mới: Gói hè 2 tháng · 16 buổi', description: '16 buổi · 0 buổi nghỉ không tính phí · 0 lần bảo lưu. Gói ngắn hạn mùa hè', amount: 3600000, requested_by: U.academic, status: 'pending', ref_type: 'package', ref_id: pid, payload: JSON.stringify({ package_id: pid }), created_at: iso(today, '08:00') });
    db.prepare('UPDATE fee_packages SET approval_id = ? WHERE id = ?').run(aid, pid);
  }
  // 4) Đề xuất 2 cấp: CM gửi ⇒ Trưởng phòng học thuật duyệt ⇒ Giám đốc duyệt cuối
  {
    const st12 = studentsByClass['ST1-A'].find((x) => db.prepare(`SELECT 1 FROM enrollments e JOIN fee_packages p ON p.id = e.package_id WHERE e.student_id = ? AND e.class_id = ? AND p.reserve_limit > 0`).get(x.id, classes['ST1-A'].id));
    if (st12) {
      const eid = enrollmentIds[`ST1-A:${st12.id}`];
      const e = db.prepare('SELECT code FROM enrollments WHERE id = ?').get(eid);
      addApproval({ type: 'reserve', title: `Bảo lưu ${e.code} – ${st12.name} (${dmy(addDays(today, 7))} – ${dmy(addDays(today, 37))})`, description: 'Gia đình về quê 1 tháng.', requested_by: U.tam, status: 'pending', stage: 'lead', ref_type: 'enrollment', ref_id: eid,
        payload: JSON.stringify({ enrollment_id: eid, from: addDays(today, 7), to: addDays(today, 37) }), created_at: iso(today, '07:45') });
    }
    const stT = studentsByClass['MV1-A'][2];
    const eT = enrollmentIds[`MV1-A:${stT.id}`];
    const tr = addApproval({ type: 'class_transfer', title: `Chuyển lớp ${stT.name} → MV1-B`, description: 'Lịch học MV1-A trùng lịch học bơi của bé.', requested_by: U.phuong, status: 'pending', stage: 'final', lead_decided_by: U.academic, lead_decided_at: iso(addDays(today, -1), '16:00'), lead_note: 'Đồng ý, lớp MV1-B còn chỗ', ref_type: 'enrollment', ref_id: eT,
      payload: JSON.stringify({ enrollment_id: eT, class_id: classes['MV1-B'].id }), created_at: iso(addDays(today, -1), '10:00') });
    ins('approval_events', { approval_id: tr, action: 'lead_approved', user_id: U.academic, note: 'Đồng ý, lớp MV1-B còn chỗ', created_at: iso(addDays(today, -1), '16:00') });
    const stL = studentsByClass['FL1-A'][1];
    const eL = enrollmentIds[`FL1-A:${stL.id}`];
    addApproval({ type: 'level_up', title: `Lên level ${stL.name}: Army Flyers 1 → Pre-KET Pro`, description: 'Điểm kiểm tra giữa khóa 9,5; giáo viên đề xuất lên lớp Pre-KET.', requested_by: U.phuong, status: 'pending', stage: 'lead', ref_type: 'enrollment', ref_id: eL,
      payload: JSON.stringify({ enrollment_id: eL, course_id: courses.KET, class_id: classes['KET-A'].id }), created_at: iso(today, '08:50') });
  }

  // ---------- Lịch test / họp phụ huynh trong tháng ----------
  {
    const ev = (code, kind, title, date, start, status, returned = null) => ins('class_events', { class_id: classes[code].id, kind, title, date, start_time: start, note: null, status,
      results_due: kind === 'test' ? addDays(date, 5) : null, results_returned_at: returned, created_by: classes[code].homeroom, created_at: iso(addDays(date, -10)) });
    const m = `${today.slice(5, 7)}/${today.slice(0, 4)}`;
    ev('KET-A', 'test', `Kiểm tra định kỳ tháng ${m}`, addDays(today, -7), '19:15', 'done'); // quá hạn trả kết quả
    ev('ST1-A', 'test', `Kiểm tra định kỳ tháng ${m}`, addDays(today, -2), '17:30', 'done'); // còn 3 ngày
    ev('FL1-A', 'test', `Kiểm tra định kỳ tháng ${m}`, addDays(today, -10), '19:15', 'done', iso(addDays(today, -7), '20:00'));
    ev('PET-A', 'parent_meeting', `Họp phụ huynh tháng ${m}`, addDays(today, 6), '10:15', 'scheduled');
    ev('ST1-A', 'parent_meeting', `Họp phụ huynh tháng ${m}`, addDays(today, 4), '19:15', 'scheduled');
    ev('MV1-A', 'test', `Kiểm tra định kỳ tháng ${m}`, addDays(today, 5), '17:30', 'scheduled');
  }

  // ---------- Giáo trình & vật tư ----------
  const materialDefs = [
    ['Giáo trình Starters (Student Book)', 'textbook', 'cuốn', 18, 8, 'ST1'], ['Giáo trình Starters 2 (Student Book)', 'textbook', 'cuốn', 9, 6, 'ST2'],
    ['Giáo trình Movers (Student Book)', 'textbook', 'cuốn', 3, 8, 'MV1'], ['Giáo trình Flyers (Student Book)', 'textbook', 'cuốn', 12, 6, 'FL1'],
    ['Sách luyện thi Pre-KET', 'textbook', 'cuốn', 10, 6, 'KET'], ['Sách luyện thi PET', 'textbook', 'cuốn', 7, 5, 'PET'], ['IELTS Foundation Coursebook', 'textbook', 'cuốn', 4, 5, 'IEF'],
    ['Bút lông viết bảng', 'supply', 'hộp', 6, 4, null], ['Giấy A4 Double A', 'supply', 'ram', 2, 5, null], ['Mực in Canon 337', 'supply', 'hộp', 2, 1, null],
    ['Sticker khen thưởng', 'supply', 'tập', 25, 10, null], ['Bìa hồ sơ học viên', 'supply', 'cái', 40, 20, null],
  ];
  db.prepare(`INSERT INTO counters(name, value) VALUES ('asset', ?), ('material', ?)`).run(assetDefs.length, materialDefs.length);
  for (const [i, [name, kind, unit, stock, min, courseCode]] of materialDefs.entries()) {
    const mid = ins('materials', { code: `VT-${String(i + 1).padStart(3, '0')}`, name, kind, unit, stock, min_stock: min, course_id: courseCode ? courses[courseCode] : null, note: null });
    const inQty = stock + 10 + (i % 5) * 4;
    ins('stock_moves', { material_id: mid, type: 'in', qty: inQty, balance_after: inQty, reason: 'Nhập đầu kỳ', created_by: U.ops, created_at: iso(addDays(today, -60)) });
    if (inQty - stock > 0) ins('stock_moves', { material_id: mid, type: 'out', qty: inQty - stock, balance_after: stock, reason: kind === 'textbook' ? 'Phát giáo trình cho học viên lớp mới' : 'Xuất dùng cho lớp học', created_by: U.academic, created_at: iso(addDays(today, -20)) });
  }

  // ---------- Công việc ----------
  const templates = checklistTemplates();
  const task = (o, items = [], comments = []) => {
    const created = o.created_at || iso(addDays(today, -3));
    const id = ins('tasks', { code: nextCode(db, 'task', 'CV-', 4), description: null, priority: 'normal', created_by: U.manager, position: R() * 100, updated_at: created, ...o, created_at: created });
    items.forEach((t, i) => ins('task_items', { task_id: id, text: typeof t === 'string' ? t : t[0], done: typeof t === 'string' ? 0 : t[1] ? 1 : 0, position: i, done_by: Array.isArray(t) && t[1] ? o.assignee_id : null, done_at: Array.isArray(t) && t[1] ? iso(today, '07:50') : null }));
    comments.forEach(([uid, content, at]) => ins('task_comments', { task_id: id, user_id: uid, content, created_at: at }));
    return id;
  };
  task({ title: `${templates.open.name} – ${today.split('-').reverse().join('/')}`, status: 'in_progress', priority: 'high', assignee_id: U.ops, due_date: today, due_time: '08:00', template_key: 'open', source_key: `template:open:${today}`, created_at: iso(today, '07:30') }, templates.open.items.map((t, i) => [t, i < 4]));
  task({ title: `${templates.room_check.name} – ${today.split('-').reverse().join('/')}`, status: 'todo', assignee_id: U.ops, due_date: today, due_time: '16:30', template_key: 'room_check', source_key: `template:room_check:${today}`, created_at: iso(today, '07:30') }, templates.room_check.items);
  task({ title: `${templates.close.name} – ${today.split('-').reverse().join('/')}`, status: 'todo', assignee_id: U.ops, due_date: today, due_time: '21:30', template_key: 'close', source_key: `template:close:${today}`, created_at: iso(today, '07:30') }, templates.close.items);
  task({ title: `${templates.close.name} – ${addDays(today, -1).split('-').reverse().join('/')}`, status: 'done', assignee_id: U.ops, due_date: addDays(today, -1), due_time: '21:30', template_key: 'close', source_key: `template:close:${addDays(today, -1)}`, completed_at: iso(addDays(today, -1), '21:20'), created_at: iso(addDays(today, -1), '07:30') }, templates.close.items.map((t) => [t, true]));
  task({ title: 'Gọi nhắc phụ huynh các khoản học phí quá hạn', status: 'todo', priority: 'high', assignee_id: U.cashier, due_date: addDays(today, -2), created_by: U.manager }, [], [[U.manager, 'Ưu tiên các khoản quá hạn trên 7 ngày, ghi kết quả vào hồ sơ.', iso(addDays(today, -3), '09:10')]]);
  task({ title: 'Chuẩn bị đề kiểm tra giữa khóa Movers 1 – A', status: 'in_progress', assignee_id: U.phuong, due_date: addDays(today, 3), created_by: U.academic }, [['Soạn phần nghe', true], ['Soạn phần đọc – viết', false], ['In đề', false]]);
  task({ title: 'Nhận xét tháng cho lớp Starters 1 – A', status: 'review', assignee_id: U.tam, due_date: today, created_by: U.academic }, [], [[U.tam, 'Đã gửi bản nháp, nhờ chị Lan xem giúp.', iso(addDays(today, -1), '21:00')]]);
  task({ title: 'Nhập và phát giáo trình cho lớp Movers 1 – B', description: 'Kho còn ít giáo trình Movers, cần nhập thêm trước khai giảng.', status: 'todo', priority: 'high', assignee_id: U.academic, due_date: addDays(today, 5), created_by: U.manager });
  task({ title: 'Đăng bài khai giảng lớp Movers 1 – B', status: 'done', assignee_id: U.consultant, due_date: addDays(today, -4), completed_at: iso(addDays(today, -4), '16:00'), created_by: U.manager });
  task({ title: 'Sắp xếp phòng thi thử Pre-KET', status: 'todo', assignee_id: U.academic, due_date: addDays(today, -3), created_by: U.manager });
  task({ title: 'Gọi lại khách hẹn học thử chưa đến', status: 'in_progress', assignee_id: U.yen, due_date: today, created_by: U.consultant });
  task({ title: 'Kiểm kê tủ giáo trình cuối tháng', status: 'todo', priority: 'low', assignee_id: U.ops, due_date: addDays(today, 12), created_by: U.manager });
  task({ title: 'Cập nhật bảng giờ dạy tuần trước', status: 'done', assignee_id: U.academic, due_date: addDays(today, -1), completed_at: iso(addDays(today, -1), '18:00'), created_by: U.manager });
  task({ title: 'Họp phụ huynh lớp PET Elite – A', status: 'todo', priority: 'normal', assignee_id: U.david, due_date: addDays(today, 6), created_by: U.academic }, ['Chuẩn bị báo cáo tiến bộ', 'Gửi thư mời phụ huynh', 'Đặt phòng P301']);
  task({ title: 'Đối soát tiền mặt cuối ngày', status: 'done', assignee_id: U.cashier, due_date: addDays(today, -1), completed_at: iso(addDays(today, -1), '21:05'), created_by: U.manager });

  // ---------- Thông báo nội bộ ----------
  const notice = (o) => ins('notices', { pinned: 0, external_status: 'internal_only', created_by: U.manager, ...o });
  notice({ title: 'Lịch khai giảng lớp Movers 1 – B', body: `Lớp Movers 1 – B khai giảng ngày ${addDays(today, 7).split('-').reverse().join('/')}. Tư vấn ưu tiên giới thiệu cho các khách đang quan tâm Movers.`, audience: 'all', pinned: 1, created_at: iso(addDays(today, -3), '08:00') });
  notice({ title: 'Quy định điểm danh trước 15 phút sau giờ học', body: 'Giáo viên hoàn thành điểm danh và ghi nội dung buổi học chậm nhất 15 phút sau khi kết thúc buổi.', audience: 'teacher,academic', created_by: U.academic, created_at: iso(addDays(today, -6), '09:00') });
  notice({ title: 'Đối soát quỹ cuối tháng', body: 'Thu ngân hoàn tất đối soát quỹ và nộp báo cáo vào ngày làm việc cuối cùng của tháng.', audience: 'cashier,manager', created_at: iso(addDays(today, -8), '09:00') });
  notice({ title: 'Thông báo nghỉ lễ gửi phụ huynh', body: 'Trung tâm nghỉ ngày lễ theo lịch nhà nước. Lịch học bù sẽ được giáo vụ thông báo riêng từng lớp.', audience: 'all', external_status: 'sent_manually', external_note: 'Giáo vụ đã gửi tay qua nhóm Zalo phụ huynh các lớp', external_marked_by: U.academic, external_marked_at: iso(addDays(today, -12), '10:00'), created_at: iso(addDays(today, -12), '09:00') });

  // Phản hồi / khiếu nại có sẵn
  const anyStudent = studentsByClass['KET-A'][1];
  const fb = ins('care_cases', { code: nextCode(db, 'care', 'CS-', 4), student_id: anyStudent.id, enrollment_id: enrollmentIds[`KET-A:${anyStudent.id}`], type: 'complaint', title: 'Phụ huynh phản ánh phòng học nóng', content: 'Phụ huynh phản ánh phòng P102 nóng trong giờ học tối thứ trước.', status: 'in_progress', priority: 'high', owner_id: U.academic, due_date: addDays(today, 1), created_by: U.consultant, created_at: iso(addDays(today, -2), '20:00'), updated_at: iso(addDays(today, -1), '09:00') });
  ins('care_logs', { case_id: fb, channel: 'call', content: 'Gọi xin lỗi phụ huynh, thông báo đang sửa điều hòa P102 và tạm chuyển lớp sang phòng khác nếu cần.', result: 'Phụ huynh đồng ý, chờ phản hồi sau khi sửa', created_by: U.academic, created_at: iso(addDays(today, -1), '09:00') });
  const fb2Student = studentsByClass['FL1-A'][2];
  const fb2 = ins('care_cases', { code: nextCode(db, 'care', 'CS-', 4), student_id: fb2Student.id, enrollment_id: enrollmentIds[`FL1-A:${fb2Student.id}`], type: 'feedback', title: 'Phụ huynh muốn nhận nhận xét chi tiết hơn', content: 'Mong giáo viên gửi nhận xét kỹ năng nói hằng tháng.', status: 'done', priority: 'normal', owner_id: U.academic, due_date: addDays(today, -6), resolution: 'Đã thống nhất gửi nhận xét kỹ năng hằng tháng qua Zalo.', created_by: U.academic, created_at: iso(addDays(today, -10)), updated_at: iso(addDays(today, -7)), resolved_at: iso(addDays(today, -7)) });
  ins('care_logs', { case_id: fb2, channel: 'zalo', content: 'Gửi mẫu nhận xét kỹ năng nói cho phụ huynh xem trước.', result: 'Phụ huynh hài lòng', created_by: U.academic, created_at: iso(addDays(today, -7)) });

  // Thông báo trong app mẫu
  const n = (uid, title, body, link, days) => ins('notifications', { user_id: uid, title, body, link, dedupe_key: null, read_at: null, created_at: iso(addDays(today, days), '08:00') });
  n(U.tam, 'Nhắc điểm danh lớp hôm nay', 'Lớp Starters 1 – A có buổi học hôm nay lúc 17:30.', '/schedule', 0);
  n(U.ops, 'Báo hỏng mới: Loa kéo JBL (P101)', 'Giáo viên Đỗ Thanh Tâm vừa báo hỏng.', '/assets?tab=issues', 0);
  n(U.academic, 'Giáo trình Movers sắp hết', 'Tồn kho 3 cuốn, dưới ngưỡng 8.', '/inventory', -1);
}

// Việc chăm sóc vắng học cũ đã được xử lý (để danh sách giống thực tế: chỉ vài việc mới)
function ageCareCases(db, today) {
  const cases = db.prepare(`SELECT c.id, c.status, s.date FROM care_cases c JOIN attendance a ON a.id = c.attendance_id JOIN class_sessions s ON s.id = a.session_id
    WHERE c.type = 'absence' ORDER BY s.date`).all();
  const owner = 3; // giáo vụ
  db.transaction(() => {
    for (const [i, c] of cases.entries()) {
      const at = new Date(`${addDays(c.date, 1)}T10:00:00+07:00`).toISOString();
      if (c.date < addDays(today, -6)) {
        db.prepare('INSERT INTO care_logs(case_id, channel, content, result, created_by, created_at) VALUES (?,?,?,?,?,?)')
          .run(c.id, i % 2 ? 'zalo' : 'call', 'Hỏi thăm lý do vắng, nhắc lịch học buổi tiếp theo.', 'Phụ huynh đã nắm thông tin', owner, at);
        db.prepare(`UPDATE care_cases SET status = 'done', resolution = 'Đã liên hệ phụ huynh', resolved_at = ?, updated_at = ? WHERE id = ?`).run(at, at, c.id);
      } else if (c.date < addDays(today, -2)) {
        db.prepare('INSERT INTO care_logs(case_id, channel, content, result, created_by, created_at) VALUES (?,?,?,?,?,?)')
          .run(c.id, 'call', 'Gọi phụ huynh nhưng chưa nghe máy, đã nhắn Zalo.', 'Chờ phụ huynh phản hồi', owner, at);
        db.prepare(`UPDATE care_cases SET status = 'waiting', updated_at = ? WHERE id = ?`).run(at, c.id);
      }
    }
  })();
}

export function checklistTemplates() {
  return {
    open: { name: 'Checklist mở cửa', items: ['Mở khóa cửa chính, tắt báo động', 'Bật đèn, điều hòa khu lễ tân', 'Kiểm tra vệ sinh sảnh và nhà vệ sinh', 'Bật máy tính quầy, kiểm tra mạng', 'Chuẩn bị nước uống cho phụ huynh', 'Kiểm tra lịch học và học thử trong ngày'] },
    room_check: { name: 'Kiểm tra phòng học', items: ['Máy chiếu/tivi hoạt động', 'Loa và micro hoạt động', 'Điều hòa mát, không rò nước', 'Bảng sạch, đủ bút lông', 'Bàn ghế đủ theo sĩ số', 'Thùng rác đã được dọn'] },
    close: { name: 'Checklist đóng cửa', items: ['Tắt máy chiếu, tivi, loa các phòng', 'Tắt điều hòa và đèn tất cả phòng', 'Kiểm tra cửa sổ đã đóng', 'Đối soát tiền mặt với thu ngân', 'Khóa cửa, bật báo động'] },
  };
}
