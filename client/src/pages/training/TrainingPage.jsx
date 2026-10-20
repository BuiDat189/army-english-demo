import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, CalendarPlus, Ban, Info } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { date, todayVN, addDays, weekdayLabel, relativeDay } from '../../lib/format.js';
import { PageHeader, Card, Tabs, DataTable, DataState, StatusBadge, Badge, Button, EmptyState, Select, FilterBar, ConfirmDialog, useToast, Alert } from '../../components/ui/index.js';
import SessionDrawer from '../../components/business/SessionDrawer.jsx';
import { MakeupModal } from '../../components/business/ClassModals.jsx';

export default function TrainingPage() {
  const { can } = useAuth();
  const [f, setF] = useUrlFilters({ tab: 'sessions', session: '', days: '30', makeup: '' });
  const tabs = [
    { value: 'sessions', label: 'Buổi cần điểm danh' },
    can('makeup.edit', 'care.view', 'attendance.edit_own') && { value: 'absences', label: 'Học viên vắng & học bù' },
    { value: 'rules', label: 'Quy tắc tính buổi' },
  ].filter(Boolean);
  return (
    <div>
      <PageHeader title="Điểm danh – Đào tạo" description="Điểm danh theo buổi, ghi nội dung và nhận xét, theo dõi học viên vắng và xếp học bù." />
      <Card>
        <Tabs className="px-4 sm:px-5" tabs={tabs} value={f.tab} onChange={(tab) => setF({ tab })} />
        {f.tab === 'sessions' && <SessionsTab onOpen={(id) => setF({ session: String(id) })} />}
        {f.tab === 'absences' && <AbsencesTab f={f} setF={setF} />}
        {f.tab === 'rules' && <RulesTab />}
      </Card>
      <SessionDrawer open={!!f.session} sessionId={f.session} onOpenChange={(v) => !v && setF({ session: '' })} />
    </div>
  );
}

function SessionsTab({ onOpen }) {
  const today = todayVN();
  const { data, error, loading, reload } = useApi(`/api/sessions${qs({ from: addDays(today, -7), to: today })}`);
  const rows = data ? data.sessions.filter((s) => s.status === 'scheduled' || s.date === today).sort((a, b) => (a.date === b.date ? a.start_time.localeCompare(b.start_time) : b.date.localeCompare(a.date))) : [];
  const columns = [
    { key: 'date', header: 'Ngày', mobile: 'title', render: (s) => <span className="font-medium">{relativeDay(s.date, today)} · {s.start_time}–{s.end_time}</span> },
    { key: 'class', header: 'Lớp', render: (s) => <span>{s.class_code || s.title}{s.kind === 'makeup' && <Badge tone="purple" className="ml-1.5">Học bù</Badge>}</span> },
    { key: 'room', header: 'Phòng · GV', render: (s) => <span className="text-[13px]">{s.room_name} · {s.teacher_name}</span> },
    { key: 'n', header: 'Học viên', align: 'right', render: (s) => s.student_count },
    { key: 'status', header: 'Trạng thái', render: (s) => (s.status === 'scheduled' && s.date < today ? <Badge tone="danger">Chưa điểm danh (trễ)</Badge> : <StatusBadge kind="session" value={s.status} />) },
    { key: 'act', header: '', stop: true, render: (s) => <Button size="sm" variant={s.status === 'done' ? 'secondary' : 'primary'} icon={ClipboardCheck} onClick={() => onOpen(s.id)}>{s.status === 'done' ? 'Xem/sửa' : 'Điểm danh'}</Button> },
  ];
  return (
    <DataState loading={loading} error={error} data={data} onRetry={reload}>
      {() => <DataTable columns={columns} rows={rows} onRowClick={(s) => onOpen(s.id)} caption="Buổi học cần điểm danh"
        empty={<EmptyState icon={ClipboardCheck} title="Không có buổi nào cần điểm danh" description="Các buổi hôm nay và buổi 7 ngày qua chưa điểm danh sẽ hiện ở đây." />} />}
    </DataState>
  );
}

function AbsencesTab({ f, setF }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/api/sessions/absences?days=${f.days}`);
  const [modal, setModal] = useState(null);
  let rows = data?.items || [];
  if (f.makeup === 'none') rows = rows.filter((r) => !r.makeup_status);
  if (f.makeup === 'scheduled') rows = rows.filter((r) => r.makeup_status === 'scheduled');
  if (f.makeup === 'done') rows = rows.filter((r) => r.makeup_status === 'done');
  const columns = [
    { key: 'student', header: 'Học viên', mobile: 'title', render: (r) => <Link to={`/students/${r.student_id}?tab=attendance`} className="font-medium text-ink hover:text-brand-700 hover:underline">{r.full_name}</Link> },
    { key: 'date', header: 'Buổi vắng', render: (r) => <span className="tabular">{weekdayLabel(r.date)} {date(r.date)} · {r.class_code}</span> },
    { key: 'status', header: 'Loại vắng', render: (r) => <StatusBadge kind="attendance" value={r.status} /> },
    { key: 'note', header: 'Ghi chú', render: (r) => r.note || '—' },
    can('care.view') && { key: 'care', header: 'Chăm sóc', render: (r) => (r.care_id ? <Link to={`/care?id=${r.care_id}`} className="inline-flex"><StatusBadge kind="care" value={r.care_status} /></Link> : '—') },
    { key: 'makeup', header: 'Học bù', render: (r) => (r.makeup_status ? <span className="text-[13px]"><StatusBadge kind="makeup" value={r.makeup_status} /> <span className="text-ink-3 tabular">{date(r.makeup_date)} {r.makeup_time}</span></span> : <span className="text-ink-3">Chưa xếp</span>) },
    can('makeup.edit') && { key: 'act', header: '', stop: true, render: (r) => (
      !r.makeup_status || r.makeup_status === 'missed'
        ? <Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => setModal({ type: 'makeup', absence: r })}>Xếp học bù</Button>
        : r.makeup_status === 'scheduled' ? <Button size="sm" variant="ghost" icon={Ban} onClick={() => setModal({ type: 'cancel', absence: r })}>Hủy lịch bù</Button> : null
    ) },
  ].filter(Boolean);
  return (
    <>
      <FilterBar active={f.makeup || f.days !== '30'} onReset={() => setF({ makeup: '', days: '30' })}>
        <Select aria-label="Khoảng thời gian" className="w-44" value={f.days} onChange={(e) => setF({ days: e.target.value })}><option value="7">7 ngày qua</option><option value="30">30 ngày qua</option><option value="90">90 ngày qua</option></Select>
        <Select aria-label="Tình trạng học bù" className="w-48" value={f.makeup} onChange={(e) => setF({ makeup: e.target.value })} placeholder="Mọi tình trạng học bù">
          <option value="none">Chưa xếp học bù</option><option value="scheduled">Đã xếp, chưa học</option><option value="done">Đã học bù</option>
        </Select>
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {() => <DataTable columns={columns} rows={rows} rowKey="attendance_id" caption="Học viên vắng" empty={<EmptyState title="Không có học viên vắng trong khoảng này" />} />}
      </DataState>
      <MakeupModal open={modal?.type === 'makeup'} onOpenChange={(v) => !v && setModal(null)} absence={modal?.absence} onDone={reload} />
      <ConfirmDialog open={modal?.type === 'cancel'} onOpenChange={(v) => !v && setModal(null)} title="Hủy lịch học bù?" confirmLabel="Hủy lịch bù"
        message={modal?.absence && `Lịch bù ${date(modal.absence.makeup_date)} ${modal.absence.makeup_time} của ${modal.absence.full_name} sẽ bị hủy. Có thể xếp lại sau.`}
        onConfirm={async () => { await api.post(`/api/sessions/makeup/${modal.absence.makeup_id}/cancel`); toast.success('Đã hủy lịch học bù.'); reload(); }} />
    </>
  );
}

function RulesTab() {
  const { data } = useApi('/api/sessions/absences?days=7');
  return (
    <div className="max-w-3xl space-y-4 p-5">
      <Alert tone="info" title="Giả định nghiệp vụ dùng trong bản demo">Quy tắc dưới đây được áp dụng thống nhất ở hồ sơ học viên, danh sách lớp, nhắc tái đăng ký và báo cáo. Cần trung tâm xác nhận trước khi dùng chính thức.</Alert>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">{(data?.rules || []).map((r) => <li key={r}>{r}</li>)}</ol>
      <div className="rounded-[var(--radius-control)] border border-line p-4 text-sm">
        <p className="mb-2 flex items-center gap-1.5 font-medium"><Info className="size-4 text-ink-3" />Ví dụ</p>
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          <li>Khóa 24 buổi, học viên vắng có phép buổi 5 và đã học bù: buổi 5 trừ 1 lần → còn 24 − (số buổi đã học tính cả buổi 5).</li>
          <li>Vắng không phép buổi 6, sau đó được học bù miễn phí: vẫn chỉ trừ 1 buổi cho buổi 6.</li>
          <li>Lưu điểm danh lại nhiều lần: mỗi học viên chỉ có 1 bản ghi cho mỗi buổi, nên số buổi không bị nhân đôi.</li>
        </ul>
      </div>
      <p className="text-sm text-ink-3">Học viên còn ≤ 4 buổi được đưa vào danh sách “Sắp hết khóa” ở mục Chăm sóc – Tái đăng ký.</p>
    </div>
  );
}
