import { useEffect, useState } from 'react';
import { Plus, Pencil, Archive, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { money } from '../../lib/format.js';
import { Button, DataTable, DataState, Badge, StatusBadge, EmptyState, Modal, Field, Input, Select, MoneyInput, Alert, Menu, useToast, Segmented } from '../../components/ui/index.js';

/** Gói phí theo khóa: NEW / TÁI PHÍ, số buổi + buổi tặng, giá. Đổi giá không ảnh hưởng đăng ký cũ. */
export default function PackagesTab() {
  const { can } = useAuth();
  const { reload: reloadLookups } = useLookups();
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/api/packages');
  const [edit, setEdit] = useState(null);
  const canEdit = can('packages.edit');
  const columns = [
    { key: 'course', header: 'Khóa học', mobile: 'title', render: (p) => <span className="font-medium">{p.course_name}</span> },
    { key: 'name', header: 'Gói phí', render: (p) => <span>{p.name}{p.note && <span className="block text-xs text-ink-3">{p.note}</span>}</span> },
    { key: 'kind', header: 'Loại', render: (p) => (p.kind === 'renew' ? <Badge tone="purple">Tái phí</Badge> : <Badge tone="info">Học viên mới</Badge>) },
    { key: 'sessions', header: 'Số buổi', align: 'right', render: (p) => <span className="tabular">{p.sessions}{p.bonus_sessions ? ` + ${p.bonus_sessions} tặng` : ''}</span> },
    { key: 'rights', header: 'Nghỉ miễn phí · bảo lưu', render: (p) => <span className="text-[13px] tabular">{p.free_absences} buổi · {p.reserve_limit} lần</span> },
    { key: 'months', header: 'Thời lượng', align: 'right', render: (p) => (p.months ? `~${p.months} tháng` : '—') },
    { key: 'price', header: 'Giá', align: 'right', render: (p) => <b className="font-semibold">{money(p.price)}</b> },
    { key: 'used', header: 'Đang dùng', align: 'right', render: (p) => p.used },
    { key: 'status', header: 'Trạng thái', render: (p) => <StatusBadge kind="package" value={p.status} /> },
    canEdit && { key: 'act', header: '', stop: true, render: (p) => !['pending', 'rejected'].includes(p.status) && <Menu items={[
      { label: 'Sửa gói', icon: Pencil, onSelect: () => setEdit(p) },
      { label: p.status === 'active' ? 'Ngừng bán' : 'Bán lại', icon: p.status === 'active' ? Archive : RotateCcw, onSelect: async () => { await api.post(`/api/packages/${p.id}/status`, { status: p.status === 'active' ? 'archived' : 'active' }); toast.success('Đã cập nhật.'); reload(); reloadLookups(); } },
    ]} /> },
  ].filter(Boolean);
  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">Gói phí mới do trưởng phòng đề xuất phải được <b>Giám đốc duyệt</b> mới bán được. Gói 1 năm (96 buổi): 4 buổi nghỉ không tính phí, 1 lần bảo lưu 2 tuần – 3 tháng. Học phí giữ nguyên theo giá lúc đăng ký.</p>
        {canEdit && <Button icon={Plus} onClick={() => setEdit({})}>Thêm gói phí</Button>}
      </div>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {(d) => <DataTable columns={columns} rows={d.items} pageSize={40} caption="Gói phí" empty={<EmptyState title="Chưa có gói phí" />} />}
      </DataState>
      <PackageModal pkg={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); reloadLookups(); }} />
    </div>
  );
}

function PackageModal({ pkg, onClose, onDone }) {
  const { courses } = useLookups();
  const toast = useToast();
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = !!pkg;
  useEffect(() => {
    if (!pkg) { setV(null); return; }
    setV({ course_id: String(pkg.course_id || ''), name: pkg.name || '', kind: pkg.kind || 'new', sessions: pkg.sessions || '', bonus_sessions: pkg.bonus_sessions ?? 0, months: pkg.months || '', price: pkg.price || '', note: pkg.note || '', free_absences: pkg.free_absences ?? 0, reserve_limit: pkg.reserve_limit ?? 0 });
    setErr(null);
  }, [pkg]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { ...v, course_id: Number(v.course_id) || 0 };
      if (pkg.id) await api.put(`/api/packages/${pkg.id}`, body); else await api.post('/api/packages', body);
      toast.success(pkg.id ? 'Đã cập nhật gói phí.' : 'Đã gửi gói phí (Giám đốc tạo thì bán ngay; trưởng phòng tạo thì chờ Giám đốc duyệt).');
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const fe = err?.fields || {};
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={pkg?.id ? 'Sửa gói phí' : 'Thêm gói phí'}
      footer={<><Button variant="secondary" onClick={onClose}>Hủy</Button><Button loading={busy} onClick={save}>Lưu</Button></>}>
      {v && (
        <div className="space-y-4">
          <Field label="Khóa học" required error={fe.course_id}><Select value={v.course_id} onChange={(e) => setV({ ...v, course_id: e.target.value })} placeholder="— Chọn khóa —">{courses.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Tên gói" required error={fe.name}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ví dụ: Gói 12 tháng · 96 buổi + tặng 8 buổi" /></Field>
          <Field label="Loại"><Segmented ariaLabel="Loại gói" value={v.kind} onChange={(k) => setV({ ...v, kind: k })} options={[{ value: 'new', label: 'Học viên mới' }, { value: 'renew', label: 'Tái phí' }]} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Số buổi" required error={fe.sessions}><Input type="number" min={1} value={v.sessions} onChange={(e) => setV({ ...v, sessions: e.target.value })} /></Field>
            <Field label="Buổi tặng" error={fe.bonus_sessions}><Input type="number" min={0} value={v.bonus_sessions} onChange={(e) => setV({ ...v, bonus_sessions: e.target.value })} /></Field>
            <Field label="Số tháng" error={fe.months}><Input type="number" min={1} value={v.months} onChange={(e) => setV({ ...v, months: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Buổi nghỉ không tính phí" error={fe.free_absences} hint="Gói 96 buổi: 4"><Input type="number" min={0} value={v.free_absences} onChange={(e) => setV({ ...v, free_absences: e.target.value })} /></Field>
            <Field label="Số lần bảo lưu" error={fe.reserve_limit} hint="Gói 1 năm: 1 lần (2 tuần – 3 tháng)"><Input type="number" min={0} value={v.reserve_limit} onChange={(e) => setV({ ...v, reserve_limit: e.target.value })} /></Field>
          </div>
          <Field label="Giá gói" required error={fe.price}><MoneyInput value={v.price} onChange={(n) => setV({ ...v, price: n })} /></Field>
          <Field label="Ghi chú ưu đãi"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Ví dụ: giảm 10%, tặng 6 buổi" /></Field>
          {err && !err.fields && <Alert tone="danger">{err.message}</Alert>}
        </div>
      )}
    </Modal>
  );
}
