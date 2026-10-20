import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Check, X, Banknote, Ban, Paperclip, FileText } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { money, date, dateTime, todayVN } from '../../lib/format.js';
import { APPROVAL_TYPES, LEAVE_KINDS, STATUS, STAGE_LABELS } from '../../lib/labels.js';
import {
  PageHeader, Card, Tabs, DataTable, DataState, FilterBar, Select, StatusBadge, Button, EmptyState, Drawer, Modal, Field, Input, Textarea, FormGrid, MoneyInput, Alert, Segmented, Timeline, useForm, useToast, Spinner, ErrorState, KeyValue, ConfirmDialog, DateInput,
} from '../../components/ui/index.js';

export default function ApprovalsPage() {
  const { can } = useAuth();
  const decider = can('approvals.decide', 'approvals.decide_lead');
  const defaultView = decider ? 'to_decide' : can('finance.pay') ? 'to_pay' : 'mine';
  const [f, setF] = useUrlFilters({ view: defaultView, type: '', status: '', id: '' });
  const { data, error, loading, reload } = useApi(`/api/approvals${qs({ view: f.view === 'all' ? '' : f.view, type: f.type, status: f.status })}`);
  const [creating, setCreating] = useState(false);
  const tabs = [
    decider && { value: 'to_decide', label: can('approvals.decide') ? 'Chờ Giám đốc duyệt' : 'Chờ tôi duyệt (cấp 1)', count: data?.counts.pending },
    can('finance.pay') && { value: 'to_pay', label: 'Đã duyệt – chờ chi', count: data?.counts.toPay },
    { value: 'mine', label: 'Đề xuất của tôi' },
    (can('approvals.view_all') || can('finance.pay') || can('approvals.decide_lead')) && { value: 'all', label: 'Tất cả' },
  ].filter(Boolean);
  const columns = [
    { key: 'title', header: 'Đề xuất', mobile: 'title', render: (a) => <div><p className="font-medium">{a.title}</p><p className="flex items-center gap-1 text-xs text-ink-3">{a.code} · {APPROVAL_TYPES[a.type]}{a.file_count > 0 && <span className="inline-flex items-center gap-0.5" title={`${a.file_count} file đính kèm`}><Paperclip className="size-3" />{a.file_count}</span>}</p></div> },
    { key: 'requester', header: 'Người đề xuất', render: (a) => <div className="text-[13px]"><p>{a.requester}</p><p className="text-ink-3">{dateTime(a.created_at)}</p></div> },
    { key: 'amount', header: 'Số tiền', align: 'right', render: (a) => (a.amount ? money(a.amount) : '—') },
    { key: 'status', header: 'Duyệt', render: (a) => <span className="flex flex-col items-start gap-1"><StatusBadge kind="approval" value={a.status} />{a.status === 'pending' && a.stage && <span className="text-xs text-ink-3">{STAGE_LABELS[a.stage]}</span>}</span> },
    { key: 'payment', header: 'Chi tiền', render: (a) => (a.payment_status === 'none' ? <span className="text-xs text-ink-3">Không phát sinh</span> : <StatusBadge kind="approvalPayment" value={a.payment_status} />) },
    { key: 'decider', header: 'Người xử lý', render: (a) => (a.decider ? <div className="text-[13px]"><p>{a.decider}</p><p className="text-ink-3">{dateTime(a.decided_at)}</p></div> : '—') },
  ];
  return (
    <div>
      <PageHeader title="Đề xuất – Phê duyệt" description="Học phí đăng ký/tái phí và gói phí: Giám đốc duyệt. Bảo lưu, chuyển học phí, chuyển lớp, lên level: Trưởng phòng học thuật duyệt trước, Giám đốc duyệt cuối. Đề xuất có chi tiền: duyệt xong chờ kế toán xác nhận đã chi."
        actions={can('approvals.create') && <Button icon={Plus} onClick={() => setCreating(true)}>Tạo đề xuất</Button>} />
      <Card>
        <Tabs className="px-4 sm:px-5" tabs={tabs} value={f.view} onChange={(view) => setF({ view })} />
        <FilterBar active={f.type || f.status} onReset={() => setF({ type: '', status: '' })}>
          <Select aria-label="Loại đề xuất" className="w-full sm:w-44" value={f.type} onChange={(e) => setF({ type: e.target.value })} placeholder="Mọi loại">{Object.entries(APPROVAL_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Select aria-label="Trạng thái duyệt" className="w-full sm:w-44" value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder="Mọi trạng thái">{Object.entries(STATUS.approval).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        </FilterBar>
        <DataState loading={loading} error={error} data={data} onRetry={reload}>
          {(d) => <DataTable columns={columns} rows={d.items} onRowClick={(a) => setF({ id: String(a.id) })} caption="Danh sách đề xuất" empty={<EmptyState title="Không có đề xuất trong mục này" />} />}
        </DataState>
      </Card>
      <CreateModal open={creating} onOpenChange={setCreating} onSaved={(id) => { reload(); if (id) setF({ id: String(id), view: 'mine' }); }} />
      <ApprovalDrawer id={f.id} onOpenChange={(v) => !v && setF({ id: '' })} onChanged={reload} />
    </div>
  );
}

function CreateModal({ open, onOpenChange, onSaved }) {
  const toast = useToast();
  const f = useForm({});
  useEffect(() => { if (open) { f.setValues({ type: 'purchase', title: '', description: '', amount: '', kind: 'annual', from_date: todayVN(), to_date: todayVN(), reason: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const isLeave = f.values.type === 'leave';
  const save = () => f.submit(async (v) => {
    if (isLeave) {
      const r = await api.post('/api/hr/leaves', { kind: v.kind, from_date: v.from_date, to_date: v.to_date, reason: v.reason });
      toast.success(`Đã gửi đơn nghỉ.${r.affectedSessions ? ` Ảnh hưởng ${r.affectedSessions} buổi dạy — quản lý sẽ sắp xếp dạy thay.` : ''}`);
      onOpenChange(false); onSaved?.(r.approvalId);
    } else {
      const r = await api.post('/api/approvals', { type: v.type, title: v.title, description: v.description || null, amount: v.amount });
      toast.success('Đã gửi đề xuất, chờ quản lý duyệt.'); onOpenChange(false); onSaved?.(r.id);
    }
  }, (v) => (v.type === 'leave'
    ? { reason: !v.reason.trim() && 'Nhập lý do.', to_date: v.to_date < v.from_date && 'Ngày kết thúc phải từ ngày bắt đầu.' }
    : { title: !v.title?.trim() && 'Nhập tiêu đề.', amount: !(v.amount > 0) && 'Nhập số tiền lớn hơn 0.' }));
  if (f.values.type === undefined) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Tạo đề xuất" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Gửi đề xuất</Button></>}>
      <div className="space-y-4">
        <Segmented ariaLabel="Loại đề xuất" value={f.values.type} onChange={(t) => f.set('type', t)} options={[{ value: 'purchase', label: 'Mua sắm' }, { value: 'expense', label: 'Chi phí' }, { value: 'leave', label: 'Nghỉ phép' }]} />
        {isLeave ? (<>
          <Field label="Loại nghỉ"><select className="field-input" {...f.bind('kind')}>{Object.entries(LEAVE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <FormGrid>
            <Field label="Từ ngày" required error={f.errors.from_date}><DateInput {...f.bind('from_date')} /></Field>
            <Field label="Đến ngày" required error={f.errors.to_date}><DateInput {...f.bind('to_date')} /></Field>
          </FormGrid>
          <Field label="Lý do" required error={f.errors.reason}><Textarea rows={2} {...f.bind('reason')} /></Field>
        </>) : (<>
          <Field label="Tiêu đề" required error={f.errors.title}><Input {...f.bind('title')} /></Field>
          <Field label="Số tiền đề xuất" required error={f.errors.amount}><MoneyInput value={f.values.amount} onChange={(n) => f.set('amount', n)} /></Field>
          <Field label="Mô tả / báo giá"><Textarea rows={3} {...f.bind('description')} /></Field>
        </>)}
        <p className="text-xs text-ink-3">Giảm học phí và hoàn phí được tạo từ hồ sơ học viên (tab Học phí) để gắn đúng đăng ký khóa.</p>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function ApprovalDrawer({ id, onOpenChange, onChanged }) {
  const { data, error, loading, reload } = useApi(id ? `/api/approvals/${id}` : null, { keepPrevious: false });
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  useEffect(() => { setNote(''); setErr(null); }, [id]);
  const a = data?.approval;
  const decide = async (decision) => {
    if (busy) return;
    setBusy(decision); setErr(null);
    try {
      await api.post(`/api/approvals/${a.id}/decide`, { decision, note: note || null });
      const needPay = ['purchase', 'expense', 'refund'].includes(a.type) || (a.type === 'contract_cancel' && a.amount > 0);
      const done = { package_change: ' Gói phí mới đã được áp dụng.', reserve: ' Học viên đã chuyển sang bảo lưu.', contract_cancel: ' Đăng ký đã hủy.', fee_transfer: ' Số dư đã được chuyển.', enrollment: ' Đăng ký có hiệu lực, kế toán thu được học phí.', package: ' Gói phí đã mở bán.', class_transfer: ' Học viên đã chuyển lớp.', level_up: ' Học viên đã lên level mới.' }[a.type] || '';
      const leadStep = data.can.decideLevel === 'lead';
      toast.success(decision === 'approved' ? (leadStep ? 'Đã duyệt cấp Trưởng phòng — chuyển Giám đốc duyệt cuối.' : needPay ? `Đã duyệt.${done} Chờ kế toán chi tiền.` : `Đã duyệt đề xuất.${done}`) : 'Đã từ chối đề xuất.');
      reload(); onChanged?.();
    } catch (e) { setErr(e); reload(); } finally { setBusy(null); }
  };
  const EVENT = { created: 'Tạo đề xuất', lead_approved: 'Trưởng phòng học thuật duyệt cấp 1', approved: 'Duyệt', rejected: 'Từ chối', paid: 'Xác nhận đã chi', cancelled: 'Hủy đề xuất', file: 'Đính kèm file' };
  return (
    <>
      <Drawer open={!!id} onOpenChange={onOpenChange} title={a ? a.title : 'Đề xuất'} description={a && `${a.code} · ${APPROVAL_TYPES[a.type]} · ${a.requester}`}
        headerExtra={a && <div className="mt-2 flex flex-wrap gap-2"><StatusBadge kind="approval" value={a.status} />{a.status === 'pending' && a.stage && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">{STAGE_LABELS[a.stage]}</span>}{a.payment_status !== 'none' && <StatusBadge kind="approvalPayment" value={a.payment_status} />}</div>}
        footer={a && (data.can.decide || data.can.pay || data.can.cancel) && <>
          {data.can.cancel && <Button variant="ghost" icon={Ban} className="mr-auto" onClick={() => setCancel(true)}>Hủy đề xuất</Button>}
          {data.can.decide && <><Button variant="danger-outline" icon={X} loading={busy === 'rejected'} disabled={!!busy} onClick={() => decide('rejected')}>Từ chối</Button><Button icon={Check} loading={busy === 'approved'} disabled={!!busy} onClick={() => decide('approved')}>{data.can.decideLevel === 'lead' ? 'Duyệt cấp 1 → chuyển Giám đốc' : a.stage === 'lead' ? 'Duyệt thẳng (Giám đốc)' : 'Duyệt'}</Button></>}
          {data.can.pay && <Button icon={Banknote} onClick={() => setPay(true)}>Xác nhận đã chi</Button>}
        </>}>
        {error && !data && <ErrorState error={error} onRetry={reload} />}
        {loading && !data && <Spinner />}
        {a && (
          <div className="space-y-5">
            <KeyValue items={[
              ['Loại', APPROVAL_TYPES[a.type]], ['Số tiền', a.amount ? money(a.amount) : 'Không có'], ['Người đề xuất', a.requester], ['Ngày tạo', dateTime(a.created_at)],
              (a.stage || a.lead_decider) && ['Trưởng phòng học thuật', a.lead_decider ? `${a.lead_decider} · ${dateTime(a.lead_decided_at)}${a.lead_note ? ` — ${a.lead_note}` : ''}` : a.stage === 'lead' ? 'Chờ duyệt cấp 1' : 'Bỏ qua (người gửi là trưởng phòng/Giám đốc)'],
              ['Người duyệt cuối', a.decider ? `${a.decider} · ${dateTime(a.decided_at)}` : 'Chưa xử lý'], ['Ghi chú duyệt', a.decision_note],
              a.payment_status !== 'none' && ['Chi tiền', a.payment_status === 'paid' ? `Đã chi ${date(a.paid_at)} bởi ${a.payer} (${a.payment_method === 'cash' ? 'tiền mặt' : 'chuyển khoản'})` : 'Đã duyệt – CHƯA chi'],
            ]} />
            {a.description && <p className="whitespace-pre-line rounded-md bg-canvas p-3 text-sm text-ink-2">{a.description}</p>}
            <RefBlock a={a} r={data.ref} />
            <FilesSection approvalId={a.id} files={data.files} canAttach={data.can.attach} status={a.status} onChanged={reload} />
            {a.status === 'approved' && a.payment_status === 'unpaid' && <Alert tone="warning" title="Đã duyệt nhưng chưa chi tiền">Duyệt đề xuất không đồng nghĩa đã thanh toán. Thu ngân bấm “Xác nhận đã chi” sau khi thực chi; khi đó khoản chi mới vào báo cáo thu chi.</Alert>}
            {data.can.decide && <Field label="Ghi chú khi duyệt / lý do từ chối" hint="Bắt buộc khi từ chối." error={err?.fields?.note}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
            {err && <Alert tone="danger">{err.message}</Alert>}
            <section><h3 className="mb-2 text-sm font-semibold">Lịch sử xử lý</h3>
              <Timeline items={data.events.map((e) => ({ key: e.id, tone: e.action === 'rejected' || e.action === 'cancelled' ? 'danger' : undefined, title: `${EVENT[e.action]} — ${e.user_name || 'Hệ thống'}`, body: e.note, meta: dateTime(e.created_at) }))} />
            </section>
          </div>
        )}
      </Drawer>
      <PayModal open={pay} onOpenChange={setPay} approval={a} onDone={() => { reload(); onChanged?.(); }} />
      <ConfirmDialog open={cancel} onOpenChange={setCancel} title="Hủy đề xuất?" confirmLabel="Hủy đề xuất" message="Chỉ hủy được khi đề xuất còn chờ duyệt."
        onConfirm={async () => { await api.post(`/api/approvals/${a.id}/cancel`, {}); toast.success('Đã hủy đề xuất.'); reload(); onChanged?.(); }} />
    </>
  );
}

function RefBlock({ a, r }) {
  if (!r) return null;
  if (a.ref_type === 'discount') return <Alert tone="info" title="Giảm học phí">Học viên <Link className="font-medium underline" to={`/students/${r.student_id}?tab=finance`}>{r.student_name}</Link> · đăng ký {r.enrollment_code} · học phí {money(r.tuition_fee)} · giảm {r.kind === 'percent' ? `${r.value}%` : money(r.value)} = {money(r.amount)}. Công nợ chỉ giảm sau khi duyệt.</Alert>;
  if (a.ref_type === 'refund') return <Alert tone="info" title="Hoàn phí">Học viên {r.student_name} · đăng ký {r.enrollment_code} · {money(r.amount)} · trạng thái hoàn: <StatusBadge kind="refund" value={r.status} /></Alert>;
  if (a.ref_type === 'leave') return <Alert tone="info" title={LEAVE_KINDS[r.kind]}>Từ {date(r.from_date)} đến {date(r.to_date)}. {r.reason}</Alert>;
  if (a.ref_type === 'enrollment') {
    const what = {
      package_change: 'Khi duyệt: học phí và số buổi đổi theo gói mới, phần chênh lệch thêm thành đợt thanh toán mới.',
      reserve: 'Khi duyệt: học viên rời lớp trong thời gian bảo lưu, giữ học phí và số buổi đã học; hết bảo lưu chủ nhiệm nhận việc xếp lại lớp. Gói 1 năm được 1 lần, 2 tuần – 3 tháng.',
      contract_cancel: `Khi duyệt: đăng ký chuyển sang “Đã hủy”${a.amount ? `, tạo khoản hoàn ${money(a.amount)} chờ kế toán chi` : ''}.`,
      enrollment: 'Khi duyệt: đăng ký có hiệu lực (vào lớp đã chọn hoặc chờ xếp lớp) và kế toán mới thu được học phí. Từ chối: đăng ký bị hủy.',
      class_transfer: 'Khi duyệt: học viên chuyển sang lớp mới, giữ nguyên học phí và số buổi đã học.',
      level_up: 'Khi duyệt: đăng ký chuyển sang khóa/level mới, giữ học phí và số buổi còn lại.',
    }[a.type];
    return <Alert tone="info" title="Đăng ký liên quan">Học viên <Link className="font-medium underline" to={`/students/${r.student_id}?tab=classes`}>{r.student_name}</Link> · {r.enrollment_code} · {r.course_name}{r.package_name ? ` · ${r.package_name}` : ''} · học phí {money(r.tuition_fee)} · <StatusBadge kind="enrollment" value={r.status} />{what && <span className="mt-1 block">{what}</span>}</Alert>;
  }
  if (a.ref_type === 'student') return <Alert tone="info" title="Chuyển số dư">Từ học viên <Link className="font-medium underline" to={`/students/${r.student_id}?tab=finance`}>{r.student_name}</Link>. Số dư được kiểm tra lại khi duyệt; nếu không đủ, đề xuất giữ nguyên trạng thái chờ duyệt.</Alert>;
  if (a.ref_type === 'package') return <Alert tone="info" title="Gói phí đề xuất">{r.course_name} · <b>{r.name}</b> · {r.sessions} buổi · {money(r.price)} · {r.free_absences} buổi nghỉ không tính phí · {r.reserve_limit} lần bảo lưu. Khi duyệt gói được mở bán; từ chối thì không bán được.</Alert>;
  if (a.ref_type === 'asset_issue') return <Alert tone="info" title="Gắn với báo hỏng tài sản"><Link className="font-medium underline" to={`/assets/issues/${r.id}`}>{r.code} · {r.asset_name}{r.asset_code ? ` (${r.asset_code})` : ''}{r.room_name ? ` · ${r.room_name}` : ''}</Link> — <StatusBadge kind="issue" value={r.status} /></Alert>;
  return null;
}

function PayModal({ open, onOpenChange, approval, onDone }) {
  const toast = useToast();
  const f = useForm({ method: 'transfer', paid_at: todayVN(), note: '' });
  useEffect(() => { if (open) { f.setValues({ method: 'transfer', paid_at: todayVN(), note: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!approval) return null;
  const save = () => f.submit(async (v) => { await api.post(`/api/approvals/${approval.id}/pay`, v); toast.success('Đã xác nhận chi tiền.'); onOpenChange(false); onDone?.(); });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Xác nhận đã chi tiền" description={`${approval.code} · ${approval.title} · ${money(approval.amount)}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Xác nhận đã chi</Button></>}>
      <div className="space-y-4">
        <Alert tone="warning">Chỉ xác nhận sau khi đã thực sự chi tiền. Hệ thống không thực hiện chuyển khoản.</Alert>
        <FormGrid>
          <Field label="Hình thức"><select className="field-input" {...f.bind('method')}><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></Field>
          <Field label="Ngày chi" error={f.errors.paid_at}><DateInput max={todayVN()} {...f.bind('paid_at')} /></Field>
        </FormGrid>
        <Field label="Ghi chú (mã giao dịch, người nhận…)"><Input {...f.bind('note')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

const MAX_MB = 5;
const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('Không đọc được file.'));
  r.readAsDataURL(file);
});

/** File đính kèm đề xuất: báo giá, hóa đơn, đơn của phụ huynh… (PDF, ảnh, Word, Excel; ≤ 5 MB) */
function FilesSection({ approvalId, files, canAttach, status, onChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) { toast.error(`File tối đa ${MAX_MB} MB.`); return; }
    setBusy(true);
    try {
      await api.post(`/api/approvals/${approvalId}/files`, { name: file.name, mime: file.type || 'application/octet-stream', data: await toBase64(file) });
      toast.success(`Đã đính kèm ${file.name}.`);
      onChanged?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!files.length && !canAttach) return null;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">File đính kèm</h3>
        {canAttach && files.length < 5 && (
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-[13px] font-medium text-ink-2 hover:border-brand-300 hover:text-brand-700 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            <Paperclip className="size-3.5" />{busy ? 'Đang tải lên…' : 'Đính kèm file'}
            <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {files.length ? (
        <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line text-[13px]">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <a href={`/api/approvals/${approvalId}/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 font-medium text-brand-700 hover:underline">
                <FileText className="size-3.5 shrink-0" /><span className="truncate">{f.name}</span>
              </a>
              <span className="flex items-center gap-2 text-xs text-ink-3">
                {(f.size / 1024).toFixed(f.size > 102400 ? 0 : 1)} KB · {f.uploaded_by_name}
                <a href={`/api/approvals/${approvalId}/files/${f.id}?download=1`} className="font-medium text-ink-2 hover:text-brand-700">Tải về</a>
                {f.uploaded_by === user?.id && status === 'pending' && (
                  <button type="button" className="font-medium text-red-700 hover:underline" onClick={async () => { try { await api.del(`/api/approvals/${approvalId}/files/${f.id}`); onChanged?.(); } catch (e) { toast.error(e.message); } }}>Gỡ</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-ink-3">Chưa có file. Có thể đính kèm báo giá, hóa đơn, đơn xin của phụ huynh (PDF, ảnh, Word, Excel; tối đa 5 file, mỗi file ≤ 5 MB).</p>}
    </section>
  );
}
