import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useLookups, useAuth } from '../../lib/auth.jsx';
import { LEAD_SOURCES, STATUS, MANUAL_LEAD_STATUSES } from '../../lib/labels.js';
import { dateTime } from '../../lib/format.js';
import {
  Drawer, Button, Field, Input, Select, Textarea, FormGrid, Alert, useForm, useToast, DateInput, DateTimeInput,
} from '../../components/ui/index.js';

export function DuplicateWarning({ dup }) {
  if (!dup || (!dup.leads?.length && !dup.parents?.length)) return null;
  if (dup.checkedIn) {
    return (
      <Alert tone="danger" title="Khách đã check-in với nhân sự khác">
        Số điện thoại này đã check-in ngày {dateTime(dup.checkedIn.checked_in_at.slice(0, 16).replace('T', ' '))} với <b>{dup.checkedIn.owner_name}</b> (hồ sơ {dup.checkedIn.code}).
        Theo quy định, khách thuộc về nhân sự check-in trước — không tạo được hồ sơ mới.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title="Số điện thoại đã xuất hiện trong hệ thống">
      <p>Hệ thống KHÔNG tự gộp vì một phụ huynh có thể đăng ký cho nhiều con. Vui lòng kiểm tra:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {dup.parents?.map((p) => <li key={`p${p.id}`}>Phụ huynh <b>{p.full_name}</b>{p.children ? ` — con: ${p.children}` : ''}</li>)}
        {dup.leads?.map((l) => <li key={`l${l.id}`}>Hồ sơ khách <Link className="font-medium underline" to={`/leads/${l.id}`}>{l.code}</Link>: {l.student_name} (PH {l.parent_name})</li>)}
      </ul>
    </Alert>
  );
}

const toLocalInput = (s) => (s ? s.replace(' ', 'T') : '');

export default function LeadForm({ open, onOpenChange, lead, onSaved }) {
  const { courses, activeStaff } = useLookups();
  const { user, can } = useAuth();
  const toast = useToast();
  const consultants = activeStaff.filter((s) => s.roles.some((r) => ['consultant', 'sales_lead', 'teacher', 'manager'].includes(r)));
  const blank = { parent_name: '', phone: '', email: '', student_name: '', student_dob: '', school: '', interest_course_id: '', source: '', status: 'potential', owner_id: String(user.id), next_contact_at: '', note: '' };
  const f = useForm(blank);
  const [dup, setDup] = useState(null);

  useEffect(() => {
    if (!open) return;
    f.setValues(lead ? {
      ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, lead[k] ?? ''])),
      interest_course_id: lead.interest_course_id ? String(lead.interest_course_id) : '', owner_id: lead.owner_id ? String(lead.owner_id) : '', next_contact_at: toLocalInput(lead.next_contact_at),
    } : blank);
    f.setErrors({}); f.setFormError(null); setDup(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kiểm tra trùng số điện thoại khi nhập (chỉ cảnh báo)
  useEffect(() => {
    const phone = f.values.phone.replace(/[\s.-]/g, '');
    if (!/^0\d{9,10}$/.test(phone)) { setDup(null); return undefined; }
    const t = setTimeout(() => api.get(`/api/leads/check-phone?phone=${phone}&exclude=${lead?.id || 0}`).then(setDup).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [f.values.phone, lead?.id]);

  const save = () => f.submit(async (v) => {
    const body = { ...v, interest_course_id: v.interest_course_id || null, owner_id: v.owner_id || null, next_contact_at: v.next_contact_at || null, student_dob: v.student_dob || null };
    if (lead) { delete body.status; delete body.next_contact_at; }
    if (lead) { await api.put(`/api/leads/${lead.id}`, body); toast.success('Đã cập nhật hồ sơ khách.'); onSaved?.(lead.id); } else {
      const r = await api.post('/api/leads', body);
      toast.success('Đã tạo hồ sơ khách quan tâm.');
      onSaved?.(r.id);
    }
    onOpenChange(false);
  }, (v) => ({
    parent_name: !v.parent_name.trim() && 'Vui lòng nhập tên phụ huynh.',
    phone: !v.phone.trim() ? 'Vui lòng nhập số điện thoại.' : !/^0\d{9,10}$/.test(v.phone.replace(/[\s.-]/g, '')) && 'Số điện thoại gồm 10–11 chữ số, bắt đầu bằng 0.',
    student_name: !v.student_name.trim() && 'Vui lòng nhập tên học viên.',
    source: !v.source && 'Vui lòng chọn nguồn khách.',
    next_contact_at: !lead && !v.next_contact_at && 'Chọn ngày liên hệ lại để hệ thống nhắc việc.',
  }));

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={lead ? `Sửa hồ sơ ${lead.code}` : 'Nhập data khách hàng'} description="Thông tin này sẽ được dùng lại khi chuyển thành học viên — không cần nhập lại."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>{lead ? 'Lưu thay đổi' : 'Tạo hồ sơ'}</Button></>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold">Phụ huynh</legend>
          <FormGrid>
            <Field label="Họ tên phụ huynh" required error={f.errors.parent_name}><Input autoFocus {...f.bind('parent_name')} /></Field>
            <Field label="Số điện thoại" required error={f.errors.phone} hint="Ví dụ: 0000 123 456 (dữ liệu demo)"><Input inputMode="tel" {...f.bind('phone')} /></Field>
            <Field label="Email" error={f.errors.email}><Input type="email" placeholder="ten@example.com" {...f.bind('email')} /></Field>
          </FormGrid>
          <DuplicateWarning dup={dup} />
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold">Học viên</legend>
          <FormGrid>
            <Field label="Họ tên học viên" required error={f.errors.student_name}><Input {...f.bind('student_name')} /></Field>
            <Field label="Ngày sinh" error={f.errors.student_dob}><DateInput {...f.bind('student_dob')} /></Field>
            <Field label="Trường đang học" error={f.errors.school}><Input {...f.bind('school')} /></Field>
            <Field label="Khóa quan tâm" error={f.errors.interest_course_id}>
              <Select {...f.bind('interest_course_id')} placeholder="— Chưa xác định —">{courses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.age_range})</option>)}</Select>
            </Field>
          </FormGrid>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold">Tư vấn</legend>
          <FormGrid>
            <Field label="Nguồn khách" required error={f.errors.source}><Select {...f.bind('source')} placeholder="— Chọn nguồn —">{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            {can('leads.assign') && (
              <Field label="Nhân sự phụ trách" error={f.errors.owner_id} hint={lead?.owner_locked ? 'Khách đã check-in — chỉ trưởng phòng đổi được.' : undefined}>
                <Select {...f.bind('owner_id')}>{consultants.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select>
              </Field>
            )}
            {!lead && (
              <>
                <Field label="Phân loại" error={f.errors.status} hint="Đăng ký check-in / học thử thao tác ở hồ sơ khách sau khi tạo.">
                  <Select {...f.bind('status')}>{MANUAL_LEAD_STATUSES.map((k) => <option key={k} value={k}>{STATUS.lead[k][0]}</option>)}</Select>
                </Field>
                <Field label="Ngày liên hệ lại" required error={f.errors.next_contact_at}><DateTimeInput {...f.bind('next_contact_at')} /></Field>
              </>
            )}
          </FormGrid>
          <Field label="Ghi chú" error={f.errors.note}><Textarea {...f.bind('note')} /></Field>
        </fieldset>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </form>
    </Drawer>
  );
}
