import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCcw, Phone, CalendarPlus, BookPlus, MessageSquarePlus } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, dateTime, phone, money, todayVN } from '../../lib/format.js';
import { CARE_TYPES, CARE_CHANNELS, STATUS } from '../../lib/labels.js';
import {
  PageHeader, Card, Tabs, DataTable, DataState, FilterBar, SearchInput, Select, StatusBadge, Badge, Button, EmptyState, Drawer, Field, Textarea, Input, FormGrid, Alert, Timeline, useForm, useToast, Segmented, KeyValue, Spinner, ErrorState, DateInput,
} from '../../components/ui/index.js';
import { MakeupModal } from '../../components/business/ClassModals.jsx';
import CareCaseModal from '../../components/business/CareCaseModal.jsx';

export default function CarePage() {
  const { can } = useAuth();
  const toast = useToast();
  const [f, setF] = useUrlFilters({ tab: 'cases', status: 'open', type: '', owner_id: '', q: '', due: '', id: '' });
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const run = async () => {
    setRunning(true);
    try {
      const r = await api.post('/api/care/run-reminders');
      const c = r.created;
      setLastRun(c);
      toast.success(`Đã quét nhắc việc: ${c.absenceCases} việc vắng học, ${c.renewalCases} việc tái đăng ký, ${c.paymentNotices} nhắc học phí, ${c.leadFollowups} nhắc gọi khách mới. Chạy lại không sinh trùng.`);
    } catch (e) { toast.error(e.message); } finally { setRunning(false); }
  };
  return (
    <div>
      <PageHeader title="Chăm sóc – Tái đăng ký" description="Học viên cần chăm sóc vì vắng, phản hồi/khiếu nại, và danh sách sắp hết khóa để tư vấn tái đăng ký."
        actions={can('care.edit') && <>
          <Button variant="secondary" icon={RefreshCcw} loading={running} onClick={run}>Quét nhắc việc</Button>
          <Button icon={MessageSquarePlus} onClick={() => setCreating(true)}>Tiếp nhận phản hồi</Button>
        </>} />
      {lastRun && <Alert tone="info" className="mb-4">Lần quét gần nhất tạo mới: {lastRun.absenceCases + lastRun.renewalCases} việc chăm sóc, {lastRun.paymentNotices + lastRun.leadFollowups} thông báo. Mỗi việc có khóa chống trùng nên quét lại không nhân đôi.</Alert>}
      <Card>
        <Tabs className="px-4 sm:px-5" value={f.tab} onChange={(tab) => setF({ tab })} tabs={[{ value: 'cases', label: 'Việc chăm sóc & phản hồi' }, { value: 'renewals', label: 'Sắp hết khóa' }]} />
        {f.tab === 'cases' ? <Cases key={version} f={f} setF={setF} /> : <Renewals />}
      </Card>
      <CareCaseModal open={creating} onOpenChange={setCreating} onDone={() => setVersion((x) => x + 1)} />
    </div>
  );
}

function Cases({ f, setF }) {
  const { activeStaff } = useLookups();
  const { data, error, loading, reload } = useApi(`/api/care${qs({ status: f.status, type: f.type, owner_id: f.owner_id, q: f.q, due: f.due })}`);
  const today = todayVN();
  const columns = [
    { key: 'title', header: 'Việc chăm sóc', mobile: 'title', render: (c) => <div><p className="font-medium">{c.title}</p><p className="text-xs text-ink-3">{c.code} · {CARE_TYPES[c.type]}{c.log_count ? ` · ${c.log_count} lần liên hệ` : ''}</p></div> },
    { key: 'student', header: 'Học viên', render: (c) => <Link to={`/students/${c.student_id}?tab=care`} onClick={(e) => e.stopPropagation()} className="hover:underline">{c.student_name}</Link> },
    { key: 'owner_name', header: 'Phụ trách' },
    { key: 'priority', header: 'Ưu tiên', render: (c) => <StatusBadge kind="priority" value={c.priority} /> },
    { key: 'due', header: 'Hạn xử lý', render: (c) => (c.due_date ? <span className={c.due_date < today && c.status !== 'done' ? 'font-medium text-red-700' : 'tabular'}>{date(c.due_date)}{c.due_date < today && c.status !== 'done' ? ' (quá hạn)' : ''}</span> : '—') },
    { key: 'status', header: 'Trạng thái', render: (c) => <StatusBadge kind="care" value={c.status} /> },
  ];
  const counts = data?.counts || {};
  return (
    <>
      <FilterBar active={f.type || f.owner_id || f.q || f.due || f.status !== 'open'} onReset={() => setF({ type: '', owner_id: '', q: '', due: '', status: 'open' })}>
        <SearchInput className="w-full sm:w-56" value={f.q} onChange={(q) => setF({ q })} placeholder="Học viên, tiêu đề…" />
        <Select aria-label="Trạng thái" className="w-full sm:w-44" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="open">Chưa hoàn thành ({(counts.new || 0) + (counts.in_progress || 0) + (counts.waiting || 0)})</option>
          {Object.entries(STATUS.care).map(([k, [l]]) => <option key={k} value={k}>{l} ({counts[k] || 0})</option>)}
          <option value="all">Tất cả</option>
        </Select>
        <Select aria-label="Loại" className="w-full sm:w-40" value={f.type} onChange={(e) => setF({ type: e.target.value })} placeholder="Mọi loại">{Object.entries(CARE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select aria-label="Người phụ trách" className="w-full sm:w-48" value={f.owner_id} onChange={(e) => setF({ owner_id: e.target.value })} placeholder="Mọi người phụ trách"><option value="me">Việc của tôi</option>{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select>
        <Select aria-label="Hạn" className="w-full sm:w-36" value={f.due} onChange={(e) => setF({ due: e.target.value })} placeholder="Mọi hạn"><option value="overdue">Quá hạn</option></Select>
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => <DataTable columns={columns} rows={d.items} onRowClick={(c) => setF({ id: String(c.id) })} caption="Việc chăm sóc" empty={<EmptyState title="Không có việc chăm sóc phù hợp" />} />}
      </DataState>
      <CareDrawer id={f.id} onOpenChange={(v) => !v && setF({ id: '' })} onChanged={reload} />
    </>
  );
}

function CareDrawer({ id, onOpenChange, onChanged }) {
  const { can } = useAuth();
  const { activeStaff } = useLookups();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(id ? `/api/care/${id}` : null, { keepPrevious: false });
  const log = useForm({ channel: 'call', content: '', result: '', next_status: '' });
  const [upd, setUpd] = useState(null);
  const [makeup, setMakeup] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { if (data) { setUpd({ status: data.case.status, owner_id: String(data.case.owner_id || ''), due_date: data.case.due_date || '', priority: data.case.priority, resolution: data.case.resolution || '' }); log.setValues({ channel: 'call', content: '', result: '', next_status: '' }); log.setErrors({}); } }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = data?.case;
  const edit = can('care.edit');
  const saveLog = () => log.submit(async (v) => {
    await api.post(`/api/care/${id}/logs`, { ...v, next_status: v.next_status || null });
    toast.success('Đã ghi kết quả liên hệ.'); reload(); onChanged?.();
  }, (v) => ({ content: !v.content.trim() && 'Nhập nội dung liên hệ.', result: v.next_status === 'done' && !v.result.trim() && 'Nhập kết quả trước khi hoàn thành.' }));
  const saveCase = async () => {
    try {
      await api.put(`/api/care/${id}`, { ...upd, owner_id: upd.owner_id ? Number(upd.owner_id) : null, due_date: upd.due_date || null, resolution: upd.resolution || null });
      toast.success('Đã cập nhật việc chăm sóc.'); reload(); onChanged?.();
    } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <Drawer open={!!id} onOpenChange={onOpenChange} width="lg" title={c ? c.title : 'Việc chăm sóc'}
        description={c && <span>{c.code} · {CARE_TYPES[c.type]} · Học viên <Link className="font-medium text-brand-700 hover:underline" to={`/students/${c.student_id}?tab=care`}>{c.student_name}</Link></span>}
        headerExtra={c && <div className="mt-2 flex flex-wrap gap-2"><StatusBadge kind="care" value={c.status} /><StatusBadge kind="priority" value={c.priority} /></div>}>
        {error && !data && <ErrorState error={error} onRetry={reload} />}
        {loading && !data && <Spinner />}
        {c && upd && (
          <div className="space-y-6">
            {c.content && <p className="rounded-md bg-canvas p-3 text-sm text-ink-2">{c.content}</p>}
            {c.attendance_id && (
              <Alert tone={c.makeup_status ? 'success' : 'warning'} title={`Buổi vắng: ${date(c.absence_date)} (${c.absence_class || 'học bù'})`}
                action={!c.makeup_status && can('makeup.edit') && <Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => setMakeup(true)}>Xếp học bù</Button>}>
                {c.makeup_status ? <>Học bù: <StatusBadge kind="makeup" value={c.makeup_status} /> {date(c.makeup_date)} {c.makeup_time}</> : 'Chưa xếp học bù.'}
              </Alert>
            )}
            {c.type === 'renewal' && c.enrollment_id && <Button variant="secondary" icon={BookPlus} onClick={() => navigate(`/students/${c.student_id}?tab=classes`)}>Mở hồ sơ để tạo đăng ký khóa tiếp theo</Button>}
            {data.contacts && (
              <section><h3 className="mb-2 text-sm font-semibold">Liên hệ phụ huynh</h3>
                <ul className="space-y-1 text-sm">{data.contacts.map((p, i) => <li key={i} className="flex items-center gap-2"><Phone className="size-3.5 text-ink-3" /><span className="tabular">{phone(p.phone)}</span> · {p.full_name} ({p.relationship})</li>)}</ul>
              </section>
            )}
            {edit && c.status !== 'done' && (
              <section className="space-y-3 rounded-[var(--radius-control)] border border-line p-4">
                <h3 className="text-sm font-semibold">Ghi kết quả liên hệ</h3>
                <Segmented ariaLabel="Kênh liên hệ" size="sm" value={log.values.channel} onChange={(ch) => log.set('channel', ch)} options={Object.entries(CARE_CHANNELS).map(([value, label]) => ({ value, label }))} />
                <Field label="Nội dung" required error={log.errors.content}><Textarea rows={2} {...log.bind('content')} /></Field>
                <FormGrid>
                  <Field label="Kết quả" error={log.errors.result}><Input {...log.bind('result')} /></Field>
                  <Field label="Chuyển trạng thái"><select className="field-input" {...log.bind('next_status')}><option value="">Giữ nguyên / Đang xử lý</option><option value="waiting">Chờ phản hồi</option><option value="done">Hoàn thành</option></select></Field>
                </FormGrid>
                <div className="flex justify-end"><Button onClick={saveLog} loading={log.submitting}>Lưu liên hệ</Button></div>
                {log.formError && !log.formError.fields && <Alert tone="danger">{log.formError.message}</Alert>}
              </section>
            )}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Lịch sử liên hệ</h3>
              <Timeline items={data.logs.map((l) => ({ key: l.id, title: <><b className="font-medium">{CARE_CHANNELS[l.channel]}:</b> {l.content}</>, body: l.result ? `Kết quả: ${l.result}` : null, meta: `${l.by_name || 'Hệ thống'} · ${dateTime(l.created_at)}` }))} empty="Chưa có lần liên hệ nào." />
            </section>
            {edit && (
              <section className="space-y-3 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Phân công & trạng thái</h3>
                <FormGrid>
                  <Field label="Trạng thái"><select className="field-input" value={upd.status} onChange={(e) => setUpd({ ...upd, status: e.target.value })}>{Object.entries(STATUS.care).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                  <Field label="Người phụ trách"><select className="field-input" value={upd.owner_id} onChange={(e) => setUpd({ ...upd, owner_id: e.target.value })}>{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
                  <Field label="Hạn xử lý"><DateInput value={upd.due_date} onChange={(e) => setUpd({ ...upd, due_date: e.target.value })} /></Field>
                  <Field label="Ưu tiên"><select className="field-input" value={upd.priority} onChange={(e) => setUpd({ ...upd, priority: e.target.value })}><option value="low">Thấp</option><option value="normal">Bình thường</option><option value="high">Cao</option></select></Field>
                </FormGrid>
                {upd.status === 'done' && <Field label="Kết quả xử lý" required><Textarea rows={2} value={upd.resolution} onChange={(e) => setUpd({ ...upd, resolution: e.target.value })} /></Field>}
                <div className="flex justify-end"><Button variant="secondary" onClick={saveCase}>Lưu phân công</Button></div>
              </section>
            )}
            {!edit && <KeyValue items={[['Người phụ trách', c.owner_name], ['Hạn', date(c.due_date)], ['Kết quả', c.resolution]]} />}
          </div>
        )}
      </Drawer>
      <MakeupModal open={makeup} onOpenChange={setMakeup} absence={c && { attendance_id: c.attendance_id, full_name: c.student_name, date: c.absence_date, class_code: c.absence_class }} onDone={() => { reload(); onChanged?.(); }} />
    </>
  );
}

function Renewals() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi('/api/care/renewals');
  const columns = [
    { key: 'student', header: 'Học viên', mobile: 'title', render: (r) => <Link to={`/students/${r.student_id}?tab=classes`} className="font-medium hover:underline">{r.student_name}</Link> },
    { key: 'course', header: 'Khóa hiện tại', render: (r) => <span className="text-[13px]">{r.course_name} · {r.class_code}</span> },
    { key: 'remaining', header: 'Còn lại', align: 'right', render: (r) => <span className="font-semibold text-amber-700">{r.usage.remaining}/{r.usage.total} buổi</span> },
    { key: 'end', header: 'Dự kiến kết thúc', render: (r) => date(r.end_date) },
    { key: 'next', header: 'Khóa tiếp theo', render: (r) => r.next_course_name || '—' },
    can('finance.view') && { key: 'debt', header: 'Công nợ', align: 'right', render: (r) => money(r.debt) },
    { key: 'care', header: 'Tư vấn tái đăng ký', render: (r) => (r.renewed ? <Badge tone="success">Đã tái đăng ký</Badge> : r.care_id ? <Link to={`/care?id=${r.care_id}`}><StatusBadge kind="care" value={r.care_status} /></Link> : <span className="text-ink-3">Chưa có việc</span>) },
  ].filter(Boolean);
  return (
    <DataState loading={loading} error={error} data={data} onRetry={reload}>
      {(d) => (<>
        <p className="border-b border-line px-4 py-3 text-[13px] text-ink-3 sm:px-5">Đăng ký đang học còn ≤ {d.threshold} buổi (tính theo quy tắc tính buổi demo). Việc “Tư vấn tái đăng ký” được tự tạo bởi bộ quét nhắc việc và tự đóng khi tạo đăng ký khóa tiếp theo.</p>
        <DataTable columns={columns} rows={d.items} caption="Sắp hết khóa" empty={<EmptyState title="Không có học viên sắp hết khóa" />} />
      </>)}
    </DataState>
  );
}
