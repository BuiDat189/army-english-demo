import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { phone } from '../../lib/format.js';
import { RELATIONSHIPS } from '../../lib/labels.js';
import {
  Drawer, Modal, Button, Field, Input, Select, Textarea, FormGrid, Alert, Segmented, Checkbox, useForm, useToast, SearchInput, Spinner, DateInput,
} from '../../components/ui/index.js';

const emptyParent = { full_name: '', phone: '', email: '', address: '', occupation: '', note: '' };

function ParentPicker({ value, onChange, errors = {} }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ loading: false, items: [] });
  useEffect(() => {
    if (q.trim().length < 2) { setState({ loading: false, items: [] }); return; }
    setState((s) => ({ ...s, loading: true }));
    api.get(`/api/students/parents/search?q=${encodeURIComponent(q.trim())}`).then((r) => setState({ loading: false, items: r.items })).catch(() => setState({ loading: false, items: [] }));
  }, [q]);
  return (
    <div className="space-y-2">
      <SearchInput value={q} onChange={setQ} placeholder="Tìm theo tên hoặc số điện thoại phụ huynh…" label="Tìm phụ huynh" />
      {state.loading && <Spinner className="size-4" />}
      <ul className="space-y-1.5">
        {state.items.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border border-line p-2.5 hover:bg-canvas has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
              <input type="radio" name="parent-pick" className="mt-1 accent-brand-600" checked={value === p.id} onChange={() => onChange(p.id)} />
              <span className="text-sm"><span className="font-medium">{p.full_name}</span> · {phone(p.phone)}<span className="block text-xs text-ink-3">{p.children ? `Con: ${p.children}` : 'Chưa liên kết học viên'}</span></span>
            </label>
          </li>
        ))}
      </ul>
      {errors.parent_id && <p className="text-xs font-medium text-red-700">{errors.parent_id}</p>}
    </div>
  );
}

function ParentFields({ f, prefix = '' }) {
  const k = (x) => `${prefix}${x}`;
  return (
    <FormGrid>
      <Field label="Họ tên phụ huynh" required error={f.errors[k('full_name')]}><Input value={f.values.parent.full_name} onChange={(e) => f.set('parent', { ...f.values.parent, full_name: e.target.value })} /></Field>
      <Field label="Số điện thoại" required error={f.errors[k('phone')]}><Input inputMode="tel" value={f.values.parent.phone} onChange={(e) => f.set('parent', { ...f.values.parent, phone: e.target.value })} /></Field>
      <Field label="Email" error={f.errors[k('email')]}><Input value={f.values.parent.email} onChange={(e) => f.set('parent', { ...f.values.parent, email: e.target.value })} /></Field>
      <Field label="Nghề nghiệp"><Input value={f.values.parent.occupation} onChange={(e) => f.set('parent', { ...f.values.parent, occupation: e.target.value })} /></Field>
    </FormGrid>
  );
}

/** Tạo / sửa học viên. Khi tạo mới bắt buộc có người liên hệ (chọn có sẵn hoặc tạo mới). */
export function StudentFormDrawer({ open, onOpenChange, student, onSaved }) {
  const toast = useToast();
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    f.setValues({
      full_name: student?.full_name || '', dob: student?.dob || '', gender: student?.gender || '', school: student?.school || '', note: student?.note || '',
      parentMode: 'new', parent_id: null, relationship: 'Mẹ', parent: { ...emptyParent },
    });
    f.setErrors({}); f.setFormError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    const st = { full_name: v.full_name, dob: v.dob || null, gender: v.gender || null, school: v.school || null, note: v.note || null };
    if (student) { await api.put(`/api/students/${student.id}`, st); toast.success('Đã cập nhật học viên.'); onSaved?.(student.id); } else {
      const r = await api.post('/api/students', { student: st, parent: v.parentMode === 'existing' ? { mode: 'existing', parent_id: v.parent_id, relationship: v.relationship } : { mode: 'new', relationship: v.relationship, ...v.parent } });
      toast.success('Đã tạo hồ sơ học viên.'); onSaved?.(r.id);
    }
    onOpenChange(false);
  }, (v) => ({
    full_name: !v.full_name?.trim() && 'Nhập họ tên học viên.',
    ...(!student && v.parentMode === 'existing' ? { parent_id: !v.parent_id && 'Chọn phụ huynh.' } : {}),
    ...(!student && v.parentMode === 'new' ? { 'parent.full_name': !v.parent.full_name.trim() && 'Nhập tên phụ huynh.', 'parent.phone': !/^0\d{9,10}$/.test(v.parent.phone.replace(/[\s.-]/g, '')) && 'Số điện thoại gồm 10–11 chữ số, bắt đầu bằng 0.' } : {}),
  }));
  if (!f.values.parent && !student) return null;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={student ? `Sửa học viên ${student.code}` : 'Thêm học viên'} description={student ? undefined : 'Khách từ tuyển sinh nên dùng nút “Chuyển thành học viên” để giữ lịch sử tư vấn.'}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>{student ? 'Lưu thay đổi' : 'Tạo học viên'}</Button></>}>
      {f.values.full_name !== undefined && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
          <FormGrid>
            <Field label="Họ tên học viên" required error={f.errors.full_name}><Input autoFocus {...f.bind('full_name')} /></Field>
            <Field label="Ngày sinh" error={f.errors.dob}><DateInput {...f.bind('dob')} /></Field>
            <Field label="Giới tính"><Select {...f.bind('gender')} placeholder="— Chọn —"><option value="male">Nam</option><option value="female">Nữ</option></Select></Field>
            <Field label="Trường"><Input {...f.bind('school')} /></Field>
          </FormGrid>
          <Field label="Ghi chú"><Textarea rows={2} {...f.bind('note')} /></Field>
          {!student && (
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-semibold">Người liên hệ chính</legend>
              <Segmented ariaLabel="Phụ huynh" value={f.values.parentMode} onChange={(m) => f.set('parentMode', m)} options={[{ value: 'new', label: 'Phụ huynh mới' }, { value: 'existing', label: 'Phụ huynh đã có (anh/chị em)' }]} />
              {f.values.parentMode === 'existing' ? <ParentPicker value={f.values.parent_id} onChange={(id) => f.set('parent_id', id)} errors={f.errors} /> : <ParentFields f={f} prefix="parent." />}
              <Field label="Quan hệ" className="sm:w-1/2"><Select {...f.bind('relationship')}>{RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
            </fieldset>
          )}
          {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
        </form>
      )}
    </Drawer>
  );
}

/** Liên kết thêm người liên hệ cho học viên */
export function ContactModal({ open, onOpenChange, studentId, onDone }) {
  const toast = useToast();
  const f = useForm({ mode: 'existing', parent_id: null, relationship: 'Bố', is_primary: false, parent: { ...emptyParent } });
  useEffect(() => { if (open) { f.setValues({ mode: 'existing', parent_id: null, relationship: 'Bố', is_primary: false, parent: { ...emptyParent } }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => f.submit(async (v) => {
    await api.post(`/api/students/${studentId}/contacts`, v.mode === 'existing' ? { mode: 'existing', parent_id: v.parent_id, relationship: v.relationship, is_primary: v.is_primary } : { mode: 'new', relationship: v.relationship, is_primary: v.is_primary, ...v.parent });
    toast.success('Đã liên kết người liên hệ.'); onOpenChange(false); onDone?.();
  }, (v) => (v.mode === 'existing' ? { parent_id: !v.parent_id && 'Chọn phụ huynh.' } : { full_name: !v.parent.full_name.trim() && 'Nhập tên.', phone: !v.parent.phone.trim() && 'Nhập số điện thoại.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Thêm người liên hệ"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Liên kết</Button></>}>
      <div className="space-y-4">
        <Segmented ariaLabel="Nguồn" value={f.values.mode} onChange={(m) => f.set('mode', m)} options={[{ value: 'existing', label: 'Chọn phụ huynh có sẵn' }, { value: 'new', label: 'Tạo mới' }]} />
        {f.values.mode === 'existing' ? <ParentPicker value={f.values.parent_id} onChange={(id) => f.set('parent_id', id)} errors={f.errors} /> : <ParentFields f={f} />}
        <FormGrid>
          <Field label="Quan hệ"><Select {...f.bind('relationship')}>{RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <div className="flex items-end pb-2"><Checkbox checked={f.values.is_primary} onChange={(c) => f.set('is_primary', c)} label="Đặt làm liên hệ chính" /></div>
        </FormGrid>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

export function ParentEditModal({ open, onOpenChange, parent, onDone }) {
  const toast = useToast();
  const f = useForm({ ...emptyParent });
  useEffect(() => { if (open && parent) { f.setValues({ ...emptyParent, ...Object.fromEntries(Object.keys(emptyParent).map((k) => [k, parent[k] || ''])) }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!parent) return null;
  const save = () => f.submit(async (v) => { await api.put(`/api/students/parents/${parent.id}`, v); toast.success('Đã cập nhật phụ huynh.'); onOpenChange(false); onDone?.(); });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Sửa thông tin phụ huynh" description="Thay đổi áp dụng cho mọi học viên liên kết với phụ huynh này."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Lưu</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Họ tên" required error={f.errors.full_name}><Input {...f.bind('full_name')} /></Field>
          <Field label="Số điện thoại" required error={f.errors.phone}><Input {...f.bind('phone')} /></Field>
          <Field label="Email" error={f.errors.email}><Input {...f.bind('email')} /></Field>
          <Field label="Nghề nghiệp"><Input {...f.bind('occupation')} /></Field>
        </FormGrid>
        <Field label="Địa chỉ"><Input {...f.bind('address')} /></Field>
        <Field label="Ghi chú"><Textarea rows={2} {...f.bind('note')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
