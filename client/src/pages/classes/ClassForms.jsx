import { useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useLookups } from '../../lib/auth.jsx';
import { todayVN, WEEKDAYS, money } from '../../lib/format.js';
import {
  Drawer, Modal, Button, IconButton, Field, Input, Select, Textarea, FormGrid, Alert, ConflictList, MoneyInput, useForm, useToast, DateInput, TimeInput,
} from '../../components/ui/index.js';

/** Tạo lớp mới (sinh đủ số buổi theo khóa) hoặc sửa lớp (áp dụng phòng/GV mới cho các buổi sắp tới) */
export function ClassFormDrawer({ open, onOpenChange, cls, onSaved }) {
  const { courses, rooms, teachers, activeStaff, reload: reloadLookups } = useLookups();
  const toast = useToast();
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    f.setValues(cls ? {
      name: cls.name, room_id: String(cls.room_id || ''), teacher_id: String(cls.teacher_id || ''), assistant_id: String(cls.assistant_id || ''), homeroom_id: String(cls.homeroom_id || ''), max_students: cls.max_students, status: cls.status, note: cls.note || '',
    } : {
      code: '', name: '', course_id: '', room_id: '', teacher_id: '', assistant_id: '', homeroom_id: '', max_students: 12, start_date: todayVN(), note: '',
      schedule: [{ weekday: 2, start: '17:30', end: '19:00' }, { weekday: 5, start: '17:30', end: '19:00' }],
    });
    f.setErrors({}); f.setFormError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const room = rooms.find((r) => r.id === Number(f.values.room_id));
  const course = courses.find((c) => c.id === Number(f.values.course_id));
  const save = () => f.submit(async (v) => {
    const common = { name: v.name, room_id: Number(v.room_id), teacher_id: Number(v.teacher_id), assistant_id: v.assistant_id ? Number(v.assistant_id) : null, homeroom_id: v.homeroom_id ? Number(v.homeroom_id) : null, max_students: Number(v.max_students), note: v.note || null };
    if (cls) {
      await api.put(`/api/classes/${cls.id}`, { ...common, status: v.status });
      toast.success('Đã cập nhật lớp.'); onSaved?.(cls.id);
    } else {
      const r = await api.post('/api/classes', { ...common, code: v.code, course_id: Number(v.course_id), start_date: v.start_date, schedule: v.schedule.map((x) => ({ ...x, weekday: Number(x.weekday) })) });
      toast.success(`Đã tạo lớp với ${r.sessions} buổi học.`); onSaved?.(r.id);
    }
    reloadLookups();
    onOpenChange(false);
  }, (v) => ({
    code: !cls && !v.code?.trim() && 'Nhập mã lớp.', name: !v.name?.trim() && 'Nhập tên lớp.', course_id: !cls && !v.course_id && 'Chọn khóa học.',
    room_id: !v.room_id && 'Chọn phòng.', teacher_id: !v.teacher_id && 'Chọn giáo viên.',
    assistant_id: v.assistant_id && v.assistant_id === v.teacher_id && 'Trợ giảng phải khác giáo viên.',
    max_students: (!v.max_students || v.max_students < 1) ? 'Sĩ số tối thiểu 1.' : room && v.max_students > room.capacity && `Phòng ${room.name} chỉ chứa ${room.capacity} học viên.`,
    schedule: !cls && (!v.schedule?.length ? 'Cần ít nhất một khung giờ.' : v.schedule.some((x) => x.end <= x.start) && 'Giờ kết thúc phải sau giờ bắt đầu.'),
  }));
  if (f.values.name === undefined) return null;
  const setSlot = (i, patch) => f.set('schedule', f.values.schedule.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <Drawer open={open} onOpenChange={onOpenChange} width="lg" title={cls ? `Sửa lớp ${cls.code}` : 'Tạo lớp mới'}
      description={cls ? 'Đổi phòng/giáo viên/trợ giảng sẽ áp dụng cho các buổi chưa diễn ra (có kiểm tra trùng lịch).' : 'Hệ thống tự sinh đủ số buổi của khóa theo lịch tuần và kiểm tra trùng phòng, giáo viên, trợ giảng.'}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>{cls ? 'Lưu thay đổi' : 'Tạo lớp & sinh lịch'}</Button></>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <FormGrid>
          {!cls && <Field label="Mã lớp" required error={f.errors.code} hint="Ví dụ: MV1-C"><Input {...f.bind('code')} /></Field>}
          <Field label="Tên lớp" required error={f.errors.name}><Input {...f.bind('name')} /></Field>
          {!cls && <Field label="Khóa học" required error={f.errors.course_id}><Select {...f.bind('course_id')} placeholder="— Chọn khóa —">{courses.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name} ({c.total_sessions} buổi)</option>)}</Select></Field>}
          {!cls && <Field label="Ngày khai giảng" required error={f.errors.start_date}><DateInput {...f.bind('start_date')} /></Field>}
          <Field label="Phòng học" required error={f.errors.room_id}><Select {...f.bind('room_id')} placeholder="— Chọn phòng —">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.capacity} chỗ</option>)}</Select></Field>
          <Field label="Sĩ số tối đa" required error={f.errors.max_students} hint={room ? `Không vượt sức chứa phòng (${room.capacity}).` : undefined}><Input type="number" min={1} max={40} {...f.bind('max_students')} /></Field>
          <Field label="Giáo viên" required error={f.errors.teacher_id}><Select {...f.bind('teacher_id')} placeholder="— Chọn giáo viên —">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          <Field label="Trợ giảng" error={f.errors.assistant_id}><Select {...f.bind('assistant_id')} placeholder="— Không có —">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          <Field label="Chủ nhiệm lớp (CM)" hint="Người theo dõi sĩ số, học phí, tái phí của lớp." error={f.errors.homeroom_id}><Select {...f.bind('homeroom_id')} placeholder="— Chưa gán —">{activeStaff.filter((s) => s.roles.some((r) => ['academic', 'manager', 'consultant'].includes(r))).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
          {cls && <Field label="Trạng thái"><Select {...f.bind('status')}><option value="planned">Sắp khai giảng</option><option value="active">Đang học</option><option value="finished">Đã kết thúc</option><option value="cancelled">Đã hủy</option></Select></Field>}
        </FormGrid>
        {!cls && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Lịch học trong tuần {course && <span className="font-normal text-ink-3">· sinh {course.total_sessions} buổi</span>}</legend>
            <div className="space-y-2">
              {f.values.schedule.map((x, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                  <Select aria-label={`Thứ (khung ${i + 1})`} value={x.weekday} onChange={(e) => setSlot(i, { weekday: Number(e.target.value) })}>{Object.entries(WEEKDAYS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                  <TimeInput aria-label={`Giờ bắt đầu (khung ${i + 1})`} value={x.start} onChange={(e) => setSlot(i, { start: e.target.value })} />
                  <TimeInput aria-label={`Giờ kết thúc (khung ${i + 1})`} value={x.end} onChange={(e) => setSlot(i, { end: e.target.value })} />
                  <IconButton icon={Trash2} label={`Xóa khung ${i + 1}`} size="sm" disabled={f.values.schedule.length <= 1} onClick={() => f.set('schedule', f.values.schedule.filter((_, k) => k !== i))} />
                </div>
              ))}
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => f.set('schedule', [...f.values.schedule, { weekday: 7, start: '09:00', end: '10:30' }])}>Thêm khung giờ</Button>
              {f.errors.schedule && <p className="text-xs font-medium text-red-700">{f.errors.schedule}</p>}
            </div>
          </fieldset>
        )}
        <Field label="Ghi chú"><Textarea rows={2} {...f.bind('note')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger" title={f.formError.message}><ConflictList error={f.formError} /></Alert>}
      </form>
    </Drawer>
  );
}

export function CourseFormModal({ open, onOpenChange, course, onSaved }) {
  const { courses, reload } = useLookups();
  const toast = useToast();
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    f.setValues(course ? { ...course, age_range: course.age_range || '', description: course.description || '', next_course_id: course.next_course_id ? String(course.next_course_id) : '' }
      : { code: '', name: '', program: '', level: '', age_range: '', total_sessions: 24, session_minutes: 90, tuition_fee: '', description: '', status: 'active', next_course_id: '' });
    f.setErrors({}); f.setFormError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const body = { ...v, total_sessions: Number(v.total_sessions), session_minutes: Number(v.session_minutes), next_course_id: v.next_course_id || null };
    if (course) await api.put(`/api/classes/courses/${course.id}`, body); else await api.post('/api/classes/courses', body);
    toast.success(course ? 'Đã cập nhật khóa học.' : 'Đã tạo khóa học.'); reload(); onSaved?.(); onOpenChange(false);
  }, (v) => ({ code: !v.code?.trim() && 'Nhập mã.', name: !v.name?.trim() && 'Nhập tên.', program: !v.program?.trim() && 'Nhập chương trình.', level: !v.level?.trim() && 'Nhập trình độ.', tuition_fee: !(v.tuition_fee > 0) && 'Nhập học phí lớn hơn 0.' }));
  if (f.values.code === undefined) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title={course ? `Sửa khóa ${course.code}` : 'Thêm khóa học'} description={course ? 'Học phí mới chỉ áp dụng cho đăng ký mới; đăng ký cũ giữ học phí lúc đăng ký.' : undefined}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Lưu</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Mã khóa" required error={f.errors.code}><Input {...f.bind('code')} /></Field>
          <Field label="Tên khóa" required error={f.errors.name}><Input {...f.bind('name')} /></Field>
          <Field label="Chương trình" required error={f.errors.program}><Input {...f.bind('program')} /></Field>
          <Field label="Trình độ" required error={f.errors.level}><Input {...f.bind('level')} /></Field>
          <Field label="Độ tuổi"><Input {...f.bind('age_range')} /></Field>
          <Field label="Học phí" required error={f.errors.tuition_fee}><MoneyInput value={f.values.tuition_fee} onChange={(n) => f.set('tuition_fee', n)} /></Field>
          <Field label="Số buổi" required error={f.errors.total_sessions}><Input type="number" min={1} {...f.bind('total_sessions')} /></Field>
          <Field label="Phút/buổi" required error={f.errors.session_minutes}><Input type="number" min={30} {...f.bind('session_minutes')} /></Field>
          <Field label="Khóa tiếp theo (tái đăng ký)"><Select {...f.bind('next_course_id')} placeholder="— Không —">{courses.filter((c) => c.id !== course?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Trạng thái"><Select {...f.bind('status')}><option value="active">Đang mở</option><option value="archived">Ngừng tuyển</option></Select></Field>
        </FormGrid>
        <Field label="Mô tả"><Textarea rows={2} {...f.bind('description')} /></Field>
        {f.values.tuition_fee > 0 && <p className="text-xs text-ink-3">Học phí: {money(f.values.tuition_fee)}</p>}
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
