import { nextCode, logActivity, notify, usersWithRole } from '../db/index.js';
import { nowIso, vnToday, addDays } from '../lib/time.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { validateInstallments, financeOf, rebalanceInstallments } from './finance.js';
import { sessionUsage } from './attendance.js';
import { findConflicts } from './schedule.js';
import { createApproval } from './approvals.js';
import { resolvePackage, enrollmentKind, packageRow } from './packages.js';

export function classOccupancy(db, classId) {
  return db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE class_id = ? AND status = 'active'`).get(classId).n;
}

/** Kiểm tra trước khi xếp học viên vào lớp: đúng khóa, còn chỗ, không trùng lịch với lớp khác của học viên. */
export function checkClassAssignment(db, { classId, courseId, studentId, today = vnToday() }) {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!cls) throw notFound('Không tìm thấy lớp.');
  if (['finished', 'cancelled'].includes(cls.status)) throw conflict('Lớp đã kết thúc hoặc đã hủy, không thể xếp thêm học viên.');
  if (cls.course_id !== courseId) throw conflict('Lớp không thuộc khóa học của đăng ký này.');
  const occ = classOccupancy(db, classId);
  if (occ >= cls.max_students) {
    throw conflict(`Lớp ${cls.code} đã đủ sĩ số (${occ}/${cls.max_students}). Chọn lớp khác hoặc điều chỉnh sĩ số tối đa trong thông tin lớp.`, { code: 'class_full' });
  }
  const already = db.prepare(`SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ? AND status = 'active'`).get(classId, studentId);
  if (already) throw conflict('Học viên đã có trong lớp này.');
  const future = db.prepare(`SELECT * FROM class_sessions WHERE class_id = ? AND date >= ? AND status != 'cancelled' ORDER BY date LIMIT 60`).all(classId, today);
  const conflicts = [];
  for (const s of future) {
    for (const c of findConflicts(db, { date: s.date, start: s.start_time, end: s.end_time, studentIds: [studentId], excludeSessionId: s.id })) {
      conflicts.push({ ...c, message: `${s.date.split('-').reverse().join('/')}: ${c.message}` });
    }
    if (conflicts.length >= 5) break;
  }
  if (conflicts.length) throw conflict('Học viên bị trùng lịch với lớp khác đang học.', { conflicts });
  return cls;
}

/** Quyền lợi theo gói: buổi nghỉ không tính phí + số lần bảo lưu. Không chọn gói: tỷ lệ theo gói 96 buổi (4 nghỉ, 1 bảo lưu). */
export function packageBenefits(pkg, sessions) {
  if (pkg) return { free: pkg.free_absences || 0, reserve: pkg.reserve_limit || 0 };
  return { free: Math.floor(sessions / 24), reserve: sessions >= 96 ? 1 : 0 };
}

export function createEnrollment(db, { studentId, courseId, packageId = null, classId = null, enrolledAt, installments, discount = null, note = null, previousEnrollmentId = null, idempotencyKey = null, soldBy = null, user }) {
  return db.transaction(() => {
    if (idempotencyKey) {
      const ex = db.prepare('SELECT id FROM enrollments WHERE idempotency_key = ?').get(idempotencyKey);
      if (ex) return { id: ex.id, duplicate: true };
    }
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
    if (!student) throw notFound('Không tìm thấy học viên.');
    if (student.status === 'archived') throw conflict('Hồ sơ học viên đã lưu trữ, không thể đăng ký mới.');
    const course = db.prepare(`SELECT * FROM courses WHERE id = ? AND status = 'active'`).get(courseId);
    if (!course) throw badRequest('Khóa học không hợp lệ.', { course_id: 'Vui lòng chọn khóa học đang mở.' });
    // Có gói phí: học phí = giá gói, số buổi = buổi tính phí + buổi tặng. Không chọn gói: theo khóa học.
    const pkg = packageId ? resolvePackage(db, { packageId, courseId }) : null;
    const fee = pkg ? pkg.price : course.tuition_fee;
    const bonus = pkg ? pkg.bonus_sessions : 0;
    const sessions = pkg ? pkg.sessions + pkg.bonus_sessions : course.total_sessions;
    const err = validateInstallments(installments, fee);
    if (err) throw badRequest(err, { installments: err });
    const dupActive = db.prepare(`SELECT code FROM enrollments WHERE student_id = ? AND course_id = ? AND status IN ('pending_approval','pending_class','active')`).get(studentId, courseId);
    if (dupActive) throw conflict(`Học viên đã có đăng ký ${dupActive.code} cho khóa này đang hiệu lực.`);
    if (previousEnrollmentId) {
      const prev = db.prepare('SELECT * FROM enrollments WHERE id = ? AND student_id = ?').get(previousEnrollmentId, studentId);
      if (!prev) throw badRequest('Đăng ký trước không thuộc học viên này.');
    }
    if (classId) checkClassAssignment(db, { classId, courseId, studentId });

    const ts = nowIso();
    const code = nextCode(db, 'enrollment', 'DK-', 4);
    const kind = enrollmentKind(db, studentId, previousEnrollmentId);
    // Học phí đăng ký mới / tái phí phải được Giám đốc trung tâm duyệt (Giám đốc tự tạo ⇒ có hiệu lực ngay)
    const director = !!user.perms?.has('approvals.decide');
    const status = director ? (classId ? 'active' : 'pending_class') : 'pending_approval';
    const ben = packageBenefits(pkg, sessions);
    const id = Number(db.prepare(`INSERT INTO enrollments(code, student_id, course_id, class_id, class_joined_at, status, enrolled_at, total_sessions, tuition_fee, previous_enrollment_id, note, idempotency_key, created_by, created_at, package_id, kind, bonus_sessions, free_absences, reserve_limit, sold_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, studentId, courseId, classId, classId && director ? vnToday() : null, status,
      enrolledAt, sessions, fee, previousEnrollmentId, note, idempotencyKey, user.id, ts, pkg?.id ?? null, kind, bonus, ben.free, ben.reserve, soldBy || user.id).lastInsertRowid);
    if (!director) {
      const aid = createApproval(db, {
        type: 'enrollment', title: `${kind === 'renew' ? 'Tái phí' : 'Đăng ký mới'} ${course.name} – ${student.full_name}`,
        description: `${code} · ${pkg ? pkg.name : 'Theo khóa học'} · ${sessions} buổi${classId ? ` · lớp ${db.prepare('SELECT code FROM classes WHERE id = ?').get(classId).code}` : ''}`,
        amount: fee, requestedBy: user.id, refType: 'enrollment', refId: id, payload: { enrollment_id: id },
      });
      db.prepare('UPDATE enrollments SET approval_id = ? WHERE id = ?').run(aid, id);
    }
    installments.forEach((p, i) => db.prepare('INSERT INTO installments(enrollment_id, seq, due_date, amount) VALUES (?,?,?,?)').run(id, i + 1, p.due_date, p.amount));
    if (student.status !== 'active') db.prepare(`UPDATE students SET status = 'active', updated_at = ? WHERE id = ?`).run(ts, studentId);
    db.prepare('UPDATE students SET level = ?, updated_at = ? WHERE id = ?').run(course.level, ts, studentId);
    logActivity(db, { entityType: 'enrollment', entityId: id, action: 'created', summary: `Đăng ký khóa ${course.name} (${code})`, userId: user.id });
    logActivity(db, { entityType: 'student', entityId: studentId, action: 'enrolled', summary: `Đăng ký khóa ${course.name} (${code})${pkg ? ` — ${pkg.name}` : ''}${kind === 'renew' ? ' — tái phí' : ''}`, userId: user.id });
    if (classId && director) {
      const cls = db.prepare('SELECT code FROM classes WHERE id = ?').get(classId);
      logActivity(db, { entityType: 'student', entityId: studentId, action: 'class_assigned', summary: `Xếp vào lớp ${cls.code}`, userId: user.id });
    }
    if (discount) requestDiscount(db, { enrollmentId: id, ...discount, user });
    if (previousEnrollmentId) {
      // Đóng việc chăm sóc tái đăng ký của khóa trước (nếu có)
      db.prepare(`UPDATE care_cases SET status = 'done', resolution = ?, resolved_at = ?, updated_at = ? WHERE source_key = ? AND status != 'done'`)
        .run(`Đã tái đăng ký khóa ${course.name} (${code})`, ts, ts, `renewal:${previousEnrollmentId}`);
    }
    return { id, duplicate: false, status };
  })();
}

/** Giám đốc duyệt học phí ⇒ đăng ký có hiệu lực: vào lớp đã chọn (nếu lớp còn chỗ) hoặc chờ xếp lớp */
export function activateEnrollment(db, { enrollmentId, user }) {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!e) throw notFound('Không tìm thấy đăng ký.');
  if (e.status !== 'pending_approval') return;
  let status = 'pending_class';
  let joined = null;
  if (e.class_id) {
    try {
      checkClassAssignment(db, { classId: e.class_id, courseId: e.course_id, studentId: e.student_id });
      status = 'active';
      joined = vnToday();
    } catch (err) {
      logActivity(db, { entityType: 'enrollment', entityId: e.id, action: 'class_pending', summary: `Chưa xếp được lớp đã chọn: ${err.message}`, userId: user.id });
    }
  }
  db.prepare('UPDATE enrollments SET status = ?, class_id = ?, class_joined_at = ? WHERE id = ?').run(status, status === 'active' ? e.class_id : null, joined, e.id);
  logActivity(db, { entityType: 'enrollment', entityId: e.id, action: 'approved', summary: 'Giám đốc duyệt học phí — đăng ký có hiệu lực', userId: user.id });
  logActivity(db, { entityType: 'student', entityId: e.student_id, action: 'enrollment_approved', summary: `Học phí ${e.code} đã được duyệt${status === 'active' ? '' : ' — chờ xếp lớp'}`, userId: user.id });
  if (status === 'active') {
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(e.class_id);
    const st = db.prepare('SELECT full_name FROM students WHERE id = ?').get(e.student_id);
    for (const uid of new Set([cls.teacher_id, cls.assistant_id, cls.homeroom_id])) notify(db, uid, { title: `Học viên mới vào lớp ${cls.code}`, body: st.full_name, link: `/classes/${cls.id}`, dedupeKey: `class-join:${e.id}:${cls.id}` });
  }
}

/** Chuyển lớp (đã duyệt 2 cấp): giữ nguyên học phí, số buổi đã học; cùng khóa học */
export function transferClass(db, { enrollmentId, classId, user }) {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!e) throw notFound('Không tìm thấy đăng ký.');
  if (!['active', 'pending_class'].includes(e.status)) throw conflict('Chỉ chuyển lớp cho đăng ký đang học hoặc chờ xếp lớp.');
  if (e.class_id === classId) throw conflict('Học viên đã ở lớp này.');
  const cls = checkClassAssignment(db, { classId, courseId: e.course_id, studentId: e.student_id });
  const old = e.class_id ? db.prepare('SELECT code FROM classes WHERE id = ?').get(e.class_id).code : '—';
  db.prepare(`UPDATE enrollments SET class_id = ?, class_joined_at = ?, status = 'active' WHERE id = ?`).run(classId, vnToday(), e.id);
  db.prepare(`UPDATE makeups SET status = 'cancelled', note = 'Hủy do chuyển lớp' WHERE enrollment_id = ? AND status = 'scheduled'`).run(e.id);
  logActivity(db, { entityType: 'student', entityId: e.student_id, action: 'class_transferred', summary: `Chuyển lớp ${old} → ${cls.code}`, userId: user.id });
  logActivity(db, { entityType: 'enrollment', entityId: e.id, action: 'class_transferred', summary: `Chuyển lớp ${old} → ${cls.code}`, userId: user.id });
  return cls;
}

/** Lên level mới (đã duyệt 2 cấp): đăng ký chuyển sang khóa cao hơn + lớp mới, giữ học phí và số buổi còn lại */
export function levelUp(db, { enrollmentId, courseId, classId = null, user }) {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!e) throw notFound('Không tìm thấy đăng ký.');
  if (!['active', 'pending_class'].includes(e.status)) throw conflict('Chỉ lên level cho đăng ký đang học hoặc chờ xếp lớp.');
  const course = db.prepare(`SELECT * FROM courses WHERE id = ? AND status = 'active'`).get(courseId);
  if (!course) throw badRequest('Khóa học mới không hợp lệ.');
  if (courseId === e.course_id) throw conflict('Khóa mới phải khác khóa hiện tại.');
  if (classId) checkClassAssignment(db, { classId, courseId, studentId: e.student_id });
  const oldCourse = db.prepare('SELECT name FROM courses WHERE id = ?').get(e.course_id).name;
  db.prepare(`UPDATE enrollments SET course_id = ?, class_id = ?, class_joined_at = ?, status = ? WHERE id = ?`)
    .run(courseId, classId, classId ? vnToday() : null, classId ? 'active' : 'pending_class', e.id);
  db.prepare('UPDATE students SET level = ?, updated_at = ? WHERE id = ?').run(course.level, nowIso(), e.student_id);
  const text = `Lên level: ${oldCourse} → ${course.name}${classId ? ` (lớp ${db.prepare('SELECT code FROM classes WHERE id = ?').get(classId).code})` : ''}`;
  logActivity(db, { entityType: 'student', entityId: e.student_id, action: 'level_up', summary: text, userId: user.id });
  logActivity(db, { entityType: 'enrollment', entityId: e.id, action: 'level_up', summary: text, userId: user.id });
}

export function requestDiscount(db, { enrollmentId, kind, value, reason, user }) {
  const e = db.prepare(`SELECT e.*, s.full_name FROM enrollments e JOIN students s ON s.id = e.student_id WHERE e.id = ?`).get(enrollmentId);
  if (!e) throw notFound('Không tìm thấy đăng ký.');
  if (e.status === 'cancelled') throw conflict('Đăng ký đã hủy.');
  if (!['percent', 'amount'].includes(kind)) throw badRequest('Loại giảm phí không hợp lệ.', { kind: 'Chọn loại giảm phí.' });
  if (!Number.isInteger(value) || value <= 0) throw badRequest('Giá trị giảm phải là số nguyên dương.', { value: 'Giá trị giảm phải là số nguyên dương.' });
  if (kind === 'percent' && value > 50) throw badRequest('Giảm theo phần trăm tối đa 50%.', { value: 'Tối đa 50%.' });
  const amount = kind === 'percent' ? Math.round((e.tuition_fee * value) / 100 / 1000) * 1000 : value;
  const existing = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM discounts WHERE enrollment_id = ? AND status IN ('approved','pending')`).get(enrollmentId).s;
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM receipts WHERE enrollment_id = ? AND status = 'confirmed'`).get(enrollmentId).s;
  if (existing + amount > e.tuition_fee - paid) {
    throw badRequest('Tổng giảm phí vượt quá số học phí còn phải thu.', { value: 'Tổng giảm phí vượt quá số học phí còn phải thu.' });
  }
  if (!reason || !reason.trim()) throw badRequest('Vui lòng nhập lý do giảm phí.', { reason: 'Vui lòng nhập lý do giảm phí.' });
  const pending = db.prepare(`SELECT 1 FROM discounts WHERE enrollment_id = ? AND status = 'pending'`).get(enrollmentId);
  if (pending) throw conflict('Đăng ký này đã có một đề nghị giảm phí đang chờ duyệt.');
  const did = Number(db.prepare(`INSERT INTO discounts(enrollment_id, kind, value, amount, reason, status, requested_by, created_at) VALUES (?,?,?,?,?,'pending',?,?)`)
    .run(enrollmentId, kind, value, amount, reason.trim(), user.id, nowIso()).lastInsertRowid);
  const aid = createApproval(db, {
    type: 'discount', title: `Giảm ${kind === 'percent' ? `${value}%` : `${amount.toLocaleString('vi-VN')} đ`} học phí – ${e.full_name}`,
    description: reason.trim(), amount, requestedBy: user.id, refType: 'discount', refId: did,
  });
  db.prepare('UPDATE discounts SET approval_id = ? WHERE id = ?').run(aid, did);
  logActivity(db, { entityType: 'enrollment', entityId: enrollmentId, action: 'discount_requested', summary: `Đề nghị giảm phí ${amount.toLocaleString('vi-VN')} đ, chờ quản lý duyệt`, userId: user.id });
  return { discountId: did, approvalId: aid };
}

export function assignClass(db, { enrollmentId, classId, user }) {
  return db.transaction(() => {
    const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
    if (!e) throw notFound('Không tìm thấy đăng ký.');
    if (!['pending_class', 'active', 'reserved'].includes(e.status)) throw conflict('Đăng ký không ở trạng thái có thể xếp lớp.');
    if (e.class_id === classId && e.status === 'active') throw conflict('Học viên đã ở lớp này.');
    if (e.status === 'reserved' && e.class_id && e.class_id !== classId) {
      const marked = db.prepare('SELECT COUNT(*) n FROM attendance WHERE enrollment_id = ?').get(enrollmentId).n;
      if (marked > 0) throw conflict('Đăng ký đã có điểm danh ở lớp cũ. Bản demo chỉ cho quay lại đúng lớp cũ sau bảo lưu.');
    }
    if (e.class_id && e.status === 'active') {
      const marked = db.prepare('SELECT COUNT(*) n FROM attendance WHERE enrollment_id = ?').get(enrollmentId).n;
      if (marked > 0) throw conflict('Học viên đã có điểm danh ở lớp hiện tại. Chuyển lớp giữa khóa chưa được hỗ trợ trong bản demo.');
    }
    const cls = checkClassAssignment(db, { classId, courseId: e.course_id, studentId: e.student_id });
    db.prepare(`UPDATE enrollments SET class_id = ?, class_joined_at = ?, status = 'active' WHERE id = ?`).run(classId, vnToday(), enrollmentId);
    db.prepare(`UPDATE students SET status = 'active', updated_at = ? WHERE id = ? AND status IN ('reserved','inactive')`).run(nowIso(), e.student_id);
    logActivity(db, { entityType: 'student', entityId: e.student_id, action: 'class_assigned', summary: `Xếp vào lớp ${cls.code}`, userId: user.id });
    logActivity(db, { entityType: 'enrollment', entityId: enrollmentId, action: 'class_assigned', summary: `Xếp vào lớp ${cls.code}`, userId: user.id });
    for (const uid of [cls.teacher_id, cls.assistant_id]) {
      const st = db.prepare('SELECT full_name FROM students WHERE id = ?').get(e.student_id);
      notify(db, uid, { title: `Học viên mới vào lớp ${cls.code}`, body: st.full_name, link: `/classes/${cls.id}`, dedupeKey: `class-join:${enrollmentId}:${classId}` });
    }
    return cls;
  })();
}

export function cancelEnrollment(db, { enrollmentId, reason, user }) {
  return db.transaction(() => {
    const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
    if (!e) throw notFound('Không tìm thấy đăng ký.');
    if (['cancelled', 'completed'].includes(e.status)) throw conflict('Đăng ký đã kết thúc hoặc đã hủy.');
    db.prepare(`UPDATE enrollments SET status = 'cancelled', cancel_reason = ? WHERE id = ?`).run(reason, enrollmentId);
    db.prepare(`UPDATE makeups SET status = 'cancelled' WHERE enrollment_id = ? AND status = 'scheduled'`).run(enrollmentId);
    logActivity(db, { entityType: 'student', entityId: e.student_id, action: 'enrollment_cancelled', summary: `Hủy đăng ký ${e.code}: ${reason}`, userId: user.id });
    logActivity(db, { entityType: 'enrollment', entityId: enrollmentId, action: 'cancelled', summary: `Hủy đăng ký: ${reason}`, userId: user.id });
    for (const m of usersWithRole(db, 'manager')) notify(db, m, { title: `Đăng ký ${e.code} đã hủy`, body: reason, link: `/students/${e.student_id}?tab=finance`, dedupeKey: `enroll-cancel:${enrollmentId}` });
  })();
}

// Bảo lưu: gói 1 năm (96 buổi) được 1 lần, tối thiểu 2 tuần, tối đa 3 tháng
export const RESERVE_MIN_DAYS = 14;
export const RESERVE_MAX_DAYS = 92;
export function reserveCheck(e, from, to, today = vnToday()) {
  if (!['active', 'pending_class'].includes(e.status)) return 'Chỉ bảo lưu được đăng ký đang học hoặc chờ xếp lớp.';
  if (e.reserve_count >= e.reserve_limit) return e.reserve_limit ? `Gói phí chỉ được bảo lưu ${e.reserve_limit} lần, đã dùng hết.` : 'Gói phí này không có quyền bảo lưu (chỉ gói 1 năm – 96 buổi).';
  if (!from || !to) return 'Chọn ngày bắt đầu và kết thúc bảo lưu.';
  if (from < today) return 'Ngày bắt đầu bảo lưu phải từ hôm nay.';
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days < RESERVE_MIN_DAYS) return `Bảo lưu tối thiểu 2 tuần (đang chọn ${days} ngày).`;
  if (days > RESERVE_MAX_DAYS) return `Bảo lưu tối đa 3 tháng (đang chọn ${days} ngày).`;
  return null;
}

/** Bảo lưu: rời lớp (giải phóng chỗ), giữ nguyên học phí/công nợ và số buổi đã học; hết hạn bảo lưu thì xếp lại lớp. */
export function reserveEnrollment(db, { enrollmentId, reason, from = null, to = null, user }) {
  return db.transaction(() => {
    const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
    if (!e) throw notFound('Không tìm thấy đăng ký.');
    if (!from) { from = vnToday(); to = addDays(from, RESERVE_MIN_DAYS - 1); }
    const err = reserveCheck(e, from, to, from < vnToday() ? from : vnToday());
    if (err) throw conflict(err);
    db.prepare(`UPDATE enrollments SET status = 'reserved', note = ?, reserved_from = ?, reserved_to = ?, reserve_count = reserve_count + 1 WHERE id = ?`)
      .run(`Bảo lưu ${from.split('-').reverse().join('/')} – ${to.split('-').reverse().join('/')}: ${reason}`, from, to, enrollmentId);
    // Nhắc chủ nhiệm lớp xếp lại lớp khi hết bảo lưu
    const cls = e.class_id ? db.prepare('SELECT homeroom_id, code FROM classes WHERE id = ?').get(e.class_id) : null;
    const st = db.prepare('SELECT full_name FROM students WHERE id = ?').get(e.student_id);
    const assignee = cls?.homeroom_id || user.id;
    db.prepare(`INSERT INTO tasks(code, title, description, status, priority, assignee_id, created_by, due_date, related_type, related_id, source_key, position, created_at, updated_at)
      VALUES (?,?,?,'todo','high',?,?,?,'student',?,?,0,?,?) ON CONFLICT(source_key) DO NOTHING`)
      .run(nextCode(db, 'task', 'CV-', 4), `Hết bảo lưu: xếp lại lớp cho ${st.full_name}`, `Đăng ký ${e.code} bảo lưu đến ${to.split('-').reverse().join('/')}${cls ? ` (lớp cũ ${cls.code})` : ''}.`,
        assignee, user.id, addDays(to, 1), e.student_id, `reserve-end:${e.id}:${to}`, nowIso(), nowIso());
    db.prepare(`UPDATE makeups SET status = 'cancelled', note = 'Hủy do bảo lưu' WHERE enrollment_id = ? AND status = 'scheduled'`).run(enrollmentId);
    const stillActive = db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE student_id = ? AND status IN ('active','pending_class')`).get(e.student_id).n;
    if (!stillActive) db.prepare(`UPDATE students SET status = 'reserved', updated_at = ? WHERE id = ?`).run(nowIso(), e.student_id);
    logActivity(db, { entityType: 'student', entityId: e.student_id, action: 'reserved', summary: `Bảo lưu đăng ký ${e.code}: ${reason}`, userId: user.id });
    logActivity(db, { entityType: 'enrollment', entityId: enrollmentId, action: 'reserved', summary: `Bảo lưu: ${reason}`, userId: user.id });
  })();
}

/**
 * Đổi gói phí của đăng ký (chạy khi đề xuất "Đổi gói phí" được duyệt).
 * Học phí, số buổi theo gói mới; lịch thanh toán: thêm đợt mới cho phần tăng (hạn 7 ngày) hoặc trừ dần đợt cuối nếu giảm.
 * Không cho đổi sang gói thấp hơn số đã thu hoặc ít buổi hơn số buổi đã dùng.
 */
export function applyPackageChange(db, { enrollmentId, packageId, user }) {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!e) throw notFound('Không tìm thấy đăng ký.');
  if (['cancelled', 'completed'].includes(e.status)) throw conflict('Đăng ký đã kết thúc hoặc đã hủy.');
  const p = resolvePackage(db, { packageId, courseId: e.course_id });
  if (p.id === e.package_id) throw conflict('Đăng ký đang dùng gói phí này.');
  const f = financeOf(db, enrollmentId);
  const newNet = p.price - f.discount;
  if (newNet < f.paid) throw conflict(`Gói mới (${newNet.toLocaleString('vi-VN')} đ sau giảm) thấp hơn số đã thu (${f.paid.toLocaleString('vi-VN')} đ). Cần đề nghị hoàn phí phần chênh lệch.`);
  const used = sessionUsage(db, [enrollmentId]).get(enrollmentId)?.used || 0;
  const total = p.sessions + p.bonus_sessions;
  if (total < used) throw conflict(`Gói mới có ${total} buổi, ít hơn số buổi đã học (${used}).`);
  const old = e.package_id ? packageRow(db, e.package_id)?.name : 'Theo khóa học';
  db.prepare('UPDATE enrollments SET package_id = ?, tuition_fee = ?, total_sessions = ?, bonus_sessions = ?, free_absences = ?, reserve_limit = ? WHERE id = ?')
    .run(p.id, p.price, total, p.bonus_sessions, p.free_absences || 0, p.reserve_limit || 0, enrollmentId);
  const planned = db.prepare('SELECT COALESCE(SUM(amount),0) s, COALESCE(MAX(seq),0) m FROM installments WHERE enrollment_id = ?').get(enrollmentId);
  if (newNet > planned.s) {
    db.prepare('INSERT INTO installments(enrollment_id, seq, due_date, amount) VALUES (?,?,?,?)').run(enrollmentId, planned.m + 1, addDays(vnToday(), 7), newNet - planned.s);
  } else if (newNet < planned.s) rebalanceInstallments(db, enrollmentId);
  const text = `Đổi gói phí: ${old} → ${p.name} (${p.price.toLocaleString('vi-VN')} đ, ${total} buổi)`;
  logActivity(db, { entityType: 'enrollment', entityId: enrollmentId, action: 'package_changed', summary: text, userId: user.id });
  logActivity(db, { entityType: 'student', entityId: e.student_id, action: 'package_changed', summary: `${e.code}: ${text}`, userId: user.id });
}
