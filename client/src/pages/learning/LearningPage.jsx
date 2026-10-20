import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCheck, Undo2, BookOpenCheck, LifeBuoy, ClipboardCheck, CheckCircle2, XCircle, Info } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, dateTime, todayVN, addDays, relativeDay } from '../../lib/format.js';
import {
  PageHeader, Card, Tabs, DataTable, DataState, Badge, Button, EmptyState, Select, Field, Textarea, DateInput, Modal, Alert,
  SearchInput, StatTile, Segmented, useToast, ConfirmDialog,
} from '../../components/ui/index.js';
import SessionDrawer from '../../components/business/SessionDrawer.jsx';

const pctText = (x) => (x === null || x === undefined ? '—' : `${x}%`);
const scoreText = (x) => (x === null || x === undefined ? '—' : String(x).replace('.', ','));

/** Học tập: check-in tại quầy, BTVN & nhận xét còn thiếu, bổ trợ học tập hằng tháng */
export default function LearningPage() {
  const { can } = useAuth();
  const tabs = [
    can('checkin.edit') && { value: 'checkin', label: 'Check-in tại quầy' },
    can('learning.edit', 'learning.edit_own') && { value: 'homework', label: 'BTVN & nhận xét' },
    can('support.view') && { value: 'support', label: 'Bổ trợ học tập' },
  ].filter(Boolean);
  const [f, setF] = useUrlFilters({ tab: tabs[0]?.value || 'checkin', date: '', month: '', state: 'needed', session: '' });
  const tab = tabs.some((t) => t.value === f.tab) ? f.tab : tabs[0]?.value;
  return (
    <div>
      <PageHeader title="Học tập – Check-in" description="Check-in học viên khi đến trung tâm, theo dõi BTVN và nhận xét còn thiếu, rà soát học viên cần bổ trợ hằng tháng." />
      <Card>
        <Tabs className="px-4 sm:px-5" tabs={tabs} value={tab} onChange={(t) => setF({ tab: t })} />
        {tab === 'checkin' && <CheckinTab f={f} setF={setF} />}
        {tab === 'homework' && <HomeworkTab onOpen={(id) => setF({ session: String(id) })} />}
        {tab === 'support' && <SupportTab f={f} setF={setF} />}
      </Card>
      <SessionDrawer open={!!f.session} sessionId={f.session} onOpenChange={(v) => !v && setF({ session: '' })} />
    </div>
  );
}

function CheckinTab({ f, setF }) {
  const toast = useToast();
  const today = todayVN();
  const day = f.date || today;
  const { data, error, loading, reload, setData } = useApi(`/api/learning/checkins?date=${day}`);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const rows = useMemo(() => (data?.items || []).filter((x) => !q || x.full_name.toLowerCase().includes(q.toLowerCase()) || x.code.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const checkin = async (st) => {
    setBusy(st.id);
    try {
      await api.post('/api/learning/checkins', { student_id: st.id });
      toast.success(`Đã check-in ${st.full_name}.`);
      await reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };
  const undo = async (st) => {
    setBusy(st.id);
    try {
      await api.del(`/api/learning/checkins/${st.checkin.id}`);
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === st.id ? { ...x, checkin: null } : x)), checked: d.checked - 1 }));
      toast.success('Đã hoàn tác check-in.');
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };
  const columns = [
    { key: 'name', header: 'Học viên', mobile: 'title', render: (x) => <span><Link to={`/students/${x.id}`} className="font-medium hover:text-brand-700 hover:underline">{x.full_name}</Link><span className="ml-1.5 text-xs text-ink-3">{x.code}</span></span> },
    { key: 'session', header: 'Buổi học', render: (x) => (x.session ? <span className="text-[13px]">{x.session.start_time}–{x.session.end_time} · {x.session.class_code || x.session.title || 'Học bù'} · {x.session.room_name}</span> : <span className="text-xs text-ink-3">Không có lịch học hôm nay</span>) },
    { key: 'status', header: 'Trạng thái', render: (x) => (x.checkin ? <Badge tone="success">Đã đến {dateTime(x.checkin.checked_at).slice(-5)} · {x.checkin.checked_by_name}</Badge> : <Badge tone="neutral">Chưa đến</Badge>) },
    {
      key: 'act', header: '', stop: true, render: (x) => (day !== today ? null : x.checkin
        ? <Button size="sm" variant="ghost" icon={Undo2} loading={busy === x.id} onClick={() => undo(x)}>Hoàn tác</Button>
        : <Button size="sm" icon={UserCheck} loading={busy === x.id} onClick={() => checkin(x)}>Check-in</Button>),
    },
  ];
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={day === today ? 'Đã check-in hôm nay' : `Đã check-in ${date(day)}`} numeric={data?.checked || 0} format={(n) => `${n}/${data?.total || 0}`} icon={UserCheck} tone="success" />
        <StatTile label="Chưa đến (có lịch)" numeric={data ? data.items.filter((x) => x.session && !x.checkin).length : 0} icon={ClipboardCheck} tone="warning" />
        {(data?.byStaff || []).slice(0, 2).map((s) => <StatTile key={s.full_name} label={`Check-in bởi ${s.full_name}`} numeric={s.n} />)}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm tên hoặc mã học viên…" className="w-full sm:w-72" />
        <Field label="Ngày" className="w-44"><DateInput value={day} max={today} onChange={(e) => setF({ date: e.target.value === today ? '' : e.target.value })} /></Field>
        {day !== today && <Button variant="secondary" onClick={() => setF({ date: '' })}>Về hôm nay</Button>}
      </div>
      <p className="text-xs text-ink-3">Danh sách gồm học viên có buổi học trong ngày. Check-in là xác nhận học viên đã đến trung tâm (do quầy lễ tân bấm), khác với điểm danh trong lớp của giáo viên.</p>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {() => <DataTable columns={columns} rows={rows} caption="Danh sách check-in" empty={<EmptyState icon={UserCheck} title="Không có học viên có lịch học trong ngày" />} />}
      </DataState>
    </div>
  );
}

function HomeworkTab({ onOpen }) {
  const { data, error, loading, reload } = useApi('/api/learning/todo');
  const today = todayVN();
  const sessionCols = [
    { key: 'date', header: 'Buổi', mobile: 'title', render: (s) => <span className="font-medium">{relativeDay(s.date, today)} · {s.start_time} · {s.class_code}</span> },
    { key: 'teacher', header: 'Giáo viên', render: (s) => s.teacher_name },
    { key: 'grade', header: 'Chưa chấm BTVN', align: 'right', render: (s) => (s.missing_grade ? <Badge tone="warning">{s.missing_grade}/{s.present}</Badge> : <span className="text-ink-3">0</span>) },
    { key: 'cmt', header: 'Chưa nhận xét', align: 'right', render: (s) => (s.missing_comment ? <Badge tone="neutral">{s.missing_comment}/{s.present}</Badge> : <span className="text-ink-3">0</span>) },
    { key: 'act', header: '', stop: true, render: (s) => <Button size="sm" variant="secondary" icon={BookOpenCheck} onClick={() => onOpen(s.id)}>Chấm BTVN</Button> },
  ];
  const missCols = [
    { key: 'name', header: 'Học viên', mobile: 'title', render: (x) => <Link to={`/students/${x.student_id}?tab=learning`} className="font-medium hover:text-brand-700 hover:underline">{x.full_name}</Link> },
    { key: 'class', header: 'Lớp', render: (x) => x.class_code },
    { key: 'times', header: 'Số buổi không làm (14 ngày)', align: 'right', render: (x) => <Badge tone={x.times >= 2 ? 'danger' : 'warning'}>{x.times}</Badge> },
    { key: 'last', header: 'Gần nhất', render: (x) => date(x.last_date) },
  ];
  return (
    <DataState loading={loading} error={error} data={data} onRetry={reload}>
      {(d) => (
        <div className="space-y-6 p-4 sm:p-5">
          <section>
            <h3 className="mb-1 text-sm font-semibold">Buổi đã dạy chưa chấm BTVN / chưa nhận xét (7 ngày qua)</h3>
            <p className="mb-3 text-xs text-ink-3">Mở buổi để chấm BTVN (Hoàn thành / Chưa đủ / Không làm), cho điểm và nhận xét từng học viên.</p>
            <DataTable columns={sessionCols} rows={d.ungraded} onRowClick={(s) => onOpen(s.id)} caption="Buổi chưa chấm"
              empty={<EmptyState compact icon={CheckCircle2} title="Đã chấm đủ" description="Không còn buổi nào thiếu chấm BTVN hay nhận xét." />} />
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold">Học viên không làm BTVN</h3>
            <DataTable columns={missCols} rows={d.missing} rowKey="student_id" caption="Học viên không làm BTVN"
              empty={<EmptyState compact icon={CheckCircle2} title="Không có học viên bỏ BTVN" />} />
          </section>
        </div>
      )}
    </DataState>
  );
}

function monthOptions() {
  const out = [];
  const t = todayVN();
  let y = Number(t.slice(0, 4)); let m = Number(t.slice(5, 7));
  for (let i = 0; i < 6; i++) {
    out.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `Tháng ${m}/${y}` });
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

function SupportTab({ f, setF }) {
  const toast = useToast();
  const months = monthOptions();
  const month = f.month || months[0].value;
  const { data, error, loading, reload } = useApi(`/api/learning/support${qs({ month })}`);
  const [modal, setModal] = useState(null);
  const rows = (data?.items || []).filter((x) => f.state === 'all' || x.state === f.state || (f.state === 'needed' && x.state === 'needed'));
  const columns = [
    { key: 'name', header: 'Học viên', mobile: 'title', render: (x) => <span><Link to={`/students/${x.id}?tab=learning`} className="font-medium hover:text-brand-700 hover:underline">{x.full_name}</Link><span className="block text-xs text-ink-3">{x.classes.join(', ')}{x.homeroom_name ? ` · CN ${x.homeroom_name}` : ''}</span></span> },
    { key: 'att', header: 'Chuyên cần', align: 'right', render: (x) => pctText(x.stats.attendanceRate) },
    { key: 'hw', header: 'Hoàn thành BTVN', align: 'right', render: (x) => pctText(x.stats.homeworkDoneRate) },
    { key: 'hwavg', header: 'Điểm BTVN TB', align: 'right', render: (x) => scoreText(x.stats.homeworkAvg) },
    { key: 'test', header: 'Điểm KT TB', align: 'right', render: (x) => scoreText(x.stats.testAvg) },
    { key: 'why', header: 'Lý do gợi ý', render: (x) => (x.reasons.length ? <div className="flex flex-wrap gap-1">{x.reasons.map((r) => <Badge key={r} tone="warning" dot={false}>{r}</Badge>)}</div> : <span className="text-xs text-ink-3">Ổn định</span>) },
    {
      key: 'act', header: 'Quyết định', stop: true, render: (x) => (x.review ? (
        <div className="flex flex-wrap items-center gap-2">
          {x.review.status === 'confirmed'
            ? <Link to={`/care?id=${x.review.case_id}`}><Badge tone="info">Đã xác nhận · {x.review.case_code}</Badge></Link>
            : <Badge tone="neutral" title={x.review.note}>Không cần bổ trợ</Badge>}
          <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setModal({ type: 'undo', row: x })}>Hoàn tác</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={LifeBuoy} onClick={() => setModal({ type: 'confirm', row: x })}>Xác nhận bổ trợ</Button>
          <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setModal({ type: 'skip', row: x })}>Không cần</Button>
        </div>
      )),
    },
  ];
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Tháng" className="w-44"><Select value={month} onChange={(e) => setF({ month: e.target.value === months[0].value ? '' : e.target.value })}>{months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
        <Segmented ariaLabel="Lọc trạng thái bổ trợ" value={f.state} onChange={(v) => setF({ state: v })} options={[
          { value: 'needed', label: `Cần bổ trợ (${data?.counts.needed ?? 0})` }, { value: 'confirmed', label: `Đã xác nhận (${data?.counts.confirmed ?? 0})` },
          { value: 'not_needed', label: `Không cần (${data?.counts.not_needed ?? 0})` }, { value: 'all', label: `Tất cả (${data?.counts.all ?? 0})` },
        ]} />
      </div>
      {data && <Alert tone="info" title="Cách hệ thống gợi ý"><span className="inline-flex items-start gap-1"><Info className="mt-0.5 size-3.5 shrink-0" />Học viên đang học được gợi ý khi: {data.rules.join('; ')}. Chủ nhiệm/giáo vụ xem lại và quyết định; xác nhận bổ trợ sẽ tạo việc chăm sóc "Bổ trợ học tập".</span></Alert>}
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {() => <DataTable columns={columns} rows={rows} caption="Rà soát bổ trợ học tập"
          empty={<EmptyState icon={LifeBuoy} title={f.state === 'needed' ? 'Không có học viên cần bổ trợ' : 'Không có học viên trong mục này'} />} />}
      </DataState>
      <SupportModal state={modal} month={month} onClose={() => setModal(null)} onDone={(msg) => { toast.success(msg); setModal(null); reload(); }} />
    </div>
  );
}

function SupportModal({ state, month, onClose, onDone }) {
  const { activeStaff } = useLookups();
  const { user } = useAuth();
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState(addDays(todayVN(), 7));
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = state?.type === 'confirm' || state?.type === 'skip';
  const row = state?.row;
  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      await api.post('/api/learning/support', { student_id: row.id, month, status: state.type === 'confirm' ? 'confirmed' : 'not_needed', note: note || null, owner_id: owner || user.id, due_date: due });
      setNote(''); setOwner('');
      onDone(state.type === 'confirm' ? `Đã xác nhận bổ trợ cho ${row.full_name} và tạo việc chăm sóc.` : `Đã ghi nhận ${row.full_name} không cần bổ trợ.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <>
      <Modal open={open} onOpenChange={(v) => !v && onClose()} title={state?.type === 'confirm' ? `Xác nhận bổ trợ – ${row?.full_name}` : `Không cần bổ trợ – ${row?.full_name}`}
        description={row?.reasons?.length ? `Gợi ý: ${row.reasons.join('; ')}` : 'Học viên không vượt ngưỡng gợi ý.'}
        footer={<><Button variant="secondary" onClick={onClose}>Hủy</Button><Button loading={busy} onClick={submit}>{state?.type === 'confirm' ? 'Xác nhận & tạo việc' : 'Lưu'}</Button></>}>
        <div className="space-y-4">
          {state?.type === 'confirm' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Người phụ trách"><Select value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="— Tôi phụ trách —">{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
              <Field label="Hạn xử lý"><DateInput value={due} min={todayVN()} onChange={(e) => setDue(e.target.value)} /></Field>
            </div>
          )}
          <Field label={state?.type === 'confirm' ? 'Kế hoạch bổ trợ' : 'Lý do không cần bổ trợ'} required={state?.type === 'skip'} error={err?.fields?.note}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={state?.type === 'confirm' ? 'Ví dụ: kèm thêm 2 buổi/tuần, gửi bài luyện từ vựng cho phụ huynh' : 'Ví dụ: vắng do ốm, đã học bù đủ'} />
          </Field>
          {err && !err.fields && <Alert tone="danger">{err.message}</Alert>}
        </div>
      </Modal>
      <ConfirmDialog open={state?.type === 'undo'} onOpenChange={(v) => !v && onClose()} title="Hoàn tác quyết định?" confirmLabel="Hoàn tác"
        message="Xóa quyết định của tháng này. Nếu đã tạo việc bổ trợ mà chưa có ghi nhận xử lý, việc đó cũng bị xóa."
        onConfirm={async () => { await api.del(`/api/learning/support/${row.id}/${month}`); onDone('Đã hoàn tác.'); }} />
    </>
  );
}
