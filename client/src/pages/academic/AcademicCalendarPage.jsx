import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, CalendarOff, CheckCircle2, Send, XCircle } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, dateTime, todayVN, addDays } from '../../lib/format.js';
import { EVENT_KINDS } from '../../lib/labels.js';
import {
  PageHeader, Card, Tabs, Button, DataTable, DataState, EmptyState, Badge, StatusBadge, Modal, Field, Input, Select, Textarea, FormGrid, Alert,
  DateInput, TimeInput, Segmented, Checkbox, Menu, useForm, useToast,
} from '../../components/ui/index.js';

// Lịch test / họp phụ huynh hằng tháng (trả kết quả test cho PH trong 5 ngày) và lịch nghỉ do trung tâm (không trừ học phí)
export default function AcademicCalendarPage() {
  const { can } = useAuth();
  const [f, setF] = useUrlFilters({ tab: 'events', month: todayVN().slice(0, 7) });
  return (
    <div>
      <PageHeader title="Test – Họp PH – Lịch nghỉ" description="Mỗi lớp đặt lịch kiểm tra và họp phụ huynh hằng tháng. Trả kết quả test cho phụ huynh trong 5 ngày sau ngày test. Nghỉ do trung tâm được bù cuối khóa, không trừ học phí." />
      <Card>
        <Tabs className="px-4 sm:px-5" value={f.tab} onChange={(tab) => setF({ tab })} tabs={[{ value: 'events', label: 'Lịch test & họp phụ huynh' }, { value: 'closures', label: 'Nghỉ do trung tâm' }]} />
        {f.tab === 'events' ? <EventsTab month={f.month} setMonth={(month) => setF({ month })} /> : <ClosuresTab canEdit={can('closures.edit')} />}
      </Card>
    </div>
  );
}

// 6 tháng trước → 3 tháng tới
function monthOptions() {
  const t = todayVN();
  const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7));
  return Array.from({ length: 10 }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 + 3 - i, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; });
}

function EventsTab({ month, setMonth }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/api/class-events${qs({ month })}`);
  const [creating, setCreating] = useState(null);
  const today = todayVN();
  const act = async (e, path, msg) => { await api.post(`/api/class-events/${e.id}/${path}`, {}); toast.success(msg); reload(); };
  const columns = [
    { key: 'date', header: 'Ngày', mobile: 'title', render: (e) => <span className="whitespace-nowrap font-medium tabular">{date(e.date)}<span className="block text-xs font-normal text-ink-3">{e.start_time || ''}</span></span> },
    { key: 'class_code', header: 'Lớp', render: (e) => <Link to={`/classes/${e.class_id}`} className="whitespace-nowrap font-medium hover:underline">{e.class_code}</Link> },
    { key: 'kind', header: 'Loại', render: (e) => <Badge tone={e.kind === 'test' ? 'info' : 'purple'}>{EVENT_KINDS[e.kind]}</Badge> },
    { key: 'title', header: 'Nội dung' },
    { key: 'homeroom_name', header: 'Chủ nhiệm' },
    { key: 'status', header: 'Trạng thái', render: (e) => <StatusBadge kind="classEvent" value={e.status} /> },
    { key: 'results', header: 'Trả kết quả cho PH', render: (e) => (e.kind !== 'test' ? <span className="text-ink-3">—</span>
      : e.results_returned_at ? <Badge tone="success">Đã trả {date(e.results_returned_at.slice(0, 10))}</Badge>
        : e.status !== 'done' ? <span className="text-[13px] text-ink-3">Hạn {date(e.results_due)}</span>
          : <Badge tone={e.results_overdue ? 'danger' : 'warning'}>{e.results_overdue ? `Quá hạn (hạn ${date(e.results_due)})` : `Hạn ${date(e.results_due)}`}</Badge>) },
    { key: 'act', header: '', stop: true, render: (e) => e.can_edit && (
      <Menu items={[
        e.status === 'scheduled' && e.date <= today && { label: 'Đánh dấu đã tổ chức', icon: CheckCircle2, onSelect: () => act(e, 'done', 'Đã cập nhật.') },
        e.kind === 'test' && e.status === 'done' && !e.results_returned_at && { label: 'Đã trả kết quả cho phụ huynh', icon: Send, onSelect: () => act(e, 'results-returned', 'Đã ghi nhận trả kết quả.') },
        e.status === 'scheduled' && { label: 'Hủy lịch', icon: XCircle, danger: true, onSelect: () => act(e, 'cancel', 'Đã hủy lịch.') },
      ].filter(Boolean)} />
    ) },
  ];
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Tháng" className="w-44">
          <Select value={month} onChange={(e) => setMonth(e.target.value)}>
            {monthOptions().map((m) => <option key={m} value={m}>Tháng {Number(m.slice(5))}/{m.slice(0, 4)}</option>)}
          </Select>
        </Field>
        {can('class_events.edit', 'classes.edit') && <Button icon={Plus} onClick={() => setCreating({})}>Đặt lịch test / họp PH</Button>}
      </div>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => (
          <>
            {d.missing.length > 0 && (
              <Alert tone="warning" title={`${d.missing.length} lớp chưa đủ lịch tháng ${month.slice(5)}/${month.slice(0, 4)}`}>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {d.missing.map((c) => (
                    <li key={c.id}><button type="button" className="rounded-md bg-surface px-2 py-1 text-xs ring-1 ring-inset ring-line hover:ring-line-strong" onClick={() => setCreating({ class_id: c.id, kind: c.test ? 'parent_meeting' : 'test' })}>
                      {c.code}: thiếu {[!c.test && 'test', !c.parent_meeting && 'họp PH'].filter(Boolean).join(' + ')}
                    </button></li>
                  ))}
                </ul>
              </Alert>
            )}
            {d.items.some((e) => e.results_overdue) && <Alert tone="danger" title="Có bài test quá 5 ngày chưa trả kết quả cho phụ huynh" />}
            <DataTable columns={columns} rows={d.items} caption="Lịch test và họp phụ huynh" rowClassName={(e) => (e.results_overdue ? 'bg-red-100/50' : undefined)}
              empty={<EmptyState title="Chưa có lịch trong tháng" description="Đặt lịch kiểm tra định kỳ và họp phụ huynh cho từng lớp." />} />
          </>
        )}
      </DataState>
      <EventModal init={creating} onClose={() => setCreating(null)} onDone={() => { setCreating(null); reload(); }} />
    </div>
  );
}

function EventModal({ init, onClose, onDone }) {
  const { classes } = useLookups();
  const { user, can } = useAuth();
  const toast = useToast();
  const own = classes.filter((c) => ['active', 'planned'].includes(c.status) && (can('classes.edit') || c.homeroom_id === user.id || c.teacher_id === user.id));
  const f = useForm({ class_id: '', kind: 'test', title: '', date: todayVN(), start_time: '', note: '' });
  useEffect(() => {
    if (init) { f.setValues({ class_id: init.class_id ? String(init.class_id) : own[0] ? String(own[0].id) : '', kind: init.kind || 'test', title: '', date: addDays(todayVN(), 3), start_time: '', note: '' }); f.setErrors({}); f.setFormError(null); }
  }, [init]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    await api.post('/api/class-events', { ...v, class_id: Number(v.class_id), start_time: v.start_time || null, title: v.title || null });
    toast.success(v.kind === 'test' ? 'Đã đặt lịch test. Hạn trả kết quả: 5 ngày sau ngày test.' : 'Đã đặt lịch họp phụ huynh.'); onDone();
  }, (v) => ({ class_id: !v.class_id && 'Chọn lớp.', date: !v.date && 'Chọn ngày.' }));
  return (
    <Modal open={!!init} onOpenChange={(o) => !o && onClose()} title="Đặt lịch test / họp phụ huynh"
      footer={<><Button variant="secondary" onClick={onClose}>Hủy</Button><Button onClick={save} loading={f.submitting}>Đặt lịch</Button></>}>
      <div className="space-y-4">
        <Field label="Loại"><Segmented ariaLabel="Loại lịch" value={f.values.kind} onChange={(k) => f.set('kind', k)} options={Object.entries(EVENT_KINDS).map(([value, label]) => ({ value, label }))} /></Field>
        <FormGrid>
          <Field label="Lớp" required error={f.errors.class_id}><Select {...f.bind('class_id')} placeholder="— Chọn lớp —">{own.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></Field>
          <Field label="Tiêu đề" hint="Để trống: tự đặt theo tháng"><Input {...f.bind('title')} /></Field>
          <Field label="Ngày" required error={f.errors.date}><DateInput {...f.bind('date')} /></Field>
          <Field label="Giờ"><TimeInput {...f.bind('start_time')} /></Field>
        </FormGrid>
        <Field label="Ghi chú"><Textarea {...f.bind('note')} /></Field>
        {f.values.kind === 'test' && <Alert tone="info">Hạn trả kết quả cho phụ huynh: <b>{f.values.date ? date(addDays(f.values.date, 5)) : '—'}</b> (5 ngày sau ngày test). Quá hạn hệ thống tạo việc nhắc chủ nhiệm.</Alert>}
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function ClosuresTab({ canEdit }) {
  const { data, error, loading, reload } = useApi('/api/closures');
  const [open, setOpen] = useState(false);
  const columns = [
    { key: 'range', header: 'Thời gian', mobile: 'title', render: (x) => <span className="font-medium tabular">{date(x.from_date)}{x.to_date !== x.from_date ? ` – ${date(x.to_date)}` : ''}</span> },
    { key: 'reason', header: 'Lý do' },
    { key: 'classes', header: 'Phạm vi', render: (x) => x.class_codes ? x.class_codes.join(', ') : <Badge tone="info">Toàn trung tâm</Badge> },
    { key: 'sessions_cancelled', header: 'Buổi hủy', align: 'right' },
    { key: 'sessions_added', header: 'Buổi bù cuối khóa', align: 'right' },
    { key: 'by', header: 'Người khai báo', render: (x) => <span className="text-[13px]">{x.created_by_name}<span className="block text-xs text-ink-3">{dateTime(x.created_at)}</span></span> },
  ];
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-ink-3">Ví dụ nghỉ Tết sớm, cúp điện, sự cố… Buổi học trong khoảng nghỉ bị hủy và được bù đủ vào cuối lịch lớp theo lịch tuần, nên <b>học phí của học viên không bị trừ</b>. Buổi đã điểm danh không bị ảnh hưởng.</p>
        {canEdit && <Button icon={CalendarOff} onClick={() => setOpen(true)}>Khai báo nghỉ</Button>}
      </div>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => <DataTable columns={columns} rows={d.items} caption="Lịch nghỉ do trung tâm" empty={<EmptyState title="Chưa có lịch nghỉ" />} />}
      </DataState>
      <ClosureModal open={open} onOpenChange={setOpen} onDone={() => { setOpen(false); reload(); }} />
    </div>
  );
}

function ClosureModal({ open, onOpenChange, onDone }) {
  const { classes } = useLookups();
  const toast = useToast();
  const active = classes.filter((c) => ['active', 'planned'].includes(c.status));
  const f = useForm({ from_date: todayVN(), to_date: todayVN(), reason: '', all: true, class_ids: [] });
  const [preview, setPreview] = useState(null);
  useEffect(() => { if (open) { f.setValues({ from_date: addDays(todayVN(), 1), to_date: addDays(todayVN(), 1), reason: '', all: true, class_ids: [] }); f.setErrors({}); f.setFormError(null); setPreview(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = (v) => ({ from_date: v.from_date, to_date: v.to_date, reason: v.reason || 'Xem trước', class_ids: v.all ? null : v.class_ids.map(Number) });
  useEffect(() => {
    if (!open || !f.values.from_date || !f.values.to_date || f.values.to_date < f.values.from_date || (!f.values.all && !f.values.class_ids.length)) { setPreview(null); return undefined; }
    const t = setTimeout(() => api.post('/api/closures/preview', body(f.values)).then(setPreview).catch(() => setPreview(null)), 300);
    return () => clearTimeout(t);
  }, [open, f.values.from_date, f.values.to_date, f.values.all, f.values.class_ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const r = await api.post('/api/closures', body(v));
    toast.success(`Đã hủy ${r.cancelled} buổi và bù ${r.added} buổi cuối khóa cho ${r.classes} lớp.`);
    if (r.warnings?.length) toast.error(`Lưu ý trùng lịch buổi bù: ${r.warnings.slice(0, 2).join('; ')}`);
    onDone();
  }, (v) => ({ reason: !v.reason.trim() && 'Nhập lý do nghỉ.', to_date: v.to_date < v.from_date && 'Đến ngày phải sau từ ngày.', class_ids: !v.all && !v.class_ids.length && 'Chọn ít nhất một lớp.' }));
  const toggle = (id) => f.set('class_ids', f.values.class_ids.includes(id) ? f.values.class_ids.filter((x) => x !== id) : [...f.values.class_ids, id]);
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Khai báo nghỉ do trung tâm" description="Buổi học bị hủy sẽ được bù vào cuối lịch lớp — học phí không bị trừ."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting} disabled={!preview?.total}>Xác nhận nghỉ & bù buổi</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Từ ngày" required><DateInput {...f.bind('from_date')} /></Field>
          <Field label="Đến ngày" required error={f.errors.to_date}><DateInput {...f.bind('to_date')} /></Field>
        </FormGrid>
        <Field label="Lý do" required error={f.errors.reason}><Input placeholder="Ví dụ: Nghỉ Tết sớm, cúp điện toàn tòa nhà" {...f.bind('reason')} /></Field>
        <Checkbox checked={f.values.all} onChange={(c) => f.set('all', c)} label="Áp dụng toàn trung tâm" description="Bỏ chọn để chọn từng lớp." />
        {!f.values.all && (
          <Field label="Lớp áp dụng" error={f.errors.class_ids}>
            <div className="flex flex-wrap gap-1.5">
              {active.map((c) => (
                <button key={c.id} type="button" aria-pressed={f.values.class_ids.includes(c.id)} onClick={() => toggle(c.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${f.values.class_ids.includes(c.id) ? 'bg-brand-100 text-brand-800 ring-brand-300' : 'bg-surface ring-line hover:ring-line-strong'}`}>{c.code}</button>
              ))}
            </div>
          </Field>
        )}
        {preview && (preview.total ? (
          <Alert tone="info" title={`Sẽ hủy ${preview.total} buổi và bù ${preview.total} buổi cuối khóa`}>
            <ul className="mt-1 space-y-0.5 text-[13px]">{preview.classes.map((c) => <li key={c.class_id}><b>{c.class_code}</b>: hủy {c.cancelled} buổi · bù {c.added.map(date).join(', ')}</li>)}</ul>
          </Alert>
        ) : <Alert tone="warning">Không có buổi học chưa điểm danh nào trong khoảng này.</Alert>)}
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
