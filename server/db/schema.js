// Migration theo PRAGMA user_version. Thêm migration mới vào cuối mảng, không sửa migration cũ.
export const migrations = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE app_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Nhân sự kiêm tài khoản đăng nhập
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    title TEXT,
    phone TEXT,
    email TEXT,
    employment TEXT NOT NULL DEFAULT 'full_time',   -- full_time | part_time
    status TEXT NOT NULL DEFAULT 'active',           -- active | inactive
    username TEXT UNIQUE,
    password_hash TEXT,
    is_demo INTEGER NOT NULL DEFAULT 1,
    joined_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL,                               -- manager | consultant | academic | teacher | cashier | operations
    PRIMARY KEY (user_id, role)
  );

  CREATE TABLE rooms (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    capacity INTEGER NOT NULL,
    floor TEXT,
    status TEXT NOT NULL DEFAULT 'active'             -- active | maintenance
  );

  CREATE TABLE courses (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    program TEXT NOT NULL,
    level TEXT NOT NULL,
    age_range TEXT,
    total_sessions INTEGER NOT NULL,
    session_minutes INTEGER NOT NULL DEFAULT 90,
    tuition_fee INTEGER NOT NULL,                     -- VNĐ, số nguyên
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',            -- active | archived
    next_course_id INTEGER REFERENCES courses(id)
  );

  CREATE TABLE classes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    course_id INTEGER NOT NULL REFERENCES courses(id),
    room_id INTEGER REFERENCES rooms(id),
    teacher_id INTEGER REFERENCES users(id),
    assistant_id INTEGER REFERENCES users(id),
    max_students INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    schedule_json TEXT NOT NULL DEFAULT '[]',          -- [{weekday:1..7,start:'18:00',end:'19:30'}]
    status TEXT NOT NULL DEFAULT 'active',            -- planned | active | finished | cancelled
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE class_sessions (
    id INTEGER PRIMARY KEY,
    class_id INTEGER REFERENCES classes(id),          -- NULL: buổi học bù riêng
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    room_id INTEGER REFERENCES rooms(id),
    teacher_id INTEGER REFERENCES users(id),
    assistant_id INTEGER REFERENCES users(id),
    kind TEXT NOT NULL DEFAULT 'regular',             -- regular | makeup | trial
    seq_no INTEGER,
    status TEXT NOT NULL DEFAULT 'scheduled',         -- scheduled | done | cancelled
    cancel_reason TEXT,
    topic TEXT,
    teacher_note TEXT,
    attendance_saved_at TEXT,
    attendance_saved_by INTEGER REFERENCES users(id),
    title TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_date ON class_sessions(date);
  CREATE INDEX idx_sessions_class ON class_sessions(class_id);

  CREATE TABLE parents (
    id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    occupation TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_parents_phone ON parents(phone);

  CREATE TABLE leads (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    parent_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    student_name TEXT NOT NULL,
    student_dob TEXT,
    school TEXT,
    interest_course_id INTEGER REFERENCES courses(id),
    source TEXT NOT NULL,
    owner_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'new',               -- new | contacted | trial_scheduled | trial_done | enrolled | unfit
    next_contact_at TEXT,                             -- 'YYYY-MM-DD HH:MM' giờ VN
    note TEXT,
    unfit_reason TEXT,
    parent_id INTEGER REFERENCES parents(id),
    converted_student_id INTEGER,
    converted_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_leads_phone ON leads(phone);

  CREATE TABLE lead_activities (
    id INTEGER PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    type TEXT NOT NULL,                               -- call | message | meeting | note | status | trial
    content TEXT NOT NULL,
    result TEXT,
    next_contact_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE trials (
    id INTEGER PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    type TEXT NOT NULL,                               -- trial | placement
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    session_id INTEGER REFERENCES class_sessions(id), -- học thử ghép vào buổi có sẵn
    room_id INTEGER REFERENCES rooms(id),
    teacher_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'scheduled',         -- scheduled | done | no_show | cancelled
    score TEXT,
    result_level TEXT,
    recommended_course_id INTEGER REFERENCES courses(id),
    teacher_comment TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE students (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    dob TEXT,
    gender TEXT,                                      -- male | female
    school TEXT,
    level TEXT,
    status TEXT NOT NULL DEFAULT 'active',            -- active | reserved | inactive | archived
    archived_reason TEXT,
    lead_id INTEGER REFERENCES leads(id),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_students_lead ON students(lead_id) WHERE lead_id IS NOT NULL;

  CREATE TABLE student_contacts (
    student_id INTEGER NOT NULL REFERENCES students(id),
    parent_id INTEGER NOT NULL REFERENCES parents(id),
    relationship TEXT NOT NULL,                       -- Bố | Mẹ | Ông | Bà | Người giám hộ
    is_primary INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (student_id, parent_id)
  );

  CREATE TABLE enrollments (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    student_id INTEGER NOT NULL REFERENCES students(id),
    course_id INTEGER NOT NULL REFERENCES courses(id),
    class_id INTEGER REFERENCES classes(id),
    class_joined_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending_class',     -- pending_class | active | completed | reserved | cancelled
    enrolled_at TEXT NOT NULL,                        -- ngày đăng ký (YYYY-MM-DD)
    total_sessions INTEGER NOT NULL,
    tuition_fee INTEGER NOT NULL,                     -- học phí niêm yết tại thời điểm đăng ký
    previous_enrollment_id INTEGER REFERENCES enrollments(id),
    cancel_reason TEXT,
    note TEXT,
    idempotency_key TEXT UNIQUE,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_enroll_student ON enrollments(student_id);
  CREATE INDEX idx_enroll_class ON enrollments(class_id);

  CREATE TABLE installments (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
    seq INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    UNIQUE (enrollment_id, seq)
  );

  CREATE TABLE discounts (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
    kind TEXT NOT NULL,                               -- percent | amount
    value INTEGER NOT NULL,
    amount INTEGER NOT NULL,                          -- số tiền giảm quy đổi (VNĐ)
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',           -- pending | approved | rejected
    approval_id INTEGER,
    requested_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE receipts (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    paid_at TEXT NOT NULL,                            -- ngày thu (YYYY-MM-DD)
    method TEXT NOT NULL,                             -- cash | transfer | card
    payer_name TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',         -- confirmed | cancelled
    collected_by INTEGER REFERENCES users(id),
    cancel_reason TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancelled_at TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_receipts_enroll ON receipts(enrollment_id);

  CREATE TABLE refunds (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',         -- requested | approved | rejected | paid
    approval_id INTEGER,
    paid_at TEXT,
    paid_by INTEGER REFERENCES users(id),
    method TEXT,
    requested_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE attendance (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES class_sessions(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    enrollment_id INTEGER REFERENCES enrollments(id),
    status TEXT NOT NULL,                             -- present | late | excused | absent
    note TEXT,
    is_makeup INTEGER NOT NULL DEFAULT 0,
    makeup_id INTEGER,
    marked_by INTEGER REFERENCES users(id),
    marked_at TEXT NOT NULL,
    UNIQUE (session_id, student_id)
  );

  CREATE TABLE makeups (
    id INTEGER PRIMARY KEY,
    absence_attendance_id INTEGER NOT NULL UNIQUE REFERENCES attendance(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    enrollment_id INTEGER REFERENCES enrollments(id),
    makeup_session_id INTEGER NOT NULL REFERENCES class_sessions(id),
    status TEXT NOT NULL DEFAULT 'scheduled',         -- scheduled | done | missed | cancelled
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE care_cases (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    student_id INTEGER NOT NULL REFERENCES students(id),
    enrollment_id INTEGER REFERENCES enrollments(id),
    type TEXT NOT NULL,                               -- absence | feedback | complaint | renewal | payment | general
    title TEXT NOT NULL,
    content TEXT,
    status TEXT NOT NULL DEFAULT 'new',               -- new | in_progress | waiting | done
    priority TEXT NOT NULL DEFAULT 'normal',          -- low | normal | high
    owner_id INTEGER REFERENCES users(id),
    due_date TEXT,
    source_key TEXT UNIQUE,                           -- khoá chống sinh trùng khi chạy lại nhắc việc
    attendance_id INTEGER REFERENCES attendance(id),
    resolution TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE care_logs (
    id INTEGER PRIMARY KEY,
    case_id INTEGER NOT NULL REFERENCES care_cases(id),
    channel TEXT NOT NULL,                            -- call | zalo | sms | meeting | email
    content TEXT NOT NULL,
    result TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',              -- todo | in_progress | review | done
    priority TEXT NOT NULL DEFAULT 'normal',          -- low | normal | high | urgent
    assignee_id INTEGER REFERENCES users(id),
    created_by INTEGER REFERENCES users(id),
    due_date TEXT,
    due_time TEXT,
    related_type TEXT,                                -- asset_issue | care_case | lead | approval
    related_id INTEGER,
    template_key TEXT,
    source_key TEXT UNIQUE,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE task_items (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    done_by INTEGER REFERENCES users(id),
    done_at TEXT
  );
  CREATE TABLE task_comments (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE work_shifts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    note TEXT
  );

  CREATE TABLE leave_requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,                               -- annual | sick | personal
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',           -- pending | approved | rejected
    approval_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE teaching_logs (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES class_sessions(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL,                               -- teacher | assistant
    minutes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',           -- pending | approved | rejected
    note TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    review_note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, user_id)
  );

  CREATE TABLE approvals (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,                               -- purchase | expense | leave | discount | refund
    title TEXT NOT NULL,
    description TEXT,
    amount INTEGER,
    requested_by INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',           -- pending | approved | rejected | cancelled
    ref_type TEXT,
    ref_id INTEGER,
    decided_by INTEGER REFERENCES users(id),
    decided_at TEXT,
    decision_note TEXT,
    payment_status TEXT NOT NULL DEFAULT 'none',      -- none | unpaid | paid
    paid_at TEXT,
    paid_by INTEGER REFERENCES users(id),
    payment_method TEXT,
    payment_note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE approval_events (
    id INTEGER PRIMARY KEY,
    approval_id INTEGER NOT NULL REFERENCES approvals(id),
    action TEXT NOT NULL,                             -- created | approved | rejected | paid | cancelled
    user_id INTEGER REFERENCES users(id),
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE assets (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    room_id INTEGER REFERENCES rooms(id),
    location_note TEXT,
    status TEXT NOT NULL DEFAULT 'good',              -- good | damaged | repairing | disposed
    purchased_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE asset_issues (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'normal',          -- low | normal | high
    status TEXT NOT NULL DEFAULT 'reported',          -- reported | in_progress | waiting_approval | resolved | cancelled
    reported_by INTEGER REFERENCES users(id),
    handler_id INTEGER REFERENCES users(id),
    task_id INTEGER REFERENCES tasks(id),
    approval_id INTEGER REFERENCES approvals(id),
    resolution TEXT,
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE materials (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,                               -- textbook | supply
    unit TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    min_stock INTEGER NOT NULL DEFAULT 0,
    course_id INTEGER REFERENCES courses(id),
    note TEXT
  );
  CREATE TABLE stock_moves (
    id INTEGER PRIMARY KEY,
    material_id INTEGER NOT NULL REFERENCES materials(id),
    type TEXT NOT NULL,                               -- in | out
    qty INTEGER NOT NULL CHECK (qty > 0),
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    student_id INTEGER REFERENCES students(id),
    class_id INTEGER REFERENCES classes(id),
    idempotency_key TEXT UNIQUE,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE notices (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all',             -- 'all' hoặc danh sách vai trò, ví dụ 'teacher,academic'
    pinned INTEGER NOT NULL DEFAULT 0,
    external_status TEXT NOT NULL DEFAULT 'internal_only', -- internal_only | sent_manually
    external_note TEXT,
    external_marked_by INTEGER REFERENCES users(id),
    external_marked_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE notice_reads (
    notice_id INTEGER NOT NULL REFERENCES notices(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    read_at TEXT NOT NULL,
    PRIMARY KEY (notice_id, user_id)
  );

  -- Thông báo hệ thống trong app (chuông), không gửi ra ngoài
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    dedupe_key TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, dedupe_key)
  );

  -- Nhật ký nghiệp vụ dùng chung để hiển thị lịch sử
  CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id);

  CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `,
  // v2: gói phí & tái phí, chủ nhiệm lớp, BTVN/điểm/nhận xét, check-in, bổ trợ học tập, số dư, tag, file đính kèm đề xuất
  `
  CREATE TABLE fee_packages (
    id INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'new',                 -- new (học viên mới) | renew (tái phí)
    sessions INTEGER NOT NULL,                        -- số buổi tính phí
    bonus_sessions INTEGER NOT NULL DEFAULT 0,        -- buổi tặng
    months INTEGER,                                   -- thời lượng dự kiến (tháng), chỉ để hiển thị
    price INTEGER NOT NULL,                           -- VNĐ
    note TEXT,
    status TEXT NOT NULL DEFAULT 'active',            -- active | archived
    created_at TEXT NOT NULL
  );
  ALTER TABLE enrollments ADD COLUMN package_id INTEGER REFERENCES fee_packages(id);
  ALTER TABLE enrollments ADD COLUMN kind TEXT NOT NULL DEFAULT 'new';           -- new | renew
  ALTER TABLE enrollments ADD COLUMN bonus_sessions INTEGER NOT NULL DEFAULT 0;   -- đã gồm trong total_sessions

  ALTER TABLE classes ADD COLUMN homeroom_id INTEGER REFERENCES users(id);         -- chủ nhiệm lớp (CM)
  ALTER TABLE class_sessions ADD COLUMN homework TEXT;                             -- BTVN giao sau buổi học
  ALTER TABLE attendance ADD COLUMN homework_status TEXT;                          -- done | partial | missing (NULL: chưa chấm)
  ALTER TABLE attendance ADD COLUMN homework_score REAL;                           -- điểm BTVN thang 10
  ALTER TABLE attendance ADD COLUMN comment TEXT;                                  -- nhận xét riêng từng học viên
  ALTER TABLE students ADD COLUMN tags TEXT NOT NULL DEFAULT '';                   -- danh sách tag, phân tách bằng dấu phẩy
  ALTER TABLE approvals ADD COLUMN payload TEXT;                                   -- JSON tham số cho đề xuất có tác động khi duyệt

  -- Điểm kiểm tra (giữa khóa, cuối khóa, unit test…)
  CREATE TABLE assessments (
    id INTEGER PRIMARY KEY,
    class_id INTEGER REFERENCES classes(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    enrollment_id INTEGER REFERENCES enrollments(id),
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'unit',                -- unit | midterm | final | mock
    score REAL NOT NULL,
    max_score REAL NOT NULL DEFAULT 10,
    taken_at TEXT NOT NULL,
    comment TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_assess_student ON assessments(student_id);

  -- Check-in tại quầy khi học viên đến trung tâm (mỗi học viên tối đa 1 lần/ngày)
  CREATE TABLE checkins (
    id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    date TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    session_id INTEGER REFERENCES class_sessions(id),
    checked_by INTEGER REFERENCES users(id),
    note TEXT,
    UNIQUE (student_id, date)
  );

  -- Rà soát bổ trợ học tập hằng tháng
  CREATE TABLE support_reviews (
    student_id INTEGER NOT NULL REFERENCES students(id),
    month TEXT NOT NULL,                              -- YYYY-MM
    status TEXT NOT NULL,                             -- confirmed (đã xác nhận bổ trợ) | not_needed
    note TEXT,
    case_id INTEGER REFERENCES care_cases(id),
    decided_by INTEGER REFERENCES users(id),
    decided_at TEXT NOT NULL,
    PRIMARY KEY (student_id, month)
  );

  -- Số dư học viên: nạp tiền (tiền vào thật) / trừ số dư khi đóng học phí / chuyển số dư
  CREATE TABLE wallet_entries (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    student_id INTEGER NOT NULL REFERENCES students(id),
    kind TEXT NOT NULL,                               -- topup | apply | transfer_in | transfer_out
    amount INTEGER NOT NULL,                          -- dương: cộng vào số dư, âm: trừ khỏi số dư
    method TEXT,                                      -- cash | transfer | card (chỉ với topup)
    paid_at TEXT NOT NULL,
    payer_name TEXT,
    receipt_id INTEGER REFERENCES receipts(id),
    approval_id INTEGER REFERENCES approvals(id),
    note TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',         -- confirmed | cancelled
    cancel_reason TEXT,
    cancelled_by INTEGER REFERENCES users(id),
    cancelled_at TEXT,
    idempotency_key TEXT UNIQUE,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_wallet_student ON wallet_entries(student_id);

  CREATE TABLE approval_files (
    id INTEGER PRIMARY KEY,
    approval_id INTEGER NOT NULL REFERENCES approvals(id),
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  `,
  // v3: khớp yêu cầu trung tâm — phân loại khách & quyền giữ khách theo check-in, học phí qua Giám đốc duyệt,
  // duyệt 2 cấp, nghỉ không tính phí theo gói, bảo lưu theo gói, nghỉ do trung tâm, lịch test/họp PH, sự cố phòng học, thẻ tín dụng
  `
  ALTER TABLE leads ADD COLUMN checkin_booked_at TEXT;                -- ngày giờ hẹn khách lên check-in (YYYY-MM-DD HH:MM)
  ALTER TABLE leads ADD COLUMN checked_in_at TEXT;                    -- lúc khách check-in thực tế
  ALTER TABLE leads ADD COLUMN checked_in_by INTEGER REFERENCES users(id);
  ALTER TABLE leads ADD COLUMN owner_locked INTEGER NOT NULL DEFAULT 0; -- 1: đã check-in ⇒ khách thuộc nhân sự này
  ALTER TABLE leads ADD COLUMN trial_class_id INTEGER REFERENCES classes(id);

  ALTER TABLE fee_packages ADD COLUMN free_absences INTEGER NOT NULL DEFAULT 0;  -- số buổi nghỉ không tính phí
  ALTER TABLE fee_packages ADD COLUMN reserve_limit INTEGER NOT NULL DEFAULT 0;  -- số lần được bảo lưu
  ALTER TABLE fee_packages ADD COLUMN approval_id INTEGER REFERENCES approvals(id);

  ALTER TABLE enrollments ADD COLUMN free_absences INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE enrollments ADD COLUMN reserve_limit INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE enrollments ADD COLUMN reserve_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE enrollments ADD COLUMN reserved_from TEXT;
  ALTER TABLE enrollments ADD COLUMN reserved_to TEXT;
  ALTER TABLE enrollments ADD COLUMN approval_id INTEGER REFERENCES approvals(id);  -- duyệt học phí của Giám đốc
  ALTER TABLE enrollments ADD COLUMN sold_by INTEGER REFERENCES users(id);          -- nhân sự ghi nhận doanh số (EC mới, CM tái phí)

  ALTER TABLE attendance ADD COLUMN improvement TEXT;                -- hướng cải thiện cho từng học viên

  ALTER TABLE receipts ADD COLUMN card_id_no TEXT;                   -- quẹt thẻ tín dụng: số CCCD chủ thẻ
  ALTER TABLE receipts ADD COLUMN card_issue_date TEXT;              -- ngày cấp thẻ
  ALTER TABLE receipts ADD COLUMN card_issuer TEXT;                  -- đơn vị cấp thẻ (ngân hàng)

  ALTER TABLE approvals ADD COLUMN stage TEXT;                       -- NULL: một cấp · 'lead': chờ trưởng phòng · 'final': chờ Giám đốc
  ALTER TABLE approvals ADD COLUMN lead_decided_by INTEGER REFERENCES users(id);
  ALTER TABLE approvals ADD COLUMN lead_decided_at TEXT;
  ALTER TABLE approvals ADD COLUMN lead_note TEXT;

  -- Sự cố cơ sở vật chất: cho phép báo theo phòng (phát sinh mới, chưa có trong danh mục tài sản) + thời gian đề xuất xử lý
  CREATE TABLE asset_issues_v3 (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    asset_id INTEGER REFERENCES assets(id),
    room_id INTEGER REFERENCES rooms(id),
    title TEXT,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'reported',
    requested_due TEXT,                                -- thời gian đề xuất xử lý (YYYY-MM-DD)
    session_id INTEGER REFERENCES class_sessions(id),
    reported_by INTEGER REFERENCES users(id),
    handler_id INTEGER REFERENCES users(id),
    task_id INTEGER REFERENCES tasks(id),
    approval_id INTEGER REFERENCES approvals(id),
    resolution TEXT,
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO asset_issues_v3(id, code, asset_id, room_id, description, severity, status, reported_by, handler_id, task_id, approval_id, resolution, resolved_by, resolved_at, created_at, updated_at)
    SELECT i.id, i.code, i.asset_id, a.room_id, i.description, i.severity, i.status, i.reported_by, i.handler_id, i.task_id, i.approval_id, i.resolution, i.resolved_by, i.resolved_at, i.created_at, i.updated_at
    FROM asset_issues i LEFT JOIN assets a ON a.id = i.asset_id;
  DROP TABLE asset_issues;
  ALTER TABLE asset_issues_v3 RENAME TO asset_issues;

  -- Lịch nghỉ do trung tâm (nghỉ Tết sớm, cúp điện…): hủy buổi trong khoảng, bù buổi cuối khóa ⇒ không trừ học phí
  CREATE TABLE center_closures (
    id INTEGER PRIMARY KEY,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    reason TEXT NOT NULL,
    class_ids TEXT,                                    -- NULL: mọi lớp; JSON mảng id lớp
    sessions_cancelled INTEGER NOT NULL DEFAULT 0,
    sessions_added INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  -- Lịch test / họp phụ huynh hằng tháng của lớp; test phải trả kết quả cho PH trong 5 ngày
  CREATE TABLE class_events (
    id INTEGER PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    kind TEXT NOT NULL,                                -- test | parent_meeting
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',          -- scheduled | done | cancelled
    results_due TEXT,                                  -- hạn trả kết quả (test: ngày test + 5)
    results_returned_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  `,
];

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
