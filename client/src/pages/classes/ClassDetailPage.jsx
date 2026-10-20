import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil, UserPlus, CalendarPlus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useLookups, useAuth } from '../../lib/auth.jsx';
import AssessmentsTab from './AssessmentsTab.jsx';
import { date, weekdayLabel, phone, todayVN, dateTime, money } from '../../lib/format.js';
import { EVENT_KINDS } from '../../lib/labels.js';
import {
  Card, Button, StatusBadge, Badge, KeyValue, Tabs, DataTable, EmptyState, ErrorState, LoadingRows, Modal, Field, Input, Select, FormGrid, Alert, ConflictList, useForm, useToast, Spinner, ProgressBar, Timeline, DateInput, TimeInput,
} from '../../components/ui/index.js';
import SessionDrawer from '../../components/business/SessionDrawer.jsx';
import { ClassFormDrawer } from './ClassForms.jsx';

export default function ClassDetailPage() {
  const { can, user } = useAuth();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'students';
  const sessionId = params.get('session');
  const setQ = (patch) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } return n; }, { replace: true });
  const { data, error, loading, reload } = useApi(`/api/classes/${id}`);
  const [modal, setModal] = useState(null);
  const today = todayVN();

  if (error && !data) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card>{loading && <LoadingRows />}</Card>;
  const c = data.class;
  const done = data.sessions.filter((s) => s.status === 'done').length;
  const total = data.sessions.filter((s) => s.status !== 'cancelled').length;

  const studentCols = [
    { key: 'name', header: 'Học viên', mobile: 'title', className: 'min-w-40', render: (s) => <div><Link to={`/students/${s.id}`} className="whitespace-nowrap font-medium text-ink hover:text-brand-700 hover:underline">{s.full_name}</Link><p className="text-xs text-ink-3">{s.code}</p></div> },
    data.can.contacts && { key: 'parent', header: 'Phụ huynh', className: 'min-w-36', render: (s) => (s.parent ? <span className="text-[13px]">{s.parent.full_name}<span className="block text-xs text-ink-3 tabular">{phone(s.parent.phone)}</span></span> : '—') },
    { key: 'usage', header: 'Buổi đã tính / còn', render: (s) => <span className="tabular">{s.usage.used}/{s.usage.total} · <span className={s.usage.remaining <= 4 ? 'font-semibold text-amber-700' : ''}>còn {s.usage.remaining}</span>{s.usage.freeAbsences ? <span className="block text-xs text-ink-3">Nghỉ miễn phí {s.usage.freeUsed}/{s.usage.freeAbsences}</span> : null}</span> },
    { key: 'rates', header: `CC · BTVN (≥${data.flagRate}%)`, render: (s) => {
      const st = s.stats || {};
      const cell = (v, n, min) => (v === null || v === undefined ? '—' : <span className={n >= min && v < data.flagRate ? 'font-semibold text-red-700' : ''}>{v}%</span>);
      return <span className="tabular">{cell(st.attendanceRate, st.marked, 4)} · {cell(st.homeworkDoneRate, st.hwGraded, 3)}{s.flags?.length > 0 && <span className="mt-0.5 block"><Badge tone="danger">Cần quan tâm</Badge></span>}</span>;
    } },
    data.can.finance && { key: 'paid', header: 'Đã đóng · ngày đóng', render: (s) => <span className="text-[13px] tabular">{money(s.paid)}<span className="block text-xs text-ink-3">{s.last_paid_at ? date(s.last_paid_at) : 'Chưa đóng'}</span>{s.payment_status && s.payment_status !== 'paid' && <span className="mt-0.5 block"><StatusBadge kind="payment" value={s.payment_status} /></span>}</span> },
    { key: 'end', header: 'Dự kiến hết phí', render: (s) => (s.expected_end ? <span className={s.usage.remaining <= 4 ? 'font-semibold text-amber-700' : 'tabular'}>{date(s.expected_end)}</span> : '—') },
    data.can.renew && { key: 'renew', header: '', stop: true, render: (s) => s.usage.remaining <= 8 && <Link to={`/students/${s.id}?tab=classes`} className="whitespace-nowrap text-[13px] font-medium text-brand-700 hover:underline">Nhập tái phí</Link> },
  ].filter(Boolean);
  const flagged = data.students.filter((s) => s.flags?.length);

  const sessionCols = [
    { key: 'date', header: 'Buổi', mobile: 'title', render: (s) => <span className="font-medium tabular">{s.seq_no ? `#${s.seq_no} · ` : ''}{weekdayLabel(s.date)} {date(s.date)}</span> },
    { key: 'time', header: 'Giờ', render: (s) => <span className="tabular">{s.start_time}–{s.end_time}</span> },
    { key: 'room', header: 'Phòng · GV', render: (s) => <span className="text-[13px]">{s.room_name} · {s.teacher_name}</span> },
    { key: 'topic', header: 'Nội dung', render: (s) => <span className="text-[13px] text-ink-2">{s.status === 'cancelled' ? `Hủy: ${s.cancel_reason}` : s.topic || '—'}</span> },
    { key: 'att', header: 'Có mặt', align: 'right', render: (s) => (s.marked_count ? `${s.present_count}/${s.marked_count}` : '—') },
    { key: 'status', header: 'Trạng thái', render: (s) => <div className="flex gap-1"><StatusBadge kind="session" value={s.status} />{s.date === today && s.status === 'scheduled' && <Badge tone="warning">Hôm nay</Badge>}</div> },
  ];

  return (
    <div>
      <Link to="/classes" className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />Danh sách lớp</Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{c.code} · {c.name}</h1><StatusBadge kind="class" value={c.status} /></div>
          <p className="mt-1 text-sm text-ink-3">{c.course_name} ({c.level}) · {c.schedule_text}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.can.edit && ['planned', 'active'].includes(c.status) && <Button variant="secondary" icon={UserPlus} onClick={() => setModal('add')}>Thêm học viên</Button>}
          {data.can.schedule && ['planned', 'active'].includes(c.status) && <Button variant="secondary" icon={CalendarPlus} onClick={() => setModal('session')}>Thêm buổi</Button>}
          {data.can.edit && <Button variant="secondary" icon={Pencil} onClick={() => setModal('edit')}>Sửa lớp</Button>}
        </div>
      </div>

      <Card className="mb-4 p-4 sm:p-5">
        <KeyValue cols={3} items={[
          ['Giáo viên', c.teacher_name], ['Trợ giảng', c.assistant_name || 'Không có'], ['Chủ nhiệm (CM)', c.homeroom_name || 'Chưa gán'], ['Phòng', `${c.room_name} (sức chứa ${c.room_capacity})`],
          ['Sĩ số', <span key="o" className={c.occupancy >= c.max_students ? 'font-semibold text-red-700' : ''}>{c.occupancy}/{c.max_students}{c.occupancy >= c.max_students ? ' — đã đủ' : ''}</span>],
          ['Thời gian', `${date(c.start_date)} → ${date(c.end_date)}`],
          ['Tiến độ', <div key="p" className="max-w-56"><p className="mb-1 text-[13px] tabular">{done}/{total} buổi đã dạy</p><ProgressBar value={done} max={total} /></div>],
        ]} />
        {c.note && <p className="mt-3 text-[13px] text-ink-2">{c.note}</p>}
      </Card>

      <Card>
        <Tabs className="px-4 sm:px-5" value={tab} onChange={(t) => setQ({ tab: t === 'students' ? '' : t })} tabs={[
          { value: 'students', label: 'Học viên', count: data.students.filter((s) => s.status === 'active').length },
          { value: 'sessions', label: 'Buổi học', count: data.sessions.length },
          { value: 'scores', label: 'Điểm kiểm tra' },
          { value: 'events', label: 'Test & họp PH', count: data.events.filter((e) => e.status === 'scheduled').length },
          { value: 'history', label: 'Lịch sử' },
        ]} />
        {tab === 'students' && flagged.length > 0 && <Alert tone="danger" className="mx-4 mt-4 sm:mx-5" title={`${flagged.length} học viên dưới ngưỡng ${data.flagRate}%`}>{flagged.map((s) => `${s.full_name} (${s.flags.join(', ')})`).join(' · ')}</Alert>}
        {tab === 'events' && (
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[13px] text-ink-3">Kiểm tra định kỳ và họp phụ huynh hằng tháng. Trả kết quả test cho phụ huynh trong 5 ngày.</p><Link to="/class-events" className="text-[13px] font-medium text-brand-700 hover:underline">{data.can.events ? 'Đặt lịch / cập nhật' : 'Xem lịch toàn trung tâm'}</Link></div>
            {!data.events.length ? <EmptyState compact title="Chưa có lịch test / họp phụ huynh" /> : (
              <ul className="divide-y divide-line rounded-lg ring-1 ring-inset ring-line">
                {data.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
                    <span><b className="font-medium">{date(e.date)}{e.start_time ? ` ${e.start_time}` : ''}</b> · {EVENT_KINDS[e.kind]} · {e.title}</span>
                    <span className="flex gap-1.5"><StatusBadge kind="classEvent" value={e.status} />{e.kind === 'test' && e.status === 'done' && (e.results_returned_at ? <Badge tone="success">Đã trả KQ</Badge> : <Badge tone={e.results_due < today ? 'danger' : 'warning'}>Hạn trả KQ {date(e.results_due)}</Badge>)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tab === 'students' && <DataTable columns={studentCols} rows={data.students} rowKey="enrollment_id" caption="Học viên trong lớp" empty={<EmptyState title="Lớp chưa có học viên" action={data.can.edit && <Button icon={UserPlus} onClick={() => setModal('add')}>Thêm học viên</Button>} />} />}
        {tab === 'sessions' && <DataTable columns={sessionCols} rows={data.sessions} pageSize={40} onRowClick={(s) => setQ({ session: String(s.id) })} rowClassName={(s) => (s.date === today ? 'bg-amber-50/40' : s.status === 'cancelled' ? 'opacity-60' : '')} caption="Buổi học của lớp" />}
        {tab === 'scores' && <AssessmentsTab cls={c} students={data.students} canEdit={can('learning.edit') || (can('learning.edit_own') && [c.teacher_id, c.assistant_id, c.homeroom_id].includes(user?.id))} />}
        {tab === 'history' && <div className="p-5"><Timeline items={data.history.map((h) => ({ key: h.id, title: h.summary, meta: `${h.by_name || 'Hệ thống'} · ${dateTime(h.created_at)}` }))} /></div>}
      </Card>

      <SessionDrawer open={!!sessionId} sessionId={sessionId} onOpenChange={(v) => !v && setQ({ session: '' })} onChanged={reload} />
      <ClassFormDrawer open={modal === 'edit'} onOpenChange={(v) => !v && setModal(null)} cls={c} onSaved={reload} />
      <AddStudentModal open={modal === 'add'} onOpenChange={(v) => !v && setModal(null)} cls={c} onDone={reload} />
      <AddSessionModal open={modal === 'session'} onOpenChange={(v) => !v && setModal(null)} cls={c} onDone={reload} />
    </div>
  );
}

function AddStudentModal({ open, onOpenChange, cls, onDone }) {
  const cands = useApi(open ? `/api/classes/${cls.id}/candidates` : null, { keepPrevious: false });
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) setErr(null); }, [open]);
  const add = async (e) => {
    setBusy(e.enrollment_id); setErr(null);
    try { await api.post(`/api/classes/${cls.id}/students`, { enrollment_id: e.enrollment_id }); toast.success(`Đã xếp ${e.full_name} vào lớp ${cls.code}.`); cands.reload(); onDone(); } catch (x) { setErr(x); } finally { setBusy(null); }
  };
  const full = cls.occupancy >= cls.max_students;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Thêm học viên vào ${cls.code}`} description="Danh sách đăng ký cùng khóa đang chờ xếp lớp hoặc bảo lưu."
      footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>Đóng</Button>}>
      {full && <Alert tone="warning" className="mb-3" title={`Lớp đã đủ sĩ số (${cls.occupancy}/${cls.max_students})`}>Không thể xếp thêm. Tăng sĩ số tối đa (nếu phòng cho phép) trong “Sửa lớp” hoặc chọn lớp khác.</Alert>}
      {cands.loading && <Spinner />}
      {cands.data && !cands.data.items.length && <EmptyState compact title="Không có đăng ký chờ xếp lớp" description="Tạo đăng ký khóa ở hồ sơ học viên trước." />}
      <ul className="divide-y divide-line">
        {cands.data?.items.map((e) => (
          <li key={e.enrollment_id} className="flex items-center justify-between gap-3 py-2.5">
            <div><p className="text-sm font-medium">{e.full_name}</p><p className="text-xs text-ink-3">{e.student_code} · {e.code} · <StatusBadge kind="enrollment" value={e.status} /></p></div>
            <Button size="sm" loading={busy === e.enrollment_id} disabled={full || !!busy} onClick={() => add(e)}>Xếp vào lớp</Button>
          </li>
        ))}
      </ul>
      {err && <Alert tone="danger" className="mt-3" title={err.message}><ConflictList error={err} /></Alert>}
    </Modal>
  );
}

function AddSessionModal({ open, onOpenChange, cls, onDone }) {
  const { rooms, teachers } = useLookups();
  const toast = useToast();
  const f = useForm({});
  useEffect(() => { if (open) { f.setValues({ date: todayVN(), start_time: cls.schedule[0]?.start || '17:30', end_time: cls.schedule[0]?.end || '19:00', room_id: String(cls.room_id), teacher_id: String(cls.teacher_id), assistant_id: cls.assistant_id ? String(cls.assistant_id) : '', title: '', reason: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    await api.post('/api/sessions', { ...v, class_id: cls.id, room_id: Number(v.room_id), teacher_id: Number(v.teacher_id), assistant_id: v.assistant_id ? Number(v.assistant_id) : null });
    toast.success('Đã thêm buổi học.'); onOpenChange(false); onDone();
  }, (v) => ({ end_time: v.end_time <= v.start_time && 'Giờ kết thúc phải sau giờ bắt đầu.' }));
  if (f.values.date === undefined) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Thêm buổi học cho ${cls.code}`} description="Ví dụ buổi bổ sung bù cho buổi trung tâm đã hủy. Có kiểm tra trùng phòng, giáo viên, học viên."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Thêm buổi</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Ngày" required error={f.errors.date}><DateInput min={todayVN()} {...f.bind('date')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bắt đầu" required error={f.errors.start_time}><TimeInput {...f.bind('start_time')} /></Field>
            <Field label="Kết thúc" required error={f.errors.end_time}><TimeInput {...f.bind('end_time')} /></Field>
          </div>
          <Field label="Phòng" required><Select {...f.bind('room_id')}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="Giáo viên" required><Select {...f.bind('teacher_id')}>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          <Field label="Trợ giảng" error={f.errors.assistant_id}><Select {...f.bind('assistant_id')} placeholder="— Không có —">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          <Field label="Lý do / ghi chú"><Input {...f.bind('reason')} /></Field>
        </FormGrid>
        {f.formError && <Alert tone="danger" title={f.formError.message}><ConflictList error={f.formError} /></Alert>}
      </div>
    </Modal>
  );
}
