import { Link } from 'react-router-dom';
import { Trophy, Info } from 'lucide-react';
import { qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { money, num } from '../../lib/format.js';
import { PageHeader, Card, Tabs, DataTable, DataState, Badge, EmptyState, Alert, Avatar } from '../../components/ui/index.js';
import { PeriodFilter } from '../../components/PeriodFilter.jsx';

const LEVEL_TONE = { L0: 'info', L1: 'purple', L2: 'warning', L3: 'brand', L4: 'warning', L5: 'success' };

/** Hiệu suất đội ngũ: EC (tư vấn tuyển sinh) và CM (chủ nhiệm lớp) */
export default function PerformancePage() {
  const [f, setF] = useUrlFilters({ tab: 'ec', period: 'month', from: '', to: '' });
  return (
    <div>
      <PageHeader title="Hiệu suất EC/CM" description="EC: tư vấn tuyển sinh (phễu L0–L5, doanh số mới/tái phí). CM: chủ nhiệm lớp (sĩ số, đóng phí, tái phí)." />
      <Card>
        <Tabs className="px-4 sm:px-5" tabs={[{ value: 'ec', label: 'Tư vấn (EC)' }, { value: 'cm', label: 'Chủ nhiệm (CM)' }]} value={f.tab} onChange={(tab) => setF({ tab })} />
        {f.tab === 'ec' ? <EcTab f={f} setF={setF} /> : <CmTab />}
      </Card>
    </div>
  );
}

function Person({ x }) {
  return <span className="flex items-center gap-2"><Avatar name={x.full_name} size="sm" /><span className="whitespace-nowrap"><span className="font-medium">{x.full_name}</span><span className="block text-xs text-ink-3">{x.code}</span></span></span>;
}

function EcTab({ f, setF }) {
  const { data, error, loading, reload } = useApi(`/api/performance/ec${qs({ period: f.period, from: f.from, to: f.to })}`);
  const levelCols = (data?.levels || []).map((l) => ({
    key: l.key, header: <span title={l.label}>{l.key}</span>, align: 'right',
    render: (x) => (x[l.key] ? <Link to={`/leads?status=all&level=${l.key}&owner_id=${x.id}`} className="hover:underline"><Badge tone={LEVEL_TONE[l.key]} dot={false}>{x[l.key]}</Badge></Link> : <span className="text-ink-3">0</span>),
  }));
  const columns = [
    { key: 'name', header: 'Tư vấn viên', mobile: 'title', render: (x) => <Person x={x} /> },
    { key: 'total', header: 'Tổng khách', align: 'right', render: (x) => num(x.total) },
    ...levelCols,
    { key: 'conv', header: 'Tỷ lệ L5', align: 'right', render: (x) => `${String(x.conversion).replace('.', ',')}%` },
    { key: 'nf', header: 'HS mới đủ phí', align: 'right', render: (x) => num(x.newFullfee) },
    { key: 'sn', header: 'Doanh số mới', align: 'right', render: (x) => money(x.salesNew) },
    { key: 'sr', header: 'Doanh số tái phí', align: 'right', render: (x) => money(x.salesRenew) },
    { key: 'rev', header: 'Tổng doanh thu', align: 'right', render: (x) => <b className="font-semibold">{money(x.revenue)}</b> },
  ];
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <PeriodFilter period={f.period} from={f.from} to={f.to} onChange={setF} resolved={data && { from: data.from, to: data.to }} />
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => (<>
          <DataTable columns={columns} rows={d.rows} caption="Hiệu suất tư vấn viên" empty={<EmptyState icon={Trophy} title="Chưa có tư vấn viên" />} />
          <Alert tone="info" title="Cách tính"><ul className="list-disc space-y-1 pl-4"><li>{d.definitions.levels}</li><li>{d.definitions.newFullfee}</li><li>{d.definitions.revenue}</li></ul></Alert>
        </>)}
      </DataState>
    </div>
  );
}

function CmTab() {
  const { data, error, loading, reload } = useApi('/api/performance/cm');
  const columns = [
    { key: 'name', header: 'Chủ nhiệm', mobile: 'title', render: (x) => <Person x={x} /> },
    { key: 'classes', header: 'Số lớp', align: 'right', render: (x) => <span title={x.classCodes.join(', ')}>{x.classes}</span> },
    { key: 'codes', header: 'Lớp', render: (x) => <span className="text-[13px] text-ink-2">{x.classCodes.join(', ')}</span> },
    { key: 'students', header: 'Tổng HS', align: 'right', render: (x) => num(x.students) },
    { key: 'trial', header: 'Học thử', align: 'right', render: (x) => num(x.trial) },
    { key: 'deposit', header: 'Đóng 1 phần', align: 'right', render: (x) => (x.deposit ? <Badge tone="warning" dot={false}>{x.deposit}</Badge> : '0') },
    { key: 'unpaid', header: 'Chưa đóng', align: 'right', render: (x) => (x.unpaid ? <Badge tone="danger" dot={false}>{x.unpaid}</Badge> : '0') },
    { key: 'full', header: 'Đóng đủ', align: 'right', render: (x) => <Badge tone="success" dot={false}>{x.fullfee}</Badge> },
    { key: 'acs', header: 'ACS', align: 'right', render: (x) => <b className="font-semibold">{String(x.acs).replace('.', ',')}</b> },
    { key: 'r1', header: 'Tái phí T.này', align: 'right', render: (x) => (x.renewThisMonth ? <Badge tone="danger" dot={false}>{x.renewThisMonth}</Badge> : '0') },
    { key: 'r2', header: 'T.sau', align: 'right', render: (x) => (x.renewNextMonth ? <Badge tone="warning" dot={false}>{x.renewNextMonth}</Badge> : '0') },
  ];
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => (<>
          <DataTable columns={columns} rows={d.rows} caption="Hiệu suất chủ nhiệm" empty={<EmptyState icon={Trophy} title="Chưa có lớp nào được gán chủ nhiệm" description="Gán chủ nhiệm trong phần Sửa lớp." />} />
          <Alert tone="info" title="Cách tính"><span className="inline-flex items-start gap-1"><Info className="mt-0.5 size-3.5 shrink-0" /><span>{d.definitions.acs} {d.definitions.renewalDue} Danh sách chi tiết ở Báo cáo → Học viên tới hạn tái phí.</span></span></Alert>
        </>)}
      </DataState>
    </div>
  );
}
