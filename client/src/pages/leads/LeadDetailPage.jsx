import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PhoneCall, CalendarPlus, UserCheck, Pencil, XCircle, RotateCcw, MessageSquare, FlaskConical, GraduationCap, DoorOpen, MapPinCheck, ListChecks } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, dateTime, phone, todayVN, age, addDays } from '../../lib/format.js';
import { CONTACT_TYPES, RELATIONSHIPS, STATUS, MANUAL_LEAD_STATUSES } from '../../lib/labels.js';
import {
  Card, CardHeader, Button, StatusBadge, KeyValue, Timeline, Modal, Drawer, Field, Input, Select, Textarea, Alert, FormGrid, Segmented, ConfirmDialog, ErrorState, LoadingRows, useForm, useToast, Checkbox, ConflictList, Menu, Badge, DateInput, DateTimeInput, TimeInput,
} from '../../components/ui/index.js';
import LeadForm, { DuplicateWarning } from './LeadForm.jsx';
import { TrialResultModal } from '../../components/business/ClassModals.jsx';
import EnrollmentFields, { emptyEnrollment, validateEnrollment, toEnrollmentPayload } from '../../components/business/EnrollmentFields.jsx';

const ACT_ICON = { call: PhoneCall, message: MessageSquare, meeting: UserCheck, note: Pencil, trial: FlaskConical, status: RotateCcw };

export default function LeadDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/api/leads/${id}`);
  const [modal, setModal] = useState(null);

  if (error && !data) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card>{loading && <LoadingRows />}</Card>;
  const { lead, activities, trials, duplicates, tasks = [] } = data;
  const closed = ['enrolled', 'unfit'].includes(lead.status);
  const edit = can('leads.edit');
  const checkin = async () => { await api.post(`/api/leads/${lead.id}/checkin`, {}); toast.success('Đã ghi nhận khách check-in. Khách thuộc về nhân sự phụ trách.'); reload(); };

  return (
    <div>
      <Link to="/leads" className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />Danh sách khách</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{lead.student_name}</h1><StatusBadge kind="lead" value={lead.status} /></div>
          <p className="mt-1 text-sm text-ink-3">{lead.code} · Phụ huynh {lead.parent_name} · {phone(lead.phone)} · Nguồn {lead.source}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lead.status === 'enrolled' && lead.converted_student_id && <Button icon={GraduationCap} onClick={() => navigate(`/students/${lead.converted_student_id}`)}>Mở hồ sơ học viên</Button>}
          {!closed && edit && <Button variant="secondary" icon={PhoneCall} onClick={() => setModal('activity')}>Ghi tư vấn / phân loại</Button>}
          {!closed && edit && !lead.checked_in_at && <Button variant="secondary" icon={DoorOpen} onClick={() => setModal('bookCheckin')}>{lead.status === 'checkin_booked' ? 'Đổi lịch check-in' : 'Đăng ký check-in'}</Button>}
          {!closed && edit && !lead.checked_in_at && <Button variant="secondary" icon={MapPinCheck} onClick={() => setModal('checkin')}>Khách đã check-in</Button>}
          {!closed && edit && <Button variant="secondary" icon={CalendarPlus} onClick={() => setModal('trial')}>Đăng ký học thử</Button>}
          {!closed && can('leads.convert') && <Button icon={UserCheck} onClick={() => setModal('convert')}>Chuyển thành học viên</Button>}
          {edit && <Menu items={[
            !closed && { label: 'Sửa thông tin', icon: Pencil, onSelect: () => setModal('edit') },
            !closed && { label: 'Đóng hồ sơ: không phù hợp', icon: XCircle, danger: true, onSelect: () => setModal('unfit') },
            lead.status === 'unfit' && { label: 'Mở lại hồ sơ (Chăm sóc thêm)', icon: RotateCcw, onSelect: async () => { await api.post(`/api/leads/${lead.id}/status`, { status: 'nurturing', next_contact_at: `${addDays(todayVN(), 1)} 09:00` }); toast.success('Đã mở lại hồ sơ, hẹn liên hệ lại ngày mai.'); reload(); } },
          ]} />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-5">
          <DuplicateWarning dup={duplicates} />
          <Card>
            <CardHeader title="Thông tin khách" />
            <div className="px-4 pb-4 sm:px-5">
              <KeyValue items={[
                ['Phụ huynh', lead.parent_name], ['Số điện thoại', phone(lead.phone)], ['Email', lead.email], ['Học viên', lead.student_name],
                ['Ngày sinh', lead.student_dob ? `${date(lead.student_dob)} (${age(lead.student_dob)} tuổi)` : null], ['Trường', lead.school],
                ['Khóa quan tâm', lead.course_name], ['Nhân sự phụ trách', lead.owner_name], ['Ngày liên hệ lại', lead.next_contact_at ? dateTime(lead.next_contact_at) : null],
                ['Lịch check-in', lead.checkin_booked_at && !lead.checked_in_at ? dateTime(lead.checkin_booked_at) : null],
                ['Đã check-in', lead.checked_in_at ? `${dateTime(lead.checked_in_at.slice(0, 16).replace('T', ' '))} (ghi nhận: ${lead.checked_in_by_name || '—'})` : null],
                ['Lớp học thử', lead.trial_class_code],
                ['Ngày tạo', dateTime(lead.created_at)],
              ]} />
              {lead.owner_locked === 1 && <Alert tone="success" className="mt-4" title="Khách đã check-in">Theo quy định, khách thuộc về <b>{lead.owner_name}</b> — nhân sự check-in trước. Chỉ trưởng phòng/Giám đốc đổi được người phụ trách.</Alert>}
              {lead.note && <p className="mt-4 rounded-md bg-canvas p-3 text-[13px] text-ink-2">{lead.note}</p>}
              {lead.status === 'unfit' && <Alert tone="info" className="mt-4" title="Hồ sơ đã đóng">{lead.unfit_reason}</Alert>}
            </div>
          </Card>
          {tasks.length > 0 && (
            <Card>
              <CardHeader title="Đề xuất đã đẩy cho CM" description="Việc tự sinh khi đăng ký check-in / học thử" />
              <ul className="divide-y divide-line border-t border-line">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0"><p className="flex items-center gap-1.5 text-sm"><ListChecks className="size-3.5 shrink-0 text-ink-3" aria-hidden />{t.title}</p><p className="text-xs text-ink-3">{t.assignee} · hạn {date(t.due_date)}</p></div>
                    <StatusBadge kind="task" value={t.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Học thử / kiểm tra đầu vào" actions={!closed && edit && <Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => setModal('trial')}>Đặt lịch</Button>} />
            {!trials.length ? <p className="px-5 pb-5 text-sm text-ink-3">Chưa có lịch học thử.</p> : (
              <ul className="divide-y divide-line border-t border-line">
                {trials.map((t) => (
                  <li key={t.id} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{t.type === 'placement' ? 'Kiểm tra đầu vào' : 'Học thử'} · {date(t.date)} {t.start_time}–{t.end_time}</p>
                        <p className="text-xs text-ink-3">{t.class_code ? `Ghép lớp ${t.class_code} · ` : ''}{t.room_name} · {t.teacher_name}</p>
                      </div>
                      <StatusBadge kind="trial" value={t.status} />
                    </div>
                    {t.status === 'done' && <p className="mt-2 text-[13px] text-ink-2">{[t.result_level, t.score && `Điểm ${t.score}`, t.recommended_course && `Đề xuất: ${t.recommended_course}`].filter(Boolean).join(' · ')}<br />{t.teacher_comment}</p>}
                    {t.status === 'scheduled' && edit && (
                      <div className="mt-2 flex gap-2">
                        {t.date <= todayVN() && <Button size="sm" onClick={() => setModal({ type: 'result', trial: { ...t, student_name: lead.student_name } })}>Ghi kết quả</Button>}
                        <Button size="sm" variant="ghost" onClick={() => setModal({ type: 'cancelTrial', trial: t })}>Hủy lịch</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Lịch sử tư vấn" description="Mọi lần liên hệ, lịch hẹn và thay đổi trạng thái" actions={!closed && edit && <Button size="sm" icon={PhoneCall} onClick={() => setModal('activity')}>Ghi tư vấn</Button>} />
          <div className="px-5 pb-5">
            <Timeline items={activities.map((a) => {
              const Icon = ACT_ICON[a.type] || Pencil;
              return {
                key: a.id, tone: a.type === 'status' ? 'muted' : undefined,
                title: <span className="inline-flex items-start gap-1.5"><Icon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden /><span><b className="font-medium">{CONTACT_TYPES[a.type] || (a.type === 'trial' ? 'Học thử' : 'Trạng thái')}:</b> {a.content}</span></span>,
                body: [a.result && `Kết quả: ${a.result}`, a.next_contact_at && `Hẹn tiếp: ${dateTime(a.next_contact_at)}`].filter(Boolean).join(' · ') || null,
                meta: `${a.by_name || 'Hệ thống'} · ${dateTime(a.created_at)}`,
              };
            })} />
          </div>
        </Card>
      </div>

      <LeadForm open={modal === 'edit'} onOpenChange={(v) => !v && setModal(null)} lead={lead} onSaved={reload} />
      <ActivityModal open={modal === 'activity'} onOpenChange={(v) => !v && setModal(null)} lead={lead} onDone={reload} />
      <TrialModal open={modal === 'trial'} onOpenChange={(v) => !v && setModal(null)} lead={lead} onDone={reload} />
      <TrialResultModal open={modal?.type === 'result'} onOpenChange={(v) => !v && setModal(null)} trial={modal?.trial} onDone={reload} />
      <ConvertDrawer open={modal === 'convert'} onOpenChange={(v) => !v && setModal(null)} lead={lead} trials={trials} duplicates={duplicates} />
      <BookCheckinModal open={modal === 'bookCheckin'} onOpenChange={(v) => !v && setModal(null)} lead={lead} onDone={reload} />
      <ConfirmDialog open={modal === 'checkin'} onOpenChange={(v) => !v && setModal(null)} title="Xác nhận khách đã check-in" confirmLabel="Xác nhận check-in"
        message={`${lead.parent_name} và ${lead.student_name} đã đến trung tâm. Hệ thống ghi thời điểm check-in và khóa khách cho ${lead.owner_name || 'bạn'} (ai check-in trước giữ khách). Các đề xuất "đón khách" của CM sẽ tự hoàn tất.`}
        onConfirm={checkin} />
      <ConfirmDialog open={modal === 'unfit'} onOpenChange={(v) => !v && setModal(null)} title="Đóng hồ sơ: không phù hợp" confirmLabel="Đóng hồ sơ" reason reasonLabel="Lý do không phù hợp"
        message="Hồ sơ sẽ chuyển khỏi danh sách đang tư vấn. Có thể mở lại sau." onConfirm={async (reason) => { await api.post(`/api/leads/${lead.id}/status`, { status: 'unfit', reason }); toast.success('Đã đóng hồ sơ.'); reload(); }} />
      <ConfirmDialog open={modal?.type === 'cancelTrial'} onOpenChange={(v) => !v && setModal(null)} title="Hủy lịch học thử?" confirmLabel="Hủy lịch"
        message={modal?.trial && `Lịch ngày ${date(modal.trial.date)} ${modal.trial.start_time} sẽ bị hủy.`} onConfirm={async () => { await api.post(`/api/leads/trials/${modal.trial.id}/cancel`); toast.success('Đã hủy lịch học thử.'); reload(); }} />
    </div>
  );
}

function ActivityModal({ open, onOpenChange, lead, onDone }) {
  const manual = MANUAL_LEAD_STATUSES.includes(lead.status);
  const blank = { type: 'call', content: '', result: '', status: '', next_contact_at: (lead.next_contact_at || '').replace(' ', 'T') };
  const f = useForm(blank);
  const toast = useToast();
  useEffect(() => { if (open) { f.setValues(blank); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    await api.post(`/api/leads/${lead.id}/activities`, { ...v, status: v.status || null, next_contact_at: v.next_contact_at || null });
    toast.success('Đã ghi lịch sử tư vấn.'); onOpenChange(false); onDone();
  }, (v) => ({ content: !v.content.trim() && 'Nhập nội dung tư vấn.', next_contact_at: !v.next_contact_at && 'Chọn ngày liên hệ lại để hệ thống nhắc việc.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Ghi lịch sử tư vấn" description={`${lead.parent_name} · ${phone(lead.phone)}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Lưu</Button></>}>
      <div className="space-y-4">
        <Field label="Hình thức"><Segmented ariaLabel="Hình thức liên hệ" value={f.values.type} onChange={(t) => f.set('type', t)} options={Object.entries(CONTACT_TYPES).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Nội dung" required error={f.errors.content}><Textarea autoFocus {...f.bind('content')} /></Field>
        <Field label="Kết quả" error={f.errors.result}><Input placeholder="Ví dụ: phụ huynh hẹn cho bé học thử thứ 7" {...f.bind('result')} /></Field>
        <FormGrid>
          <Field label="Phân loại" hint={manual ? undefined : `Đang: ${STATUS.lead[lead.status]?.[0]}. Chọn nếu muốn chuyển về nhóm này.`}>
            <Select {...f.bind('status')} placeholder={manual ? `Giữ: ${STATUS.lead[lead.status][0]}` : '— Giữ nguyên —'}>
              {MANUAL_LEAD_STATUSES.filter((k) => k !== lead.status).map((k) => <option key={k} value={k}>{STATUS.lead[k][0]}</option>)}
            </Select>
          </Field>
          <Field label="Ngày liên hệ lại" required error={f.errors.next_contact_at}><DateTimeInput {...f.bind('next_contact_at')} /></Field>
        </FormGrid>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

/** Đăng ký check-in: hẹn ngày giờ khách lên trung tâm ⇒ đẩy "Đề xuất cần xử lý" cho tất cả CM */
function BookCheckinModal({ open, onOpenChange, lead, onDone }) {
  const toast = useToast();
  const f = useForm({ checkin_at: `${todayVN()}T18:00`, note: '' });
  useEffect(() => { if (open) { f.setValues({ checkin_at: (lead.checkin_booked_at || `${addDays(todayVN(), 1)} 18:00`).replace(' ', 'T'), note: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const r = await api.post(`/api/leads/${lead.id}/book-checkin`, v);
    toast.success(`Đã đăng ký check-in và gửi đề xuất cho ${r.notified} CM.`); onOpenChange(false); onDone();
  }, (v) => ({ checkin_at: !v.checkin_at && 'Chọn ngày giờ check-in.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Đăng ký check-in" description="Hẹn ngày giờ phụ huynh đưa bé lên trung tâm. Tất cả giáo viên chủ nhiệm (CM) nhận đề xuất để chuẩn bị đón khách."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Đăng ký</Button></>}>
      <div className="space-y-4">
        <Field label="Ngày giờ check-in" required error={f.errors.checkin_at}><DateTimeInput {...f.bind('checkin_at')} /></Field>
        <Field label="Ghi chú cho CM" error={f.errors.note}><Textarea placeholder="Ví dụ: bé nhút nhát, muốn xem phòng học" {...f.bind('note')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function TrialModal({ open, onOpenChange, lead, onDone }) {
  const { rooms, teachers, classes } = useLookups();
  const toast = useToast();
  const f = useForm({ type: 'trial', mode: 'session', class_id: '', session_id: '', date: todayVN(), start_time: '15:00', end_time: '15:45', room_id: '', teacher_id: '' });
  const suggested = classes.filter((c) => c.course_id === lead.interest_course_id && ['active', 'planned'].includes(c.status));
  const sessions = useApi(open && f.values.mode === 'session' && f.values.class_id ? `/api/sessions?class_id=${f.values.class_id}&from=${todayVN()}&to=${addDays(todayVN(), 21)}` : null);
  useEffect(() => {
    if (open) { f.setValues({ type: 'trial', mode: 'session', class_id: suggested[0] ? String(suggested[0].id) : '', session_id: '', date: todayVN(), start_time: '15:00', end_time: '15:45', room_id: '', teacher_id: '' }); f.setErrors({}); f.setFormError(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const body = v.mode === 'session' ? { type: v.type, session_id: Number(v.session_id) } : { type: v.type, date: v.date, start_time: v.start_time, end_time: v.end_time, room_id: Number(v.room_id) || null, teacher_id: Number(v.teacher_id) || null };
    await api.post(`/api/leads/${lead.id}/trials`, body);
    toast.success('Đã đăng ký học thử. CM của lớp nhận đề xuất xử lý.'); onOpenChange(false); onDone();
  }, (v) => (v.mode === 'session' ? { session_id: !v.session_id && 'Chọn buổi học.' } : { room_id: !v.room_id && 'Chọn phòng.', teacher_id: !v.teacher_id && 'Chọn giáo viên.', end_time: v.end_time <= v.start_time && 'Giờ kết thúc phải sau giờ bắt đầu.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Đăng ký học thử" description={`${lead.student_name} · khóa quan tâm: ${lead.course_name || 'chưa xác định'}. Chọn lớp ⇒ đề xuất chuyển cho CM của lớp đó.`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Đặt lịch</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Loại lịch"><Segmented ariaLabel="Loại lịch" value={f.values.type} onChange={(t) => f.set('type', t)} options={[{ value: 'trial', label: 'Học thử' }, { value: 'placement', label: 'Kiểm tra đầu vào' }]} /></Field>
          <Field label="Cách xếp"><Segmented ariaLabel="Cách xếp" value={f.values.mode} onChange={(m) => f.set('mode', m)} options={[{ value: 'session', label: 'Ghép buổi của lớp' }, { value: 'standalone', label: 'Lịch riêng' }]} /></Field>
        </FormGrid>
        {f.values.mode === 'session' ? (
          <FormGrid>
            <Field label="Lớp"><Select value={f.values.class_id} onChange={(e) => f.setValues((x) => ({ ...x, class_id: e.target.value, session_id: '' }))} placeholder="— Chọn lớp —">
              {classes.filter((c) => ['active', 'planned'].includes(c.status)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}{c.course_id === lead.interest_course_id ? ' (đúng khóa quan tâm)' : ''}</option>)}
            </Select></Field>
            <Field label="Buổi học" required error={f.errors.session_id}><Select {...f.bind('session_id')} placeholder={sessions.loading ? 'Đang tải…' : '— Chọn buổi —'} disabled={!f.values.class_id}>
              {sessions.data?.sessions.filter((s) => s.status === 'scheduled').map((s) => <option key={s.id} value={s.id}>{date(s.date)} {s.start_time}–{s.end_time} · {s.room_name}</option>)}
            </Select></Field>
          </FormGrid>
        ) : (
          <FormGrid>
            <Field label="Ngày" required error={f.errors.date}><DateInput min={todayVN()} {...f.bind('date')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bắt đầu" required error={f.errors.start_time}><TimeInput {...f.bind('start_time')} /></Field>
              <Field label="Kết thúc" required error={f.errors.end_time}><TimeInput {...f.bind('end_time')} /></Field>
            </div>
            <Field label="Phòng" required error={f.errors.room_id}><Select {...f.bind('room_id')} placeholder="— Chọn phòng —">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            <Field label="Giáo viên" required error={f.errors.teacher_id}><Select {...f.bind('teacher_id')} placeholder="— Chọn giáo viên —">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          </FormGrid>
        )}
        {f.formError && <Alert tone="danger" title={f.formError.message}><ConflictList error={f.formError} /></Alert>}
      </div>
    </Modal>
  );
}

/** Chuyển khách thành học viên: dùng lại thông tin đã có, tùy chọn tạo đăng ký khóa ngay */
function ConvertDrawer({ open, onOpenChange, lead, trials, duplicates }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const recommended = trials.find((t) => t.status === 'done' && t.recommended_course_id)?.recommended_course_id || lead.interest_course_id;
  const existingParent = duplicates?.parents?.[0];
  const init = () => ({
    student: { full_name: lead.student_name, dob: lead.student_dob || '', gender: '', school: lead.school || '' },
    parent: existingParent ? { mode: 'existing', parent_id: existingParent.id, full_name: lead.parent_name, phone: lead.phone, email: lead.email || '', relationship: 'Mẹ' } : { mode: 'new', parent_id: '', full_name: lead.parent_name, phone: lead.phone, email: lead.email || '', relationship: 'Mẹ' },
    withEnrollment: true,
    enrollment: emptyEnrollment(recommended),
  });
  const [v, setV] = useState(init);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setV(init()); setErrors({}); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const { courses } = useLookups();
  const fee = courses.find((c) => c.id === Number(v.enrollment.course_id))?.tuition_fee;

  const submit = async () => {
    if (busy) return;
    const e = {};
    if (!v.student.full_name.trim()) e['student.full_name'] = 'Nhập họ tên học viên.';
    if (v.parent.mode === 'new' && !v.parent.full_name.trim()) e['parent.full_name'] = 'Nhập tên phụ huynh.';
    if (v.withEnrollment) Object.assign(e, Object.fromEntries(Object.entries(validateEnrollment(v.enrollment, fee)).map(([k, x]) => [k, x])));
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    try {
      const body = {
        student: { ...v.student, dob: v.student.dob || null, gender: v.student.gender || null },
        parent: { ...v.parent, parent_id: v.parent.parent_id ? Number(v.parent.parent_id) : null, email: v.parent.email || null },
        enrollment: v.withEnrollment ? toEnrollmentPayload(v.enrollment) : null,
      };
      const r = await api.post(`/api/leads/${lead.id}/convert`, body);
      toast.success(r.already ? 'Khách đã được chuyển trước đó — mở hồ sơ học viên hiện có (không tạo trùng).' : `Đã tạo học viên${r.enrollmentId ? '. Học phí đăng ký đã gửi Giám đốc duyệt' : ''}.`);
      navigate(`/students/${r.studentId}${r.enrollmentId ? `?tab=${can('finance.view') ? 'finance' : 'classes'}` : ''}`);
    } catch (e2) {
      setErr(e2);
      if (e2.fields) setErrors(e2.fields);
    } finally { setBusy(false); }
  };
  const setS = (patch) => setV((x) => ({ ...x, student: { ...x.student, ...patch } }));
  const setP = (patch) => setV((x) => ({ ...x, parent: { ...x.parent, ...patch } }));

  return (
    <Drawer open={open} onOpenChange={onOpenChange} width="lg" title="Chuyển thành học viên" description="Thông tin đã nhập ở hồ sơ khách được điền sẵn. Kiểm tra lại rồi xác nhận."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={submit} loading={busy}>{v.withEnrollment ? 'Tạo học viên & đăng ký khóa' : 'Tạo học viên'}</Button></>}>
      <div className="space-y-6">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">1. Học viên</h2>
          <FormGrid>
            <Field label="Họ tên" required error={errors['student.full_name']}><Input value={v.student.full_name} onChange={(e) => setS({ full_name: e.target.value })} /></Field>
            <Field label="Ngày sinh" error={errors['student.dob']}><DateInput value={v.student.dob} onChange={(e) => setS({ dob: e.target.value })} /></Field>
            <Field label="Giới tính"><Select value={v.student.gender} onChange={(e) => setS({ gender: e.target.value })} placeholder="— Chọn —"><option value="male">Nam</option><option value="female">Nữ</option></Select></Field>
            <Field label="Trường"><Input value={v.student.school} onChange={(e) => setS({ school: e.target.value })} /></Field>
          </FormGrid>
        </section>
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">2. Phụ huynh / người liên hệ</h2>
          {existingParent && (
            <Segmented ariaLabel="Phụ huynh" value={v.parent.mode} onChange={(m) => setP({ mode: m })}
              options={[{ value: 'existing', label: `Liên kết phụ huynh có sẵn: ${existingParent.full_name}` }, { value: 'new', label: 'Tạo phụ huynh mới' }]} />
          )}
          {v.parent.mode === 'existing' && existingParent ? (
            <Alert tone="info">Học viên sẽ liên kết với phụ huynh <b>{existingParent.full_name}</b>{existingParent.children ? ` (đang có con: ${existingParent.children})` : ''}. Không tạo thêm hồ sơ phụ huynh.</Alert>
          ) : (
            <FormGrid>
              <Field label="Họ tên phụ huynh" required error={errors['parent.full_name']}><Input value={v.parent.full_name} onChange={(e) => setP({ full_name: e.target.value })} /></Field>
              <Field label="Số điện thoại" required error={errors['parent.phone']}><Input value={v.parent.phone} onChange={(e) => setP({ phone: e.target.value })} /></Field>
              <Field label="Email" error={errors['parent.email']}><Input value={v.parent.email} onChange={(e) => setP({ email: e.target.value })} /></Field>
            </FormGrid>
          )}
          <Field label="Quan hệ với học viên" required className="sm:w-1/2"><Select value={v.parent.relationship} onChange={(e) => setP({ relationship: e.target.value })}>{RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        </section>
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">3. Đăng ký khóa học</h2>{recommended && <Badge tone="brand">Khóa đề xuất từ học thử/quan tâm đã điền sẵn</Badge>}</div>
          <Checkbox checked={v.withEnrollment} onChange={(c) => setV((x) => ({ ...x, withEnrollment: c }))} label="Tạo đăng ký khóa ngay" description="Bỏ chọn nếu chỉ muốn tạo hồ sơ học viên, đăng ký sau." />
          {v.withEnrollment && <Alert tone="info">Học phí đăng ký mới cần <b>Giám đốc trung tâm duyệt</b>. Trong lúc chờ, kế toán chưa thu học phí — nếu khách đặt cọc thì ghi bằng "Nạp tiền".</Alert>}
          {v.withEnrollment && <EnrollmentFields value={v.enrollment} onChange={(en) => setV((x) => ({ ...x, enrollment: en }))} errors={errors} />}
        </section>
        {err && !err.fields && <Alert tone="danger" title={err.message}><ConflictList error={err} /></Alert>}
      </div>
    </Drawer>
  );
}
