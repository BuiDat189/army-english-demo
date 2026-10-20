import { forwardRef, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { CalendarDays } from 'lucide-react';

// Ô ngày/giờ hiển thị CỐ ĐỊNH dd/MM/yyyy và HH:mm (24h), không phụ thuộc ngôn ngữ trình duyệt.
// Giá trị trả về: ngày 'YYYY-MM-DD', giờ 'HH:MM'. onChange nhận object dạng sự kiện { target: { value } }
// để dùng chung với form hiện có. Nhập chưa hợp lệ thì trả nguyên chuỗi để phần kiểm tra báo lỗi.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isoToVn(v) {
  const m = ISO.exec(v || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v || '';
}
export function parseVnDate(t) {
  const s = String(t || '').trim();
  let y; let mo; let d;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) [, d, mo, y] = m;
  else if ((m = ISO.exec(s))) [, y, mo, d] = m;
  else if ((m = /^(\d{2})(\d{2})(\d{4})$/.exec(s))) [, d, mo, y] = m;
  else return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}
export function parseTime(t) {
  const s = String(t || '').trim();
  const m = /^(\d{1,2})[:h.]?(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
}

export const DateInput = forwardRef(function DateInput({ value, onChange, min, max, className, disabled, ...rest }, ref) {
  const [text, setText] = useState(isoToVn(value));
  const picker = useRef(null);
  useEffect(() => { setText(isoToVn(value)); }, [value]);
  const emit = (v) => onChange?.({ target: { value: v } });
  const change = (t) => {
    setText(t);
    if (!t.trim()) return emit('');
    const iso = parseVnDate(t);
    emit(iso || t);
  };
  return (
    <div className="relative">
      <input ref={ref} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/yyyy" value={text} disabled={disabled}
        onChange={(e) => change(e.target.value)} onBlur={() => { const iso = parseVnDate(text); if (iso) setText(isoToVn(iso)); }}
        className={clsx('field-input pr-9 tabular', className)} {...rest} />
      <button type="button" tabIndex={-1} aria-hidden="true" disabled={disabled}
        onClick={() => { try { picker.current?.showPicker(); } catch { picker.current?.focus(); } }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-3 hover:text-ink disabled:opacity-50">
        <CalendarDays className="size-4" />
      </button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" value={ISO.test(value || '') ? value : ''} min={min} max={max}
        onChange={(e) => change(isoToVn(e.target.value))}
        className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0" />
    </div>
  );
});

export const TimeInput = forwardRef(function TimeInput({ value, onChange, className, ...rest }, ref) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);
  const change = (raw) => {
    let t = raw.replace(/[^\d:]/g, '').slice(0, 5);
    if (/^\d{3,4}$/.test(t)) t = `${t.slice(0, t.length - 2)}:${t.slice(-2)}`;
    setText(t);
    const ok = parseTime(t);
    onChange?.({ target: { value: ok || t } });
  };
  return (
    <input ref={ref} type="text" inputMode="numeric" autoComplete="off" placeholder="HH:mm" maxLength={5} value={text}
      onChange={(e) => change(e.target.value)} onBlur={() => { const ok = parseTime(text); if (ok) setText(ok); }}
      className={clsx('field-input tabular', className)} {...rest} />
  );
});

/** Ngày + giờ, giá trị 'YYYY-MM-DDTHH:MM' */
export const DateTimeInput = forwardRef(function DateTimeInput({ value, onChange, id, ...rest }, ref) {
  const [d, t] = (value || '').split(/[T ]/);
  const emit = (nd, nt) => onChange?.({ target: { value: nd ? `${nd}T${nt || '09:00'}` : '' } });
  return (
    <div className="grid grid-cols-[1fr_88px] gap-2">
      <DateInput ref={ref} id={id} value={d || ''} onChange={(e) => emit(e.target.value, t)} {...rest} />
      <TimeInput aria-label="Giờ" value={t || ''} onChange={(e) => emit(d, e.target.value)} />
    </div>
  );
});
