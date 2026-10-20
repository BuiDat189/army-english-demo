import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useLookups } from '../../lib/auth.jsx';
import { date, todayVN, weekdayLabel } from '../../lib/format.js';
import {
  Modal, Button, Field, Input, Select, Textarea, Alert, FormGrid, Segmented, ConflictList, useForm, useToast, Spinner, EmptyState, Badge, DateInput, TimeInput,
} from '../ui/index.js';

/** Xếp học viên (đăng ký) vào lớp: kiểm tra sĩ số và trùng lịch ở server */
export function AssignClassModal({ open, onOpenChange, enrollment, onDone }) {
  const classes = useApi(open && enrollment ? `/api/enrollments/available-classes?course_id=${enrollment.course_id}` : null);
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();
  useEffect(() => { if (open) { setClassId(''); setError(null); } }, [open]);
  if (!enrollment) return null;
  const save = async () => {
    if (!classId || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/api/enrollments/${enrollment.id}/assign-class`, { class_id: Number(classId) });
      toast.success(`Đã xếp vào lớp ${r.class.code}.`);
      onOpenChange(false); onDone?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Xếp lớp" description={`${enrollment.studentName || ''} · ${enrollment.code} · ${enrollment.course_name}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={busy} disabled={!classId}>Xếp vào lớp</Button></>}>
      {classes.loading && <Spinner />}
      {classes.data && !classes.data.items.length && <EmptyState compact title="Chưa có lớp đang mở cho khóa này" description="Giáo vụ cần tạo lớp mới ở mục Lớp & Khóa học." />}
      <fieldset className="space-y-2">
        <legend className="sr-only">Chọn lớp</legend>
        {classes.data?.items.map((c) => {
          const full = c.occupancy >= c.max_students;
          return (
            <label key={c.id} className={clsx('flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3', Number(classId) === c.id ? 'border-brand-500 bg-brand-50/50' : 'border-line hover:bg-canvas', full && 'cursor-not-allowed opacity-60')}>
              <input type="radio" name="class" className="mt-1 accent-brand-600" disabled={full} checked={Number(classId) === c.id} onChange={() => setClassId(c.id)} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{c.code} · {c.name}{full && <Badge tone="danger">Đủ sĩ số</Badge>}{c.status === 'planned' && <Badge tone="info">Sắp khai giảng</Badge>}</span>
                <span className="block text-xs text-ink-3">{c.schedule} · {c.room_name} · GV {c.teacher_name}</span>
                <span className="block text-xs text-ink-3">Sĩ số {c.occupancy}/{c.max_students} · Khai giảng {date(c.start_date)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {error && <Alert tone="danger" className="mt-3" title={error.message}><ConflictList error={error} /></Alert>}
    </Modal>
  );
}

/** Xếp học bù cho một buổi vắng: ghép buổi có sẵn hoặc tạo buổi bù riêng */
export function MakeupModal({ open, onOpenChange, absence, onDone }) {
  const { rooms, teachers } = useLookups();
  const [mode, setMode] = useState('existing');
  const [sessionId, setSessionId] = useState('');
  const options = useApi(open && absence ? `/api/sessions/makeup/options?attendance_id=${absence.attendance_id}` : null);
  const f = useForm({ date: todayVN(), start_time: '15:30', end_time: '16:30', room_id: '', teacher_id: '', note: '' });
  const toast = useToast();
  useEffect(() => { if (open) { setMode('existing'); setSessionId(''); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!absence) return null;
  const save = () => f.submit(async (v) => {
    const body = mode === 'existing'
      ? { attendance_id: absence.attendance_id, session_id: Number(sessionId), note: v.note || null }
      : { attendance_id: absence.attendance_id, new_session: { date: v.date, start_time: v.start_time, end_time: v.end_time, room_id: Number(v.room_id), teacher_id: Number(v.teacher_id) }, note: v.note || null };
    await api.post('/api/sessions/makeup', body);
    toast.success('Đã xếp lịch học bù. Học viên sẽ có trong danh sách điểm danh của buổi bù.');
    onOpenChange(false); onDone?.();
  }, (v) => (mode === 'existing' ? { session_id: !sessionId && 'Chọn một buổi học.' } : {
    'new_session.date': !v.date && 'Chọn ngày.', 'new_session.room_id': !v.room_id && 'Chọn phòng.', 'new_session.teacher_id': !v.teacher_id && 'Chọn giáo viên.',
    'new_session.end_time': v.end_time <= v.start_time && 'Giờ kết thúc phải sau giờ bắt đầu.',
  }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Xếp lịch học bù"
      description={`${absence.full_name} · vắng buổi ${date(absence.date)}${absence.class_code ? ` (${absence.class_code})` : ''}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Xếp học bù</Button></>}>
      <div className="space-y-4">
        <Segmented ariaLabel="Cách xếp" value={mode} onChange={setMode} options={[{ value: 'existing', label: 'Ghép vào buổi có sẵn' }, { value: 'new', label: 'Tạo buổi học bù riêng' }]} />
        {mode === 'existing' ? (
          <div>
            {options.loading && <Spinner />}
            {options.data && !options.data.items.length && <EmptyState compact title="Không có buổi phù hợp trong 4 tuần tới" description="Tạo buổi học bù riêng." />}
            <div className="scroll-thin max-h-72 space-y-2 overflow-y-auto pr-1">
              {options.data?.items.map((s) => {
                const disabled = s.full || !!s.conflict;
                return (
                  <label key={s.id} className={clsx('flex items-start gap-3 rounded-[var(--radius-control)] border p-3', Number(sessionId) === s.id ? 'border-brand-500 bg-brand-50/50' : 'border-line', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-canvas')}>
                    <input type="radio" name="makeup-session" className="mt-1 accent-brand-600" disabled={disabled} checked={Number(sessionId) === s.id} onChange={() => setSessionId(s.id)} />
                    <span className="text-sm">
                      <span className="font-medium">{weekdayLabel(s.date)} {date(s.date)} · {s.start_time}–{s.end_time}</span>
                      <span className="block text-xs text-ink-3">{s.class_code} · {s.room_name} · GV {s.teacher_name} · {s.student_count}/{s.max_students} HV</span>
                      {s.full && <span className="block text-xs text-red-700">Buổi đã đủ sĩ số</span>}
                      {s.conflict && <span className="block text-xs text-red-700">{s.conflict}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {f.errors.session_id && <p className="mt-2 text-xs font-medium text-red-700">{f.errors.session_id}</p>}
          </div>
        ) : (
          <FormGrid>
            <Field label="Ngày" required error={f.errors['new_session.date']}><DateInput min={todayVN()} {...f.bind('date')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bắt đầu" required error={f.errors['new_session.start_time']}><TimeInput {...f.bind('start_time')} /></Field>
              <Field label="Kết thúc" required error={f.errors['new_session.end_time']}><TimeInput {...f.bind('end_time')} /></Field>
            </div>
            <Field label="Phòng" required error={f.errors['new_session.room_id']}><Select {...f.bind('room_id')} placeholder="— Chọn phòng —">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.capacity} chỗ)</option>)}</Select></Field>
            <Field label="Giáo viên/Trợ giảng phụ trách" required error={f.errors['new_session.teacher_id']}><Select {...f.bind('teacher_id')} placeholder="— Chọn người dạy —">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          </FormGrid>
        )}
        <Field label="Ghi chú"><Textarea rows={2} placeholder="Ví dụ: phụ huynh đã xác nhận qua điện thoại" {...f.bind('note')} /></Field>
        <Alert tone="info">Quy tắc tính buổi (giả định demo): buổi nghỉ và buổi bù của nó chỉ trừ tối đa 1 buổi.</Alert>
        {f.formError && <Alert tone="danger" title={f.formError.message}><ConflictList error={f.formError} /></Alert>}
      </div>
    </Modal>
  );
}

/** Đổi lịch một buổi học (ngày, giờ, phòng, giáo viên) */
export function RescheduleModal({ open, onOpenChange, session, onDone }) {
  const { rooms, teachers } = useLookups();
  const f = useForm({});
  const toast = useToast();
  useEffect(() => {
    if (open && session) {
      f.setValues({ date: session.date, start_time: session.start_time, end_time: session.end_time, room_id: String(session.room_id || ''), teacher_id: String(session.teacher_id || ''), assistant_id: String(session.assistant_id || ''), reason: '' });
      f.setErrors({}); f.setFormError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!session) return null;
  const save = () => f.submit(async (v) => {
    await api.put(`/api/sessions/${session.id}`, { ...v, room_id: Number(v.room_id), teacher_id: Number(v.teacher_id), assistant_id: v.assistant_id ? Number(v.assistant_id) : null });
    toast.success('Đã đổi lịch buổi học.');
    onOpenChange(false); onDone?.();
  }, (v) => ({ end_time: v.end_time <= v.start_time && 'Giờ kết thúc phải sau giờ bắt đầu.', date: v.date < todayVN() && 'Không dời về quá khứ.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Đổi lịch buổi học" description={`${session.class_code || session.title} · ${date(session.date)} ${session.start_time}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Lưu lịch mới</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Ngày" required error={f.errors.date}><DateInput min={todayVN()} {...f.bind('date')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bắt đầu" required error={f.errors.start_time}><TimeInput {...f.bind('start_time')} /></Field>
            <Field label="Kết thúc" required error={f.errors.end_time}><TimeInput {...f.bind('end_time')} /></Field>
          </div>
          <Field label="Phòng" required error={f.errors.room_id}><Select {...f.bind('room_id')}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="Giáo viên" required error={f.errors.teacher_id}><Select {...f.bind('teacher_id')}>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          <Field label="Trợ giảng" error={f.errors.assistant_id}><Select {...f.bind('assistant_id')} placeholder="— Không có —">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
        </FormGrid>
        <Field label="Lý do đổi lịch"><Textarea rows={2} {...f.bind('reason')} /></Field>
        {f.formError && <Alert tone="danger" title={f.formError.message}><ConflictList error={f.formError} /></Alert>}
      </div>
    </Modal>
  );
}

/** Ghi kết quả học thử / kiểm tra đầu vào */
export function TrialResultModal({ open, onOpenChange, trial, onDone }) {
  const { courses } = useLookups();
  const f = useForm({ status: 'done', score: '', result_level: '', recommended_course_id: '', teacher_comment: '' });
  const toast = useToast();
  useEffect(() => { if (open) { f.setValues({ status: 'done', score: '', result_level: '', recommended_course_id: '', teacher_comment: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!trial) return null;
  const save = () => f.submit(async (v) => {
    await api.post(`/api/leads/trials/${trial.id}/result`, { ...v, recommended_course_id: v.recommended_course_id ? Number(v.recommended_course_id) : null });
    toast.success('Đã lưu kết quả.');
    onOpenChange(false); onDone?.();
  }, (v) => ({ teacher_comment: v.status === 'done' && !v.teacher_comment.trim() && 'Nhập nhận xét của giáo viên.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={trial.type === 'placement' ? 'Kết quả kiểm tra đầu vào' : 'Kết quả học thử'} description={trial.student_name}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Lưu kết quả</Button></>}>
      <div className="space-y-4">
        <Segmented ariaLabel="Kết quả" value={f.values.status} onChange={(s) => f.set('status', s)} options={[{ value: 'done', label: 'Đã tham gia' }, { value: 'no_show', label: 'Không đến' }]} />
        {f.values.status === 'done' && (<>
          <FormGrid>
            <Field label="Trình độ đánh giá"><Input placeholder="Ví dụ: A1 Movers" {...f.bind('result_level')} /></Field>
            <Field label="Điểm (nếu có)"><Input placeholder="Ví dụ: 32/50" {...f.bind('score')} /></Field>
          </FormGrid>
          <Field label="Khóa đề xuất"><Select {...f.bind('recommended_course_id')} placeholder="— Chọn khóa —">{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Nhận xét của giáo viên" required error={f.errors.teacher_comment}><Textarea {...f.bind('teacher_comment')} /></Field>
        </>)}
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
