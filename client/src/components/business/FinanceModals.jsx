import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, newIdempotencyKey } from '../../lib/api.js';
import { money, todayVN, date } from '../../lib/format.js';
import { METHODS } from '../../lib/labels.js';
import {
  Modal, Button, Field, Input, Select, MoneyInput, Textarea, Alert, FormGrid, Segmented, useForm, useToast, KeyValue, DateInput,
} from '../ui/index.js';

/**
 * Ghi nhận phiếu thu. Mỗi lần mở modal sinh một mã chống gửi trùng (Idempotency-Key):
 * bấm hai lần hoặc mạng gửi lại cũng chỉ tạo MỘT phiếu.
 */
/** Quẹt thẻ tín dụng: bắt buộc số CCCD chủ thẻ, ngày cấp thẻ, đơn vị cấp thẻ (theo quy định kế toán trung tâm) */
export function CardFields({ f }) {
  if (f.values.method !== 'card') return null;
  return (
    <FormGrid cols={3}>
      <Field label="Số CCCD chủ thẻ" required error={f.errors.card_id_no} hint="12 chữ số"><Input inputMode="numeric" maxLength={12} {...f.bind('card_id_no')} /></Field>
      <Field label="Ngày cấp thẻ" required error={f.errors.card_issue_date}><DateInput max={todayVN()} {...f.bind('card_issue_date')} /></Field>
      <Field label="Đơn vị cấp thẻ" required error={f.errors.card_issuer}><Input placeholder="Ngân hàng phát hành" {...f.bind('card_issuer')} /></Field>
    </FormGrid>
  );
}
export const cardErrors = (v) => (v.method !== 'card' ? {} : {
  card_id_no: !/^\d{12}$/.test(v.card_id_no || '') && 'Số CCCD gồm 12 chữ số.',
  card_issue_date: !v.card_issue_date && 'Chọn ngày cấp thẻ.',
  card_issuer: !v.card_issuer?.trim() && 'Nhập đơn vị cấp thẻ.',
});
export const cardPayload = (v) => (v.method === 'card' ? { card_id_no: v.card_id_no, card_issue_date: v.card_issue_date, card_issuer: v.card_issuer } : {});

export function CollectReceiptModal({ open, onOpenChange, enrollment, studentName, onDone }) {
  const f = useForm({ amount: '', paid_at: todayVN(), method: 'transfer', payer_name: '', note: '', card_id_no: '', card_issue_date: '', card_issuer: '' });
  const key = useRef(null);
  const toast = useToast();
  const fin = enrollment?.finance;
  useEffect(() => {
    if (open && fin) {
      key.current = newIdempotencyKey();
      const suggested = fin.nextDue ? Math.min(fin.nextDue.amount, fin.debt) : fin.debt;
      f.setValues({ amount: suggested || '', paid_at: todayVN(), method: 'transfer', payer_name: '', note: '', card_id_no: '', card_issue_date: '', card_issuer: '' });
      f.setErrors({}); f.setFormError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enrollment || !fin) return null;
  const save = () => f.submit(async (v) => {
    const r = await api.post('/api/finance/receipts', { enrollment_id: enrollment.id, amount: v.amount, paid_at: v.paid_at, method: v.method, payer_name: v.payer_name || null, note: v.note || null, ...cardPayload(v) }, { idempotencyKey: key.current });
    toast.success(<>Đã ghi nhận phiếu {r.code}: {money(v.amount)}. <Link className="font-medium text-brand-700 underline" to={`/finance/receipts/${r.id}`}>Xem / in phiếu</Link></>, { title: r.duplicate ? 'Phiếu đã tồn tại (gửi lại)' : 'Thu tiền thành công' });
    onOpenChange(false);
    onDone?.(r);
  }, (v) => ({
    amount: !v.amount ? 'Nhập số tiền thu.' : v.amount <= 0 ? 'Số tiền phải lớn hơn 0.' : v.amount > fin.debt ? `Không vượt công nợ còn lại (${money(fin.debt)}).` : null,
    paid_at: !v.paid_at ? 'Chọn ngày thu.' : v.paid_at > todayVN() ? 'Ngày thu không được ở tương lai.' : null,
    ...cardErrors(v),
  }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Ghi nhận phiếu thu" description={`${studentName} · ${enrollment.code} · ${enrollment.course_name}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Xác nhận thu tiền</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <KeyValue cols={3} items={[['Phải thu', money(fin.net)], ['Đã thu', money(fin.paid)], ['Công nợ còn lại', <span className="font-semibold text-red-700">{money(fin.debt)}</span>]]} />
        {fin.nextDue && <p className="text-[13px] text-ink-3">Đợt gần nhất chưa thu đủ: đợt {fin.nextDue.seq}, hạn {date(fin.nextDue.date)}, còn {money(fin.nextDue.amount)}.</p>}
        <FormGrid>
          <Field label="Số tiền thu" required error={f.errors.amount}><MoneyInput value={f.values.amount} onChange={(n) => f.set('amount', n)} autoFocus /></Field>
          <Field label="Ngày thu" required error={f.errors.paid_at}><DateInput max={todayVN()} {...f.bind('paid_at')} /></Field>
        </FormGrid>
        <Field label="Phương thức" required error={f.errors.method}>
          <Segmented ariaLabel="Phương thức thanh toán" value={f.values.method} onChange={(m) => f.set('method', m)} options={Object.entries(METHODS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <CardFields f={f} />
        <FormGrid>
          <Field label="Người nộp"><Input placeholder="Ví dụ: mẹ học viên" {...f.bind('payer_name')} /></Field>
          <Field label="Ghi chú"><Input placeholder="Mã giao dịch chuyển khoản…" {...f.bind('note')} /></Field>
        </FormGrid>
        <p className="text-xs text-ink-3">Phiếu thu nội bộ, không phải hóa đơn điện tử. Chuyển khoản/quẹt thẻ chỉ GHI NHẬN giao dịch đã xảy ra — hệ thống không kết nối ngân hàng.</p>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </form>
    </Modal>
  );
}

export function DiscountModal({ open, onOpenChange, enrollment, onDone }) {
  const f = useForm({ kind: 'percent', value: '', reason: '' });
  const toast = useToast();
  useEffect(() => { if (open) { f.setValues({ kind: 'percent', value: '', reason: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enrollment) return null;
  const save = () => f.submit(async (v) => {
    await api.post(`/api/enrollments/${enrollment.id}/discount`, { kind: v.kind, value: Number(v.value), reason: v.reason });
    toast.success('Đã gửi đề nghị giảm phí. Công nợ chỉ thay đổi sau khi quản lý duyệt.');
    onOpenChange(false); onDone?.();
  }, (v) => ({ value: !v.value ? 'Nhập giá trị giảm.' : null, reason: !v.reason.trim() ? 'Nhập lý do.' : null }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Đề nghị giảm học phí" description={`${enrollment.code} · ${enrollment.course_name}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Gửi đề nghị</Button></>}>
      <div className="space-y-4">
        <Alert tone="info">Đề nghị sẽ chuyển tới quản lý duyệt. Người đề nghị không tự duyệt được.</Alert>
        <FormGrid>
          <Field label="Hình thức" required><Select {...f.bind('kind')}><option value="percent">Theo phần trăm</option><option value="amount">Số tiền cố định</option></Select></Field>
          <Field label={f.values.kind === 'percent' ? 'Phần trăm (%)' : 'Số tiền'} required error={f.errors.value}>
            {f.values.kind === 'percent' ? <Input type="number" min={1} max={50} {...f.bind('value')} /> : <MoneyInput value={f.values.value} onChange={(n) => f.set('value', n)} />}
          </Field>
        </FormGrid>
        <Field label="Lý do" required error={f.errors.reason}><Textarea {...f.bind('reason')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}

export function RefundModal({ open, onOpenChange, enrollment, onDone }) {
  const f = useForm({ amount: '', reason: '' });
  const toast = useToast();
  useEffect(() => { if (open) { f.setValues({ amount: '', reason: '' }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enrollment) return null;
  const max = (enrollment.finance?.paid || 0) - (enrollment.reservedRefund || 0);
  const save = () => f.submit(async (v) => {
    await api.post('/api/finance/refunds', { enrollment_id: enrollment.id, amount: v.amount, reason: v.reason });
    toast.success('Đã tạo đề nghị hoàn phí, chờ quản lý duyệt. Tiền chỉ ghi nhận đã hoàn sau khi thu ngân xác nhận chi.');
    onOpenChange(false); onDone?.();
  }, (v) => ({ amount: !v.amount ? 'Nhập số tiền hoàn.' : v.amount > max ? `Tối đa ${money(max)}.` : null, reason: !v.reason.trim() ? 'Nhập lý do.' : null }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Đề nghị hoàn phí" description={`${enrollment.code} · ${enrollment.course_name}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Gửi đề nghị</Button></>}>
      <div className="space-y-4">
        <Alert tone="info">Quy trình: Đề nghị → Quản lý duyệt → Thu ngân xác nhận đã chi. Duyệt KHÔNG đồng nghĩa đã hoàn tiền.</Alert>
        <Field label="Số tiền hoàn" required error={f.errors.amount} hint={`Tối đa ${money(max)} (đã thu, trừ các khoản hoàn đang xử lý).`}><MoneyInput value={f.values.amount} onChange={(n) => f.set('amount', n)} /></Field>
        <Field label="Lý do" required error={f.errors.reason}><Textarea {...f.bind('reason')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
