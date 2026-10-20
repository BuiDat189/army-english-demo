import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Download, AlertTriangle, Phone, X } from 'lucide-react';
import clsx from 'clsx';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { phone, dateTime, relativeDay, todayVN } from '../../lib/format.js';
import { LEAD_SOURCES, STATUS, OPEN_LEAD_STATUSES } from '../../lib/labels.js';
import { PageHeader, Card, Button, DataTable, DataState, FilterBar, SearchInput, Select, StatusBadge, Tabs, EmptyState } from '../../components/ui/index.js';
import LeadForm from './LeadForm.jsx';

// Màu cấp độ phễu: lạnh → nóng (L5 = đóng đủ học phí)
const LEVEL_STYLE = {
  L0: 'bg-sky-100 text-sky-800', L1: 'bg-violet-100 text-violet-800', L2: 'bg-amber-100 text-amber-800',
  L3: 'bg-emerald-100 text-emerald-800', L4: 'bg-red-100 text-red-800', L5: 'bg-brand-100 text-brand-800',
};

export default function LeadsPage() {
  const { can } = useAuth();
  const { activeStaff } = useLookups();
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters({ status: 'open', q: '', source: '', owner_id: '', appointment: '', level: '' });
  const { data, error, loading, reload } = useApi(`/api/leads${qs(f)}`);
  const [creating, setCreating] = useState(false);
  const today = todayVN();
  const counts = data?.counts || {};
  const openCount = OPEN_LEAD_STATUSES.reduce((s, k) => s + (counts[k] || 0), 0);
  const all = data?.scope === 'all';
  const filtered = f.q || f.source || f.owner_id || f.appointment || f.level;

  const columns = [
    { key: 'parent', header: 'Phụ huynh', mobile: 'title', className: 'min-w-44', render: (l) => (
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-medium text-ink">{l.parent_name}{l.dup_count > 0 && <span title="Số điện thoại trùng với hồ sơ khác"><AlertTriangle className="size-3.5 text-amber-500" aria-label="Có dấu hiệu trùng số điện thoại" /></span>}</p>
        <p className="flex items-center gap-1 text-xs text-ink-3 tabular"><Phone className="size-3" aria-hidden />{phone(l.phone)}</p>
      </div>
    ) },
    { key: 'student', header: 'Học viên', className: 'min-w-40', render: (l) => <div><p>{l.student_name}</p><p className="text-xs text-ink-3">{l.code}</p></div> },
    { key: 'course_name', header: 'Khóa quan tâm', render: (l) => l.course_name || <span className="text-ink-3">—</span> },
    { key: 'source', header: 'Nguồn' },
    { key: 'owner_name', header: 'Phụ trách', render: (l) => (
      <div className="text-[13px]">
        <p>{l.owner_name || '—'}</p>
        {l.checked_in_at && <p className="text-xs font-medium text-emerald-700" title="Khách thuộc về nhân sự check-in trước">Check-in {dateTime(l.checked_in_at.slice(0, 16).replace('T', ' '))}</p>}
      </div>
    ) },
    { key: 'status', header: 'Trạng thái', render: (l) => <span className="flex flex-wrap items-center gap-1.5">{l.level && <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-bold tabular', LEVEL_STYLE[l.level])} title={data?.levels?.find((x) => x.key === l.level)?.label}>{l.level}</span>}<StatusBadge kind="lead" value={l.status} /></span> },
    { key: 'next', header: 'Lịch hẹn', render: (l) => (
      <div className="text-[13px]">
        {l.next_trial && <p className="font-medium text-amber-700">Học thử: {relativeDay(l.next_trial.slice(0, 10), today)} {l.next_trial.slice(11)}</p>}
        {l.status === 'checkin_booked' && l.checkin_booked_at && <p className="font-medium text-amber-700">Check-in: {relativeDay(l.checkin_booked_at.slice(0, 10), today)} {l.checkin_booked_at.slice(11)}</p>}
        {l.next_contact_at ? <p className={l.next_contact_at.slice(0, 10) < today ? 'font-medium text-red-700' : 'text-ink-2'}>Liên hệ lại: {dateTime(l.next_contact_at)}{l.next_contact_at.slice(0, 10) < today && ' (trễ)'}</p> : !l.next_trial && <span className="text-ink-3">—</span>}
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Data khách hàng" description={all ? 'Data khách của toàn bộ nhân sự. Khách thuộc về nhân sự check-in trước.' : 'Data khách bạn phụ trách. Mỗi khách đang tư vấn phải có ngày liên hệ lại để hệ thống nhắc việc.'}
        actions={<>
          <Button variant="secondary" icon={Download} onClick={() => { window.location.href = '/api/reports/export/leads'; }}>Xuất CSV</Button>
          {can('leads.edit') && <Button icon={Plus} onClick={() => setCreating(true)}>Nhập data khách</Button>}
        </>} />
      <Card>
        <Tabs className="px-4 sm:px-5" value={f.status} onChange={(v) => setF({ status: v })} tabs={[
          { value: 'open', label: 'Đang tư vấn', count: openCount },
          ...[...OPEN_LEAD_STATUSES, 'enrolled', 'unfit'].map((k) => ({ value: k, label: STATUS.lead[k][0], count: counts[k] || 0 })),
          { value: 'all', label: 'Tất cả' },
        ]} />
        {data?.levels && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5 sm:px-5" role="group" aria-label="Phễu L0–L5">
            <span className="mr-1 text-xs font-medium text-ink-3">Phễu:</span>
            {data.levels.map((lv) => (
              <button key={lv.key} type="button" title={lv.label} aria-pressed={f.level === lv.key}
                onClick={() => setF(f.level === lv.key ? { level: '' } : { level: lv.key, status: 'all' })}
                className={clsx('rounded-md px-2 py-1 text-xs font-semibold tabular ring-1 ring-inset transition-colors', LEVEL_STYLE[lv.key], f.level === lv.key ? 'ring-2 ring-ink/40' : 'ring-transparent hover:ring-line-strong')}>
                {lv.key}: {data.levelCounts[lv.key]} <span className="hidden font-normal sm:inline">· {lv.label}</span>
              </button>
            ))}
            {f.level && <button type="button" onClick={() => setF({ level: '' })} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><X className="size-3" />Bỏ lọc phễu</button>}
          </div>
        )}
        <FilterBar active={filtered} onReset={() => setF({ q: '', source: '', owner_id: '', appointment: '', level: '' })}>
          <SearchInput className="w-full sm:w-72" value={f.q} onChange={(q) => setF({ q })} placeholder="Tên phụ huynh, học viên, số điện thoại…" />
          <Select aria-label="Nguồn" className="w-full sm:w-40" value={f.source} onChange={(e) => setF({ source: e.target.value })} placeholder="Mọi nguồn">{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select>
          {all && (
            <Select aria-label="Người phụ trách" className="w-full sm:w-48" value={f.owner_id} onChange={(e) => setF({ owner_id: e.target.value })} placeholder="Mọi nhân sự">
              <option value="me">Khách của tôi</option>
              {activeStaff.filter((s) => s.roles.includes('consultant') || s.roles.includes('teacher')).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          )}
          <Select aria-label="Lịch hẹn" className="w-full sm:w-48" value={f.appointment} onChange={(e) => setF({ appointment: e.target.value })} placeholder="Mọi lịch hẹn">
            <option value="today">Liên hệ lại hôm nay</option><option value="overdue">Trễ hẹn liên hệ</option><option value="week">Liên hệ lại trong tuần</option>
            <option value="month_new">Data nhập tháng này</option>
          </Select>
        </FilterBar>
        <DataState loading={loading} error={error} data={data} onRetry={reload}>
          {(d) => (
            <DataTable columns={columns} rows={d.items} onRowClick={(l) => navigate(`/leads/${l.id}`)} caption="Danh sách khách quan tâm"
              empty={<EmptyState title={filtered ? 'Không có khách phù hợp bộ lọc' : 'Chưa có khách trong nhóm này'} description={filtered ? 'Thử bỏ bớt điều kiện lọc.' : undefined}
                action={can('leads.edit') && !filtered ? <Button icon={Plus} onClick={() => setCreating(true)}>Thêm khách</Button> : undefined} />} />
          )}
        </DataState>
      </Card>
      <LeadForm open={creating} onOpenChange={setCreating} onSaved={(id) => navigate(`/leads/${id}`)} />
    </div>
  );
}
