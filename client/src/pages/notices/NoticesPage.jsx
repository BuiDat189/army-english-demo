import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Plus, Pin, Send, Smartphone } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { dateTime } from '../../lib/format.js';
import { ROLE_LABELS } from '../../lib/labels.js';
import { PageHeader, Card, DataState, Badge, Button, EmptyState, Modal, Field, Input, Textarea, Alert, Checkbox, Segmented, useForm, useToast, Menu } from '../../components/ui/index.js';

export default function NoticesPage() {
  const { can } = useAuth();
  const [f, setF] = useUrlFilters({ all: '', id: '' });
  const { data, error, loading, reload } = useApi(`/api/notices${f.all ? '?all=1' : ''}`);
  const [creating, setCreating] = useState(false);
  const [ext, setExt] = useState(null);
  const toast = useToast();
  const markRead = async (n) => { if (!n.read_at) { await api.post(`/api/notices/${n.id}/read`).catch(() => {}); reload(); } };
  return (
    <div>
      <PageHeader title="Thông báo nội bộ" description="Thông báo chỉ hiển thị trong app theo nhóm vai trò. Bản demo không gửi SMS/Zalo/email ra ngoài."
        actions={can('notices.create') && <Button icon={Plus} onClick={() => setCreating(true)}>Tạo thông báo</Button>} />
      <Alert tone="info" className="mb-4" title="Phân biệt kênh">
        <span className="inline-flex flex-wrap items-center gap-2"><Badge tone="info">Chỉ trong app</Badge> hiển thị cho nhân sự trong hệ thống. <Badge tone="purple">Đã gửi ngoài (thủ công)</Badge> nghĩa là nhân viên đã tự gửi qua kênh khác và đánh dấu lại để theo dõi — hệ thống không tự gửi.</span>
      </Alert>
      {can('notices.create') && <div className="mb-3"><Segmented ariaLabel="Phạm vi" value={f.all ? 'all' : 'mine'} onChange={(v) => setF({ all: v === 'all' ? '1' : '' })} options={[{ value: 'mine', label: 'Thông báo gửi tới tôi' }, { value: 'all', label: 'Tất cả thông báo' }]} /></div>}
      <DataState loading={loading} error={error} data={data} onRetry={reload} isEmpty={(d) => !d.items.length} empty={<Card><EmptyState title="Chưa có thông báo" /></Card>}>
        {(d) => (
          <ul className="space-y-3">
            {d.items.map((n) => (
              <li key={n.id}>
                <Card className={clsx('p-4 sm:p-5', !n.read_at && 'border-brand-200')} onClick={() => markRead(n)}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">{n.pinned ? <Pin className="size-4 text-brand-600" aria-label="Ghim" /> : null}{n.title}{!n.read_at && <Badge tone="success">Mới</Badge>}</h2>
                      <p className="mt-0.5 text-xs text-ink-3">{n.author} · {dateTime(n.created_at)} · Gửi tới: {n.audience === 'all' ? 'Tất cả nhân sự' : n.audience.split(',').map((r) => ROLE_LABELS[r]).join(', ')}{can('notices.create') ? ` · ${n.read_count} người đã đọc` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {n.external_status === 'sent_manually' ? <Badge tone="purple">Đã gửi ngoài (thủ công)</Badge> : <Badge tone="info">Chỉ trong app</Badge>}
                      {can('notices.create') && n.external_status !== 'sent_manually' && <Menu items={[{ label: 'Đánh dấu đã gửi ngoài (thủ công)', icon: Send, onSelect: () => setExt(n) }]} />}
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-2">{n.body}</p>
                  {n.external_status === 'sent_manually' && <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3"><Smartphone className="size-3.5" />{n.external_note} — {n.external_marked_by_name}, {dateTime(n.external_marked_at)}</p>}
                  {!n.read_at && <Button size="sm" variant="ghost" className="mt-2" onClick={(e) => { e.stopPropagation(); markRead(n); }}>Đánh dấu đã đọc</Button>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </DataState>
      <CreateNotice open={creating} onOpenChange={setCreating} onDone={reload} />
      <ExternalModal notice={ext} onOpenChange={(v) => !v && setExt(null)} onDone={() => { toast.success('Đã đánh dấu gửi ngoài.'); reload(); }} />
    </div>
  );
}

function CreateNotice({ open, onOpenChange, onDone }) {
  const toast = useToast();
  const f = useForm({ title: '', body: '', all: true, roles: [], pinned: false });
  useEffect(() => { if (open) { f.setValues({ title: '', body: '', all: true, roles: [], pinned: false }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => { await api.post('/api/notices', { title: v.title, body: v.body, audience: v.all ? 'all' : v.roles, pinned: v.pinned }); toast.success('Đã đăng thông báo trong app.'); onOpenChange(false); onDone(); },
    (v) => ({ title: !v.title.trim() && 'Nhập tiêu đề.', body: !v.body.trim() && 'Nhập nội dung.', audience: !v.all && !v.roles.length && 'Chọn ít nhất một nhóm.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Tạo thông báo nội bộ" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Đăng thông báo</Button></>}>
      <div className="space-y-4">
        <Field label="Tiêu đề" required error={f.errors.title}><Input {...f.bind('title')} /></Field>
        <Field label="Nội dung" required error={f.errors.body}><Textarea rows={5} {...f.bind('body')} /></Field>
        <fieldset><legend className="mb-2 text-[13px] font-medium text-ink-2">Gửi tới</legend>
          <Checkbox label="Tất cả nhân sự" checked={f.values.all} onChange={(c) => f.set('all', c)} />
          {!f.values.all && <div className="mt-2 grid gap-2 sm:grid-cols-3">{Object.entries(ROLE_LABELS).map(([k, l]) => <Checkbox key={k} label={l} checked={f.values.roles.includes(k)} onChange={(c) => f.set('roles', c ? [...f.values.roles, k] : f.values.roles.filter((x) => x !== k))} />)}</div>}
          {f.errors.audience && <p className="mt-1 text-xs font-medium text-red-700">{f.errors.audience}</p>}
        </fieldset>
        <Checkbox label="Ghim lên đầu" checked={f.values.pinned} onChange={(c) => f.set('pinned', c)} />
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function ExternalModal({ notice, onOpenChange, onDone }) {
  const f = useForm({ note: '' });
  useEffect(() => { if (notice) { f.setValues({ note: '' }); f.setErrors({}); f.setFormError(null); } }, [notice]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!notice) return null;
  const save = () => f.submit(async (v) => { await api.post(`/api/notices/${notice.id}/external`, v); onOpenChange(false); onDone(); }, (v) => ({ note: !v.note.trim() && 'Ghi kênh và người nhận đã gửi.' }));
  return (
    <Modal open={!!notice} onOpenChange={onOpenChange} title="Đánh dấu đã gửi ra ngoài" description={notice.title} footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Xác nhận</Button></>}>
      <div className="space-y-4">
        <Alert tone="warning">Hệ thống KHÔNG gửi tin. Chỉ đánh dấu khi bạn đã tự gửi qua Zalo/SMS/email bằng công cụ khác.</Alert>
        <Field label="Kênh và người nhận" required error={f.errors.note}><Input placeholder="Ví dụ: đã gửi nhóm Zalo phụ huynh lớp ST1-A" {...f.bind('note')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
