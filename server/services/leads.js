import { nextCode, notify, usersWithRole, logActivity } from '../db/index.js';
import { nowIso } from '../lib/time.js';
import { conflict } from '../lib/http.js';

// ===== DATA KHÁCH HÀNG (theo yêu cầu trung tâm) =====
export const LEAD_SOURCES = ['Khách hàng giới thiệu', 'Vãng lai', 'Fanpage', 'Thị trường', 'Telesales', 'Kênh online', 'Sự kiện', 'Đối tác'];

// Phân loại khách. Mỗi phân loại đang mở đều có "ngày liên hệ lại" để hệ thống nhắc việc.
export const LEAD_STATUS = {
  potential: 'Tiềm năng tháng',
  appointing: 'Đang lên hẹn',
  checkin_booked: 'Đăng ký check-in',   // CM gọi là "Đợi lên hẹn"
  checked_in: 'Đã check-in',
  trial_booked: 'Đăng ký học thử',      // CM gọi là "Đợi học thử"
  trial_done: 'Đã học thử',
  nurturing: 'Chăm sóc thêm',
  enrolled: 'Đã đăng ký',
  unfit: 'Không phù hợp',
};
export const OPEN_STATUSES = ['potential', 'appointing', 'checkin_booked', 'checked_in', 'trial_booked', 'trial_done', 'nurturing'];
// Phân loại nhân sự tự chọn (các bước check-in/học thử có thao tác riêng vì kéo theo lịch & đề xuất cho CM)
export const MANUAL_STATUSES = ['potential', 'appointing', 'nurturing'];

/** Khách còn giữ quyền "ai check-in trước": trả về hồ sơ khách cùng SĐT đã check-in (nếu có) */
export function checkedInTwin(db, phone, excludeId = 0) {
  return db.prepare(`SELECT l.id, l.code, l.student_name, l.checked_in_at, u.full_name AS owner_name, l.owner_id FROM leads l LEFT JOIN users u ON u.id = l.owner_id
    WHERE l.phone = ? AND l.id != ? AND l.checked_in_at IS NOT NULL ORDER BY l.checked_in_at LIMIT 1`).get(phone, excludeId);
}

/** Danh sách CM (giáo viên chủ nhiệm đang hoạt động) */
export function cmUsers(db) {
  return db.prepare(`SELECT DISTINCT u.id, u.full_name FROM users u JOIN user_roles r ON r.user_id = u.id
    WHERE r.role = 'teacher' AND u.status = 'active' AND EXISTS (SELECT 1 FROM classes c WHERE c.homeroom_id = u.id AND c.status IN ('active','planned'))`).all();
}

/** Tạo "đề xuất cần xử lý" (công việc) cho một người; khóa source_key chống tạo trùng */
export function proposeTask(db, { assigneeId, title, description = null, dueDate, dueTime = null, leadId, key, by }) {
  const ex = db.prepare('SELECT id FROM tasks WHERE source_key = ?').get(key);
  if (ex) return ex.id;
  const ts = nowIso();
  const id = Number(db.prepare(`INSERT INTO tasks(code, title, description, status, priority, assignee_id, created_by, due_date, due_time, related_type, related_id, source_key, position, created_at, updated_at)
    VALUES (?,?,?,'todo','high',?,?,?,?,'lead',?,?,0,?,?)`).run(nextCode(db, 'task', 'CV-', 4), title, description, assigneeId, by, dueDate, dueTime, leadId, key, ts, ts).lastInsertRowid);
  notify(db, assigneeId, { title: `Đề xuất cần xử lý: ${title}`, link: `/tasks?id=${id}`, dedupeKey: `task:${id}` });
  return id;
}

/** Hoàn tất các đề xuất của một khách theo tiền tố khóa (vd: đã check-in ⇒ đóng đề xuất "đăng ký check-in") */
export function closeLeadTasks(db, leadId, prefix) {
  const ts = nowIso();
  db.prepare(`UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE related_type = 'lead' AND related_id = ? AND source_key LIKE ? AND status != 'done'`)
    .run(ts, ts, leadId, `${prefix}%`);
}

/**
 * Khách check-in tại trung tâm. Quy tắc tránh tranh chấp: nhân sự ghi nhận check-in ĐẦU TIÊN giữ khách (khóa người phụ trách).
 * Khách trùng SĐT đã check-in với người khác ⇒ chặn.
 */
export function recordCheckin(db, { lead, staffId, user, at = nowIso() }) {
  if (lead.checked_in_at) throw conflict(`Khách đã check-in lúc ${at.slice(0, 10)} — thuộc về nhân sự đã check-in trước.`);
  const twin = checkedInTwin(db, lead.phone, lead.id);
  if (twin && twin.owner_id !== staffId) {
    throw conflict(`Số điện thoại này đã check-in ngày ${twin.checked_in_at.slice(0, 10).split('-').reverse().join('/')} (hồ sơ ${twin.code}, ${twin.owner_name}). Khách thuộc về nhân sự check-in trước.`);
  }
  db.prepare(`UPDATE leads SET status = 'checked_in', checked_in_at = ?, checked_in_by = ?, owner_id = ?, owner_locked = 1, updated_at = ? WHERE id = ?`)
    .run(at, user.id, staffId, at, lead.id);
  const staff = db.prepare('SELECT full_name FROM users WHERE id = ?').get(staffId);
  db.prepare('INSERT INTO lead_activities(lead_id, type, content, created_by, created_at) VALUES (?,?,?,?,?)')
    .run(lead.id, 'status', `Khách check-in tại trung tâm — khách thuộc về ${staff.full_name} (check-in trước).`, user.id, at);
  closeLeadTasks(db, lead.id, `lead-checkin:${lead.id}:`);
  logActivity(db, { entityType: 'lead', entityId: lead.id, action: 'checked_in', summary: `Check-in, phụ trách ${staff.full_name}`, userId: user.id });
}

export { usersWithRole };
