import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Plus, ListChecks, LayoutGrid, Table2, MessageSquare, CheckSquare, ArrowRight, Calendar, ClipboardList, Trash2 } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, dateTime, todayVN, relativeDay } from '../../lib/format.js';
import { STATUS } from '../../lib/labels.js';
import {
  PageHeader, Card, DataTable, DataState, FilterBar, SearchInput, Select, StatusBadge, Button, IconButton, EmptyState, Drawer, Modal, Field, Input, Textarea, FormGrid, Alert, Segmented, Checkbox, Menu, Avatar, useForm, useToast, Spinner, ErrorState, Timeline, DateInput, TimeInput,
} from '../../components/ui/index.js';

const COLS = ['todo', 'in_progress', 'review', 'done'];

export default function TasksPage() {
  const { can } = useAuth();
  const { activeStaff } = useLookups();
  const [f, setF] = useUrlFilters({ mode: 'table', view: 'open', assignee_id: '', priority: '', q: '', id: '' });
  const { data, error, loading, reload, setData } = useApi(`/api/tasks${qs({ view: f.mode === 'kanban' && f.view === 'open' ? 'all' : f.view, assignee_id: f.assignee_id, priority: f.priority, q: f.q })}`);
  const [modal, setModal] = useState(null);
  const today = todayVN();
  const toast = useToast();

  const move = async (task, status, beforeId = null) => {
    if (task.status === status && !beforeId) return;
    // Cập nhật lạc quan, lưu xuống server; reload để lấy đúng thứ tự đã lưu
    setData((d) => ({ ...d, items: d.items.map((t) => (t.id === task.id ? { ...t, status } : t)) }));
    try { await api.post(`/api/tasks/${task.id}/move`, { status, before_id: beforeId }); toast.success(`Đã chuyển “${task.title}” sang ${STATUS.task[status][0]}.`); } catch (e) { toast.error(e.message); }
    reload();
  };

  const columns = [
    { key: 'title', header: 'Công việc', mobile: 'title', render: (t) => (
      <div><p className="font-medium text-ink">{t.title}</p>
        <p className="flex flex-wrap gap-x-3 text-xs text-ink-3">{t.code}{t.item_total > 0 && <span className="inline-flex items-center gap-1"><CheckSquare className="size-3" />{t.item_done}/{t.item_total}</span>}{t.comment_count > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" />{t.comment_count}</span>}</p></div>
    ) },
    { key: 'assignee', header: 'Phụ trách', render: (t) => t.assignee_name || '—' },
    { key: 'priority', header: 'Ưu tiên', render: (t) => <StatusBadge kind="priority" value={t.priority} /> },
    { key: 'due', header: 'Hạn', render: (t) => <DueLabel t={t} today={today} /> },
    { key: 'status', header: 'Trạng thái', render: (t) => <StatusBadge kind="task" value={t.status} /> },
    { key: 'act', header: '', stop: true, render: (t) => <StatusMenu task={t} onMove={move} /> },
  ];

  return (
    <div>
      <PageHeader title="Công việc" description="Giao việc, theo dõi hạn và checklist vận hành hằng ngày."
        actions={<>
          <Button variant="secondary" icon={ClipboardList} onClick={() => setModal('template')}>Checklist từ mẫu</Button>
          <Button icon={Plus} onClick={() => setModal('create')}>Tạo công việc</Button>
        </>} />
      <Card>
        <FilterBar active={f.assignee_id || f.priority || f.q} onReset={() => setF({ assignee_id: '', priority: '', q: '' })}>
          <Segmented ariaLabel="Bộ lọc nhanh" value={f.view} onChange={(v) => setF({ view: v })} options={[
            { value: 'open', label: 'Đang mở' }, { value: 'mine', label: 'Việc của tôi' }, { value: 'today', label: 'Hôm nay' }, { value: 'overdue', label: 'Quá hạn' }, { value: 'done', label: 'Đã hoàn thành' }, { value: 'all', label: 'Tất cả' },
          ]} />
          <SearchInput className="w-full sm:w-52" value={f.q} onChange={(q) => setF({ q })} placeholder="Tìm công việc…" />
          {can('tasks.view_all') && <Select aria-label="Người phụ trách" className="w-full sm:w-44" value={f.assignee_id} onChange={(e) => setF({ assignee_id: e.target.value })} placeholder="Mọi người">{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select>}
          <Select aria-label="Ưu tiên" className="w-full sm:w-36" value={f.priority} onChange={(e) => setF({ priority: e.target.value })} placeholder="Mọi ưu tiên">{Object.entries(STATUS.priority).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
          <div className="sm:ml-auto"><Segmented ariaLabel="Kiểu xem" value={f.mode} onChange={(m) => setF({ mode: m })} options={[{ value: 'table', label: 'Bảng', icon: Table2 }, { value: 'kanban', label: 'Kanban', icon: LayoutGrid }]} /></div>
        </FilterBar>
        <DataState loading={loading} error={error} data={data} onRetry={reload}>
          {(d) => (f.mode === 'kanban'
            ? <Kanban items={d.items} onOpen={(t) => setF({ id: String(t.id) })} onMove={move} today={today} />
            : <DataTable columns={columns} rows={d.items} onRowClick={(t) => setF({ id: String(t.id) })} caption="Danh sách công việc" rowClassName={(t) => (t.status === 'done' ? 'opacity-70' : '')}
              empty={<EmptyState icon={ListChecks} title="Không có công việc phù hợp" />} />)}
        </DataState>
      </Card>
      <TaskFormModal open={modal === 'create'} onOpenChange={(v) => !v && setModal(null)} onSaved={(id) => { reload(); setF({ id: String(id) }); }} />
      <TemplateModal open={modal === 'template'} onOpenChange={(v) => !v && setModal(null)} onSaved={(id) => { reload(); setF({ id: String(id) }); }} />
      <TaskDrawer id={f.id} onOpenChange={(v) => !v && setF({ id: '' })} onChanged={reload} />
    </div>
  );
}

function DueLabel({ t, today }) {
  if (!t.due_date) return <span className="text-ink-3">—</span>;
  const overdue = t.status !== 'done' && t.due_date < today;
  return <span className={clsx('text-[13px] tabular', overdue ? 'font-medium text-red-700' : t.due_date === today ? 'font-medium text-amber-700' : 'text-ink-2')}>{relativeDay(t.due_date, today)}{t.due_time ? ` ${t.due_time}` : ''}{overdue && ' · quá hạn'}</span>;
}

function StatusMenu({ task, onMove }) {
  return <Menu label={`Chuyển trạng thái “${task.title}”`} items={COLS.filter((s) => s !== task.status).map((s) => ({ label: `Chuyển sang: ${STATUS.task[s][0]}`, icon: ArrowRight, onSelect: () => onMove(task, s) }))} />;
}

/** Kanban: kéo thả để đổi trạng thái/thứ tự (lưu xuống server), luôn có menu đổi trạng thái thay thế */
function Kanban({ items, onOpen, onMove, today }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const draggedId = (e) => Number(e.dataTransfer?.getData('text/plain')) || drag;
  return (
    <div className="scroll-thin overflow-x-auto p-3 sm:p-4">
      <div className="grid min-w-[880px] grid-cols-4 gap-3">
        {COLS.map((col) => {
          const list = items.filter((t) => t.status === col);
          return (
            <section key={col} aria-label={STATUS.task[col][0]}
              onDragOver={(e) => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); const t = items.find((x) => x.id === draggedId(e)); setOver(null); if (t) onMove(t, col, null); }}
              className={clsx('flex min-h-[360px] flex-col rounded-[var(--radius-control)] bg-canvas/80 ring-1 ring-inset ring-line transition-colors', over === col && 'bg-brand-50 ring-brand-300')}>
              <h3 className="flex items-center justify-between px-3 py-2.5 text-[13px] font-semibold"><StatusBadge kind="task" value={col} /><span className="text-xs text-ink-3 tabular">{list.length}</span></h3>
              <ul className="flex-1 space-y-2 px-2 pb-2">
                {list.map((t) => (
                  <li key={t.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move'; setDrag(t.id); }} onDragEnd={() => setDrag(null)}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const d = items.find((x) => x.id === draggedId(e)); setOver(null); if (d && d.id !== t.id) onMove(d, col, t.id); }}
                    className={clsx('cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-[var(--shadow-card)] transition-[transform,box-shadow,opacity] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] active:cursor-grabbing', drag === t.id && 'rotate-1 scale-[0.98] opacity-50')}>
                    <div className="flex items-start justify-between gap-1">
                      <button type="button" onClick={() => onOpen(t)} className="text-left text-[13px] font-medium text-ink hover:text-brand-700">{t.title}</button>
                      <StatusMenu task={t} onMove={onMove} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3">
                      <StatusBadge kind="priority" value={t.priority} />
                      {t.due_date && <span className="inline-flex items-center gap-1"><Calendar className="size-3" /><DueLabel t={t} today={today} /></span>}
                      {t.item_total > 0 && <span className="inline-flex items-center gap-1"><CheckSquare className="size-3" />{t.item_done}/{t.item_total}</span>}
                    </div>
                    {t.assignee_name && <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-2"><Avatar name={t.assignee_name} size="sm" className="size-5 text-[9px]" />{t.assignee_name}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-3">Kéo thẻ sang cột khác để đổi trạng thái, hoặc dùng nút “…” trên thẻ. Thứ tự được lưu, tải lại trang vẫn giữ nguyên.</p>
    </div>
  );
}

function TaskFormModal({ open, onOpenChange, task, onSaved }) {
  const { activeStaff } = useLookups();
  const { user, can } = useAuth();
  const toast = useToast();
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    f.setValues(task ? { title: task.title, description: task.description || '', priority: task.priority, assignee_id: String(task.assignee_id || user.id), due_date: task.due_date || '', due_time: task.due_time || '', items: '' }
      : { title: '', description: '', priority: 'normal', assignee_id: String(user.id), due_date: todayVN(), due_time: '', items: '' });
    f.setErrors({}); f.setFormError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const body = { title: v.title, description: v.description || null, priority: v.priority, assignee_id: Number(v.assignee_id), due_date: v.due_date || null, due_time: v.due_time || null };
    if (task) { await api.put(`/api/tasks/${task.id}`, body); toast.success('Đã cập nhật công việc.'); onSaved?.(task.id); } else {
      const r = await api.post('/api/tasks', { ...body, items: v.items.split('\n').map((x) => x.trim()).filter(Boolean) });
      toast.success('Đã tạo công việc.'); onSaved?.(r.id);
    }
    onOpenChange(false);
  }, (v) => ({ title: !v.title?.trim() && 'Nhập tiêu đề công việc.' }));
  if (f.values.title === undefined) return null;
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title={task ? 'Sửa công việc' : 'Tạo công việc'}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>{task ? 'Lưu' : 'Tạo công việc'}</Button></>}>
      <div className="space-y-4">
        <Field label="Tiêu đề" required error={f.errors.title}><Input autoFocus {...f.bind('title')} /></Field>
        <Field label="Mô tả"><Textarea rows={3} {...f.bind('description')} /></Field>
        <FormGrid>
          <Field label="Người phụ trách" hint={can('tasks.assign') ? undefined : 'Vai trò của bạn chỉ tạo việc cho chính mình.'}>
            <select className="field-input" {...f.bind('assignee_id')} disabled={!can('tasks.assign')}>{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
          </Field>
          <Field label="Ưu tiên"><select className="field-input" {...f.bind('priority')}>{Object.entries(STATUS.priority).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Hạn hoàn thành" error={f.errors.due_date}><DateInput {...f.bind('due_date')} /></Field>
          <Field label="Giờ (tùy chọn)" error={f.errors.due_time}><TimeInput {...f.bind('due_time')} /></Field>
        </FormGrid>
        {!task && <Field label="Checklist con" hint="Mỗi dòng một mục (tùy chọn)."><Textarea rows={3} {...f.bind('items')} /></Field>}
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function TemplateModal({ open, onOpenChange, onSaved }) {
  const { data } = useApi(open ? '/api/tasks/templates' : null);
  const { activeStaff } = useLookups();
  const { user, can } = useAuth();
  const toast = useToast();
  const f = useForm({ template_key: 'open', date: todayVN(), assignee_id: String(user.id) });
  useEffect(() => { if (open) { f.setValues({ template_key: 'open', date: todayVN(), assignee_id: String(user.id) }); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = data?.templates?.[f.values.template_key];
  const save = () => f.submit(async (v) => {
    const r = await api.post('/api/tasks/from-template', { ...v, assignee_id: Number(v.assignee_id) });
    if (r.duplicate) toast.info('Checklist này đã được tạo cho ngày đã chọn — mở checklist hiện có, không tạo trùng.'); else toast.success('Đã tạo checklist.');
    onOpenChange(false); onSaved?.(r.id);
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Tạo checklist từ mẫu" description="Mỗi mẫu chỉ tạo một lần cho mỗi ngày."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Tạo checklist</Button></>}>
      <div className="space-y-4">
        <Field label="Mẫu"><Segmented ariaLabel="Mẫu checklist" value={f.values.template_key} onChange={(k) => f.set('template_key', k)} options={Object.entries(data?.templates || {}).map(([value, x]) => ({ value, label: x.name }))} /></Field>
        <FormGrid>
          <Field label="Ngày"><DateInput {...f.bind('date')} /></Field>
          <Field label="Người thực hiện"><select className="field-input" {...f.bind('assignee_id')} disabled={!can('tasks.assign')}>{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
        </FormGrid>
        {t && <ul className="list-disc space-y-1 rounded-md bg-canvas p-3 pl-8 text-[13px] text-ink-2">{t.items.map((x) => <li key={x}>{x}</li>)}</ul>}
        {f.formError && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

function TaskDrawer({ id, onOpenChange, onChanged }) {
  const { data, error, loading, reload, setData } = useApi(id ? `/api/tasks/${id}` : null, { keepPrevious: false });
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [comment, setComment] = useState('');
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  const t = data?.task;
  const refresh = () => { reload(); onChanged?.(); };
  const act = async (fn, msg) => { if (busy) return; setBusy(true); try { await fn(); if (msg) toast.success(msg); refresh(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <>
      <Drawer open={!!id} onOpenChange={onOpenChange} title={t ? t.title : 'Công việc'}
        description={t && <span>{t.code} · tạo bởi {t.creator_name} · {dateTime(t.created_at)}</span>}
        headerExtra={t && <div className="mt-2 flex flex-wrap gap-2"><StatusBadge kind="task" value={t.status} /><StatusBadge kind="priority" value={t.priority} /><Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Sửa</Button></div>}>
        {error && !data && <ErrorState error={error} onRetry={reload} />}
        {loading && !data && <Spinner />}
        {t && (
          <div className="space-y-6">
            <section>
              <p className="mb-2 text-xs font-medium text-ink-3">Chuyển trạng thái</p>
              <Segmented ariaLabel="Trạng thái" value={t.status} disabled={busy} onChange={(s) => act(() => api.post(`/api/tasks/${t.id}/move`, { status: s }), `Đã chuyển sang ${STATUS.task[s][0]}.`)} options={COLS.map((s) => ({ value: s, label: STATUS.task[s][0] }))} />
            </section>
            <KeyValueBlock t={t} />
            {data.related && <Alert tone="info" title="Liên kết báo hỏng tài sản"><Link className="font-medium underline" to={`/assets/issues/${data.related.id}`}>{data.related.code} · {data.related.asset_name}</Link> — <StatusBadge kind="issue" value={data.related.status} /></Alert>}
            {t.description && <p className="whitespace-pre-line rounded-md bg-canvas p-3 text-sm text-ink-2">{t.description}</p>}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Checklist ({data.items.filter((i) => i.done).length}/{data.items.length})</h3>
              <ul className="space-y-1.5">
                {data.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-canvas">
                    <Checkbox checked={!!i.done} onChange={(c) => {
                      // Đổi ngay trên giao diện, lưu nền; lỗi thì tải lại để hoàn tác
                      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === i.id ? { ...x, done: c ? 1 : 0 } : x)) }));
                      api.put(`/api/tasks/${t.id}/items/${i.id}`, { done: c }).then(refresh).catch((e) => { toast.error(e.message); reload(); });
                    }} label={<span className={i.done ? 'text-ink-3 line-through' : ''}>{i.text}</span>} description={i.done && i.done_by_name ? `${i.done_by_name} · ${dateTime(i.done_at)}` : undefined} />
                    {!t.template_key && <IconButton icon={Trash2} label={`Xóa mục ${i.text}`} size="sm" onClick={() => act(() => api.del(`/api/tasks/${t.id}/items/${i.id}`))} />}
                  </li>
                ))}
              </ul>
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (item.trim()) act(() => api.post(`/api/tasks/${t.id}/items`, { text: item.trim() }).then(() => setItem(''))); }}>
                <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Thêm mục checklist…" aria-label="Thêm mục checklist" />
                <Button type="submit" variant="secondary" disabled={!item.trim()}>Thêm</Button>
              </form>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Bình luận</h3>
              <ul className="space-y-3">
                {data.comments.map((c) => <li key={c.id} className="flex gap-2.5"><Avatar name={c.user_name} size="sm" /><div className="min-w-0 rounded-md bg-canvas px-3 py-2"><p className="text-xs font-medium">{c.user_name} <span className="font-normal text-ink-3">· {dateTime(c.created_at)}</span></p><p className="whitespace-pre-line text-sm text-ink-2">{c.content}</p></div></li>)}
                {!data.comments.length && <li className="text-sm text-ink-3">Chưa có bình luận.</li>}
              </ul>
              <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) act(() => api.post(`/api/tasks/${t.id}/comments`, { content: comment.trim() }).then(() => setComment('')), 'Đã gửi bình luận.'); }}>
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Viết bình luận…" aria-label="Bình luận" />
                <div className="flex justify-end"><Button type="submit" size="sm" disabled={!comment.trim()} loading={busy}>Gửi</Button></div>
              </form>
            </section>
            {data.history.length > 0 && <section><h3 className="mb-2 text-sm font-semibold">Lịch sử</h3><Timeline items={data.history.map((h) => ({ key: h.id, title: h.summary, meta: `${h.by_name || 'Hệ thống'} · ${dateTime(h.created_at)}` }))} /></section>}
          </div>
        )}
      </Drawer>
      <TaskFormModal open={edit} onOpenChange={setEdit} task={t} onSaved={refresh} />
    </>
  );
}

function KeyValueBlock({ t }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div><dt className="text-xs text-ink-3">Phụ trách</dt><dd>{t.assignee_name || '—'}</dd></div>
      <div><dt className="text-xs text-ink-3">Hạn</dt><dd className="tabular">{t.due_date ? `${date(t.due_date)}${t.due_time ? ` ${t.due_time}` : ''}` : '—'}</dd></div>
      {t.completed_at && <div><dt className="text-xs text-ink-3">Hoàn thành lúc</dt><dd>{dateTime(t.completed_at)}</dd></div>}
    </dl>
  );
}
