import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Wallet, Printer, Ban, ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { money, date, dateTime } from '../../lib/format.js';
import { METHODS, STATUS } from '../../lib/labels.js';
import { PageHeader, Card, Tabs, DataTable, DataState, FilterBar, SearchInput, Select, StatusBadge, Button, EmptyState, Menu, ConfirmDialog, useToast, StatTile, Badge } from '../../components/ui/index.js';
import { PeriodFilter } from '../../components/PeriodFilter.jsx';
import { CollectReceiptModal } from '../../components/business/FinanceModals.jsx';
import WalletTab from './WalletTab.jsx';

export default function FinancePage() {
  const [f, setF] = useUrlFilters({ tab: '', status: 'debt', q: '', enrollment: '', period: 'month', from: '', to: '', method: '', rstatus: '', kind: '' });
  const tab = f.tab || 'receivables';
  return (
    <div>
      <PageHeader title="Học phí – Thu chi" description="Khoản phải thu theo đăng ký khóa, phiếu thu, hoàn phí và dòng tiền. Công nợ tính từ phiếu thu đã xác nhận." />
      <Card>
        <Tabs className="px-4 sm:px-5" value={tab} onChange={(t) => setF({ tab: t })} tabs={[
          { value: 'receivables', label: 'Công nợ' }, { value: 'receipts', label: 'Phiếu thu' }, { value: 'refunds', label: 'Hoàn phí' }, { value: 'wallet', label: 'Số dư & nạp tiền' }, { value: 'cashflow', label: 'Tổng hợp thu chi' },
        ]} />
        {tab === 'receivables' && <Receivables f={f} setF={setF} />}
        {tab === 'receipts' && <Receipts f={f} setF={setF} />}
        {tab === 'refunds' && <Refunds />}
        {tab === 'wallet' && <WalletTab f={f} setF={setF} />}
        {tab === 'cashflow' && <Cashflow f={f} setF={setF} />}
      </Card>
    </div>
  );
}

function Receivables({ f, setF }) {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi(`/api/finance/receivables${qs({ status: f.status, q: f.q, enrollment: f.enrollment })}`);
  const [collect, setCollect] = useState(null);
  const columns = [
    { key: 'student', header: 'Học viên', mobile: 'title', render: (r) => <div><Link to={`/students/${r.student_id}?tab=finance`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:text-brand-700 hover:underline">{r.student_name}</Link><p className="text-xs text-ink-3">{r.student_code} · {r.parent || ''}</p></div> },
    { key: 'course', header: 'Đăng ký', render: (r) => <div className="text-[13px]"><p>{r.code} · {r.course_name}</p><p className="text-ink-3">{r.class_code || 'Chưa xếp lớp'}</p></div> },
    { key: 'net', header: 'Phải thu', align: 'right', render: (r) => money(r.finance.net) },
    { key: 'paid', header: 'Đã thu', align: 'right', render: (r) => money(r.finance.paid) },
    { key: 'debt', header: 'Công nợ', align: 'right', render: (r) => <span className={r.finance.debt ? 'font-semibold' : 'text-ink-3'}>{money(r.finance.debt)}</span> },
    { key: 'next', header: 'Đợt gần nhất', render: (r) => (r.finance.nextDue ? <span className="text-[13px] tabular">{date(r.finance.nextDue.date)} · {money(r.finance.nextDue.amount)}</span> : '—') },
    { key: 'status', header: 'Tình trạng', render: (r) => <StatusBadge kind="payment" value={r.finance.paymentStatus} /> },
    can('finance.collect') && { key: 'act', header: '', stop: true, render: (r) => (r.finance.debt > 0 ? <Button size="sm" icon={Wallet} onClick={() => setCollect(r)}>Thu tiền</Button> : null) },
  ].filter(Boolean);
  return (
    <>
      <FilterBar active={f.q || f.enrollment || f.status !== 'debt'} onReset={() => setF({ q: '', enrollment: '', status: 'debt' })}>
        <SearchInput className="w-full sm:w-64" value={f.q} onChange={(q) => setF({ q })} placeholder="Tên/mã học viên, mã đăng ký…" />
        <Select aria-label="Tình trạng" className="w-full sm:w-56" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="debt">Còn công nợ</option><option value="due">Đến hạn hoặc quá hạn</option>
          {['overdue', 'due_soon', 'partial', 'unpaid', 'paid'].map((k) => <option key={k} value={k}>{STATUS.payment[k][0]}</option>)}
          <option value="all">Tất cả đăng ký</option>
        </Select>
        {f.enrollment && <span className="rounded bg-canvas px-2 py-1 text-xs">Lọc theo đăng ký #{f.enrollment}</span>}
        <Button className="sm:ml-auto" variant="secondary" icon={Download} onClick={() => { window.location.href = '/api/reports/export/receivables'; }}>Xuất CSV</Button>
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => (<>
          <div className="grid grid-cols-2 gap-3 border-b border-line p-4 sm:grid-cols-4 sm:px-5">
            <Total label="Phải thu (lọc hiện tại)" value={money(d.totals.net)} />
            <Total label="Đã thu" value={money(d.totals.paid)} />
            <Total label="Công nợ" value={money(d.totals.debt)} strong />
            <Total label="Quá hạn / sắp đến hạn" value={`${money(d.totals.overdue)} / ${money(d.totals.dueSoon)}`} />
          </div>
          <DataTable columns={columns} rows={d.items} caption="Công nợ" empty={<EmptyState title="Không có khoản phù hợp" />} />
        </>)}
      </DataState>
      <CollectReceiptModal open={!!collect} onOpenChange={(v) => !v && setCollect(null)} enrollment={collect && { ...collect, finance: collect.finance }} studentName={collect?.student_name} onDone={reload} />
    </>
  );
}

const Total = ({ label, value, strong }) => <div><p className="text-xs text-ink-3">{label}</p><p className={strong ? 'text-base font-semibold text-red-700 tabular' : 'text-sm font-medium tabular'}>{value}</p></div>;

function Receipts({ f, setF }) {
  const { can } = useAuth();
  const toast = useToast();
  const { period } = f;
  const { data, error, loading, reload } = useApi(`/api/finance/receipts${qs({ period, from: f.from, to: f.to, method: f.method, status: f.rstatus, q: f.q, kind: f.kind })}`);
  const [cancel, setCancel] = useState(null);
  const columns = [
    { key: 'code', header: 'Số phiếu', mobile: 'title', nowrap: true, render: (r) => <Link to={`/finance/receipts/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.code}</Link> },
    { key: 'paid_at', header: 'Ngày thu', nowrap: true, render: (r) => <span className="tabular">{date(r.paid_at)}</span> },
    { key: 'student', header: 'Học viên', render: (r) => <Link to={`/students/${r.student_id}?tab=finance`} className="hover:underline">{r.student_name}</Link> },
    { key: 'enroll', header: 'Đăng ký', render: (r) => <span className="text-[13px]">{r.enrollment_code} · {r.course_name}</span> },
    { key: 'kind', header: 'Nguồn doanh số', render: (r) => <span className="flex flex-col items-start gap-0.5">{r.enrollment_kind === 'renew' ? <Badge tone="purple">Tái phí</Badge> : <Badge tone="info">Khách mới</Badge>}{r.sold_by_name && <span className="text-xs text-ink-3">{r.sold_by_name}</span>}</span> },
    { key: 'amount', header: 'Số tiền', align: 'right', render: (r) => <span className={r.status === 'cancelled' ? 'text-ink-3 line-through' : 'font-medium'}>{money(r.amount)}</span> },
    { key: 'method', header: 'Hình thức', render: (r) => <span>{METHODS[r.method] || 'Trừ số dư'}{r.method === 'card' && r.card_issuer && <span className="block text-xs text-ink-3">{r.card_issuer} · CCCD …{r.card_id_no?.slice(-4)}</span>}</span> },
    { key: 'collector', header: 'Người thu' },
    { key: 'status', header: 'Trạng thái', render: (r) => <span title={r.cancel_reason ? `Lý do hủy: ${r.cancel_reason}` : undefined}><StatusBadge kind="receipt" value={r.status} /></span> },
    { key: 'act', header: '', stop: true, render: (r) => <Menu items={[
      { label: 'Xem / in phiếu', icon: Printer, onSelect: () => window.open(`/finance/receipts/${r.id}/print`, '_blank', 'noopener') },
      r.status === 'confirmed' && can('finance.cancel') && { label: 'Hủy phiếu thu', icon: Ban, danger: true, onSelect: () => setCancel(r) },
    ]} /> },
  ];
  return (
    <>
      <FilterBar active={f.method || f.rstatus || f.q || f.kind} onReset={() => setF({ method: '', rstatus: '', q: '', kind: '' })}>
        <PeriodFilter period={period} from={f.from} to={f.to} onChange={(p) => setF({ ...p, tab: 'receipts' })} resolved={data && { from: data.from, to: data.to }} />
        <SearchInput className="w-full sm:w-52" value={f.q} onChange={(q) => setF({ q, tab: 'receipts' })} placeholder="Số phiếu, học viên…" />
        <Select aria-label="Hình thức" className="w-full sm:w-40" value={f.method} onChange={(e) => setF({ method: e.target.value, tab: 'receipts' })} placeholder="Mọi hình thức">{Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select aria-label="Nguồn doanh số" className="w-full sm:w-40" value={f.kind} onChange={(e) => setF({ kind: e.target.value, tab: 'receipts' })} placeholder="Mới + tái phí"><option value="new">Khách mới</option><option value="renew">Tái phí</option></Select>
        <Select aria-label="Trạng thái phiếu" className="w-full sm:w-40" value={f.rstatus} onChange={(e) => setF({ rstatus: e.target.value, tab: 'receipts' })} placeholder="Mọi trạng thái"><option value="confirmed">Đã xác nhận</option><option value="cancelled">Đã hủy</option></Select>
        <Button className="sm:ml-auto" variant="secondary" icon={Download} onClick={() => { window.location.href = `/api/reports/export/receipts${qs({ period, from: f.from, to: f.to })}`; }}>Xuất CSV</Button>
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => (<>
          <div className="border-b border-line px-4 py-3 text-sm sm:px-5">
            Tổng thực thu (phiếu đã xác nhận, không gồm phiếu trừ số dư): <b className="tabular">{money(d.total)}</b> · {d.count} phiếu{d.walletTotal > 0 && <span className="text-ink-3"> · trừ số dư {money(d.walletTotal)}</span>}
            <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
              <span>Khách mới: <b className="tabular">{money(d.byKind.new)}</b></span><span>Tái phí: <b className="tabular">{money(d.byKind.renew)}</b></span>
              {Object.entries(d.byMethod).map(([k, x]) => <span key={k}>{METHODS[k] || k}: <b className="tabular">{money(x)}</b></span>)}
            </span>
          </div>
          <DataTable columns={columns} rows={d.items} caption="Phiếu thu" empty={<EmptyState title="Không có phiếu thu trong kỳ" />} />
        </>)}
      </DataState>
      <ConfirmDialog open={!!cancel} onOpenChange={(v) => !v && setCancel(null)} title={`Hủy phiếu thu ${cancel?.code}?`} reason reasonLabel="Lý do hủy phiếu" confirmLabel="Hủy phiếu thu"
        message="Phiếu không bị xóa, chỉ chuyển sang “Đã hủy” và lưu lịch sử. Công nợ của học viên được tính lại." onConfirm={async (reason) => { await api.post(`/api/finance/receipts/${cancel.id}/cancel`, { reason }); toast.success('Đã hủy phiếu thu.'); reload(); }} />
    </>
  );
}

function Refunds() {
  const { data, error, loading, reload } = useApi('/api/finance/refunds');
  const columns = [
    { key: 'code', header: 'Mã', mobile: 'title', render: (r) => <span className="font-medium">{r.code}</span> },
    { key: 'student', header: 'Học viên', render: (r) => <Link to={`/students/${r.student_id}?tab=finance`} className="hover:underline">{r.student_name}</Link> },
    { key: 'enrollment_code', header: 'Đăng ký', nowrap: true },
    { key: 'amount', header: 'Số tiền', align: 'right', render: (r) => money(r.amount) },
    { key: 'reason', header: 'Lý do', render: (r) => <span className="text-[13px]">{r.reason}</span> },
    { key: 'status', header: 'Trạng thái', render: (r) => <StatusBadge kind="refund" value={r.status} /> },
    { key: 'approval', header: 'Đề xuất', render: (r) => (r.approval_id ? <Link to={`/approvals?id=${r.approval_id}`} className="text-brand-700 hover:underline">{r.approval_code}</Link> : '—') },
    { key: 'paid_at', header: 'Ngày chi', render: (r) => (r.paid_at ? date(r.paid_at) : '—') },
  ];
  return (
    <>
      <p className="border-b border-line px-4 py-3 text-[13px] text-ink-3 sm:px-5">Quy trình: Đề nghị (từ hồ sơ học viên) → Quản lý duyệt → Thu ngân xác nhận đã chi ở mục Đề xuất – Phê duyệt. “Đã duyệt” chưa phải là đã hoàn tiền.</p>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>{(d) => <DataTable columns={columns} rows={d.items} caption="Hoàn phí" empty={<EmptyState title="Chưa có đề nghị hoàn phí" />} />}</DataState>
    </>
  );
}

function Cashflow({ f, setF }) {
  const { data, error, loading, reload } = useApi(`/api/finance/summary${qs({ period: f.period, from: f.from, to: f.to })}`);
  return (
    <>
      <FilterBar><PeriodFilter period={f.period} from={f.from} to={f.to} onChange={(p) => setF({ ...p, tab: 'cashflow' })} resolved={data && { from: data.from, to: data.to }} /></FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => (
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Tiền thu vào" icon={ArrowDownLeft} value={money(d.income)} sub={`Học phí ${money(d.receiptIncome)} · nạp tiền ${money(d.topupIncome)}`} />
              <StatTile label="Chi hoàn phí" icon={ArrowUpRight} value={money(d.refunds)} sub="Đã xác nhận chi" />
              <StatTile label="Chi mua sắm / chi phí" icon={ArrowUpRight} value={money(d.expenses)} sub="Đề xuất đã duyệt và đã chi" />
              <StatTile label="Chênh lệch thu – chi" icon={Scale} value={money(d.net)} tone={d.net < 0 ? 'danger' : 'neutral'} />
            </div>
            <p className="text-[13px] text-ink-3">Chỉ tính các khoản đã thực thu/thực chi. Đề xuất đã duyệt nhưng chưa chi không nằm trong số liệu này. Xem chi tiết từng chứng từ ở <Link to={`/reports?type=cashflow&period=${f.period}${f.from ? `&from=${f.from}&to=${f.to}` : ''}`} className="font-medium text-brand-700 hover:underline">Báo cáo thu chi</Link>.</p>
            <p className="text-xs text-ink-3">Cập nhật lúc {dateTime(new Date().toISOString())}.</p>
          </div>
        )}
      </DataState>
    </>
  );
}
