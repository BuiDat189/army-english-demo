import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PiggyBank, Plus, Ban, Users } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { money, date } from '../../lib/format.js';
import { METHODS } from '../../lib/labels.js';
import { DataTable, DataState, FilterBar, Badge, Button, EmptyState, Menu, ConfirmDialog, StatTile, Modal, Field, Input, useToast } from '../../components/ui/index.js';
import { PeriodFilter } from '../../components/PeriodFilter.jsx';
import { TopupModal } from '../../components/business/StudentExtras.jsx';

/** Số dư học viên: phiếu nạp tiền (đặt cọc / đóng trước), trừ số dư khi đóng học phí, chuyển số dư */
export default function WalletTab({ f, setF }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/api/finance/wallet${qs({ period: f.period, from: f.from, to: f.to })}`);
  const [pick, setPick] = useState(false);
  const [student, setStudent] = useState(null);
  const [cancel, setCancel] = useState(null);
  const columns = [
    { key: 'code', header: 'Chứng từ', mobile: 'title', nowrap: true, render: (w) => <span className="font-medium">{w.code}</span> },
    { key: 'paid_at', header: 'Ngày', nowrap: true, render: (w) => date(w.paid_at) },
    { key: 'student', header: 'Học viên', render: (w) => <Link to={`/students/${w.student_id}?tab=finance`} className="hover:text-brand-700 hover:underline">{w.student_name}</Link> },
    { key: 'kind', header: 'Loại', render: (w) => data.kindLabels[w.kind] },
    { key: 'amount', header: 'Số tiền', align: 'right', render: (w) => <span className={w.status === 'cancelled' ? 'text-ink-3 line-through' : w.amount > 0 ? 'font-medium text-brand-700' : 'font-medium'}>{w.amount > 0 ? '+' : '−'} {money(Math.abs(w.amount))}</span> },
    { key: 'method', header: 'Hình thức', render: (w) => (w.method ? METHODS[w.method] : '—') },
    { key: 'note', header: 'Nội dung', render: (w) => <span className="text-[13px] text-ink-2">{w.note || '—'}</span> },
    { key: 'status', header: 'Trạng thái', render: (w) => (w.status === 'cancelled' ? <Badge tone="neutral" title={w.cancel_reason}>Đã hủy</Badge> : <Badge tone="success">Đã xác nhận</Badge>) },
    { key: 'act', header: '', stop: true, render: (w) => (w.kind === 'topup' && w.status === 'confirmed' && can('finance.cancel') ? <Menu items={[{ label: 'Hủy phiếu nạp', icon: Ban, danger: true, onSelect: () => setCancel(w) }]} /> : null) },
  ];
  const holderCols = [
    { key: 'name', header: 'Học viên', mobile: 'title', render: (h) => <Link to={`/students/${h.id}?tab=finance`} className="font-medium hover:text-brand-700 hover:underline">{h.full_name}</Link> },
    { key: 'code', header: 'Mã' },
    { key: 'balance', header: 'Số dư', align: 'right', render: (h) => <b className="tabular">{money(h.balance)}</b> },
  ];
  return (
    <>
      <FilterBar>
        <PeriodFilter period={f.period} from={f.from} to={f.to} onChange={(p) => setF({ ...p, tab: 'wallet' })} resolved={data && { from: data.from, to: data.to }} />
        {can('finance.collect') && <Button icon={Plus} onClick={() => setPick(true)} className="sm:ml-auto">Nạp tiền</Button>}
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => (
          <div className="space-y-5 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile label="Nạp tiền trong kỳ" icon={PiggyBank} value={money(d.topupTotal)} sub="Tiền vào thật, tính vào thực thu" />
              <StatTile label="Tổng số dư đang giữ" icon={PiggyBank} value={money(d.balanceTotal)} sub="Chưa gắn khóa học" />
              <StatTile label="Học viên có số dư" icon={Users} value={String(d.holders.length)} />
            </div>
            {d.holders.length > 0 && (
              <section><h3 className="mb-2 text-sm font-semibold">Học viên đang có số dư</h3>
                <div className="overflow-hidden rounded-[var(--radius-control)] border border-line"><DataTable columns={holderCols} rows={d.holders} dense /></div>
              </section>
            )}
            <section><h3 className="mb-2 text-sm font-semibold">Giao dịch số dư trong kỳ</h3>
              <div className="overflow-hidden rounded-[var(--radius-control)] border border-line"><DataTable columns={columns} rows={d.items} dense empty={<EmptyState compact icon={PiggyBank} title="Chưa có giao dịch số dư trong kỳ" />} /></div>
            </section>
            <p className="text-xs text-ink-3">Dùng số dư để đóng học phí ở hồ sơ học viên (tab Học phí → “Trừ số dư”). Phiếu thu trừ số dư không cộng thêm vào thực thu vì tiền đã vào lúc nạp.</p>
          </div>
        )}
      </DataState>
      <PickStudentModal open={pick} onOpenChange={setPick} onPick={(s) => { setPick(false); setStudent(s); }} />
      {student && <TopupModal open={!!student} onOpenChange={(v) => !v && setStudent(null)} student={student} onDone={reload} />}
      <ConfirmDialog open={!!cancel} onOpenChange={(v) => !v && setCancel(null)} title={`Hủy phiếu nạp ${cancel?.code || ''}?`} reason reasonLabel="Lý do hủy" confirmLabel="Hủy phiếu nạp"
        message="Chỉ hủy được khi số dư chưa được dùng để đóng học phí. Phiếu không bị xóa, chỉ chuyển sang “Đã hủy”."
        onConfirm={async (reason) => { await api.post(`/api/finance/wallet/${cancel.id}/cancel`, { reason }); toast.success('Đã hủy phiếu nạp.'); reload(); }} />
    </>
  );
}

function PickStudentModal({ open, onOpenChange, onPick }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  useEffect(() => { if (open) { setQ(''); setItems([]); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return undefined; }
    const t = setTimeout(async () => { try { const r = await api.get(`/api/search?q=${encodeURIComponent(q)}`); setItems(r.results.filter((x) => x.type === 'student')); } catch { setItems([]); } }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Nạp tiền cho học viên" description="Tìm học viên theo tên, mã hoặc số điện thoại phụ huynh.">
      <div className="space-y-3">
        <Field label="Học viên"><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gõ ít nhất 2 ký tự…" /></Field>
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line text-sm">
            {items.map((x) => <li key={x.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-canvas" onClick={() => onPick({ id: x.id, full_name: x.title, code: x.subtitle })}>{x.title} <span className="text-xs text-ink-3">{x.subtitle}</span></button></li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}
