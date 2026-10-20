import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Download, FileSpreadsheet } from 'lucide-react';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { money, phone, age, date } from '../../lib/format.js';
import { STATUS } from '../../lib/labels.js';
import { PageHeader, Card, Button, DataTable, DataState, FilterBar, SearchInput, Select, StatusBadge, Badge, EmptyState } from '../../components/ui/index.js';
import { StudentFormDrawer } from './StudentForms.jsx';
import ImportStudentsModal from './ImportStudentsModal.jsx';

export default function StudentsPage() {
  const { can } = useAuth();
  const { classes } = useLookups();
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters({ q: '', status: '', class_id: '', payment: '', renewal: '', tag: '' });
  const { data, error, loading, reload } = useApi(`/api/students${qs(f)}`);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fin = can('finance.view');
  const filtered = f.q || f.status || f.class_id || f.payment || f.renewal || f.tag;
  const own = !can('students.view');

  const columns = [
    { key: 'name', header: 'Học viên', mobile: 'title', className: 'min-w-44', render: (s) => (
      <div><p className="font-medium text-ink">{s.full_name}</p><p className="text-xs text-ink-3">{s.code}{s.dob ? ` · ${age(s.dob)} tuổi` : ''}</p>
        {s.tags?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{s.tags.map((t) => <span key={t} className="rounded-full bg-canvas px-1.5 py-px text-[11px] font-medium text-ink-2 ring-1 ring-inset ring-line">{t}</span>)}</div>}</div>
    ) },
    { key: 'classes', header: 'Lớp đang học', render: (s) => (
      <div className="flex flex-wrap gap-1">
        {s.classes.map((c) => <Link key={c.id} to={`/classes/${c.id}`} onClick={(e) => e.stopPropagation()} className="rounded bg-canvas px-1.5 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line hover:text-brand-700">{c.code}</Link>)}
        {s.pending_class && <Badge tone="warning">Chờ xếp lớp</Badge>}
        {!s.classes.length && !s.pending_class && <span className="text-ink-3">—</span>}
      </div>
    ) },
    can('students.contacts') && { key: 'parent', header: 'Phụ huynh', className: 'min-w-44', render: (s) => (s.parent ? <div><p>{s.parent.full_name} <span className="text-xs text-ink-3">({s.parent.relationship})</span></p><p className="text-xs text-ink-3 tabular">{phone(s.parent.phone)}</p></div> : <span className="text-ink-3">—</span>) },
    { key: 'remain', header: 'Buổi còn lại', align: 'right', render: (s) => (s.min_remaining === null ? '—' : <span className={s.min_remaining <= 4 ? 'font-semibold text-amber-700' : ''}>{s.min_remaining}</span>) },
    !fin && can('finance.summary') && { key: 'paid', header: 'Đã đóng', align: 'right', render: (s) => (s.paid ? <span className="tabular">{money(s.paid)}</span> : <span className="text-ink-3">0 đ</span>) },
    can('finance.summary') && { key: 'fee_end', header: 'Hết phí dự kiến', render: (s) => (s.fee_end ? <span className={s.fee_days_left <= 30 ? 'font-semibold text-amber-700' : 'tabular'}>{date(s.fee_end)}<span className="block text-xs font-normal text-ink-3">còn {s.fee_days_left} ngày</span></span> : s.awaiting_approval ? <Badge tone="purple">Chờ GĐ duyệt</Badge> : '—') },
    fin && { key: 'debt', header: 'Công nợ', align: 'right', render: (s) => (s.debt > 0 ? <span className="font-medium">{money(s.debt)}</span> : <span className="text-ink-3">0 đ</span>) },
    fin && { key: 'payment', header: 'Học phí', render: (s) => (s.payment_status ? <StatusBadge kind="payment" value={s.payment_status} /> : '—') },
    { key: 'status', header: 'Trạng thái', render: (s) => <StatusBadge kind="student" value={s.status} /> },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader title="Học viên – Phụ huynh" description={own ? 'Học viên thuộc các lớp bạn phụ trách.' : 'Hồ sơ học viên, người liên hệ, khóa học, điểm danh, học phí và chăm sóc.'}
        actions={<>
          {can('students.view') && <Button variant="secondary" icon={Download} onClick={() => { window.location.href = '/api/reports/export/students'; }}>Xuất CSV</Button>}
          {can('students.import') && <Button variant="secondary" icon={FileSpreadsheet} onClick={() => setImporting(true)}>Nhập từ Excel</Button>}
          {can('students.edit') && <Button icon={Plus} onClick={() => setCreating(true)}>Thêm học viên</Button>}
        </>} />
      <Card>
        <FilterBar active={filtered} onReset={() => setF({ q: '', status: '', class_id: '', payment: '', renewal: '', tag: '' })}>
          <SearchInput className="w-full sm:w-72" value={f.q} onChange={(q) => setF({ q })} placeholder={own ? 'Tên hoặc mã học viên…' : 'Tên, mã HV, tên/SĐT phụ huynh…'} />
          <Select aria-label="Trạng thái" className="w-full sm:w-44" value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder="Chưa lưu trữ">
            <option value="studying">Đang học (có lớp)</option>
            {Object.entries(STATUS.student).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            <option value="all">Tất cả</option>
          </Select>
          <Select aria-label="Lớp" className="w-full sm:w-44" value={f.class_id} onChange={(e) => setF({ class_id: e.target.value })} placeholder="Mọi lớp">
            {classes.filter((c) => c.status !== 'finished').map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </Select>
          {fin && (
            <Select aria-label="Tình trạng học phí" className="w-full sm:w-44" value={f.payment} onChange={(e) => setF({ payment: e.target.value })} placeholder="Mọi tình trạng học phí">
              <option value="debt">Còn công nợ</option>
              {['overdue', 'due_soon', 'partial', 'unpaid', 'paid'].map((k) => <option key={k} value={k}>{STATUS.payment[k][0]}</option>)}
            </Select>
          )}
          <Select aria-label="Sắp hết khóa" className="w-full sm:w-44" value={f.renewal} onChange={(e) => setF({ renewal: e.target.value })} placeholder="Mọi số buổi còn lại">
            <option value="1">Sắp hết khóa (≤ 4 buổi)</option>
          </Select>
          {data?.tags?.length > 0 && (
            <Select aria-label="Tag" className="w-full sm:w-40" value={f.tag} onChange={(e) => setF({ tag: e.target.value })} placeholder="Mọi tag">
              {data.tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}
        </FilterBar>
        <DataState loading={loading} error={error} data={data} onRetry={reload}>
          {(d) => (
            <DataTable columns={columns} rows={d.items} onRowClick={(s) => navigate(`/students/${s.id}`)} caption="Danh sách học viên"
              footer={`${d.items.length} học viên`}
              empty={<EmptyState title={filtered ? 'Không có học viên phù hợp bộ lọc' : 'Chưa có học viên'} />} />
          )}
        </DataState>
      </Card>
      <StudentFormDrawer open={creating} onOpenChange={setCreating} onSaved={(id) => navigate(`/students/${id}`)} />
      <ImportStudentsModal open={importing} onOpenChange={setImporting} onDone={reload} />
    </div>
  );
}
