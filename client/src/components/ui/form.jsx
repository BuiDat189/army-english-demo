import { forwardRef, useId, useState, useRef, useCallback, cloneElement, isValidElement } from 'react';
import clsx from 'clsx';
import { parseMoney, num } from '../../lib/format.js';
import { ApiError } from '../../lib/api.js';

/** Trường biểu mẫu: label + control + gợi ý + lỗi cạnh trường */
export function Field({ label, error, hint, required, children, className, id: idProp }) {
  const auto = useId();
  const id = idProp || auto;
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const control = isValidElement(children)
    ? cloneElement(children, {
      id: children.props.id || id,
      'aria-invalid': error ? 'true' : undefined,
      'aria-describedby': clsx(error && errId, hint && hintId) || undefined,
    })
    : children;
  return (
    <div className={clsx('min-w-0', className)}>
      {label && (
        <label htmlFor={children?.props?.id || id} className="mb-1.5 block text-[13px] font-medium text-ink-2">
          {label}{required && <span className="ml-0.5 text-red-700" aria-hidden>*</span>}
        </label>
      )}
      {control}
      {hint && !error && <p id={hintId} className="mt-1 text-xs text-ink-3">{hint}</p>}
      {error && <p id={errId} className="mt-1 text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx('field-input', className)} {...rest} />;
});
export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={clsx('field-input', className)} {...rest} />;
});
export const Select = forwardRef(function Select({ className, children, placeholder, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx('field-input', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
});

/** Ô nhập tiền: hiển thị 1.500.000, giá trị trả về là số nguyên VNĐ (hoặc '' khi trống) */
export const MoneyInput = forwardRef(function MoneyInput({ value, onChange, className, ...rest }, ref) {
  const display = value === '' || value === null || value === undefined || Number.isNaN(value) ? '' : num(value);
  return (
    <div className="relative">
      <input ref={ref} inputMode="numeric" autoComplete="off" className={clsx('field-input pr-9 text-right tabular', className)} value={display}
        onChange={(e) => { const n = parseMoney(e.target.value); onChange(Number.isNaN(n) ? '' : n); }} {...rest} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-3">đ</span>
    </div>
  );
});

export function Checkbox({ label, checked, onChange, disabled, description, className, id: idProp }) {
  const auto = useId();
  const id = idProp || auto;
  return (
    <label htmlFor={id} className={clsx('flex cursor-pointer items-start gap-2.5 text-sm', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong accent-brand-600" />
      <span><span className="text-ink">{label}</span>{description && <span className="block text-xs text-ink-3">{description}</span>}</span>
    </label>
  );
}

/** Nhóm lựa chọn dạng nút (thay radio) — dùng cho điểm danh, loại liên hệ… */
export function Segmented({ options, value, onChange, size = 'md', className, ariaLabel, disabled }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={clsx('inline-flex flex-wrap gap-1 rounded-[var(--radius-control)] bg-canvas p-1 ring-1 ring-inset ring-line', className)}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} disabled={disabled}
            onClick={() => onChange(o.value)}
            className={clsx('inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-60',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              active ? (o.activeClass || 'bg-surface text-ink shadow-sm ring-1 ring-line') : 'text-ink-3 hover:text-ink')}>
            {o.icon && <o.icon className="size-3.5" aria-hidden />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Quản lý form: giữ dữ liệu khi lỗi, lỗi theo trường từ server, chống gửi trùng (double submit).
 */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  const set = useCallback((key, val) => {
    setValues((v) => ({ ...v, [key]: val }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);
  const bind = (key) => ({ value: values[key] ?? '', onChange: (e) => set(key, e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e) });

  const submit = useCallback(async (fn, validate) => {
    if (busy.current) return undefined;
    setFormError(null);
    if (validate) {
      const errs = validate(values) || {};
      const clean = Object.fromEntries(Object.entries(errs).filter(([, x]) => x));
      if (Object.keys(clean).length) { setErrors(clean); setFormError(null); return undefined; }
    }
    busy.current = true;
    setSubmitting(true);
    try {
      const out = await fn(values);
      setErrors({});
      return out ?? true;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) setErrors(err.fields);
        setFormError(err);
      } else {
        setFormError(new ApiError(0, { error: err.message }));
      }
      return undefined;
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }, [values]);

  return { values, setValues, set, bind, errors, setErrors, formError, setFormError, submitting, submit };
}

export function FormGrid({ children, cols = 2, className }) {
  return <div className={clsx('grid gap-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-3', cols === 4 && 'sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</div>;
}
