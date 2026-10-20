import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tag, X, PiggyBank, ArrowRightLeft, Wallet, BookOpenCheck, Info } from 'lucide-react';
import { api, newIdempotencyKey } from '../../lib/api.js';
import { useLookups } from '../../lib/auth.jsx';
import { date, dateTime, money, todayVN, addDays } from '../../lib/format.js';
import { METHODS, STATUS } from '../../lib/labels.js';
import {
  Modal, Button, Field, Input, Select, Textarea, MoneyInput, DateInput, Alert, Badge, EmptyState, DataTable, Timeline, Segmented, useToast, ConflictList,
} from '../ui/index.js';

// ===== Tag =====
export function TagsModal({ open, onOpenChange, student, suggestions = [], onDone }) {
  const toast = useToast();
  const [tags, setTags] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setTags(student.tags || []); setText(''); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (t) => { const v = t.trim().replace(/,/g, ' '); if (v && !tags.includes(v) && tags.length < 10) setTags([...tags, v]); setText(''); };
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api.put(`/api/students/${student.id}/tags`, { tags }); toast.success('Đã cập nhật tag.'); onOpenChange(false); onDone?.(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Gắn tag học viên" description="Tag giúp lọc nhanh danh sách (VIP, anh chị em, cần quan tâm…). Tối đa 10 tag."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button loading={busy} onClick={save}>Lưu tag</Button></>}>
      <div className="space-y-3">
        <div className="flex min-h-9 flex-wrap gap-1.5">
          {tags.length ? tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[13px] font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
              {t}<button type="button" aria-label={`Bỏ tag ${t}`} className="rounded-full p-0.5 hover:bg-brand-100" onClick={() => setTags(tags.filter((x) => x !== t))}><X className="size-3" /></button>
            </span>
          )) : <span className="text-sm text-ink-3">Chưa có tag.</span>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(text); }}>
          <Input value={text} maxLength={30} onChange={(e) => setText(e.target.value)} placeholder="Nhập tag rồi Enter" aria-label="Tag mới" />
          <Button type="submit" variant="secondary" disabled={!text.trim()}>Thêm</Button>
        </form>
        <div>
          <p className="mb-1.5 text-xs text-ink-3">Gợi ý</p>
          <div className="flex flex-wrap gap-1.5">{suggestions.filter((s) => !tags.includes(s)).map((s) => <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-line px-2.5 py-1 text-[13px] text-ink-2 hover:border-brand-300 hover:text-brand-700">+ {s}</button>)}</div>
        </div>
        {err && <Alert tone="danger">{err.message}</Alert>}
      </div>
    </Modal>
  );
}

export function TagChips({ tags, onEdit }) {
  if (!tags?.length && !onEdit) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {tags?.map((t) => <Link key={t} to={`/students?tag=${encodeURIComponent(t)}`} className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line hover:ring-brand-300">{t}</Link>)}
      {onEdit && <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"><Tag className="size-3" />{tags?.length ? 'Sửa tag' : 'Gắn tag'}</button>}
    </div>
  );
}

// ===== Số dư =====
export function WalletCard({ wallet, canCollect, canRequest, onTopup, onTransfer }) {
  const [open, setOpen] = useState(false);
  const cols = [
    { key: 'code', header: 'Chứng từ', mobile: 'title', nowrap: true, render: (w) => <span className="font-medium">{w.code}</span> },
    { key: 'paid_at', header: 'Ngày', nowrap: true, render: (w) => date(w.paid_at) },
    { key: 'kind', header: 'Loại', render: (w) => wallet.kindLabels[w.kind] },
    { key: 'amount', header: 'Số tiền', align: 'right', render: (w) => <span className={w.status === 'cancelled' ? 'text-ink-3 line-through' : w.amount > 0 ? 'font-medium text-brand-700' : 'font-medium'}>{w.amount > 0 ? '+' : '−'} {money(Math.abs(w.amount))}</span> },
    { key: 'note', header: 'Nội dung', render: (w) => <span className="text-[13px] text-ink-2">{w.note || (w.method ? METHODS[w.method] : '—')}{w.status === 'cancelled' ? ` (đã hủy: ${w.cancel_reason})` : ''}</span> },
    { key: 'by', header: 'Người tạo', render: (w) => w.created_by_name || '—' },
  ];
  return (
    <div className="rounded-[var(--radius-control)] border border-line">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"><PiggyBank className="size-5" aria-hidden /></span>
          <div>
            <p className="text-xs text-ink-3">Số dư (tiền nạp trước / đặt cọc, chưa gắn khóa)</p>
            <p className="text-lg font-semibold tabular">{money(wallet.balance)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCollect && <Button size="sm" icon={Wallet} onClick={onTopup}>Nạp tiền</Button>}
          {canRequest && wallet.balance > 0 && <Button size="sm" variant="secondary" icon={ArrowRightLeft} onClick={onTransfer}>Đề nghị chuyển số dư</Button>}
          {wallet.items.length > 0 && <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Ẩn lịch sử' : `Lịch sử (${wallet.items.length})`}</Button>}
        </div>
      </div>
      {open && <div className="border-t border-line"><DataTable columns={cols} rows={wallet.items} dense empty={<EmptyState compact title="Chưa có giao dịch số dư" />} /></div>}
    </div>
  );
}

export function TopupModal({ open, onOpenChange, student, onDone }) {
  const toast = useToast();
  const [v, setV] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(null);
  useEffect(() => { if (open) { setV({ amount: '', paid_at: todayVN(), method: 'transfer', payer_name: '', note: '' }); setErr(null); key.current = newIdempotencyKey(); } }, [open]);
  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const body = { student_id: student.id, ...v, amount: Number(v.amount) || 0, card_issue_date: v.card_issue_date || null };
      if (v.method !== 'card') { delete body.card_id_no; delete body.card_issue_date; delete body.card_issuer; }
      const r = await api.post('/api/finance/wallet/topup', body, { idempotencyKey: key.current });
      toast.success(`Đã nạp tiền (${r.code}). Số dư: ${money(r.balance)}.`);
      onOpenChange(false); onDone?.();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Nạp tiền vào số dư" description={`${student.full_name} · dùng cho đặt cọc hoặc đóng trước, chưa gắn khóa học`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button loading={busy} onClick={save}>Xác nhận nạp tiền</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Số tiền nạp" required error={err?.fields?.amount}><MoneyInput value={v.amount} onChange={(n) => setV({ ...v, amount: n })} /></Field>
          <Field label="Ngày nạp" required error={err?.fields?.paid_at}><DateInput value={v.paid_at} max={todayVN()} onChange={(e) => setV({ ...v, paid_at: e.target.value })} /></Field>
        </div>
        <Field label="Phương thức" required><Segmented ariaLabel="Phương thức" value={v.method} onChange={(m) => setV({ ...v, method: m })} options={Object.entries(METHODS).map(([value, label]) => ({ value, label }))} /></Field>
        {v.method === 'card' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Số CCCD chủ thẻ" required error={err?.fields?.card_id_no}><Input inputMode="numeric" maxLength={12} value={v.card_id_no || ''} onChange={(e) => setV({ ...v, card_id_no: e.target.value })} /></Field>
            <Field label="Ngày cấp thẻ" required error={err?.fields?.card_issue_date}><DateInput max={todayVN()} value={v.card_issue_date || ''} onChange={(e) => setV({ ...v, card_issue_date: e.target.value })} /></Field>
            <Field label="Đơn vị cấp thẻ" required error={err?.fields?.card_issuer}><Input value={v.card_issuer || ''} onChange={(e) => setV({ ...v, card_issuer: e.target.value })} placeholder="Ngân hàng phát hành" /></Field>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Người nộp"><Input value={v.payer_name || ''} onChange={(e) => setV({ ...v, payer_name: e.target.value })} placeholder="Ví dụ: mẹ học viên" /></Field>
          <Field label="Ghi chú"><Input value={v.note || ''} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Đặt cọc giữ chỗ lớp…" /></Field>
        </div>
        <p className="text-xs text-ink-3">Phiếu nạp là tiền vào thật, được tính vào tiền thực thu ngày nạp. Khi dùng số dư đóng học phí, phiếu thu “Trừ số dư” không cộng thêm vào thực thu.</p>
        {err && !err.fields && <Alert tone="danger">{err.message}</Alert>}
      </div>
    </Modal>
  );
}

export function ApplyWalletModal({ open, onOpenChange, enrollment, balance, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(null);
  const max = enrollment ? Math.min(balance, enrollment.finance.debt) : 0;
  useEffect(() => { if (open) { setAmount(max); setErr(null); key.current = newIdempotencyKey(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/api/finance/wallet/apply', { enrollment_id: enrollment.id, amount: Number(amount) || 0 }, { idempotencyKey: key.current });
      toast.success(`Đã trừ số dư, tạo phiếu thu ${r.code}.`);
      onOpenChange(false); onDone?.();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Đóng học phí từ số dư" description={enrollment && `${enrollment.code} · ${enrollment.course_name} · công nợ ${money(enrollment.finance.debt)} · số dư ${money(balance)}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button loading={busy} onClick={save}>Trừ số dư</Button></>}>
      <div className="space-y-3">
        <Field label="Số tiền trừ" required hint={`Tối đa ${money(max)}`} error={err?.fields?.amount}><MoneyInput value={amount} onChange={setAmount} /></Field>
        {err && !err.fields && <Alert tone="danger">{err.message}</Alert>}
      </div>
    </Modal>
  );
}

// ===== Đề nghị nghiệp vụ cần quản lý duyệt =====
const REQUEST_META = {
  package_change: { title: 'Đề nghị đổi gói phí', hint: 'Khi được duyệt: học phí và số buổi đổi theo gói mới; phần chênh lệch thêm thành đợt thanh toán mới (hạn 7 ngày).' },
  reserve: { title: 'Đề nghị bảo lưu', hint: 'Gói 1 năm (96 buổi) được 1 lần bảo lưu, tối thiểu 2 tuần, tối đa 3 tháng. Trưởng phòng học thuật duyệt trước, Giám đốc duyệt cuối. Khi duyệt: học viên rời lớp, giữ học phí và số buổi đã học.' },
  class_transfer: { title: 'Đề nghị chuyển lớp', hint: 'Chuyển sang lớp khác cùng khóa, giữ nguyên học phí và số buổi đã học. Trưởng phòng học thuật duyệt trước, Giám đốc duyệt cuối.' },
  level_up: { title: 'Đề nghị lên level mới', hint: 'Chuyển đăng ký sang khóa/level cao hơn, giữ học phí và số buổi còn lại. Trưởng phòng học thuật duyệt trước, Giám đốc duyệt cuối.' },
  contract_cancel: { title: 'Đề nghị hủy hợp đồng', hint: 'Khi được duyệt: đăng ký chuyển sang “Đã hủy”. Nếu có số tiền hoàn, thu ngân xác nhận đã chi sau khi duyệt.' },
  fee_transfer: { title: 'Đề nghị chuyển học phí (số dư)', hint: 'Chuyển số dư sang học viên khác (thường là anh chị em). Trưởng phòng học thuật duyệt trước, Giám đốc duyệt cuối; số dư được kiểm tra lại khi duyệt.' },
};

export function RequestModal({ open, onOpenChange, type, enrollment, student, balance, onDone }) {
  const toast = useToast();
  const { packages = [], classes = [], courses = [] } = useLookups();
  const [v, setV] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => { if (open) { setV({ package_id: '', amount: '', reason: '', to_student_id: '', from: addDays(todayVN(), 7), to: addDays(todayVN(), 37), class_id: '', course_id: '' }); setErr(null); setQ(''); setFound([]); } }, [open, type]);
  useEffect(() => {
    if (type !== 'fee_transfer' || q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(async () => { try { const r = await api.get(`/api/search?q=${encodeURIComponent(q)}`); setFound(r.results.filter((x) => x.type === 'student' && x.id !== student.id)); } catch { setFound([]); } }, 250);
    return () => clearTimeout(t);
  }, [q, type, student?.id]);
  const options = useMemo(() => (enrollment ? packages.filter((p) => p.course_id === enrollment.course_id && p.id !== enrollment.package_id) : []), [packages, enrollment]);
  const meta = REQUEST_META[type] || {};
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { type, reason: v.reason };
      if (enrollment) body.enrollment_id = enrollment.id;
      if (type === 'package_change') body.package_id = v.package_id;
      if (type === 'contract_cancel' || type === 'fee_transfer') body.amount = v.amount || null;
      if (type === 'fee_transfer') { body.from_student_id = student.id; body.to_student_id = v.to_student_id; }
      if (type === 'reserve') { body.from = v.from; body.to = v.to; }
      if (type === 'class_transfer') body.class_id = Number(v.class_id) || null;
      if (type === 'level_up') { body.course_id = Number(v.course_id) || null; body.class_id = Number(v.class_id) || null; }
      await api.post('/api/approvals/requests', body);
      toast.success(['reserve', 'fee_transfer', 'class_transfer', 'level_up'].includes(type) ? 'Đã gửi đề xuất, chờ Trưởng phòng học thuật → Giám đốc duyệt.' : 'Đã gửi đề xuất, chờ Giám đốc duyệt.');
      onOpenChange(false); onDone?.();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const fe = err?.fields || {};
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={meta.title} description={enrollment ? `${enrollment.code} · ${enrollment.course_name}${enrollment.package_name ? ` · ${enrollment.package_name}` : ''}` : student?.full_name}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button loading={busy} onClick={save}>Gửi đề xuất</Button></>}>
      <div className="space-y-4">
        <Alert tone="info"><span className="inline-flex items-start gap-1"><Info className="mt-0.5 size-3.5 shrink-0" />{meta.hint}</span></Alert>
        {type === 'package_change' && (
          <Field label="Gói phí mới" required error={fe.package_id}>
            <Select value={v.package_id} onChange={(e) => setV({ ...v, package_id: e.target.value })} placeholder="— Chọn gói —">
              {options.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)}{p.kind === 'renew' ? ' (tái phí)' : ''}</option>)}
            </Select>
          </Field>
        )}
        {type === 'reserve' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Bảo lưu từ ngày" required error={fe.from}><DateInput min={todayVN()} value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></Field>
            <Field label="Đến ngày" required error={fe.to} hint={v.from && v.to ? `${Math.round((Date.parse(v.to) - Date.parse(v.from)) / 86400000) + 1} ngày (14–92 ngày)` : undefined}><DateInput min={v.from} value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></Field>
            {enrollment && <p className="text-xs text-ink-3 sm:col-span-2">Quyền bảo lưu của gói: đã dùng {enrollment.reserve_count ?? 0}/{enrollment.reserve_limit ?? 0} lần.</p>}
          </div>
        )}
        {type === 'class_transfer' && (
          <Field label="Lớp mới" required error={fe.class_id}>
            <Select value={v.class_id} onChange={(e) => setV({ ...v, class_id: e.target.value })} placeholder="— Chọn lớp cùng khóa —">
              {classes.filter((c) => c.course_id === enrollment?.course_id && c.id !== enrollment?.class_id && ['active', 'planned'].includes(c.status)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </Select>
          </Field>
        )}
        {type === 'level_up' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Khóa / level mới" required error={fe.course_id}>
              <Select value={v.course_id} onChange={(e) => setV({ ...v, course_id: e.target.value, class_id: '' })} placeholder="— Chọn khóa —">
                {courses.filter((c) => c.id !== enrollment?.course_id && c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name} ({c.level})</option>)}
              </Select>
            </Field>
            <Field label="Xếp vào lớp (tùy chọn)" error={fe.class_id}>
              <Select value={v.class_id} onChange={(e) => setV({ ...v, class_id: e.target.value })} placeholder="— Xếp lớp sau —" disabled={!v.course_id}>
                {classes.filter((c) => c.course_id === Number(v.course_id) && ['active', 'planned'].includes(c.status)).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {type === 'contract_cancel' && (
          <Field label="Số tiền hoàn cho phụ huynh (nếu có)" hint={`Đã thu ${money(enrollment?.finance?.paid ?? 0)}. Để trống nếu không hoàn.`} error={fe.amount}>
            <MoneyInput value={v.amount} onChange={(n) => setV({ ...v, amount: n })} />
          </Field>
        )}
        {type === 'fee_transfer' && (<>
          <Field label="Học viên nhận" required error={fe.to_student_id}>
            <Input value={q} onChange={(e) => { setQ(e.target.value); setV({ ...v, to_student_id: '' }); }} placeholder="Gõ tên hoặc mã học viên…" />
          </Field>
          {found.length > 0 && !v.to_student_id && (
            <ul className="-mt-2 divide-y divide-line rounded-[var(--radius-control)] border border-line text-sm">
              {found.map((x) => <li key={x.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-canvas" onClick={() => { setV({ ...v, to_student_id: x.id }); setQ(x.title); }}>{x.title} <span className="text-xs text-ink-3">{x.subtitle}</span></button></li>)}
            </ul>
          )}
          <Field label="Số tiền chuyển" required hint={`Số dư hiện có ${money(balance)}`} error={fe.amount}><MoneyInput value={v.amount} onChange={(n) => setV({ ...v, amount: n })} /></Field>
        </>)}
        <Field label="Lý do" required error={fe.reason}><Textarea rows={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        {err && !err.fields && <Alert tone="danger" title={err.message}><ConflictList error={err} /></Alert>}
      </div>
    </Modal>
  );
}

// ===== Tab Học tập =====
function Metric({ label, value, sub, tone }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line px-3 py-2.5">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular ${tone === 'danger' ? 'text-red-700' : tone === 'good' ? 'text-brand-700' : ''}`}>{value}</p>
      {sub && <p className="text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}
const pct = (x) => (x === null || x === undefined ? '—' : `${x}%`);
const sc = (x) => (x === null || x === undefined ? '—' : String(x).replace('.', ','));

export function LearningTab({ data }) {
  const L = data.learning;
  const m = L.month; const a = L.all;
  const monthLabel = `${L.monthKey.slice(5)}/${L.monthKey.slice(0, 4)}`;
  const toneRate = (x) => (x === null ? undefined : x < 90 ? 'danger' : 'good');
  const toneScore = (x) => (x === null ? undefined : x < 6.5 ? 'danger' : 'good');
  const testCols = [
    { key: 'taken_at', header: 'Ngày', mobile: 'title', nowrap: true, render: (t) => date(t.taken_at) },
    { key: 'title', header: 'Bài kiểm tra', render: (t) => <span className="font-medium">{t.title}</span> },
    { key: 'kind', header: 'Loại', render: (t) => L.kinds[t.kind] },
    { key: 'class', header: 'Lớp', render: (t) => t.class_code || '—' },
    { key: 'score', header: 'Điểm', align: 'right', render: (t) => <b className={t.score * 10 / t.max_score < 6.5 ? 'text-red-700' : 'text-ink'}>{sc(t.score)}/{sc(t.max_score)}</b> },
    { key: 'comment', header: 'Nhận xét', render: (t) => <span className="text-[13px] text-ink-2">{t.comment || '—'}</span> },
  ];
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold">Tháng {monthLabel}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Chuyên cần" value={pct(m.attendanceRate)} sub={`${m.marked} buổi đã điểm danh`} tone={toneRate(m.attendanceRate)} />
          <Metric label="Hoàn thành BTVN" value={pct(m.homeworkDoneRate)} sub={m.missingHomework ? `${m.missingHomework} buổi không làm` : undefined} tone={m.missingHomework >= 2 ? 'danger' : toneRate(m.homeworkDoneRate)} />
          <Metric label="Điểm BTVN TB" value={sc(m.homeworkAvg)} sub="thang 10" tone={toneScore(m.homeworkAvg)} />
          <Metric label="Điểm KT TB" value={sc(m.testAvg)} sub={m.tests ? `${m.tests} bài` : 'chưa có bài trong tháng'} tone={toneScore(m.testAvg)} />
        </div>
        <p className="mt-2 text-xs text-ink-3">Toàn khóa: chuyên cần {pct(a.attendanceRate)} · hoàn thành BTVN {pct(a.homeworkDoneRate)} · BTVN TB {sc(a.homeworkAvg)} · KT TB {sc(a.testAvg)} ({a.tests} bài). Học viên dưới ngưỡng được gợi ý ở mục <Link to="/learning?tab=support" className="font-medium text-brand-700 hover:underline">Bổ trợ học tập</Link>.</p>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Điểm kiểm tra</h2>
        <div className="overflow-hidden rounded-[var(--radius-control)] border border-line"><DataTable columns={testCols} rows={L.assessments} dense empty={<EmptyState compact icon={BookOpenCheck} title="Chưa có điểm kiểm tra" description="Giáo viên nhập điểm theo lớp ở trang chi tiết lớp, tab Điểm kiểm tra." />} /></div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">BTVN & nhận xét theo buổi</h2>
        {L.comments.length ? (
          <Timeline items={L.comments.map((c, i) => ({
            key: i,
            title: <span className="flex flex-wrap items-center gap-2">{date(c.date)} · {c.class_code || 'Học bù'}{c.homework_status && <Badge tone={STATUS.hw?.[c.homework_status]?.[1] || (c.homework_status === 'done' ? 'success' : c.homework_status === 'partial' ? 'warning' : 'danger')}>BTVN: {L.homeworkLabels[c.homework_status]}{c.homework_score !== null ? ` · ${sc(c.homework_score)}` : ''}</Badge>}</span>,
            body: c.comment ? `“${c.comment}”` : c.topic,
          }))} />
        ) : <EmptyState compact title="Chưa có nhận xét" />}
      </section>
      {data.checkins?.length > 0 && (
        <p className="text-xs text-ink-3">Check-in gần đây: {data.checkins.map((k) => `${date(k.date)} ${dateTime(k.checked_at).slice(-5)}`).join(' · ')}</p>
      )}
    </div>
  );
}
