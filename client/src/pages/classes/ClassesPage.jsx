import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil } from 'lucide-react';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { money, dateTime } from '../../lib/format.js';
import PackagesTab from './PackagesTab.jsx';
import { PageHeader, Card, Button, DataTable, DataState, FilterBar, SearchInput, Select, StatusBadge, Badge, Tabs, ProgressBar, EmptyState, IconButton } from '../../components/ui/index.js';
import { ClassFormDrawer, CourseFormModal } from './ClassForms.jsx';

export default function ClassesPage() {
  const { can } = useAuth();
  const [f, setF] = useUrlFilters({ tab: 'classes', q: '', status: '', course_id: '', teacher_id: '' });
  return (
    <div>
      <PageHeader title="Lớp & Khóa học" description={can('classes.view') ? 'Danh mục khóa học, lớp, sĩ số, phòng và giáo viên phụ trách.' : 'Các lớp bạn dạy hoặc trợ giảng.'} />
      <Card>
        {can('classes.view') && <Tabs className="px-4 sm:px-5" value={f.tab} onChange={(tab) => setF({ tab })} tabs={[{ value: 'classes', label: 'Lớp học' }, { value: 'courses', label: 'Khóa học & trình độ' }, { value: 'packages', label: 'Gói phí' }]} />}
        {f.tab === 'courses' && can('classes.view') ? <CoursesTab /> : f.tab === 'packages' && can('classes.view') ? <PackagesTab /> : <ClassesTab f={f} setF={setF} />}
      </Card>
    </div>
  );
}

function ClassesTab({ f, setF }) {
  const { can } = useAuth();
  const { courses, teachers } = useLookups();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi(`/api/classes${qs({ q: f.q, status: f.status, course_id: f.course_id, teacher_id: f.teacher_id })}`);
  const [creating, setCreating] = useState(false);
  const columns = [
    { key: 'name', header: 'Lớp', mobile: 'title', render: (c) => <div><p className="font-medium">{c.code}</p><p className="text-xs text-ink-3">{c.name}</p></div> },
    { key: 'course', header: 'Khóa', render: (c) => <div><p>{c.course_name}</p><p className="text-xs text-ink-3">{c.level}</p></div> },
    { key: 'schedule', header: 'Lịch học', render: (c) => <span className="text-[13px]">{c.schedule}</span> },
    { key: 'room', header: 'Phòng', render: (c) => c.room_name },
    { key: 'teacher', header: 'GV / Trợ giảng', render: (c) => <div className="text-[13px]"><p>{c.teacher_name}</p>{c.assistant_name && <p className="text-ink-3">TG: {c.assistant_name}</p>}{c.homeroom_name && <p className="text-ink-3">CN: {c.homeroom_name}</p>}</div> },
    { key: 'occ', header: 'Sĩ số', align: 'right', render: (c) => <span className={c.occupancy >= c.max_students ? 'font-semibold text-red-700' : ''}>{c.occupancy}/{c.max_students}</span> },
    { key: 'progress', header: 'Tiến độ', render: (c) => <div className="w-28"><p className="mb-1 text-xs text-ink-3 tabular">{c.sessions_done}/{c.sessions_total} buổi</p><ProgressBar value={c.sessions_done} max={c.sessions_total} /></div> },
    { key: 'next', header: 'Buổi tiếp theo', render: (c) => (c.next_session ? <span className="text-[13px] tabular">{dateTime(c.next_session)}</span> : '—') },
    { key: 'status', header: 'Trạng thái', render: (c) => <StatusBadge kind="class" value={c.status} /> },
  ];
  return (
    <>
      <FilterBar active={f.q || f.status || f.course_id || f.teacher_id} onReset={() => setF({ q: '', status: '', course_id: '', teacher_id: '' })}>
        <SearchInput className="w-full sm:w-60" value={f.q} onChange={(q) => setF({ q })} placeholder="Mã hoặc tên lớp…" />
        <Select aria-label="Trạng thái" className="w-full sm:w-44" value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder="Đang học & sắp khai giảng">
          <option value="active">Đang học</option><option value="planned">Sắp khai giảng</option><option value="finished">Đã kết thúc</option><option value="all">Tất cả</option>
        </Select>
        {can('classes.view') && <>
          <Select aria-label="Khóa học" className="w-full sm:w-48" value={f.course_id} onChange={(e) => setF({ course_id: e.target.value })} placeholder="Mọi khóa">{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select aria-label="Giáo viên" className="w-full sm:w-48" value={f.teacher_id} onChange={(e) => setF({ teacher_id: e.target.value })} placeholder="Mọi giáo viên">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select>
        </>}
        {can('classes.edit') && <Button className="sm:ml-auto" icon={Plus} onClick={() => setCreating(true)}>Tạo lớp</Button>}
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => <DataTable columns={columns} rows={d.items} onRowClick={(c) => navigate(`/classes/${c.id}`)} caption="Danh sách lớp" empty={<EmptyState title="Không có lớp phù hợp" />} />}
      </DataState>
      <ClassFormDrawer open={creating} onOpenChange={setCreating} onSaved={(id) => navigate(`/classes/${id}`)} />
    </>
  );
}

function CoursesTab() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi('/api/classes/courses');
  const [edit, setEdit] = useState(null);
  const columns = [
    { key: 'name', header: 'Khóa học', mobile: 'title', render: (c) => <div><p className="font-medium">{c.name}</p><p className="text-xs text-ink-3">{c.code} · {c.program}</p></div> },
    { key: 'level', header: 'Trình độ', render: (c) => <div><p>{c.level}</p><p className="text-xs text-ink-3">{c.age_range}</p></div> },
    { key: 'sessions', header: 'Số buổi', align: 'right', render: (c) => `${c.total_sessions} × ${c.session_minutes}′` },
    { key: 'fee', header: 'Học phí', align: 'right', render: (c) => money(c.tuition_fee) },
    { key: 'next', header: 'Khóa tiếp theo', render: (c) => c.next_course_name || '—' },
    { key: 'open', header: 'Lớp mở', align: 'right', render: (c) => c.open_classes },
    { key: 'active', header: 'HV đang học', align: 'right', render: (c) => c.active_students },
    { key: 'status', header: 'Trạng thái', render: (c) => (c.status === 'active' ? <Badge tone="success">Đang tuyển</Badge> : <Badge>Ngừng tuyển</Badge>) },
    can('classes.edit') && { key: 'act', header: '', stop: true, render: (c) => <IconButton icon={Pencil} label={`Sửa ${c.name}`} size="sm" onClick={() => setEdit(c)} /> },
  ].filter(Boolean);
  return (
    <>
      {can('classes.edit') && <FilterBar><Button className="ml-auto" icon={Plus} onClick={() => setEdit({})}>Thêm khóa học</Button></FilterBar>}
      <DataState loading={loading} error={error} data={data} onRetry={reload}>{(d) => <DataTable columns={columns} rows={d.items} caption="Danh mục khóa học" />}</DataState>
      <CourseFormModal open={!!edit} onOpenChange={(v) => !v && setEdit(null)} course={edit?.id ? edit : null} onSaved={reload} />
    </>
  );
}
