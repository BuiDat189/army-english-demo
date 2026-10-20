import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Search, Inbox, AlertOctagon, RotateCw, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button, Skeleton } from './core.jsx';

export function PageHeader({ title, description, actions, children, breadcrumb }) {
  return (
    <div className="mb-5">
      {breadcrumb}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-[22px]">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Tabs có hỗ trợ bàn phím (mũi tên trái/phải); gạch chân trượt theo tab đang chọn */
export function Tabs({ tabs, value, onChange, className, size = 'md' }) {
  const bar = useRef(null);
  const [ind, setInd] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = document.getElementById(`tab-${value}`);
      if (!el || !bar.current) return;
      setInd({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (bar.current) ro.observe(bar.current);
    return () => ro.disconnect();
  }, [value, tabs.length]);
  // Điện thoại: tab đang chọn luôn nằm trong tầm nhìn của thanh tab cuộn ngang
  useEffect(() => {
    const el = document.getElementById(`tab-${value}`);
    const b = el?.parentElement;
    if (el && b && b.scrollWidth > b.clientWidth) b.scrollTo({ left: el.offsetLeft - b.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [value]);
  const onKey = (e, i) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.value);
    document.getElementById(`tab-${next.value}`)?.focus();
  };
  return (
    <div ref={bar} role="tablist" className={clsx('scroll-thin relative -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1', className)}>
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button key={t.value} id={`tab-${t.value}`} role="tab" type="button" aria-selected={active} tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)} onKeyDown={(e) => onKey(e, i)}
            className={clsx('relative inline-flex shrink-0 items-center gap-2 rounded-t-md font-medium transition-colors duration-200',
              size === 'sm' ? 'px-2.5 py-2 text-[13px]' : 'px-3 py-2.5 text-sm',
              active ? 'text-brand-700' : 'text-ink-3 hover:bg-canvas/70 hover:text-ink')}>
            {t.icon && <t.icon className="size-4" aria-hidden />}
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className={clsx('rounded-full px-1.5 py-px text-[11px] tabular transition-colors duration-200', active ? 'bg-brand-100 text-brand-800' : 'bg-line/80 text-ink-2')}>{t.count}</span>
            )}
          </button>
        );
      })}
      {ind && (
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-[100px] origin-left rounded-full bg-brand-500 transition-transform duration-300 ease-[var(--ease-out-soft)]"
          style={{ transform: `translateX(${ind.x}px) scaleX(${ind.w / 100})` }} />
      )}
    </div>
  );
}

export function EmptyState({ title = 'Chưa có dữ liệu', description, action, icon: Icon = Inbox, compact }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14')}>
      <div className="mb-3 flex size-12 animate-float items-center justify-center rounded-2xl bg-brand-50 ring-1 ring-brand-100"><Icon className="size-5 text-brand-700" aria-hidden /></div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }) {
  return (
    <div role="alert" className={clsx('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14')}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-200"><AlertOctagon className="size-5 text-red-700" aria-hidden /></div>
      <p className="text-sm font-medium text-ink">{error?.status === 403 ? 'Bạn không có quyền xem nội dung này' : 'Không tải được dữ liệu'}</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">{error?.message}</p>
      {onRetry && error?.status !== 403 && <Button variant="secondary" size="sm" icon={RotateCw} className="mt-4" onClick={onRetry}>Thử lại</Button>}
    </div>
  );
}

export function LoadingRows({ rows = 6 }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}

/** Bao trạng thái tải / lỗi / rỗng cho một khối dữ liệu */
export function DataState({ loading, error, data, onRetry, empty, isEmpty, children, rows }) {
  if (error && !data) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !data) return <LoadingRows rows={rows} />;
  if (data && isEmpty?.(data)) return empty || <EmptyState />;
  if (!data) return null;
  return children(data);
}

export function SearchInput({ value, onChange, placeholder = 'Tìm kiếm…', className, label = 'Tìm kiếm', delay = 300 }) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);
  useEffect(() => {
    if (text === (value || '')) return undefined;
    const t = setTimeout(() => onChange(text), delay);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input type="search" aria-label={label} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
        className="field-input pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden" />
      {text && (
        <button type="button" aria-label="Xóa nội dung tìm kiếm" onClick={() => { setText(''); onChange(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-3 hover:bg-canvas hover:text-ink"><X className="size-3.5" /></button>
      )}
    </div>
  );
}

export function FilterBar({ children, className, onReset, active }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5', className)}>
      {children}
      {onReset && active && <Button variant="ghost" size="sm" icon={X} onClick={onReset}>Xóa lọc</Button>}
    </div>
  );
}

/**
 * Bảng dữ liệu responsive. Từ md trở lên: bảng; điện thoại: danh sách thẻ (không bóp nhỏ chữ).
 * columns: [{ key, header, render?, className?, align?, mobile?: false | 'title' | 'meta' }]
 */
export function DataTable({ columns, rows, rowKey = 'id', onRowClick, pageSize = 25, empty, footer, dense, rowClassName, caption }) {
  const [page, setPage] = useState(1);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > pages) setPage(1); }, [pages, page]);
  const view = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);
  if (!total) return empty || <EmptyState />;
  const titleCol = columns.find((c) => c.mobile === 'title') || columns[0];
  const mobileCols = columns.filter((c) => c !== titleCol && c.mobile !== false);
  const cell = (c, r) => (c.render ? c.render(r) : r[c.key] ?? '—');
  // Bấm bằng bàn phím: Enter/Space trên dòng có thể mở (bỏ qua khi phím xuất phát từ nút/ô nhập bên trong)
  const rowKeys = (r) => (onRowClick ? {
    tabIndex: 0,
    onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRowClick(r); } },
  } : {});
  return (
    <div>
      <div className="hidden md:block">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left">
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={clsx('whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-3 first:pl-5 last:pr-5', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.headClassName)}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody key={page} className="animate-fade-in">
              {view.map((r) => (
                <tr key={r[rowKey]} onClick={onRowClick ? () => onRowClick(r) : undefined} {...rowKeys(r)}
                  className={clsx('border-b border-line transition-colors duration-150 last:border-0', onRowClick && 'cursor-pointer hover:bg-brand-50/50 focus-visible:bg-brand-50/60 focus-visible:outline-2 focus-visible:-outline-offset-2', rowClassName?.(r))}>
                  {columns.map((c, i) => (
                    <td key={c.key} className={clsx(dense ? 'py-2' : 'py-3', 'px-4 align-middle first:pl-5 last:pr-5', c.align === 'right' && 'whitespace-nowrap text-right tabular', c.nowrap && 'whitespace-nowrap', c.align === 'center' && 'text-center', c.className)}
                      onClick={c.stop ? (e) => e.stopPropagation() : undefined}>
                      {i === 0 && onRowClick ? <span className="contents">{cell(c, r)}</span> : cell(c, r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ul key={page} className="animate-fade-in divide-y divide-line md:hidden">
        {view.map((r) => (
          <li key={r[rowKey]} className={clsx('px-4 py-3 transition-colors active:bg-brand-50/50', rowClassName?.(r))}>
            <div className={clsx(onRowClick && 'cursor-pointer rounded-md focus-visible:outline-2')} onClick={onRowClick ? () => onRowClick(r) : undefined} role={onRowClick ? 'button' : undefined} {...rowKeys(r)}>
              <div className="text-[15px] font-medium text-ink">{cell(titleCol, r)}</div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                {mobileCols.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-ink-3">{c.header}</dt>
                    <dd className={clsx('min-w-0 text-ink', c.align === 'right' && 'tabular')} onClick={c.stop ? (e) => e.stopPropagation() : undefined}>{cell(c, r)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
      {(pages > 1 || footer) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-ink-3 sm:px-5">
          <span className="tabular">{footer || `Hiển thị ${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} / ${total}`}</span>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Trang trước" />
              <span className="px-2 tabular">Trang {page}/{pages}</span>
              <Button variant="secondary" size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Trang sau" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Dòng thời gian lịch sử xử lý */
export function Timeline({ items, empty = 'Chưa có lịch sử.' }) {
  if (!items?.length) return <p className="py-4 text-sm text-ink-3">{empty}</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {items.map((it, i) => (
        <li key={it.key ?? i} className="relative">
          <span className={clsx('absolute -left-[25px] top-1 size-2.5 rounded-full ring-4 ring-surface', it.tone === 'danger' ? 'bg-red-500' : it.tone === 'warning' ? 'bg-amber-500' : it.tone === 'muted' ? 'bg-slate-300' : 'bg-brand-500')} aria-hidden />
          <div className="text-sm text-ink">{it.title}</div>
          {it.body && <div className="mt-0.5 text-[13px] text-ink-2">{it.body}</div>}
          <div className="mt-0.5 text-xs text-ink-3">{it.meta}</div>
        </li>
      ))}
    </ol>
  );
}

/** Số chạy từ giá trị cũ tới giá trị mới (tắt khi người dùng bật giảm chuyển động) */
export function AnimatedNumber({ value, format = (n) => n.toLocaleString('vi-VN'), duration = 700 }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (typeof value !== 'number' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); from.current = value; return undefined; }
    const start = performance.now();
    const a = from.current;
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - (1 - k) ** 3;
      setShown(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, duration]);
  return <>{typeof shown === 'number' ? format(shown) : shown}</>;
}

const TILE_TONE = {
  neutral: 'bg-brand-50 text-brand-700 ring-brand-100',
  warning: 'bg-amber-50 text-amber-700 ring-amber-100',
  danger: 'bg-red-50 text-red-700 ring-red-100',
  info: 'bg-sky-50 text-sky-700 ring-sky-100',
};

/** Thẻ số liệu, bấm để mở danh sách tương ứng. numeric + format ⇒ số chạy khi tải */
export function StatTile({ label, value, numeric, format, sub, onClick, tone = 'neutral', icon: Icon, definition, href, style }) {
  const As = onClick ? 'button' : 'div';
  const text = numeric !== undefined && format ? format(numeric) : String(value);
  return (
    <As type={onClick ? 'button' : undefined} onClick={onClick} title={definition} style={style}
      className={clsx('card group relative flex min-w-0 flex-col items-start overflow-hidden p-4 text-left', onClick && 'card-lift hover:border-brand-300 focus-visible:outline-2')}
      aria-label={href ? `${label}: ${text}. Mở danh sách` : undefined}>
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 size-20 rounded-full bg-brand-500/[0.06] transition-transform duration-300 group-hover:scale-125" />
      <div className="flex w-full items-start justify-between gap-2">
        <span className="text-[13px] font-medium leading-snug text-ink-3">{label}</span>
        {Icon && <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-transform duration-200 group-hover:scale-110', TILE_TONE[tone] || TILE_TONE.neutral)}><Icon className="size-4" aria-hidden /></span>}
      </div>
      <span className={clsx('mt-1.5 whitespace-nowrap font-semibold tracking-tight tabular', text.length > 9 ? 'text-xl' : 'text-[26px] leading-tight', tone === 'danger' ? 'text-red-700' : 'text-ink')}>
        {numeric !== undefined ? <AnimatedNumber value={numeric} format={format} /> : value}
      </span>
      {sub && <span className="mt-1 text-xs text-ink-3">{sub}</span>}
    </As>
  );
}
