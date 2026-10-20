import { useEffect, useRef, useState } from 'react';
import { Plus, ArrowDownToLine, ArrowUpFromLine, History, Pencil, AlertTriangle } from 'lucide-react';
import { api, qs, newIdempotencyKey } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { dateTime } from '../../lib/format.js';
import { MATERIAL_KINDS } from '../../lib/labels.js';
import { PageHeader, Card, DataTable, DataState, FilterBar, SearchInput, Select, Badge, Button, EmptyState, Modal, Drawer, Field, Input, Textarea, FormGrid, Alert, Segmented, Checkbox, Menu, useForm, useToast, Spinner } from '../../components/ui/index.js';

export default function InventoryPage() {
  const { can } = useAuth();
  const [f, setF] = useUrlFilters({ q: '', kind: '', low: '' });
  const { data, error, loading, reload } = useApi(`/api/inventory${qs(f)}`);
  const [modal, setModal] = useState(null);
  const edit = can('inventory.edit');
  const lowCount = data?.items.filter((m) => m.stock <= m.min_stock).length || 0;
  const columns = [
    { key: 'name', header: 'Giáo trình / vật tư', mobile: 'title', render: (m) => <div><p className="font-medium">{m.name}</p><p className="text-xs text-ink-3">{m.code}{m.course_name ? ` · ${m.course_name}` : ''}</p></div> },
    { key: 'kind', header: 'Loại', render: (m) => MATERIAL_KINDS[m.kind] },
    { key: 'stock', header: 'Tồn kho', align: 'right', render: (m) => <span className={m.stock <= m.min_stock ? 'font-semibold text-red-700' : 'font-medium'}>{m.stock} {m.unit}</span> },
    { key: 'min', header: 'Ngưỡng tối thiểu', align: 'right', render: (m) => `${m.min_stock} ${m.unit}` },
    { key: 'state', header: 'Cảnh báo', render: (m) => (m.stock <= m.min_stock ? <Badge tone="danger">Tồn thấp</Badge> : <Badge tone="success">Đủ</Badge>) },
    { key: 'act', header: '', stop: true, render: (m) => <Menu items={[
      edit && { label: 'Nhập kho', icon: ArrowDownToLine, onSelect: () => setModal({ type: 'move', move: 'in', m }) },
      edit && { label: 'Xuất kho', icon: ArrowUpFromLine, onSelect: () => setModal({ type: 'move', move: 'out', m }) },
      { label: 'Lịch sử nhập/xuất', icon: History, onSelect: () => setModal({ type: 'history', m }) },
      edit && { label: 'Sửa thông tin', icon: Pencil, onSelect: () => setModal({ type: 'edit', m }) },
    ]} /> },
  ];
  return (
    <div>
      <PageHeader title="Giáo trình – Vật tư" description="Danh mục giáo trình và vật tư, nhập/xuất tồn có lịch sử, cảnh báo tồn thấp theo ngưỡng." actions={edit && <Button icon={Plus} onClick={() => setModal({ type: 'edit' })}>Thêm mặt hàng</Button>} />
      {lowCount > 0 && !f.low && <Alert tone="warning" className="mb-4" title={`${lowCount} mặt hàng dưới ngưỡng tồn tối thiểu`} action={<Button size="sm" variant="secondary" onClick={() => setF({ low: '1' })}>Xem danh sách</Button>} />}
      <Card>
        <FilterBar active={f.q || f.kind || f.low} onReset={() => setF({ q: '', kind: '', low: '' })}>
          <SearchInput className="w-full sm:w-60" value={f.q} onChange={(q) => setF({ q })} placeholder="Tên hoặc mã…" />
          <Select aria-label="Loại" className="w-full sm:w-40" value={f.kind} onChange={(e) => setF({ kind: e.target.value })} placeholder="Mọi loại">{Object.entries(MATERIAL_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Checkbox label="Chỉ hiện tồn thấp" checked={!!f.low} onChange={(c) => setF({ low: c ? '1' : '' })} />
        </FilterBar>
        <DataState loading={loading} error={error} data={data} onRetry={reload}>{(d) => <DataTable columns={columns} rows={d.items} caption="Giáo trình và vật tư" empty={<EmptyState title="Không có mặt hàng phù hợp" />} />}</DataState>
      </Card>
      <MoveModal open={modal?.type === 'move'} onOpenChange={(v) => !v && setModal(null)} m={modal?.m} type={modal?.move} onDone={reload} />
      <HistoryDrawer m={modal?.type === 'history' ? modal.m : null} onOpenChange={(v) => !v && setModal(null)} />
      <MaterialModal open={modal?.type === 'edit'} onOpenChange={(v) => !v && setModal(null)} m={modal?.m} onDone={reload} />
    </div>
  );
}

function MoveModal({ open, onOpenChange, m, type, onDone }) {
  const { classes } = useLookups();
  const toast = useToast();
  const key = useRef(null);
  const f = useForm({ type: 'in', qty: '', reason: '', class_id: '' });
  useEffect(() => { if (open) { key.current = newIdempotencyKey(); f.setValues({ type, qty: '', reason: type === 'in' ? 'Nhập hàng từ nhà cung cấp' : '', class_id: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  const save = () => f.submit(async (v) => {
    const r = await api.post(`/api/inventory/${m.id}/moves`, { type: v.type, qty: Number(v.qty), reason: v.reason, class_id: v.class_id ? Number(v.class_id) : null }, { idempotencyKey: key.current });
    toast.success(`Đã ${v.type === 'in' ? 'nhập' : 'xuất'} ${v.qty} ${m.unit}. Tồn còn ${r.balance}.${r.low ? ' ⚠ Dưới ngưỡng tối thiểu.' : ''}`);
    onOpenChange(false); onDone();
  }, (v) => ({ qty: !(Number(v.qty) > 0) ? 'Nhập số lượng lớn hơn 0.' : v.type === 'out' && Number(v.qty) > m.stock && `Không đủ tồn (còn ${m.stock} ${m.unit}).`, reason: !v.reason.trim() && 'Nhập lý do.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={f.values.type === 'in' ? 'Nhập kho' : 'Xuất kho'} description={`${m.name} · tồn hiện tại ${m.stock} ${m.unit}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Xác nhận</Button></>}>
      <div className="space-y-4">
        <Segmented ariaLabel="Loại phiếu" value={f.values.type} onChange={(t) => f.set('type', t)} options={[{ value: 'in', label: 'Nhập' }, { value: 'out', label: 'Xuất' }]} />
        <FormGrid>
          <Field label={`Số lượng (${m.unit})`} required error={f.errors.qty}><Input type="number" min={1} inputMode="numeric" {...f.bind('qty')} /></Field>
          {f.values.type === 'out' && <Field label="Cho lớp (tùy chọn)"><select className="field-input" {...f.bind('class_id')}><option value="">—</option>{classes.filter((c) => c.status !== 'finished').map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></Field>}
        </FormGrid>
        <Field label="Lý do" required error={f.errors.reason}><Textarea rows={2} {...f.bind('reason')} /></Field>
        {f.values.type === 'out' && Number(f.values.qty) > 0 && m.stock - Number(f.values.qty) <= m.min_stock && Number(f.values.qty) <= m.stock && <Alert tone="warning" title="Sau khi xuất sẽ dưới ngưỡng tối thiểu"><AlertTriangle className="hidden" />Còn {m.stock - Number(f.values.qty)} {m.unit} (ngưỡng {m.min_stock}).</Alert>}
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function HistoryDrawer({ m, onOpenChange }) {
  const { data, loading } = useApi(m ? `/api/inventory/${m.id}/moves` : null, { keepPrevious: false });
  return (
    <Drawer open={!!m} onOpenChange={onOpenChange} title={m ? `Lịch sử nhập/xuất · ${m.name}` : ''} description={m && `Tồn hiện tại: ${m.stock} ${m.unit}`}>
      {loading && <Spinner />}
      <ul className="divide-y divide-line">
        {data?.items.map((x) => (
          <li key={x.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
            <div><p className="font-medium">{x.type === 'in' ? 'Nhập' : 'Xuất'} {x.qty} {m.unit}{x.class_code ? ` · lớp ${x.class_code}` : ''}</p><p className="text-xs text-ink-3">{x.reason} · {x.by_name} · {dateTime(x.created_at)}</p></div>
            <span className="shrink-0 text-xs text-ink-3 tabular">Tồn sau: {x.balance_after}</span>
          </li>
        ))}
        {data && !data.items.length && <li className="py-4 text-sm text-ink-3">Chưa có lịch sử.</li>}
      </ul>
    </Drawer>
  );
}

function MaterialModal({ open, onOpenChange, m, onDone }) {
  const { courses } = useLookups();
  const toast = useToast();
  const f = useForm({});
  useEffect(() => { if (open) { f.setValues(m ? { name: m.name, kind: m.kind, unit: m.unit, min_stock: m.min_stock, course_id: m.course_id ? String(m.course_id) : '', note: m.note || '' } : { name: '', kind: 'textbook', unit: 'cuốn', stock: 0, min_stock: 5, course_id: '', note: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const body = { ...v, min_stock: Number(v.min_stock), course_id: v.course_id ? Number(v.course_id) : null, ...(m ? {} : { stock: Number(v.stock) }) };
    if (m) await api.put(`/api/inventory/${m.id}`, body); else await api.post('/api/inventory', body);
    toast.success('Đã lưu.'); onOpenChange(false); onDone();
  }, (v) => ({ name: !v.name?.trim() && 'Nhập tên.', unit: !v.unit?.trim() && 'Nhập đơn vị.' }));
  if (f.values.name === undefined) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={m ? `Sửa ${m.code}` : 'Thêm giáo trình / vật tư'} footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Lưu</Button></>}>
      <div className="space-y-4">
        <Field label="Tên" required error={f.errors.name}><Input {...f.bind('name')} /></Field>
        <FormGrid>
          <Field label="Loại"><select className="field-input" {...f.bind('kind')}>{Object.entries(MATERIAL_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Đơn vị tính" required error={f.errors.unit}><Input {...f.bind('unit')} /></Field>
          {!m && <Field label="Tồn đầu kỳ" error={f.errors.stock}><Input type="number" min={0} {...f.bind('stock')} /></Field>}
          <Field label="Ngưỡng tồn tối thiểu" error={f.errors.min_stock}><Input type="number" min={0} {...f.bind('min_stock')} /></Field>
          <Field label="Dùng cho khóa"><select className="field-input" {...f.bind('course_id')}><option value="">—</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </FormGrid>
        {m && <p className="text-xs text-ink-3">Số tồn chỉ thay đổi qua phiếu nhập/xuất để giữ lịch sử.</p>}
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
