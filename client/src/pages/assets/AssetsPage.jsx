import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Wrench, Pencil, AlertTriangle } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, dateTime, todayVN, addDays } from '../../lib/format.js';
import { STATUS } from '../../lib/labels.js';
import {
  PageHeader, Card, Tabs, DataTable, DataState, FilterBar, SearchInput, Select, StatusBadge, Button, EmptyState, Modal, Field, Input, Textarea, FormGrid, Alert, Segmented, useForm, useToast, Menu, DateInput,
} from '../../components/ui/index.js';

export default function AssetsPage() {
  const { can } = useAuth();
  const [f, setF] = useUrlFilters({ tab: can('assets.view') ? 'assets' : 'issues', q: '', status: '', room_id: '', category: '', istatus: 'open' });
  const [report, setReport] = useState(null);
  return (
    <div>
      <PageHeader title="Tài sản" description="Danh sách tài sản theo phòng, tình trạng và quy trình báo hỏng – xử lý."
        actions={can('assets.report') && <Button icon={AlertTriangle} onClick={() => setReport({})}>Báo hỏng</Button>} />
      <Card>
        <Tabs className="px-4 sm:px-5" value={f.tab} onChange={(tab) => setF({ tab })} tabs={[{ value: 'assets', label: 'Danh sách tài sản' }, { value: 'issues', label: can('assets.view') ? 'Báo hỏng & xử lý' : 'Báo hỏng của tôi' }]} />
        {f.tab === 'assets' ? <AssetsTab f={f} setF={setF} onReport={setReport} /> : <IssuesTab f={f} setF={setF} />}
      </Card>
      <ReportModal open={!!report} onOpenChange={(v) => !v && setReport(null)} asset={report?.id ? report : null} />
    </div>
  );
}

function AssetsTab({ f, setF, onReport }) {
  const { can } = useAuth();
  const { rooms } = useLookups();
  const { data, error, loading, reload } = useApi(`/api/assets${qs({ q: f.q, status: f.status, room_id: f.room_id, category: f.category })}`);
  const [edit, setEdit] = useState(null);
  const navigate = useNavigate();
  const columns = [
    { key: 'name', header: 'Tài sản', mobile: 'title', render: (a) => <div><p className="font-medium">{a.name}</p><p className="text-xs text-ink-3">{a.code}</p></div> },
    { key: 'category', header: 'Nhóm' },
    { key: 'room', header: 'Vị trí', render: (a) => a.room_name || a.location_note || '—' },
    { key: 'status', header: 'Tình trạng', render: (a) => <StatusBadge kind="asset" value={a.status} /> },
    { key: 'purchased_at', header: 'Ngày mua', render: (a) => date(a.purchased_at) },
    { key: 'act', header: '', stop: true, render: (a) => <Menu items={[
      can('assets.report') && !a.open_issue_id && a.status !== 'disposed' && { label: 'Báo hỏng', icon: AlertTriangle, onSelect: () => onReport(a) },
      a.open_issue_id && { label: 'Xem báo hỏng đang xử lý', icon: Wrench, onSelect: () => navigate(`/assets/issues/${a.open_issue_id}`) },
      can('assets.edit') && { label: 'Sửa thông tin', icon: Pencil, onSelect: () => setEdit(a) },
    ]} /> },
  ];
  return (
    <>
      <FilterBar active={f.q || f.status || f.room_id || f.category} onReset={() => setF({ q: '', status: '', room_id: '', category: '' })}>
        <SearchInput className="w-full sm:w-56" value={f.q} onChange={(q) => setF({ q })} placeholder="Tên hoặc mã tài sản…" />
        <Select aria-label="Tình trạng" className="w-full sm:w-44" value={f.status} onChange={(e) => setF({ status: e.target.value })} placeholder="Mọi tình trạng">{Object.entries(STATUS.asset).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select aria-label="Phòng" className="w-full sm:w-32" value={f.room_id} onChange={(e) => setF({ room_id: e.target.value })} placeholder="Mọi phòng">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        <Select aria-label="Nhóm" className="w-full sm:w-44" value={f.category} onChange={(e) => setF({ category: e.target.value })} placeholder="Mọi nhóm">{data?.categories.map((c) => <option key={c}>{c}</option>)}</Select>
        {can('assets.edit') && <Button className="sm:ml-auto" variant="secondary" icon={Plus} onClick={() => setEdit({})}>Thêm tài sản</Button>}
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>{(d) => <DataTable columns={columns} rows={d.items} caption="Tài sản" empty={<EmptyState title="Không có tài sản phù hợp" />} />}</DataState>
      <AssetModal open={!!edit} onOpenChange={(v) => !v && setEdit(null)} asset={edit?.id ? edit : null} categories={data?.categories || []} onSaved={reload} />
    </>
  );
}

function IssuesTab({ f, setF }) {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi(`/api/assets/issues${qs({ status: f.istatus })}`);
  const columns = [
    { key: 'asset', header: 'Tài sản / sự cố', mobile: 'title', render: (i) => <div><p className="font-medium">{i.asset_name}</p><p className="text-xs text-ink-3">{i.code} · {i.room_name || '—'}</p></div> },
    { key: 'desc', header: 'Mô tả', render: (i) => <span className="line-clamp-2 text-[13px] text-ink-2">{i.description}</span> },
    { key: 'severity', header: 'Mức độ', render: (i) => <StatusBadge kind="priority" value={i.severity} /> },
    { key: 'reporter', header: 'Người báo', render: (i) => <div className="text-[13px]"><p>{i.reporter}</p><p className="text-ink-3">{dateTime(i.created_at)}</p></div> },
    { key: 'handler', header: 'Xử lý', render: (i) => <div className="text-[13px]"><p>{i.handler_name || '—'}</p>{i.task_code && <p className="text-ink-3">{i.task_code} · <StatusBadge kind="task" value={i.task_status} /></p>}</div> },
    { key: 'approval', header: 'Đề xuất chi', render: (i) => (i.approval_code ? <div className="flex flex-col items-start gap-1 text-[13px]"><span>{i.approval_code}</span><StatusBadge kind="approval" value={i.approval_status} />{i.payment_status !== 'none' && <StatusBadge kind="approvalPayment" value={i.payment_status} />}</div> : '—') },
    { key: 'due', header: 'Đề xuất xử lý', render: (i) => (i.requested_due ? <span className={!['resolved', 'cancelled'].includes(i.status) && i.requested_due < todayVN() ? 'font-semibold text-red-700' : 'tabular'}>{date(i.requested_due)}{!['resolved', 'cancelled'].includes(i.status) && i.requested_due < todayVN() ? ' (quá hạn)' : ''}</span> : '—') },
    { key: 'status', header: 'Trạng thái', render: (i) => <StatusBadge kind="issue" value={i.status} /> },
  ];
  return (
    <>
      <FilterBar>
        <Select aria-label="Trạng thái báo hỏng" className="w-full sm:w-52" value={f.istatus} onChange={(e) => setF({ istatus: e.target.value })}>
          <option value="open">Chưa xử lý xong</option>{Object.entries(STATUS.issue).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}<option value="all">Tất cả</option>
        </Select>
      </FilterBar>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>{(d) => <DataTable columns={columns} rows={d.items} onRowClick={(i) => navigate(`/assets/issues/${i.id}`)} caption="Báo hỏng" empty={<EmptyState title="Không có báo hỏng" />} />}</DataState>
    </>
  );
}

export function ReportModal({ open, onOpenChange, asset }) {
  const assets = useApi(open ? '/api/assets' : null);
  const navigate = useNavigate();
  const toast = useToast();
  const { rooms } = useLookups();
  const blank = { mode: 'asset', asset_id: '', room_id: '', title: '', description: '', severity: 'normal', requested_due: addDays(todayVN(), 2) };
  const f = useForm(blank);
  useEffect(() => { if (open) { f.setValues({ ...blank, asset_id: asset ? String(asset.id) : '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const body = v.mode === 'asset' ? { asset_id: Number(v.asset_id) } : { room_id: Number(v.room_id), title: v.title };
    const r = await api.post('/api/assets/issues', { ...body, description: v.description, severity: v.severity, requested_due: v.requested_due || null });
    toast.success(`Đã gửi báo sự cố ${r.code}. Bộ phận cơ sở vật chất đã được thông báo.`);
    onOpenChange(false); navigate(`/assets/issues/${r.id}`);
  }, (v) => (v.mode === 'asset'
    ? { asset_id: !v.asset_id && 'Chọn tài sản.', description: !v.description.trim() && 'Mô tả tình trạng hư hỏng.' }
    : { room_id: !v.room_id && 'Chọn phòng.', title: !v.title.trim() && 'Nhập tên sự cố.', description: !v.description.trim() && 'Mô tả sự cố.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Báo sự cố cơ sở vật chất" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Gửi báo cáo</Button></>}>
      <div className="space-y-4">
        <Segmented ariaLabel="Loại sự cố" value={f.values.mode} onChange={(m) => f.set('mode', m)} options={[{ value: 'asset', label: 'Tài sản trong danh mục' }, { value: 'room', label: 'Phát sinh mới theo phòng' }]} />
        {f.values.mode === 'room' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Phòng" required error={f.errors.room_id}><select className="field-input" {...f.bind('room_id')}><option value="">— Chọn phòng —</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Tên sự cố" required error={f.errors.title}><Input placeholder="Ví dụ: Rèm cửa rách" {...f.bind('title')} /></Field>
          </div>
        ) : (
        <Field label="Tài sản" required error={f.errors.asset_id}>
          <select className="field-input" {...f.bind('asset_id')}>
            <option value="">— Chọn tài sản —</option>
            {assets.data?.items.filter((a) => a.status !== 'disposed').map((a) => <option key={a.id} value={a.id} disabled={!!a.open_issue_id}>{a.room_name ? `${a.room_name} · ` : ''}{a.name} ({a.code}){a.open_issue_id ? ' — đang có báo hỏng' : ''}</option>)}
          </select>
        </Field>
        )}
        <Field label="Mô tả" required error={f.errors.description}><Textarea rows={3} {...f.bind('description')} /></Field>
        <Field label="Đề xuất xử lý trước ngày" hint="Bộ phận cơ sở vật chất thấy cảnh báo khi quá hạn đề xuất."><DateInput min={todayVN()} {...f.bind('requested_due')} /></Field>
        <Field label="Mức độ"><Segmented ariaLabel="Mức độ" value={f.values.severity} onChange={(s) => f.set('severity', s)} options={[{ value: 'low', label: 'Thấp' }, { value: 'normal', label: 'Trung bình' }, { value: 'high', label: 'Cao – ảnh hưởng giờ học' }]} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function AssetModal({ open, onOpenChange, asset, categories, onSaved }) {
  const { rooms } = useLookups();
  const toast = useToast();
  const f = useForm({});
  useEffect(() => { if (open) { f.setValues(asset ? { name: asset.name, category: asset.category, room_id: asset.room_id ? String(asset.room_id) : '', location_note: asset.location_note || '', status: asset.status, purchased_at: asset.purchased_at || '', note: asset.note || '' } : { name: '', category: '', room_id: '', location_note: '', status: 'good', purchased_at: '', note: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const body = { ...v, room_id: v.room_id ? Number(v.room_id) : null, purchased_at: v.purchased_at || null };
    if (asset) await api.put(`/api/assets/${asset.id}`, body); else await api.post('/api/assets', body);
    toast.success('Đã lưu tài sản.'); onOpenChange(false); onSaved?.();
  }, (v) => ({ name: !v.name?.trim() && 'Nhập tên.', category: !v.category?.trim() && 'Nhập nhóm.' }));
  if (f.values.name === undefined) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={asset ? `Sửa ${asset.code}` : 'Thêm tài sản'} footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Lưu</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Tên tài sản" required error={f.errors.name}><Input {...f.bind('name')} /></Field>
          <Field label="Nhóm" required error={f.errors.category}><Input list="asset-cats" {...f.bind('category')} /><datalist id="asset-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Phòng"><select className="field-input" {...f.bind('room_id')}><option value="">— Không thuộc phòng học —</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Vị trí khác"><Input placeholder="Văn phòng, hành lang…" {...f.bind('location_note')} /></Field>
          <Field label="Tình trạng"><select className="field-input" {...f.bind('status')}>{Object.entries(STATUS.asset).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Ngày mua"><DateInput {...f.bind('purchased_at')} /></Field>
        </FormGrid>
        <Field label="Ghi chú"><Textarea rows={2} {...f.bind('note')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
