import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Pencil, Plus, Trash2, ChevronLeft, ChevronRight, Check, X, Clock } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, phone, addDays, startOfWeek, todayVN, WEEKDAYS_SHORT, isoWeekday, dateTime } from '../../lib/format.js';
import { ROLE_LABELS, LEAVE_KINDS } from '../../lib/labels.js';
import {
  PageHeader, Card, Tabs, DataTable, DataState, FilterBar, Select, StatusBadge, Badge, Button, IconButton, EmptyState, Modal, Field, Input, Textarea, FormGrid, Alert, Checkbox, useForm, useToast, ConfirmDialog, DateInput, TimeInput,
} from '../../components/ui/index.js';
import { PeriodFilter } from '../../components/PeriodFilter.jsx';

export default function HrPage() {
  const { can } = useAuth();
  const tabs = [
    can('hr.view') && { value: 'staff', label: 'Nhân sự & vai trò' },
    { value: 'schedule', label: 'Lịch làm việc / dạy' },
    { value: 'leaves', label: 'Đơn xin nghỉ' },
    can('teaching.log', 'teaching.approve') && { value: 'teaching', label: 'Giờ dạy thực tế' },
  ].filter(Boolean);
  const [f, setF] = useUrlFilters({ tab: tabs[0].value, week: '', period: 'month', from: '', to: '', user_id: '', status: '' });
  return (
    <div>
      <PageHeader title={can('hr.view') ? 'Nhân sự – Giờ dạy' : 'Lịch làm & giờ dạy'} description="Danh sách nhân sự, lịch làm việc và dạy, đơn nghỉ, ghi nhận và duyệt giờ dạy. Bản demo không tính lương." />
      <Card>
        <Tabs className="px-4 sm:px-5" tabs={tabs} value={f.tab} onChange={(tab) => setF({ tab })} />
        {f.tab === 'staff' && <StaffTab />}
        {f.tab === 'schedule' && <ScheduleTab f={f} setF={setF} />}
        {f.tab === 'leaves' && <LeavesTab />}
        {f.tab === 'teaching' && <TeachingTab f={f} setF={setF} />}
      </Card>
    </div>
  );
}

function StaffTab() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi('/api/hr/staff');
  const [edit, setEdit] = useState(null);
  const columns = [
    { key: 'name', header: 'Nhân sự', mobile: 'title', render: (s) => <div><p className="font-medium">{s.full_name}</p><p className="text-xs text-ink-3">{s.code} · {s.title}</p></div> },
    { key: 'roles', header: 'Vai trò', render: (s) => <div className="flex flex-wrap gap-1">{s.roles.map((r) => <Badge key={r} tone="brand" dot={false}>{ROLE_LABELS[r]}</Badge>)}</div> },
    { key: 'contact', header: 'Liên hệ', render: (s) => <div className="text-[13px]"><p className="tabular">{phone(s.phone)}</p><p className="text-ink-3">{s.email}</p></div> },
    { key: 'employment', header: 'Hình thức', render: (s) => (s.employment === 'full_time' ? 'Toàn thời gian' : 'Bán thời gian') },
    { key: 'classes', header: 'Lớp phụ trách', render: (s) => s.classes.join(', ') || '—' },
    { key: 'status', header: 'Trạng thái', render: (s) => <div className="flex flex-wrap gap-1"><StatusBadge kind="staff" value={s.status} />{s.on_leave && <Badge tone="warning">Đang nghỉ phép</Badge>}</div> },
    can('hr.edit') && { key: 'act', header: '', stop: true, render: (s) => <IconButton icon={Pencil} label={`Sửa ${s.full_name}`} size="sm" onClick={() => setEdit(s)} /> },
  ].filter(Boolean);
  return (
    <>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>{(d) => <DataTable columns={columns} rows={d.items} caption="Nhân sự" />}</DataState>
      <StaffModal open={!!edit} onOpenChange={(v) => !v && setEdit(null)} staff={edit} onSaved={reload} />
    </>
  );
}

function StaffModal({ open, onOpenChange, staff, onSaved }) {
  const toast = useToast();
  const { reload } = useLookups();
  const f = useForm({});
  useEffect(() => { if (open && staff) { f.setValues({ title: staff.title || '', phone: staff.phone || '', email: staff.email || '', employment: staff.employment, status: staff.status, roles: staff.roles }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!staff || !f.values.roles) return null;
  const toggle = (r, c) => f.set('roles', c ? [...f.values.roles, r] : f.values.roles.filter((x) => x !== r));
  const save = () => f.submit(async (v) => { await api.put(`/api/hr/staff/${staff.id}`, v); toast.success('Đã cập nhật nhân sự.'); reload(); onOpenChange(false); onSaved?.(); }, (v) => ({ roles: !v.roles.length && 'Chọn ít nhất một vai trò.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title={`Sửa ${staff.full_name}`} description="Một người có thể kiêm nhiều vai trò; quyền là hợp của các vai trò."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Lưu</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Chức danh" required error={f.errors.title}><Input {...f.bind('title')} /></Field>
          <Field label="Hình thức"><select className="field-input" {...f.bind('employment')}><option value="full_time">Toàn thời gian</option><option value="part_time">Bán thời gian</option></select></Field>
          <Field label="Số điện thoại" error={f.errors.phone}><Input {...f.bind('phone')} /></Field>
          <Field label="Email" error={f.errors.email}><Input {...f.bind('email')} /></Field>
          <Field label="Trạng thái"><select className="field-input" {...f.bind('status')}><option value="active">Đang làm việc</option><option value="inactive">Ngừng hoạt động</option></select></Field>
        </FormGrid>
        <fieldset><legend className="mb-2 text-[13px] font-medium text-ink-2">Vai trò</legend>
          <div className="grid gap-2 sm:grid-cols-2">{Object.entries(ROLE_LABELS).map(([k, l]) => <Checkbox key={k} label={l} checked={f.values.roles.includes(k)} onChange={(c) => toggle(k, c)} />)}</div>
          {f.errors.roles && <p className="mt-1 text-xs font-medium text-red-700">{f.errors.roles}</p>}
        </fieldset>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function ScheduleTab({ f, setF }) {
  const today = todayVN();
  const from = f.week || startOfWeek(today);
  const { data, error, loading, reload } = useApi(`/api/hr/schedule?from=${from}`);
  const [add, setAdd] = useState(null);
  const [del, setDel] = useState(null);
  const toast = useToast();
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <>
      <FilterBar>
        <IconButton icon={ChevronLeft} label="Tuần trước" variant="secondary" onClick={() => setF({ week: addDays(from, -7) })} />
        <Button variant="secondary" onClick={() => setF({ week: '' })}>Tuần này</Button>
        <IconButton icon={ChevronRight} label="Tuần sau" variant="secondary" onClick={() => setF({ week: addDays(from, 7) })} />
        <span className="text-sm font-semibold tabular">{date(from)} – {date(addDays(from, 6))}</span>
        <span className="text-xs text-ink-3 sm:ml-auto">Ô xanh: ca làm việc · ô viền trái: buổi dạy/trợ giảng · ô vàng: nghỉ phép đã duyệt</span>
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[960px] table-fixed border-collapse text-xs">
              <thead><tr className="bg-canvas/70"><th scope="col" className="sticky left-0 z-10 w-44 bg-canvas px-3 py-2 text-left font-semibold text-ink-3">Nhân sự</th>
                {days.map((x) => <th key={x} scope="col" className={clsx('px-2 py-2 text-left font-semibold', x === today ? 'text-brand-700' : 'text-ink-3')}>{WEEKDAYS_SHORT[isoWeekday(x)]} {date(x).slice(0, 5)}</th>)}</tr></thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-normal"><p className="text-[13px] font-medium text-ink">{p.full_name}</p><p className="text-ink-3">{p.title}</p></th>
                    {days.map((x) => {
                      const leave = d.leaves.find((l) => l.user_id === p.id && l.from_date <= x && l.to_date >= x);
                      return (
                        <td key={x} className={clsx('space-y-1 px-1.5 py-1.5', x === today && 'bg-brand-50/30')}>
                          {leave && <div className="rounded bg-amber-100 px-1.5 py-1 font-medium text-amber-900">Nghỉ: {LEAVE_KINDS[leave.kind]}</div>}
                          {d.shifts.filter((s) => s.user_id === p.id && s.date === x).map((s) => (
                            <div key={`s${s.id}`} className="group flex items-center justify-between gap-1 rounded bg-brand-50 px-1.5 py-1 text-brand-900">
                              <span className="tabular">Ca {s.start_time}–{s.end_time}</span>
                              {d.canEdit && <button type="button" aria-label={`Xóa ca ${s.start_time} của ${p.full_name}`} onClick={() => setDel(s)} className="rounded p-0.5 text-brand-700 opacity-60 hover:bg-surface hover:opacity-100"><Trash2 className="size-3" /></button>}
                            </div>
                          ))}
                          {d.teaching.filter((t) => t.user_id === p.id && t.date === x).map((t) => (
                            <div key={`t${t.id}`} className="rounded border border-line border-l-[3px] border-l-sky-500 bg-surface px-1.5 py-1">
                              <p className="font-medium tabular">{t.start_time}–{t.end_time}</p><p className="text-ink-3">{t.role === 'teacher' ? 'Dạy' : 'Trợ giảng'} {t.label} · {t.room_name}</p>
                            </div>
                          ))}
                          {d.canEdit && <button type="button" onClick={() => setAdd({ user_id: p.id, date: x, name: p.full_name })} className="w-full rounded border border-dashed border-line py-0.5 text-[11px] text-ink-3 hover:border-brand-300 hover:text-brand-700" aria-label={`Thêm ca cho ${p.full_name} ngày ${date(x)}`}>+ ca</button>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
      <ShiftModal open={!!add} onOpenChange={(v) => !v && setAdd(null)} slot={add} onDone={reload} />
      <ConfirmDialog open={!!del} onOpenChange={(v) => !v && setDel(null)} title="Xóa ca làm việc?" confirmLabel="Xóa ca" message={del && `Ca ${del.start_time}–${del.end_time} ngày ${date(del.date)} của ${del.full_name}.`}
        onConfirm={async () => { await api.del(`/api/hr/shifts/${del.id}`); toast.success('Đã xóa ca.'); reload(); }} />
    </>
  );
}

function ShiftModal({ open, onOpenChange, slot, onDone }) {
  const toast = useToast();
  const f = useForm({ start_time: '08:00', end_time: '17:00', note: '' });
  useEffect(() => { if (open) { f.setValues({ start_time: '08:00', end_time: '17:00', note: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!slot) return null;
  const save = () => f.submit(async (v) => { await api.post('/api/hr/shifts', { user_id: slot.user_id, date: slot.date, ...v }); toast.success('Đã thêm ca.'); onOpenChange(false); onDone(); }, (v) => ({ end_time: v.end_time <= v.start_time && 'Giờ kết thúc phải sau giờ bắt đầu.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm" title="Thêm ca làm việc" description={`${slot.name} · ${date(slot.date)}`} footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Thêm ca</Button></>}>
      <div className="space-y-4">
        <FormGrid><Field label="Bắt đầu" error={f.errors.start_time}><TimeInput {...f.bind('start_time')} /></Field><Field label="Kết thúc" error={f.errors.end_time}><TimeInput {...f.bind('end_time')} /></Field></FormGrid>
        <Field label="Ghi chú"><Input {...f.bind('note')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function LeavesTab() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi('/api/hr/leaves');
  const [open, setOpen] = useState(false);
  const columns = [
    { key: 'name', header: 'Nhân sự', mobile: 'title', render: (l) => <span className="font-medium">{l.full_name}</span> },
    { key: 'kind', header: 'Loại', render: (l) => LEAVE_KINDS[l.kind] },
    { key: 'range', header: 'Thời gian', render: (l) => <span className="tabular">{date(l.from_date)} → {date(l.to_date)}</span> },
    { key: 'reason', header: 'Lý do', render: (l) => <span className="text-[13px]">{l.reason}</span> },
    { key: 'status', header: 'Trạng thái', render: (l) => <StatusBadge kind="leave" value={l.status} /> },
    { key: 'decided', header: 'Người duyệt', render: (l) => (l.decided_by_name ? <span className="text-[13px]">{l.decided_by_name}{l.decision_note ? ` — ${l.decision_note}` : ''}</span> : '—') },
    { key: 'link', header: 'Đề xuất', render: (l) => (l.approval_id ? <a href={`/approvals?id=${l.approval_id}`} className="text-brand-700 hover:underline">{l.approval_code}</a> : '—') },
  ];
  return (
    <>
      <FilterBar><p className="text-[13px] text-ink-3">Đơn nghỉ được gửi tới quản lý duyệt tại mục Đề xuất – Phê duyệt.</p>{can('approvals.create') && <Button className="sm:ml-auto" icon={Plus} onClick={() => setOpen(true)}>Tạo đơn nghỉ</Button>}</FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>{(d) => <DataTable columns={columns} rows={d.items} caption="Đơn xin nghỉ" empty={<EmptyState title="Chưa có đơn xin nghỉ" />} />}</DataState>
      <LeaveModal open={open} onOpenChange={setOpen} onDone={reload} />
    </>
  );
}

function LeaveModal({ open, onOpenChange, onDone }) {
  const toast = useToast();
  const f = useForm({ kind: 'annual', from_date: todayVN(), to_date: todayVN(), reason: '' });
  useEffect(() => { if (open) { f.setValues({ kind: 'annual', from_date: addDays(todayVN(), 3), to_date: addDays(todayVN(), 3), reason: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => { const r = await api.post('/api/hr/leaves', v); toast.success(`Đã gửi đơn nghỉ${r.affectedSessions ? `; ảnh hưởng ${r.affectedSessions} buổi dạy` : ''}.`); onOpenChange(false); onDone(); },
    (v) => ({ reason: !v.reason.trim() && 'Nhập lý do.', to_date: v.to_date < v.from_date && 'Ngày kết thúc phải từ ngày bắt đầu.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Tạo đơn xin nghỉ" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Gửi đơn</Button></>}>
      <div className="space-y-4">
        <Field label="Loại nghỉ"><select className="field-input" {...f.bind('kind')}>{Object.entries(LEAVE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <FormGrid><Field label="Từ ngày" error={f.errors.from_date}><DateInput {...f.bind('from_date')} /></Field><Field label="Đến ngày" error={f.errors.to_date}><DateInput {...f.bind('to_date')} /></Field></FormGrid>
        <Field label="Lý do" required error={f.errors.reason}><Textarea rows={2} {...f.bind('reason')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function TeachingTab({ f, setF }) {
  const { can } = useAuth();
  const { teachers } = useLookups();
  const toast = useToast();
  const params = qs({ period: f.period, from: f.from, to: f.to, user_id: f.user_id, status: f.status });
  const logs = useApi(`/api/hr/teaching-logs${params}`);
  const summary = useApi(`/api/hr/teaching-summary${qs({ period: f.period, from: f.from, to: f.to })}`);
  const [sel, setSel] = useState([]);
  const [reject, setReject] = useState(false);
  const [logSession, setLogSession] = useState(null);
  const approve = can('teaching.approve');
  const review = async (decision, note) => {
    const r = await api.post('/api/hr/teaching-logs/review', { ids: sel, decision, note: note || null });
    toast.success(`Đã ${decision === 'approved' ? 'duyệt' : 'từ chối'} ${r.updated} dòng giờ dạy.`); setSel([]); logs.reload(); summary.reload();
  };
  const pending = logs.data?.items.filter((l) => l.status === 'pending') || [];
  const columns = [
    approve && { key: 'sel', header: <span className="sr-only">Chọn</span>, stop: true, render: (l) => (l.status === 'pending' ? <input type="checkbox" aria-label={`Chọn giờ dạy ${l.full_name} ${date(l.date)}`} className="size-4 accent-brand-600" checked={sel.includes(l.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} /> : null) },
    { key: 'name', header: 'Nhân sự', mobile: 'title', render: (l) => <span className="font-medium">{l.full_name}</span> },
    { key: 'session', header: 'Buổi', render: (l) => <span className="tabular">{date(l.date)} {l.start_time}–{l.end_time} · {l.class_label}</span> },
    { key: 'role', header: 'Vai trò', render: (l) => (l.role === 'teacher' ? 'Dạy chính' : 'Trợ giảng') },
    { key: 'minutes', header: 'Số phút', align: 'right', render: (l) => l.minutes },
    { key: 'status', header: 'Trạng thái', render: (l) => <span title={l.review_note || undefined}><StatusBadge kind="teachingLog" value={l.status} /></span> },
    { key: 'reviewer', header: 'Người duyệt', render: (l) => (l.reviewer ? <span className="text-[13px]">{l.reviewer} · {dateTime(l.reviewed_at)}</span> : '—') },
  ].filter(Boolean);
  return (
    <>
      <FilterBar>
        <PeriodFilter period={f.period} from={f.from} to={f.to} onChange={setF} resolved={logs.data && { from: logs.data.from, to: logs.data.to }} />
        {approve && <Select aria-label="Nhân sự" className="w-full sm:w-44" value={f.user_id} onChange={(e) => setF({ user_id: e.target.value })} placeholder="Mọi giáo viên">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select>}
        <Select aria-label="Trạng thái" className="w-full sm:w-36" value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder="Mọi trạng thái"><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option></Select>
      </FilterBar>
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 xl:border-r xl:border-line">
          {approve && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-5">
              <span className="text-[13px] text-ink-3">{pending.length} dòng chờ duyệt · đã chọn {sel.length}</span>
              <Button size="sm" variant="ghost" onClick={() => setSel(pending.map((l) => l.id))} disabled={!pending.length}>Chọn tất cả chờ duyệt</Button>
              <Button size="sm" icon={Check} disabled={!sel.length} onClick={() => review('approved')}>Duyệt</Button>
              <Button size="sm" variant="danger-outline" icon={X} disabled={!sel.length} onClick={() => setReject(true)}>Từ chối</Button>
            </div>
          )}
          {logs.data?.missing?.length > 0 && (
            <Alert tone="info" className="m-4" title="Buổi đã dạy nhưng chưa ghi giờ">
              <ul className="mt-1 space-y-1">{logs.data.missing.slice(0, 5).map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2">{date(s.date)} {s.start_time} · {s.class_label}<Button size="sm" variant="secondary" icon={Clock} onClick={() => setLogSession(s)}>Ghi giờ</Button></li>)}</ul>
            </Alert>
          )}
          <DataState loading={logs.loading} error={logs.error} data={logs.data} onRetry={logs.reload}>{(d) => <DataTable columns={columns} rows={d.items} dense caption="Giờ dạy" empty={<EmptyState title="Không có dữ liệu giờ dạy trong kỳ" />} />}</DataState>
        </div>
        <aside className="border-t border-line p-4 xl:border-t-0">
          <h3 className="mb-1 text-sm font-semibold">Tổng hợp theo người</h3>
          <p className="mb-3 text-xs text-ink-3">Chỉ tính giờ đã duyệt. Không hiển thị lương vì chưa có quy tắc lương được xác nhận.</p>
          <ul className="space-y-2">
            {summary.data?.items.map((s) => (
              <li key={s.id} className="rounded-md border border-line p-2.5 text-[13px]">
                <p className="font-medium">{s.full_name}</p>
                <p className="text-ink-2 tabular">{(s.approved_minutes / 60).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ đã duyệt · {s.teacher_sessions} buổi dạy · {s.assistant_sessions} buổi trợ giảng</p>
                {s.pending_minutes > 0 && <p className="text-xs text-amber-700 tabular">+{(s.pending_minutes / 60).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ chờ duyệt</p>}
              </li>
            ))}
            {summary.data && !summary.data.items.length && <li className="text-sm text-ink-3">Chưa có dữ liệu.</li>}
          </ul>
        </aside>
      </div>
      <ConfirmDialog open={reject} onOpenChange={setReject} title={`Từ chối ${sel.length} dòng giờ dạy?`} reason reasonLabel="Lý do từ chối" confirmLabel="Từ chối" onConfirm={(note) => review('rejected', note)} />
      <LogModal session={logSession} onOpenChange={(v) => !v && setLogSession(null)} onDone={() => { logs.reload(); summary.reload(); }} />
    </>
  );
}

function LogModal({ session, onOpenChange, onDone }) {
  const toast = useToast();
  const f = useForm({ minutes: 90, note: '' });
  useEffect(() => { if (session) { const [a, b] = [session.start_time, session.end_time].map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3))); f.setValues({ minutes: b - a, note: '' }); f.setFormError(null); } }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!session) return null;
  const save = () => f.submit(async (v) => { await api.post('/api/hr/teaching-logs', { session_id: session.id, minutes: Number(v.minutes), note: v.note || null }); toast.success('Đã ghi nhận giờ dạy, chờ duyệt.'); onOpenChange(false); onDone(); });
  return (
    <Modal open={!!session} onOpenChange={onOpenChange} size="sm" title="Ghi nhận giờ dạy" description={`${date(session.date)} ${session.start_time} · ${session.class_label}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Ghi nhận</Button></>}>
      <div className="space-y-4">
        <Field label="Số phút thực tế" error={f.errors.minutes}><Input type="number" min={15} max={300} {...f.bind('minutes')} /></Field>
        <Field label="Ghi chú"><Input {...f.bind('note')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
