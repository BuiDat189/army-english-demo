import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../lib/api.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { addDays, todayVN } from '../../lib/format.js';
import { CARE_TYPES } from '../../lib/labels.js';
import { Modal, Button, Field, Input, Select, Textarea, FormGrid, Alert, DateInput, SearchInput, useForm, useToast } from '../ui/index.js';

/** Tạo việc chăm sóc / tiếp nhận phản hồi, khiếu nại. Không truyền studentId thì hiện ô tìm học viên. */
export default function CareCaseModal({ open, onOpenChange, studentId, defaultType = 'feedback', onDone }) {
  const { activeStaff } = useLookups();
  const { user } = useAuth();
  const toast = useToast();
  const blank = () => ({ student_id: studentId || null, type: defaultType, title: '', content: '', priority: defaultType === 'complaint' ? 'high' : 'normal', owner_id: String(user.id), due_date: addDays(todayVN(), 2) });
  const f = useForm(blank());
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [picked, setPicked] = useState(null);
  useEffect(() => { if (open) { f.setValues(blank()); f.setErrors({}); f.setFormError(null); setQ(''); setFound([]); setPicked(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (studentId || q.trim().length < 2) { setFound([]); return; }
    api.get(`/api/students?q=${encodeURIComponent(q.trim())}&status=all`).then((r) => setFound(r.items.slice(0, 6))).catch(() => setFound([]));
  }, [q, studentId]);
  const save = () => f.submit(async (v) => {
    await api.post('/api/care', { ...v, owner_id: Number(v.owner_id), due_date: v.due_date || null });
    toast.success(v.type === 'complaint' ? 'Đã tiếp nhận khiếu nại.' : 'Đã tạo việc chăm sóc.');
    onOpenChange(false); onDone?.();
  }, (v) => ({ student_id: !v.student_id && 'Chọn học viên.', title: !v.title.trim() && 'Nhập tiêu đề.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Tiếp nhận phản hồi / tạo việc chăm sóc"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Tạo</Button></>}>
      <div className="space-y-4">
        {!studentId && (
          <Field label="Học viên" required error={f.errors.student_id}>
            <div className="space-y-2">
              {picked ? (
                <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-brand-300 bg-brand-50/50 px-3 py-2 text-sm">
                  <span><b className="font-medium">{picked.full_name}</b> · {picked.code}</span>
                  <Button size="sm" variant="ghost" onClick={() => { setPicked(null); f.set('student_id', null); }}>Đổi</Button>
                </div>
              ) : (<>
                <SearchInput value={q} onChange={setQ} placeholder="Tên/mã học viên hoặc SĐT phụ huynh…" label="Tìm học viên" />
                {found.length > 0 && (
                  <ul className="max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-line">
                    {found.map((s) => (
                      <li key={s.id}><button type="button" onClick={() => { setPicked(s); f.set('student_id', s.id); }} className={clsx('w-full px-3 py-2 text-left text-sm hover:bg-canvas')}>
                        <span className="font-medium">{s.full_name}</span> <span className="text-ink-3">· {s.code}{s.classes?.length ? ` · ${s.classes.map((c) => c.code).join(', ')}` : ''}</span>
                      </button></li>
                    ))}
                  </ul>
                )}
              </>)}
            </div>
          </Field>
        )}
        <FormGrid>
          <Field label="Loại"><Select {...f.bind('type')}>{Object.entries(CARE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Mức ưu tiên"><Select {...f.bind('priority')}><option value="low">Thấp</option><option value="normal">Bình thường</option><option value="high">Cao</option></Select></Field>
        </FormGrid>
        <Field label="Tiêu đề" required error={f.errors.title}><Input {...f.bind('title')} placeholder="Ví dụ: Phụ huynh phản ánh lớp học ồn" /></Field>
        <Field label="Nội dung"><Textarea {...f.bind('content')} /></Field>
        <FormGrid>
          <Field label="Người phụ trách"><Select {...f.bind('owner_id')}>{activeStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
          <Field label="Hạn xử lý"><DateInput {...f.bind('due_date')} /></Field>
        </FormGrid>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
