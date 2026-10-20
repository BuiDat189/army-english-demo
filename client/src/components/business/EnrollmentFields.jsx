import { useEffect, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLookups } from '../../lib/auth.jsx';
import { useApi } from '../../lib/hooks.js';
import { money, addDays, todayVN } from '../../lib/format.js';
import {
  Field, Select, Input, MoneyInput, Checkbox, Segmented, Textarea, Button, IconButton, Alert, FormGrid, DateInput,
} from '../ui/index.js';

const round1000 = (n) => Math.round(n / 1000) * 1000;
export function buildPlan(kind, fee, start) {
  if (!fee || !start) return [];
  if (kind === '1') return [{ due_date: start, amount: fee }];
  if (kind === '2') { const a = round1000(fee / 2); return [{ due_date: start, amount: a }, { due_date: addDays(start, 30), amount: fee - a }]; }
  if (kind === '3') { const a = round1000(fee * 0.4); const b = round1000(fee * 0.3); return [{ due_date: start, amount: a }, { due_date: addDays(start, 30), amount: b }, { due_date: addDays(start, 60), amount: fee - a - b }]; }
  return [];
}

export function emptyEnrollment(courseId = '') {
  return { course_id: courseId ? String(courseId) : '', package_id: '', fee: 0, class_id: '', enrolled_at: todayVN(), plan: '2', installments: [], withDiscount: false, discount: { kind: 'percent', value: '', reason: '' } };
}

/** Gói mặc định khi chọn khóa: gói cơ bản (đúng số buổi của khóa, không tặng) theo loại mới / tái phí */
export function defaultPackage(packages, course, renew) {
  if (!course) return null;
  const mine = packages.filter((p) => p.course_id === course.id);
  const kind = renew ? 'renew' : 'new';
  return mine.find((p) => p.kind === kind && p.bonus_sessions === 0) || mine.find((p) => p.kind === kind) || mine[0] || null;
}

/** Kiểm tra phía client (server vẫn kiểm tra lại) */
export function validateEnrollment(v, courseFee) {
  const fee = v.fee || courseFee;
  const e = {};
  if (!v.course_id) e.course_id = 'Vui lòng chọn khóa học.';
  if (!v.enrolled_at) e.enrolled_at = 'Vui lòng chọn ngày đăng ký.';
  const sum = v.installments.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  if (v.installments.some((i) => !i.amount || i.amount <= 0)) e.installments = 'Số tiền mỗi đợt phải lớn hơn 0.';
  else if (v.installments.some((i) => !i.due_date)) e.installments = 'Chọn hạn thanh toán cho mỗi đợt.';
  else if (fee && sum !== fee) e.installments = `Tổng các đợt (${money(sum)}) phải bằng học phí (${money(fee)}).`;
  if (v.withDiscount) {
    if (!v.discount.value || v.discount.value <= 0) e['discount.value'] = 'Nhập giá trị giảm.';
    else if (v.discount.kind === 'percent' && v.discount.value > 50) e['discount.value'] = 'Tối đa 50%.';
    if (!v.discount.reason?.trim()) e['discount.reason'] = 'Nhập lý do giảm phí.';
  }
  return e;
}

export function toEnrollmentPayload(v) {
  return {
    course_id: Number(v.course_id), package_id: v.package_id ? Number(v.package_id) : null, class_id: v.class_id ? Number(v.class_id) : null, enrolled_at: v.enrolled_at,
    installments: v.installments.map((i) => ({ due_date: i.due_date, amount: Number(i.amount) })),
    discount: v.withDiscount ? { kind: v.discount.kind, value: Number(v.discount.value), reason: v.discount.reason.trim() } : null,
  };
}

/** Khối nhập đăng ký khóa: khóa học, gói phí, lớp (tùy chọn), lịch thanh toán nhiều đợt, đề nghị giảm phí */
export default function EnrollmentFields({ value, onChange, errors = {}, canDiscount = true, renew = false }) {
  const { courses, packages = [] } = useLookups();
  const course = courses.find((c) => c.id === Number(value.course_id));
  const coursePackages = packages.filter((p) => p.course_id === course?.id);
  const pkg = coursePackages.find((p) => p.id === Number(value.package_id));
  const fee = pkg ? pkg.price : course?.tuition_fee || 0;
  const classes = useApi(value.course_id ? `/api/enrollments/available-classes?course_id=${value.course_id}` : null);
  const set = (patch) => onChange({ ...value, ...patch });

  // Một effect duy nhất (tránh hai lần onChange ghi đè nhau): chọn gói mặc định khi đổi khóa,
  // tính học phí theo gói và tạo lại lịch thanh toán khi đổi khóa / gói / kiểu chia đợt / ngày đăng ký
  useEffect(() => {
    let pid = value.package_id;
    if (course && !coursePackages.some((p) => p.id === Number(pid))) pid = String(defaultPackage(packages, course, renew)?.id || '');
    const p = coursePackages.find((x) => x.id === Number(pid));
    const f = p ? p.price : course?.tuition_fee || 0;
    const patch = {};
    if (pid !== value.package_id) patch.package_id = pid;
    if (f !== value.fee) patch.fee = f;
    if (value.plan !== 'custom') patch.installments = buildPlan(value.plan, f, value.enrolled_at);
    if (Object.keys(patch).length) set(patch);
  }, [value.course_id, value.package_id, value.plan, value.enrolled_at, packages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = useMemo(() => value.installments.reduce((s, i) => s + (Number(i.amount) || 0), 0), [value.installments]);
  const discountAmount = value.withDiscount && value.discount.value ? (value.discount.kind === 'percent' ? round1000((fee * value.discount.value) / 100) : Number(value.discount.value)) : 0;
  const updInst = (idx, patch) => set({ plan: 'custom', installments: value.installments.map((x, i) => (i === idx ? { ...x, ...patch } : x)) });

  return (
    <div className="space-y-4">
      <FormGrid>
        <Field label="Khóa học" required error={errors.course_id}>
          <Select value={value.course_id} onChange={(e) => set({ course_id: e.target.value, class_id: '' })} placeholder="— Chọn khóa học —">
            {courses.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name} · {c.total_sessions} buổi · {money(c.tuition_fee)}</option>)}
          </Select>
        </Field>
        <Field label="Ngày đăng ký" required error={errors.enrolled_at}>
          <DateInput value={value.enrolled_at} onChange={(e) => set({ enrolled_at: e.target.value })} />
        </Field>
      </FormGrid>
      {course && coursePackages.length > 0 && (
        <Field label="Gói phí" required error={errors.package_id}
          hint={pkg ? `${pkg.sessions + pkg.bonus_sessions} buổi${pkg.months ? ` · khoảng ${pkg.months} tháng` : ''} · ${pkg.free_absences} buổi nghỉ không tính phí · ${pkg.reserve_limit ? `${pkg.reserve_limit} lần bảo lưu` : 'không bảo lưu'}` : undefined}>
          <Select value={value.package_id} onChange={(e) => set({ package_id: e.target.value })}>
            {[['new', 'Học viên mới'], ['renew', 'Tái phí (học viên cũ)']].map(([k, label]) => {
              const list = coursePackages.filter((p) => p.kind === k);
              return list.length ? <optgroup key={k} label={label}>{list.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)}</option>)}</optgroup> : null;
            })}
          </Select>
        </Field>
      )}
      <Field label="Xếp lớp ngay (tùy chọn)" hint="Có thể để trống và xếp lớp sau. Lớp đã đủ sĩ số không chọn được." error={errors.class_id}>
        <Select value={value.class_id} onChange={(e) => set({ class_id: e.target.value })} disabled={!value.course_id} placeholder={value.course_id ? '— Chưa xếp lớp —' : 'Chọn khóa học trước'}>
          {classes.data?.items.map((c) => (
            <option key={c.id} value={c.id} disabled={c.occupancy >= c.max_students}>
              {c.code} · {c.schedule} · {c.occupancy}/{c.max_students} HV{c.occupancy >= c.max_students ? ' (đủ sĩ số)' : ''}
            </option>
          ))}
        </Select>
      </Field>

      {course && (
        <div className="rounded-[var(--radius-control)] border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/60 px-3 py-2.5">
            <p className="text-sm font-medium">Lịch thanh toán <span className="font-normal text-ink-3">· học phí {pkg ? 'theo gói' : 'niêm yết'} {money(fee)}</span></p>
            <Segmented size="sm" ariaLabel="Số đợt" value={value.plan} onChange={(p) => set({ plan: p })}
              options={[{ value: '1', label: '1 đợt' }, { value: '2', label: '2 đợt' }, { value: '3', label: '3 đợt' }, { value: 'custom', label: 'Tùy chỉnh' }]} />
          </div>
          <div className="space-y-2 p-3">
            {value.installments.map((it, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
                <span className="w-12 text-xs font-medium text-ink-3">Đợt {i + 1}</span>
                <DateInput aria-label={`Hạn đợt ${i + 1}`} value={it.due_date} onChange={(e) => updInst(i, { due_date: e.target.value })} />
                <MoneyInput aria-label={`Số tiền đợt ${i + 1}`} value={it.amount} onChange={(n) => updInst(i, { amount: n })} />
                <IconButton icon={Trash2} label={`Xóa đợt ${i + 1}`} size="sm" disabled={value.installments.length <= 1}
                  onClick={() => set({ plan: 'custom', installments: value.installments.filter((_, k) => k !== i) })} />
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button variant="ghost" size="sm" icon={Plus} disabled={value.installments.length >= 12}
                onClick={() => set({ plan: 'custom', installments: [...value.installments, { due_date: addDays(value.installments.at(-1)?.due_date || value.enrolled_at, 30), amount: Math.max(0, fee - sum) || '' }] })}>Thêm đợt</Button>
              <span className={sum === fee ? 'text-xs text-ink-3 tabular' : 'text-xs font-medium text-red-700 tabular'}>Tổng: {money(sum)} / {money(fee)}</span>
            </div>
            {errors.installments && <p className="text-xs font-medium text-red-700">{errors.installments}</p>}
          </div>
        </div>
      )}

      {course && canDiscount && (
        <div className="space-y-3 rounded-[var(--radius-control)] border border-line p-3">
          <Checkbox checked={value.withDiscount} onChange={(c) => set({ withDiscount: c })} label="Đề nghị giảm học phí"
            description="Tạo đề xuất chờ quản lý duyệt. Công nợ chỉ giảm SAU khi được duyệt; lịch thanh toán được trừ dần vào các đợt cuối." />
          {value.withDiscount && (<>
            <FormGrid>
              <Field label="Hình thức" required>
                <Select value={value.discount.kind} onChange={(e) => set({ discount: { ...value.discount, kind: e.target.value, value: '' } })}>
                  <option value="percent">Theo phần trăm</option><option value="amount">Số tiền cố định</option>
                </Select>
              </Field>
              <Field label={value.discount.kind === 'percent' ? 'Phần trăm giảm (%)' : 'Số tiền giảm'} required error={errors['discount.value']}>
                {value.discount.kind === 'percent'
                  ? <Input type="number" min={1} max={50} inputMode="numeric" value={value.discount.value} onChange={(e) => set({ discount: { ...value.discount, value: e.target.value === '' ? '' : Number(e.target.value) } })} />
                  : <MoneyInput value={value.discount.value} onChange={(n) => set({ discount: { ...value.discount, value: n } })} />}
              </Field>
            </FormGrid>
            <Field label="Lý do" required error={errors['discount.reason']}><Textarea rows={2} value={value.discount.reason} onChange={(e) => set({ discount: { ...value.discount, reason: e.target.value } })} /></Field>
            {discountAmount > 0 && <Alert tone="info">Nếu được duyệt: giảm {money(discountAmount)}, phải thu còn {money(fee - discountAmount)}.</Alert>}
          </>)}
        </div>
      )}
    </div>
  );
}
