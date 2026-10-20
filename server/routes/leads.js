import { Router } from 'express';
import { z } from 'zod';
import { can, has } from '../auth/middleware.js';
import { parse, v, notFound, conflict, badRequest, forbidden } from '../lib/http.js';
import { nextCode, logActivity } from '../db/index.js';
import { nowIso, vnToday, addDays, startOfWeek } from '../lib/time.js';
import { findConflicts } from '../services/schedule.js';
import { createEnrollment } from '../services/enrollments.js';
import { leadLevels, LEVELS } from '../services/packages.js';
import {
  LEAD_SOURCES, LEAD_STATUS, OPEN_STATUSES, MANUAL_STATUSES, checkedInTwin, cmUsers, proposeTask, closeLeadTasks, recordCheckin,
} from '../services/leads.js';

export { LEAD_STATUS };

const nextContact = z.string().optional().nullable().transform((s) => (s ? s.replace('T', ' ').slice(0, 16) : null))
  .refine((s) => s === null || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s), 'Thời gian không hợp lệ.');

const leadSchema = z.object({
  parent_name: v.text(120, 'tên phụ huynh'),
  phone: v.phone(),
  email: v.optEmail(),
  student_name: v.text(120, 'tên học sinh'),
  student_dob: v.optDate(),
  school: v.optText(120),
  student_level: v.optText(120),
  interest_course_id: v.optId(),
  source: z.enum(LEAD_SOURCES, { error: 'Vui lòng chọn nguồn khách.' }),
  status: z.enum(MANUAL_STATUSES).optional(),
  owner_id: v.optId(),
  next_contact_at: nextContact,
  note: v.optText(1000),
});

function duplicatesFor(db, phone, excludeLeadId = 0) {
  const leads = db.prepare(`SELECT l.id, l.code, l.parent_name, l.student_name, l.status, l.checked_in_at, u.full_name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id
    WHERE l.phone = ? AND l.id != ?`).all(phone, excludeLeadId);
  const parents = db.prepare(`SELECT p.id, p.full_name, group_concat(s.full_name, ', ') AS children FROM parents p
    LEFT JOIN student_contacts sc ON sc.parent_id = p.id LEFT JOIN students s ON s.id = sc.student_id WHERE p.phone = ? GROUP BY p.id`).all(phone);
  return { leads, parents };
}

/** Nhân sự chỉ thấy khách mình phụ trách/tạo; trưởng phòng, Giám đốc thấy tất cả */
function scopeSql(user) {
  return has(user, 'leads.view_all') ? { sql: '', args: [] } : { sql: '(l.owner_id = ? OR l.created_by = ?)', args: [user.id, user.id] };
}

function loadLead(db, user, id) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) throw notFound('Không tìm thấy hồ sơ khách.');
  if (!has(user, 'leads.view_all') && lead.owner_id !== user.id && lead.created_by !== user.id) throw notFound('Không tìm thấy hồ sơ khách.');
  return lead;
}

const activity = (db, leadId, type, content, userId, extra = {}) => db.prepare('INSERT INTO lead_activities(lead_id, type, content, result, next_contact_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
  .run(leadId, type, content, extra.result ?? null, extra.next ?? null, userId, nowIso());
const needNext = (status, next) => {
  if (OPEN_STATUSES.includes(status) && !next) throw badRequest('Chọn ngày liên hệ lại để hệ thống nhắc việc.', { next_contact_at: 'Chọn ngày liên hệ lại.' });
};

export function leadRoutes({ db }) {
  const r = Router();

  r.get('/', can('leads.view'), (req, res) => {
    const { q, source, owner_id, status, appointment } = req.query;
    const sc = scopeSql(req.user);
    const where = sc.sql ? [sc.sql] : [];
    const args = [...sc.args];
    if (q) {
      const digits = String(q).replace(/\D/g, '');
      where.push(`(l.parent_name LIKE ? OR l.student_name LIKE ? OR l.code LIKE ?${digits.length >= 3 ? ' OR l.phone LIKE ?' : ''})`);
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, ...(digits.length >= 3 ? [`%${digits}%`] : []));
    }
    if (source) { where.push('l.source = ?'); args.push(source); }
    if (owner_id === 'me') { where.push('l.owner_id = ?'); args.push(req.user.id); } else if (owner_id) { where.push('l.owner_id = ?'); args.push(Number(owner_id)); }
    if (status === 'open' || !status) { where.push(`l.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`); args.push(...OPEN_STATUSES); } else if (status !== 'all') { where.push('l.status = ?'); args.push(status); }
    const today = vnToday();
    if (appointment === 'today') { where.push('substr(l.next_contact_at,1,10) = ?'); args.push(today); }
    if (appointment === 'overdue') { where.push('substr(l.next_contact_at,1,10) < ?'); args.push(today); }
    if (appointment === 'week') { where.push('substr(l.next_contact_at,1,10) BETWEEN ? AND ?'); args.push(startOfWeek(today), addDays(startOfWeek(today), 6)); }
    if (appointment === 'none') where.push('l.next_contact_at IS NULL');
    if (appointment === 'month_new') { where.push('l.created_at >= ?'); args.push(`${today.slice(0, 7)}-01`); }
    const rows = db.prepare(`SELECT l.*, u.full_name AS owner_name, c.name AS course_name, ci.full_name AS checked_in_by_name,
        (SELECT COUNT(*) FROM leads l2 WHERE l2.phone = l.phone AND l2.id != l.id) + (SELECT COUNT(*) FROM parents p WHERE p.phone = l.phone AND p.id IS NOT COALESCE(l.parent_id, -1)) AS dup_count,
        (SELECT t.date || ' ' || t.start_time FROM trials t WHERE t.lead_id = l.id AND t.status = 'scheduled' ORDER BY t.date LIMIT 1) AS next_trial
      FROM leads l LEFT JOIN users u ON u.id = l.owner_id LEFT JOIN courses c ON c.id = l.interest_course_id LEFT JOIN users ci ON ci.id = l.checked_in_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(l.next_contact_at, '9999'), l.created_at DESC LIMIT 500`).all(...args);
    const countWhere = sc.sql ? `WHERE ${sc.sql}` : '';
    const counts = Object.fromEntries(db.prepare(`SELECT l.status, COUNT(*) n FROM leads l ${countWhere} GROUP BY l.status`).all(...sc.args).map((x) => [x.status, x.n]));
    const lv = leadLevels(db, rows);
    const all = db.prepare(`SELECT l.id, l.status, l.converted_student_id FROM leads l WHERE l.status != 'unfit' ${sc.sql ? `AND ${sc.sql}` : ''}`).all(...sc.args);
    const allLv = leadLevels(db, all);
    const levelCounts = Object.fromEntries(LEVELS.map((l) => [l.key, 0]));
    for (const x of allLv.values()) if (x) levelCounts[x]++;
    let items = rows.map((x) => ({ ...x, level: lv.get(x.id) }));
    if (req.query.level) items = items.filter((x) => x.level === req.query.level);
    res.json({ items, counts, levelCounts, levels: LEVELS, statusLabels: LEAD_STATUS, sources: LEAD_SOURCES, scope: has(req.user, 'leads.view_all') ? 'all' : 'mine' });
  });

  r.get('/check-phone', can('leads.view'), (req, res) => {
    const phone = String(req.query.phone || '').replace(/[\s.-]/g, '');
    if (!/^0\d{9,10}$/.test(phone)) return res.json({ leads: [], parents: [], checkedIn: null });
    res.json({ ...duplicatesFor(db, phone, Number(req.query.exclude || 0)), checkedIn: checkedInTwin(db, phone, Number(req.query.exclude || 0)) || null });
  });

  r.post('/', can('leads.edit'), (req, res) => {
    const b = parse(leadSchema, req.body);
    const status = b.status || 'potential';
    needNext(status, b.next_contact_at);
    // Khách đã check-in với nhân sự khác ⇒ không tạo hồ sơ mới để "giành" khách
    const twin = checkedInTwin(db, b.phone);
    if (twin) throw conflict(`Số điện thoại đã check-in ngày ${twin.checked_in_at.slice(0, 10).split('-').reverse().join('/')} với ${twin.owner_name} (hồ sơ ${twin.code}). Khách thuộc về nhân sự check-in trước.`, { twin });
    const ts = nowIso();
    const owner = has(req.user, 'leads.assign') && b.owner_id ? b.owner_id : req.user.id;
    const id = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO leads(code, parent_name, phone, email, student_name, student_dob, school, interest_course_id, source, owner_id, status, next_contact_at, note, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(nextCode(db, 'lead', 'KH-', 4), b.parent_name, b.phone, b.email, b.student_name, b.student_dob, b.school,
        b.interest_course_id, b.source, owner, status, b.next_contact_at, [b.student_level && `Trình độ: ${b.student_level}`, b.note].filter(Boolean).join('. ') || null, req.user.id, ts, ts).lastInsertRowid);
      activity(db, id, 'note', `Tạo data khách (nguồn ${b.source}) — ${LEAD_STATUS[status]}.`, req.user.id, { next: b.next_contact_at });
      return id;
    })();
    res.status(201).json({ id, duplicates: duplicatesFor(db, b.phone, id) });
  });

  r.get('/:id', can('leads.view'), (req, res) => {
    const id = Number(req.params.id);
    loadLead(db, req.user, id);
    const lead = db.prepare(`SELECT l.*, u.full_name AS owner_name, c.name AS course_name, ci.full_name AS checked_in_by_name, tc.code AS trial_class_code FROM leads l
      LEFT JOIN users u ON u.id = l.owner_id LEFT JOIN courses c ON c.id = l.interest_course_id LEFT JOIN users ci ON ci.id = l.checked_in_by
      LEFT JOIN classes tc ON tc.id = l.trial_class_id WHERE l.id = ?`).get(id);
    const activities = db.prepare(`SELECT a.*, u.full_name AS by_name FROM lead_activities a LEFT JOIN users u ON u.id = a.created_by WHERE a.lead_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(id);
    const trials = db.prepare(`SELECT t.*, r.name AS room_name, u.full_name AS teacher_name, c.code AS class_code, rc.name AS recommended_course
      FROM trials t LEFT JOIN rooms r ON r.id = t.room_id LEFT JOIN users u ON u.id = t.teacher_id
      LEFT JOIN class_sessions s ON s.id = t.session_id LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN courses rc ON rc.id = t.recommended_course_id
      WHERE t.lead_id = ? ORDER BY t.date DESC, t.start_time DESC`).all(id);
    const tasks = db.prepare(`SELECT t.id, t.code, t.title, t.status, t.due_date, u.full_name AS assignee FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.related_type = 'lead' AND t.related_id = ? ORDER BY t.created_at`).all(id);
    res.json({
      lead, activities, trials, tasks, duplicates: duplicatesFor(db, lead.phone, id), statusLabels: LEAD_STATUS, sources: LEAD_SOURCES,
      can: { assign: has(req.user, 'leads.assign'), edit: has(req.user, 'leads.edit') && !['enrolled'].includes(lead.status) },
    });
  });

  r.put('/:id', can('leads.edit'), (req, res) => {
    const id = Number(req.params.id);
    const lead = loadLead(db, req.user, id);
    if (lead.status === 'enrolled') throw conflict('Khách đã chuyển thành học viên. Vui lòng sửa trong hồ sơ học viên.');
    const b = parse(leadSchema.omit({ status: true, next_contact_at: true }), req.body);
    let owner = lead.owner_id;
    if (b.owner_id && b.owner_id !== lead.owner_id) {
      if (!has(req.user, 'leads.assign')) throw forbidden('Chỉ trưởng phòng/Giám đốc được đổi nhân sự phụ trách.');
      owner = b.owner_id;
    }
    if (b.phone !== lead.phone) {
      const twin = checkedInTwin(db, b.phone, id);
      if (twin) throw conflict(`Số điện thoại đã check-in với ${twin.owner_name} (hồ sơ ${twin.code}).`, { twin });
    }
    db.prepare(`UPDATE leads SET parent_name=?, phone=?, email=?, student_name=?, student_dob=?, school=?, interest_course_id=?, source=?, owner_id=?, note=?, updated_at=? WHERE id=?`)
      .run(b.parent_name, b.phone, b.email, b.student_name, b.student_dob, b.school, b.interest_course_id, b.source, owner, b.note, nowIso(), id);
    if (owner !== lead.owner_id) activity(db, id, 'status', `Đổi nhân sự phụ trách sang ${db.prepare('SELECT full_name FROM users WHERE id = ?').get(owner).full_name}.`, req.user.id);
    res.json({ ok: true, duplicates: duplicatesFor(db, b.phone, id) });
  });

  // Ghi lịch sử tư vấn + phân loại + ngày liên hệ lại (bắt buộc với khách đang mở để có nhắc việc)
  r.post('/:id/activities', can('leads.edit'), (req, res) => {
    const id = Number(req.params.id);
    const lead = loadLead(db, req.user, id);
    const b = parse(z.object({
      type: z.enum(['call', 'message', 'meeting', 'note'], { error: 'Vui lòng chọn hình thức liên hệ.' }),
      content: v.text(2000, 'nội dung tư vấn'),
      result: v.optText(500),
      status: z.enum(MANUAL_STATUSES).optional().nullable(),
      next_contact_at: nextContact,
    }), req.body);
    const status = b.status || lead.status;
    needNext(status, b.next_contact_at);
    db.transaction(() => {
      activity(db, id, b.type, b.content, req.user.id, { result: b.result, next: b.next_contact_at });
      if (status !== lead.status) activity(db, id, 'status', `Phân loại: ${LEAD_STATUS[lead.status]} → ${LEAD_STATUS[status]}.`, req.user.id);
      db.prepare('UPDATE leads SET status = ?, next_contact_at = ?, updated_at = ? WHERE id = ?').run(status, b.next_contact_at, nowIso(), id);
    })();
    res.status(201).json({ ok: true });
  });

  // Đổi phân loại thủ công (Tiềm năng tháng / Đang lên hẹn / Chăm sóc thêm), đóng hồ sơ (Không phù hợp) hoặc mở lại
  r.post('/:id/status', can('leads.edit'), (req, res) => {
    const id = Number(req.params.id);
    const lead = loadLead(db, req.user, id);
    const b = parse(z.object({ status: z.enum([...MANUAL_STATUSES, 'unfit'], { error: 'Chọn phân loại.' }), reason: v.optText(500), next_contact_at: nextContact }), req.body);
    if (lead.status === 'enrolled') throw conflict('Khách đã đăng ký, không đổi phân loại được.');
    if (b.status === 'unfit' && !b.reason) throw badRequest('Vui lòng nhập lý do không phù hợp.', { reason: 'Vui lòng nhập lý do.' });
    if (b.status !== 'unfit') needNext(b.status, b.next_contact_at);
    db.transaction(() => {
      db.prepare(`UPDATE leads SET status = ?, unfit_reason = ?, next_contact_at = ?, updated_at = ? WHERE id = ?`)
        .run(b.status, b.status === 'unfit' ? b.reason : null, b.status === 'unfit' ? null : b.next_contact_at, nowIso(), id);
      activity(db, id, 'status', b.status === 'unfit' ? `Đóng hồ sơ — không phù hợp: ${b.reason}` : `Phân loại: ${LEAD_STATUS[lead.status]} → ${LEAD_STATUS[b.status]}.`, req.user.id, { next: b.next_contact_at });
      if (b.status === 'unfit') closeLeadTasks(db, id, '');
    })();
    res.json({ ok: true });
  });

  // Đăng ký check-in: hẹn ngày khách lên trung tâm ⇒ đẩy "Đề xuất cần xử lý" cho tất cả CM
  r.post('/:id/book-checkin', can('leads.edit'), (req, res) => {
    const id = Number(req.params.id);
    const lead = loadLead(db, req.user, id);
    const b = parse(z.object({ checkin_at: nextContact, note: v.optText(500) }), req.body);
    if (!b.checkin_at) throw badRequest('Chọn ngày giờ khách lên check-in.', { checkin_at: 'Chọn ngày giờ check-in.' });
    if (b.checkin_at.slice(0, 10) < vnToday()) throw badRequest('Ngày check-in phải từ hôm nay.', { checkin_at: 'Ngày check-in phải từ hôm nay.' });
    if (lead.checked_in_at) throw conflict('Khách đã check-in rồi.');
    if (['enrolled', 'unfit'].includes(lead.status)) throw conflict('Hồ sơ đã đóng.');
    const cms = cmUsers(db);
    db.transaction(() => {
      db.prepare(`UPDATE leads SET status = 'checkin_booked', checkin_booked_at = ?, next_contact_at = ?, updated_at = ? WHERE id = ?`).run(b.checkin_at, b.checkin_at, nowIso(), id);
      activity(db, id, 'status', `Đăng ký check-in ${b.checkin_at.slice(0, 10).split('-').reverse().join('/')} lúc ${b.checkin_at.slice(11)}.${b.note ? ` ${b.note}` : ''}`, req.user.id, { next: b.checkin_at });
      for (const cm of cms) {
        proposeTask(db, {
          assigneeId: cm.id, title: `Đón khách check-in: ${lead.student_name} (PH ${lead.parent_name})`,
          description: `Khách của ${db.prepare('SELECT full_name FROM users WHERE id = ?').get(lead.owner_id)?.full_name || '—'} hẹn check-in lúc ${b.checkin_at.slice(11)} ngày ${b.checkin_at.slice(0, 10).split('-').reverse().join('/')}.${b.note ? ` Ghi chú: ${b.note}` : ''}`,
          dueDate: b.checkin_at.slice(0, 10), dueTime: b.checkin_at.slice(11), leadId: id, key: `lead-checkin:${id}:${cm.id}:${b.checkin_at}`, by: req.user.id,
        });
      }
    })();
    res.json({ ok: true, notified: cms.length });
  });

  // Khách check-in thực tế: nhân sự check-in TRƯỚC giữ khách
  r.post('/:id/checkin', can('leads.edit'), (req, res) => {
    const id = Number(req.params.id);
    const lead = loadLead(db, req.user, id);
    const b = parse(z.object({ staff_id: v.optId(), next_contact_at: nextContact }), req.body);
    if (['enrolled', 'unfit'].includes(lead.status)) throw conflict('Hồ sơ đã đóng.');
    const staffId = b.staff_id && has(req.user, 'leads.assign') ? b.staff_id : lead.owner_locked ? lead.owner_id : (lead.owner_id || req.user.id);
    db.transaction(() => {
      recordCheckin(db, { lead, staffId, user: req.user });
      if (b.next_contact_at) db.prepare('UPDATE leads SET next_contact_at = ? WHERE id = ?').run(b.next_contact_at, id);
    })();
    res.json({ ok: true });
  });

  // Đăng ký học thử: chọn lớp/buổi ⇒ đẩy "Đề xuất cần xử lý" cho CM của lớp đó. Hoặc kiểm tra đầu vào (lịch riêng).
  r.post('/:id/trials', can('leads.edit'), (req, res) => {
    const id = Number(req.params.id);
    const lead = loadLead(db, req.user, id);
    if (['enrolled', 'unfit'].includes(lead.status)) throw conflict('Hồ sơ đã đóng, không đặt lịch được.');
    const b = parse(z.object({
      type: z.enum(['trial', 'placement'], { error: 'Chọn loại lịch.' }),
      session_id: v.optId(),
      date: v.optDate(), start_time: z.string().optional().nullable(), end_time: z.string().optional().nullable(),
      room_id: v.optId(), teacher_id: v.optId(),
    }), req.body);
    const today = vnToday();
    let row;
    let cls = null;
    if (b.session_id) {
      const s = db.prepare(`SELECT * FROM class_sessions WHERE id = ? AND status = 'scheduled'`).get(b.session_id);
      if (!s) throw badRequest('Buổi học không hợp lệ hoặc đã hủy.', { session_id: 'Chọn buổi học còn hiệu lực.' });
      if (s.date < today) throw badRequest('Không đặt học thử vào buổi đã qua.', { session_id: 'Chọn buổi từ hôm nay trở đi.' });
      cls = s.class_id ? db.prepare('SELECT * FROM classes WHERE id = ?').get(s.class_id) : null;
      row = { date: s.date, start_time: s.start_time, end_time: s.end_time, session_id: s.id, room_id: s.room_id, teacher_id: s.teacher_id };
    } else {
      const fields = {};
      if (!b.date) fields.date = 'Vui lòng chọn ngày.';
      else if (b.date < today) fields.date = 'Ngày phải từ hôm nay trở đi.';
      if (!/^\d{2}:\d{2}$/.test(b.start_time || '')) fields.start_time = 'Giờ bắt đầu không hợp lệ.';
      if (!/^\d{2}:\d{2}$/.test(b.end_time || '')) fields.end_time = 'Giờ kết thúc không hợp lệ.';
      else if (b.start_time && b.end_time <= b.start_time) fields.end_time = 'Giờ kết thúc phải sau giờ bắt đầu.';
      if (!b.room_id) fields.room_id = 'Vui lòng chọn phòng.';
      if (!b.teacher_id) fields.teacher_id = 'Vui lòng chọn giáo viên.';
      if (Object.keys(fields).length) throw badRequest('Dữ liệu chưa hợp lệ, vui lòng kiểm tra các trường được đánh dấu.', fields);
      const conflicts = findConflicts(db, { date: b.date, start: b.start_time, end: b.end_time, roomId: b.room_id, teacherId: b.teacher_id });
      if (conflicts.length) throw conflict('Lịch bị trùng.', { conflicts });
      row = { date: b.date, start_time: b.start_time, end_time: b.end_time, session_id: null, room_id: b.room_id, teacher_id: b.teacher_id };
    }
    const ts = nowIso();
    const tid = db.transaction(() => {
      const tid = Number(db.prepare(`INSERT INTO trials(lead_id, type, date, start_time, end_time, session_id, room_id, teacher_id, status, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,'scheduled',?,?,?)`).run(id, b.type, row.date, row.start_time, row.end_time, row.session_id, row.room_id, row.teacher_id, req.user.id, ts, ts).lastInsertRowid);
      const when = `${row.date} ${row.start_time}`;
      db.prepare(`UPDATE leads SET status = 'trial_booked', trial_class_id = ?, next_contact_at = ?, updated_at = ? WHERE id = ?`).run(cls?.id ?? null, when, ts, id);
      activity(db, id, 'trial', `Đăng ký ${b.type === 'trial' ? 'học thử' : 'kiểm tra đầu vào'}${cls ? ` lớp ${cls.code}` : ''} ngày ${row.date.split('-').reverse().join('/')} lúc ${row.start_time}.`, req.user.id, { next: when });
      // Đề xuất xử lý cho CM của lớp (nếu lớp chưa có CM: giáo viên buổi đó)
      const cmId = cls?.homeroom_id || row.teacher_id;
      if (cmId) {
        proposeTask(db, {
          assigneeId: cmId, title: `Học thử${cls ? ` lớp ${cls.code}` : ''}: ${lead.student_name}`,
          description: `${b.type === 'trial' ? 'Học thử' : 'Kiểm tra đầu vào'} ngày ${row.date.split('-').reverse().join('/')} ${row.start_time}. Sau buổi học ghi kết quả để tư vấn chốt đăng ký.`,
          dueDate: row.date, dueTime: row.start_time, leadId: id, key: `lead-trial:${id}:${tid}`, by: req.user.id,
        });
      }
      return tid;
    })();
    res.status(201).json({ id: tid });
  });

  r.post('/trials/:tid/result', can('leads.edit', 'attendance.edit_own'), (req, res) => {
    const tid = Number(req.params.tid);
    const t = db.prepare('SELECT * FROM trials WHERE id = ?').get(tid);
    if (!t) throw notFound('Không tìm thấy lịch học thử.');
    const cls = t.session_id ? db.prepare('SELECT c.homeroom_id FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE s.id = ?').get(t.session_id) : null;
    if (!has(req.user, 'leads.edit') && t.teacher_id !== req.user.id && cls?.homeroom_id !== req.user.id) throw notFound('Không tìm thấy lịch học thử.');
    if (t.status !== 'scheduled') throw conflict('Lịch này đã được cập nhật kết quả.');
    const b = parse(z.object({
      status: z.enum(['done', 'no_show'], { error: 'Chọn kết quả.' }),
      score: v.optText(50), result_level: v.optText(80), recommended_course_id: v.optId(), teacher_comment: v.optText(1000),
    }), req.body);
    if (b.status === 'done' && !b.teacher_comment) throw badRequest('Vui lòng nhập nhận xét của giáo viên.', { teacher_comment: 'Vui lòng nhập nhận xét.' });
    const ts = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE trials SET status=?, score=?, result_level=?, recommended_course_id=?, teacher_comment=?, updated_at=? WHERE id=? AND status='scheduled'`)
        .run(b.status, b.score, b.result_level, b.recommended_course_id, b.teacher_comment, ts, tid);
      const lead = db.prepare('SELECT status FROM leads WHERE id = ?').get(t.lead_id);
      if (!['enrolled', 'unfit'].includes(lead.status)) {
        // Tư vấn gọi lại trong 1 ngày sau học thử
        db.prepare('UPDATE leads SET status = ?, interest_course_id = COALESCE(?, interest_course_id), next_contact_at = ?, updated_at = ? WHERE id = ?')
          .run(b.status === 'done' ? 'trial_done' : 'nurturing', b.recommended_course_id, `${addDays(vnToday(), 1)} 10:00`, ts, t.lead_id);
      }
      closeLeadTasks(db, t.lead_id, `lead-trial:${t.lead_id}:${tid}`);
      activity(db, t.lead_id, 'trial', b.status === 'done' ? `Kết quả ${t.type === 'trial' ? 'học thử' : 'kiểm tra'}: ${b.result_level || ''}${b.score ? ` — điểm ${b.score}` : ''}. ${b.teacher_comment}` : 'Khách không đến buổi học thử — chuyển Chăm sóc thêm.', req.user.id);
    })();
    res.json({ ok: true });
  });

  r.post('/trials/:tid/cancel', can('leads.edit'), (req, res) => {
    const tid = Number(req.params.tid);
    const t = db.prepare('SELECT * FROM trials WHERE id = ?').get(tid);
    if (!t) throw notFound('Không tìm thấy lịch học thử.');
    if (t.status !== 'scheduled') throw conflict('Chỉ hủy được lịch đang chờ.');
    const ts = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE trials SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(ts, tid);
      const left = db.prepare(`SELECT COUNT(*) n FROM trials WHERE lead_id = ? AND status = 'scheduled'`).get(t.lead_id).n;
      if (!left) db.prepare(`UPDATE leads SET status = CASE WHEN checked_in_at IS NOT NULL THEN 'checked_in' ELSE 'appointing' END, updated_at = ? WHERE id = ? AND status = 'trial_booked'`).run(ts, t.lead_id);
      closeLeadTasks(db, t.lead_id, `lead-trial:${t.lead_id}:${tid}`);
      activity(db, t.lead_id, 'trial', 'Hủy lịch học thử.', req.user.id);
    })();
    res.json({ ok: true });
  });

  // Chuyển khách thành học viên (+ tùy chọn tạo đăng ký khóa — học phí chờ Giám đốc duyệt). Gửi lại nhiều lần không tạo trùng học viên.
  r.post('/:id/convert', can('leads.convert'), (req, res) => {
    const id = Number(req.params.id);
    loadLead(db, req.user, id);
    const b = parse(z.object({
      student: z.object({ full_name: v.text(120, 'họ tên học viên'), dob: v.optDate(), gender: z.enum(['male', 'female']).optional().nullable(), school: v.optText(120) }),
      parent: z.object({
        mode: z.enum(['existing', 'new']),
        parent_id: v.optId(),
        full_name: v.optText(120), phone: v.optPhone(), email: v.optEmail(),
        relationship: z.enum(['Bố', 'Mẹ', 'Ông', 'Bà', 'Người giám hộ'], { error: 'Chọn quan hệ.' }),
      }),
      enrollment: z.object({
        course_id: v.id('khóa học'), package_id: v.optId(), class_id: v.optId(), enrolled_at: v.date('ngày đăng ký'),
        installments: z.array(z.object({ due_date: z.string(), amount: z.coerce.number() })),
        discount: z.object({ kind: z.enum(['percent', 'amount']), value: z.coerce.number().int(), reason: z.string() }).optional().nullable(),
      }).optional().nullable(),
    }), req.body);
    if (b.parent.mode === 'existing' && !b.parent.parent_id) throw badRequest('Chọn phụ huynh có sẵn.', { 'parent.parent_id': 'Chọn phụ huynh.' });
    if (b.parent.mode === 'new' && (!b.parent.full_name || !b.parent.phone)) {
      throw badRequest('Nhập tên và số điện thoại phụ huynh.', { ...(b.parent.full_name ? {} : { 'parent.full_name': 'Vui lòng nhập tên phụ huynh.' }), ...(b.parent.phone ? {} : { 'parent.phone': 'Vui lòng nhập số điện thoại.' }) });
    }

    const result = db.transaction(() => {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
      if (lead.converted_student_id) return { studentId: lead.converted_student_id, already: true };
      if (lead.status === 'unfit') throw conflict('Hồ sơ đang ở trạng thái Không phù hợp. Mở lại hồ sơ trước khi chuyển đổi.');
      const ts = nowIso();
      let parentId = b.parent.parent_id;
      if (b.parent.mode === 'new') {
        parentId = Number(db.prepare('INSERT INTO parents(full_name, phone, email, created_at) VALUES (?,?,?,?)').run(b.parent.full_name, b.parent.phone, b.parent.email, ts).lastInsertRowid);
      } else if (!db.prepare('SELECT 1 FROM parents WHERE id = ?').get(parentId)) {
        throw badRequest('Phụ huynh không tồn tại.');
      }
      const code = nextCode(db, 'student', 'HV-', 4);
      const studentId = Number(db.prepare(`INSERT INTO students(code, full_name, dob, gender, school, status, lead_id, created_at, updated_at) VALUES (?,?,?,?,?,'active',?,?,?)`)
        .run(code, b.student.full_name, b.student.dob, b.student.gender || null, b.student.school, id, ts, ts).lastInsertRowid);
      db.prepare('INSERT INTO student_contacts(student_id, parent_id, relationship, is_primary) VALUES (?,?,?,1)').run(studentId, parentId, b.parent.relationship);
      db.prepare(`UPDATE leads SET status = 'enrolled', converted_student_id = ?, converted_at = ?, parent_id = ?, next_contact_at = NULL, updated_at = ? WHERE id = ?`).run(studentId, ts, parentId, ts, id);
      activity(db, id, 'status', `Chuyển thành học viên ${code}.`, req.user.id);
      closeLeadTasks(db, id, '');
      logActivity(db, { entityType: 'student', entityId: studentId, action: 'created', summary: `Tạo hồ sơ học viên từ khách ${lead.code} (nguồn ${lead.source})`, userId: req.user.id });
      let enrollmentId = null;
      if (b.enrollment) {
        enrollmentId = createEnrollment(db, {
          studentId, courseId: b.enrollment.course_id, packageId: b.enrollment.package_id, classId: b.enrollment.class_id, enrolledAt: b.enrollment.enrolled_at,
          installments: b.enrollment.installments, discount: b.enrollment.discount || null, soldBy: lead.owner_id || req.user.id, user: req.user,
        }).id;
      }
      return { studentId, enrollmentId, already: false };
    })();
    res.status(result.already ? 200 : 201).json(result);
  });

  return r;
}
