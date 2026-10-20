import { nextCode, notify, usersWithRole, setMeta } from '../db/index.js';
import { vnToday, addDays, nowIso, vnTime } from '../lib/time.js';
import { sessionUsage } from './attendance.js';
import { computeFinance } from './finance.js';

export const RENEWAL_THRESHOLD = 4; // còn ≤ 4 buổi ⇒ vào danh sách sắp hết khóa

/** Chủ nhiệm chăm sóc mặc định: giáo vụ đầu tiên đang hoạt động */
function defaultCareOwner(db) {
  return usersWithRole(db, 'academic')[0] || usersWithRole(db, 'manager')[0] || null;
}

/** Tạo việc chăm sóc cho một buổi vắng. Có source_key ⇒ gọi lại bao nhiêu lần cũng chỉ một việc. */
export function ensureAbsenceCase(db, attendanceId, userId = null) {
  const a = db.prepare(`SELECT a.*, s.date, s.class_id, c.code AS class_code, c.homeroom_id, st.full_name
      FROM attendance a JOIN class_sessions s ON s.id = a.session_id LEFT JOIN classes c ON c.id = s.class_id
      JOIN students st ON st.id = a.student_id WHERE a.id = ?`).get(attendanceId);
  if (!a || !['absent', 'excused'].includes(a.status) || a.is_makeup) return null;
  const key = `absence:${attendanceId}`;
  const existing = db.prepare('SELECT id FROM care_cases WHERE source_key = ?').get(key);
  if (existing) return { id: existing.id, created: false };
  const ts = nowIso();
  const dd = a.date.split('-').reverse().join('/');
  const info = db.prepare(`INSERT INTO care_cases(code, student_id, enrollment_id, type, title, content, status, priority, owner_id, due_date, source_key, attendance_id, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    nextCode(db, 'care', 'CS-', 4), a.student_id, a.enrollment_id, 'absence',
    `Liên hệ vì vắng buổi ${dd} (${a.class_code || 'học bù'})`,
    `${a.full_name} ${a.status === 'absent' ? 'vắng không phép' : 'vắng có phép'} buổi ngày ${dd}. Hỏi thăm lý do và sắp xếp học bù.`,
    'new', a.status === 'absent' ? 'high' : 'normal', a.homeroom_id || defaultCareOwner(db), addDays(a.date, 1), key, attendanceId, userId, ts, ts,
  );
  const id = Number(info.lastInsertRowid);
  const owner = defaultCareOwner(db);
  notify(db, owner, { title: `Việc chăm sóc mới: ${a.full_name} vắng học`, link: `/care?id=${id}`, dedupeKey: `care:${id}` });
  return { id, created: true };
}

/**
 * Quét nhắc việc. An toàn khi chạy lại nhiều lần: mọi bản ghi sinh ra đều có khóa duy nhất.
 * Trả về số bản ghi MỚI được tạo ở lần chạy này.
 */
export function runReminders(db, { today = vnToday() } = {}) {
  return db.transaction(() => {
    const result = { absenceCases: 0, renewalCases: 0, paymentNotices: 0, leadFollowups: 0 };
    // 1) Vắng trong 14 ngày gần đây mà chưa có việc chăm sóc
    const absences = db.prepare(`SELECT a.id FROM attendance a JOIN class_sessions s ON s.id = a.session_id
      WHERE a.status IN ('absent','excused') AND a.is_makeup = 0 AND s.date BETWEEN ? AND ?`).all(addDays(today, -14), today);
    for (const a of absences) if (ensureAbsenceCase(db, a.id)?.created) result.absenceCases++;

    // 2) Sắp hết khóa ⇒ việc tái đăng ký
    const active = db.prepare(`SELECT e.id, e.student_id, s.full_name, c.name AS course_name FROM enrollments e
      JOIN students s ON s.id = e.student_id JOIN courses c ON c.id = e.course_id WHERE e.status = 'active'`).all();
    const usage = sessionUsage(db, active.map((e) => e.id));
    const owner = usersWithRole(db, 'consultant')[0] || defaultCareOwner(db);
    for (const e of active) {
      const u = usage.get(e.id);
      if (!u || u.remaining > RENEWAL_THRESHOLD) continue;
      const hasNext = db.prepare(`SELECT 1 FROM enrollments WHERE previous_enrollment_id = ? AND status != 'cancelled'`).get(e.id);
      if (hasNext) continue;
      const key = `renewal:${e.id}`;
      const ts = nowIso();
      const info = db.prepare(`INSERT INTO care_cases(code, student_id, enrollment_id, type, title, content, status, priority, owner_id, due_date, source_key, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO NOTHING`).run(
        `CS-R${e.id}`, e.student_id, e.id, 'renewal', `Tư vấn tái đăng ký: ${e.full_name}`,
        `Khóa ${e.course_name} còn ${u.remaining} buổi. Gửi nhận xét tiến bộ và tư vấn khóa tiếp theo.`,
        'new', 'normal', owner, addDays(today, 5), key, ts, ts,
      );
      if (info.changes) result.renewalCases++;
    }

    // 3) Công nợ quá hạn ⇒ thông báo cho thu ngân (mỗi đợt một lần)
    const fin = computeFinance(db, { today });
    const cashiers = usersWithRole(db, 'cashier');
    for (const [eid, f] of fin) {
      for (const i of f.installments.filter((x) => x.status === 'overdue')) {
        for (const c of cashiers) {
          const r = db.prepare(`INSERT INTO notifications(user_id, title, body, link, dedupe_key, created_at) VALUES (?,?,?,?,?,?)
            ON CONFLICT(user_id, dedupe_key) DO NOTHING`).run(c, 'Khoản học phí quá hạn', `Đăng ký #${eid} đợt ${i.seq}: còn ${i.remaining.toLocaleString('vi-VN')} đ`, `/finance?enrollment=${eid}`, `overdue:${eid}:${i.seq}`, nowIso());
          if (r.changes) result.paymentNotices++;
        }
      }
    }

    // 4) Khách cần liên hệ hôm nay ⇒ nhắc người phụ trách
    const leads = db.prepare(`SELECT id, owner_id, parent_name, next_contact_at FROM leads
      WHERE status IN ('potential','appointing','checkin_booked','checked_in','trial_booked','trial_done','nurturing') AND next_contact_at IS NOT NULL AND substr(next_contact_at,1,10) <= ?`).all(today);
    for (const l of leads) {
      if (!l.owner_id) continue;
      const r = db.prepare(`INSERT INTO notifications(user_id, title, body, link, dedupe_key, created_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id, dedupe_key) DO NOTHING`).run(l.owner_id, `Đến hẹn liên hệ: ${l.parent_name}`, `Lịch hẹn ${l.next_contact_at}`, `/leads/${l.id}`, `lead-followup:${l.id}:${l.next_contact_at}`, nowIso());
      if (r.changes) result.leadFollowups++;
    }
    // 5) Test đã tổ chức, sắp/đã quá hạn trả kết quả cho phụ huynh (5 ngày) ⇒ việc cho chủ nhiệm
    const tests = db.prepare(`SELECT e.*, c.code AS class_code, c.homeroom_id, c.teacher_id FROM class_events e JOIN classes c ON c.id = e.class_id
      WHERE e.kind = 'test' AND e.status = 'done' AND e.results_returned_at IS NULL AND e.results_due <= ?`).all(addDays(today, 1));
    for (const t of tests) {
      const owner = t.homeroom_id || t.teacher_id;
      if (!owner) continue;
      const ts = nowIso();
      const r = db.prepare(`INSERT INTO tasks(code, title, description, status, priority, assignee_id, created_by, due_date, related_type, related_id, source_key, position, created_at, updated_at)
        VALUES (?,?,?,'todo','high',?,NULL,?,'class',?,?,0,?,?) ON CONFLICT(source_key) DO NOTHING`)
        .run(nextCode(db, 'task', 'CV-', 4), `Trả kết quả test lớp ${t.class_code} cho phụ huynh`, `${t.title} ngày ${t.date.split('-').reverse().join('/')} — hạn trả kết quả ${t.results_due.split('-').reverse().join('/')} (5 ngày sau test).`,
          owner, t.results_due, t.class_id, `test-results:${t.id}`, ts, ts);
      if (r.changes) result.testResults = (result.testResults || 0) + 1;
    }
    setMeta(db, 'reminders_last_run', `${today} ${vnTime()}`);
    return result;
  })();
}
