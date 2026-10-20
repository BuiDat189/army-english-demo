import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ListPlus, FilePlus2, CheckCircle2, Ban } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { money, date, dateTime, todayVN, addDays } from '../../lib/format.js';
import {
  Card, CardHeader, Button, StatusBadge, KeyValue, Timeline, Alert, Modal, Field, Input, Textarea, FormGrid, MoneyInput, Segmented, useForm, useToast, ErrorState, LoadingRows, ConfirmDialog, DateInput,
} from '../../components/ui/index.js';

export default function IssueDetailPage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi(`/api/assets/issues/${id}`);
  const [modal, setModal] = useState(null);
  const toast = useToast();
  if (error && !data) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card>{loading && <LoadingRows />}</Card>;
  const { issue: i, task, approval } = data;
  const open = !['resolved', 'cancelled'].includes(i.status);
  const handle = data.can.handle && open;
  const approvalPending = approval?.status === 'pending';
  return (
    <div>
      <Link to="/assets?tab=issues" className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />Danh sách báo hỏng</Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{i.asset_name}</h1><StatusBadge kind="issue" value={i.status} /></div>
          <p className="mt-1 text-sm text-ink-3">{i.code} · {i.asset_code} · {i.room_name || 'Không thuộc phòng học'} · tài sản: <StatusBadge kind="asset" value={i.asset_status} /></p>
        </div>
        {handle && (
          <div className="flex flex-wrap gap-2">
            {!task && <Button variant="secondary" icon={ListPlus} onClick={() => setModal('task')}>Tạo công việc xử lý</Button>}
            {(!approval || ['rejected', 'cancelled'].includes(approval.status)) && <Button variant="secondary" icon={FilePlus2} onClick={() => setModal('approval')}>Tạo đề xuất chi</Button>}
            <Button icon={CheckCircle2} onClick={() => setModal('resolve')} disabled={approvalPending} title={approvalPending ? 'Chờ quản lý duyệt đề xuất chi' : undefined}>Xác nhận đã xử lý</Button>
            <Button variant="ghost" icon={Ban} onClick={() => setModal('cancel')}>Hủy báo hỏng</Button>
          </div>
        )}
      </div>
      {approvalPending && handle && <Alert tone="info" className="mb-4">Đề xuất chi đang chờ quản lý duyệt — chưa thể xác nhận xử lý xong.</Alert>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Nội dung báo hỏng" />
            <div className="space-y-4 px-5 pb-5">
              <p className="rounded-md bg-canvas p-3 text-sm text-ink-2">{i.description}</p>
              <KeyValue items={[['Người báo', i.reporter], ['Thời điểm báo', dateTime(i.created_at)], ['Mức độ', <StatusBadge key="s" kind="priority" value={i.severity} />], ['Người xử lý', i.handler_name], i.resolution && ['Kết quả', i.resolution], i.resolved_at && ['Hoàn tất', `${dateTime(i.resolved_at)} · ${i.resolved_by_name}`]]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Công việc xử lý" />
            <div className="px-5 pb-5">
              {task ? (
                <Link to={`/tasks?id=${task.id}`} className="flex items-center justify-between gap-2 rounded-md border border-line p-3 hover:bg-canvas">
                  <div><p className="text-sm font-medium">{task.title}</p><p className="text-xs text-ink-3">{task.code} · {task.assignee_name} · hạn {date(task.due_date)}</p></div>
                  <StatusBadge kind="task" value={task.status} />
                </Link>
              ) : <p className="text-sm text-ink-3">Chưa tạo công việc.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Đề xuất chi" />
            <div className="px-5 pb-5">
              {approval ? (
                <Link to={`/approvals?id=${approval.id}`} className="block rounded-md border border-line p-3 hover:bg-canvas">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{approval.code} · {money(approval.amount)}</p><div className="flex gap-1"><StatusBadge kind="approval" value={approval.status} />{approval.payment_status !== 'none' && <StatusBadge kind="approvalPayment" value={approval.payment_status} />}</div></div>
                  <p className="mt-1 text-xs text-ink-3">{approval.decider ? `Xử lý bởi ${approval.decider} · ${dateTime(approval.decided_at)}` : 'Chờ quản lý duyệt'}{approval.payer ? ` · Đã chi bởi ${approval.payer}` : ''}</p>
                </Link>
              ) : <p className="text-sm text-ink-3">Không có đề xuất chi.</p>}
              {approval?.status === 'approved' && approval.payment_status === 'unpaid' && <p className="mt-2 text-xs text-amber-700">Đã duyệt nhưng thu ngân chưa xác nhận chi — chưa tính vào thu chi.</p>}
            </div>
          </Card>
        </div>
        <Card>
          <CardHeader title="Lịch sử xử lý" description="Toàn bộ bước từ báo hỏng tới khi xác nhận xử lý" />
          <div className="px-5 pb-5"><Timeline items={data.history.map((h) => ({ key: h.id, title: h.summary, meta: `${h.by_name || 'Hệ thống'} · ${dateTime(h.created_at)}`, tone: h.action === 'resolved' ? undefined : h.action === 'cancelled' || h.action === 'approval_rejected' ? 'danger' : undefined }))} /></div>
        </Card>
      </div>

      <TaskModal open={modal === 'task'} onOpenChange={(v) => !v && setModal(null)} issue={i} onDone={reload} />
      <ApprovalModal open={modal === 'approval'} onOpenChange={(v) => !v && setModal(null)} issue={i} onDone={reload} />
      <ResolveModal open={modal === 'resolve'} onOpenChange={(v) => !v && setModal(null)} issue={i} onDone={reload} />
      <ConfirmDialog open={modal === 'cancel'} onOpenChange={(v) => !v && setModal(null)} title="Hủy báo hỏng?" reason reasonLabel="Lý do hủy" confirmLabel="Hủy báo hỏng"
        message="Dùng khi báo nhầm hoặc tài sản không hỏng. Lịch sử vẫn được giữ." onConfirm={async (reason) => { await api.post(`/api/assets/issues/${i.id}/cancel`, { reason }); toast.success('Đã hủy báo hỏng.'); reload(); }} />
    </div>
  );
}

function TaskModal({ open, onOpenChange, issue, onDone }) {
  const { activeStaff } = useLookups();
  const { user } = useAuth();
  const toast = useToast();
  const f = useForm({});
  useEffect(() => { if (open) { f.setValues({ assignee_id: String(user.id), due_date: addDays(todayVN(), issue.severity === 'high' ? 1 : 3), priority: issue.severity === 'high' ? 'high' : 'normal', title: `Xử lý: ${issue.asset_name}${issue.room_name ? ` (${issue.room_name})` : ''}` }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => { await api.post(`/api/assets/issues/${issue.id}/task`, { ...v, assignee_id: Number(v.assignee_id) }); toast.success('Đã tạo công việc xử lý.'); onOpenChange(false); onDone(); });
  if (f.values.title === undefined) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Tạo công việc xử lý" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Tạo công việc</Button></>}>
      <div className="space-y-4">
        <Field label="Tiêu đề"><Input {...f.bind('title')} /></Field>
        <FormGrid>
          <Field label="Người xử lý" required><select className="field-input" {...f.bind('assignee_id')}>{activeStaff.filter((s) => s.roles.includes('operations') || s.roles.includes('manager')).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <Field label="Hạn xử lý" required error={f.errors.due_date}><DateInput {...f.bind('due_date')} /></Field>
        </FormGrid>
        <Field label="Ưu tiên"><Segmented ariaLabel="Ưu tiên" value={f.values.priority} onChange={(p) => f.set('priority', p)} options={[{ value: 'normal', label: 'Bình thường' }, { value: 'high', label: 'Cao' }, { value: 'urgent', label: 'Khẩn cấp' }]} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function ApprovalModal({ open, onOpenChange, issue, onDone }) {
  const toast = useToast();
  const f = useForm({ amount: '', description: '' });
  useEffect(() => { if (open) { f.setValues({ amount: '', description: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => { await api.post(`/api/assets/issues/${issue.id}/approval`, v); toast.success('Đã gửi đề xuất chi, chờ quản lý duyệt.'); onOpenChange(false); onDone(); },
    (v) => ({ amount: !(v.amount > 0) && 'Nhập chi phí dự kiến.', description: !v.description.trim() && 'Nhập mô tả hoặc báo giá.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Tạo đề xuất chi sửa chữa" description={issue.asset_name}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Gửi đề xuất</Button></>}>
      <div className="space-y-4">
        <Field label="Chi phí dự kiến" required error={f.errors.amount}><MoneyInput value={f.values.amount} onChange={(n) => f.set('amount', n)} /></Field>
        <Field label="Mô tả / báo giá" required error={f.errors.description}><Textarea rows={3} {...f.bind('description')} /></Field>
        <p className="text-xs text-ink-3">Sau khi quản lý duyệt, thu ngân xác nhận chi tiền riêng. Duyệt không đồng nghĩa đã thanh toán.</p>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function ResolveModal({ open, onOpenChange, issue, onDone }) {
  const toast = useToast();
  const f = useForm({ resolution: '', asset_status: 'good' });
  useEffect(() => { if (open) { f.setValues({ resolution: '', asset_status: 'good' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => { await api.post(`/api/assets/issues/${issue.id}/resolve`, v); toast.success('Đã xác nhận xử lý xong. Công việc liên quan được đánh dấu hoàn thành.'); onOpenChange(false); onDone(); },
    (v) => ({ resolution: !v.resolution.trim() && 'Nhập kết quả xử lý.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Xác nhận đã xử lý" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Xác nhận</Button></>}>
      <div className="space-y-4">
        <Field label="Kết quả xử lý" required error={f.errors.resolution}><Textarea rows={3} {...f.bind('resolution')} /></Field>
        <Field label="Tình trạng tài sản sau xử lý"><Segmented ariaLabel="Tình trạng" value={f.values.asset_status} onChange={(s) => f.set('asset_status', s)} options={[{ value: 'good', label: 'Hoạt động tốt' }, { value: 'disposed', label: 'Thanh lý' }]} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
