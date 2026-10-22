import { forwardRef } from 'react';
import clsx from 'clsx';
import { Loader2, AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react';
import { STATUS } from '../../lib/labels.js';
import { initials } from '../../lib/format.js';

const BTN = {
  base: 'btn inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold rounded-[var(--radius-control)] select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-55 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2',
  size: { sm: 'h-8 px-3 text-[13px]', md: 'h-9 px-3.5 text-sm', lg: 'h-11 px-5 text-[15px]' },
  variant: {
    primary: 'bg-gradient-to-b from-brand-500 to-btn text-white hover:from-brand-600 hover:to-btn-hover shadow-xs hover:shadow-[0_8px_20px_-6px_rgb(16_185_129/0.55)]',
    secondary: 'bg-surface text-ink border border-line-strong/90 shadow-2xs hover:bg-canvas active:bg-line/60',
    ghost: 'text-ink-2 hover:bg-canvas hover:text-ink',
    danger: 'bg-gradient-to-b from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700 shadow-xs',
    'danger-outline': 'bg-surface text-red-700 border border-red-200 hover:bg-red-50',
    link: 'text-brand-700 hover:text-brand-800 hover:underline px-0 h-auto',
  },
};

export const Button = forwardRef(function Button({ variant = 'primary', size = 'md', loading = false, icon: Icon, iconRight: IconRight, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={clsx(BTN.base, 'btn-text', BTN.size[size], BTN.variant[variant], className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight className="size-4 shrink-0" aria-hidden /> : null}
    </button>
  );
});

/** Nút chỉ có icon — bắt buộc có label (đọc màn hình + tooltip) */
export const IconButton = forwardRef(function IconButton({ icon: Icon, label, size = 'md', variant = 'ghost', className, ...rest }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} title={label}
      className={clsx('btn inline-flex items-center justify-center rounded-[var(--radius-control)] transition-[background-color,color,transform] duration-150 active:scale-90 disabled:opacity-50',
        size === 'sm' ? 'size-8' : 'size-9', BTN.variant[variant], className)} {...rest}>
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
});

const TONE = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200/80',
  info: 'bg-sky-50 text-sky-800 ring-sky-200/80',
  success: 'bg-brand-50 text-brand-800 ring-brand-200/80',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200/80',
  danger: 'bg-red-50 text-red-700 ring-red-200/80',
  brand: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80',
  purple: 'bg-violet-50 text-violet-800 ring-violet-200/80',
};
const DOT = { neutral: 'bg-slate-400', info: 'bg-sky-500', success: 'bg-brand-500', warning: 'bg-amber-500', danger: 'bg-red-500', brand: 'bg-emerald-500', purple: 'bg-violet-500' };

export function Badge({ tone = 'neutral', children, dot = true, className }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap', TONE[tone], className)}>
      {dot && <span className={clsx('size-1.5 rounded-full', DOT[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/** Nhãn trạng thái chuẩn theo bảng STATUS (luôn có chữ) */
export function StatusBadge({ kind, value, className }) {
  const def = STATUS[kind]?.[value];
  if (!def) return value ? <Badge className={className}>{value}</Badge> : null;
  return <Badge tone={def[1]} className={className}>{def[0]}</Badge>;
}
export const statusLabel = (kind, value) => STATUS[kind]?.[value]?.[0] ?? value;

export function Card({ className, children, as: As = 'section', ...rest }) {
  return <As className={clsx('card', className)} {...rest}>{children}</As>;
}
export function CardHeader({ title, description, actions, className, icon: Icon }) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5', className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-ink">
          {Icon && (
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-200/70">
              <Icon className="size-4" aria-hidden />
            </span>
          )}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className, label = 'Đang tải' }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand-600', className)} aria-label={label} role="status" />;
}
export function Skeleton({ className }) {
  return <div className={clsx('skeleton-shimmer rounded-lg', className)} aria-hidden />;
}

export function Avatar({ name, size = 'md', className }) {
  const s = size === 'sm' ? 'size-7 text-[11px]' : size === 'lg' ? 'size-12 text-base' : 'size-9 text-xs';
  return <span className={clsx('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800 ring-1 ring-inset ring-brand-200/60', s, className)} aria-hidden>{initials(name)}</span>;
}

const ALERT = {
  info: ['bg-sky-50 border-sky-200 text-sky-900', Info],
  warning: ['bg-amber-50 border-amber-200 text-amber-900', AlertTriangle],
  danger: ['bg-red-50 border-red-200 text-red-900', XCircle],
  success: ['bg-brand-50 border-brand-200 text-brand-900', CheckCircle2],
};
export function Alert({ tone = 'info', title, children, className, action }) {
  const [cls, Icon] = ALERT[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-[var(--radius-control)] border px-3.5 py-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** Danh sách khóa: giá trị */
export function KeyValue({ items, className, cols = 2 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-3', cols === 3 ? 'sm:grid-cols-3' : cols === 1 ? '' : 'sm:grid-cols-2', className)}>
      {items.filter(Boolean).map(([k, val]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium text-ink-3">{k}</dt>
          <dd className="mt-0.5 text-sm font-medium text-ink break-words">{val ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Danh sách xung đột lịch trả về từ API */
export function ConflictList({ error }) {
  if (!error?.conflicts?.length) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
      {error.conflicts.map((c, i) => <li key={i}>{c.message}</li>)}
    </ul>
  );
}

export function ProgressBar({ value, max, className, tone = 'brand' }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-line/80', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={clsx('h-full origin-left rounded-full', tone === 'warning' ? 'bg-amber-500' : tone === 'danger' ? 'bg-red-500' : 'bg-gradient-to-r from-brand-500 to-brand-400')}
        style={{ width: `${pct}%`, animation: 'bar-grow 500ms var(--ease-out-soft) both' }} />
    </div>
  );
}
