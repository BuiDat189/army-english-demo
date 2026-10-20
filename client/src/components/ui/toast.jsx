import { createContext, useCallback, useContext, useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

const Ctx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  // Đóng: đánh dấu "đang rời" để chạy hiệu ứng trượt ra, rồi mới gỡ khỏi danh sách
  const dismiss = useCallback((id) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 190);
  }, []);
  const push = useCallback((tone, message, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs.slice(-3), { id, tone, message, title: opts.title }]);
    setTimeout(() => dismiss(id), opts.duration ?? (tone === 'error' ? 7000 : 4000));
  }, [dismiss]);
  const api = { success: (m, o) => push('success', m, o), error: (m, o) => push('error', m, o), info: (m, o) => push('info', m, o) };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? XCircle : Info;
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
              className={clsx('pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-[var(--radius-card)] border bg-surface px-3.5 py-3 text-sm shadow-[var(--shadow-pop)]',
                t.leaving ? 'animate-toast-out' : 'animate-toast-in',
                t.tone === 'success' ? 'border-brand-200' : t.tone === 'error' ? 'border-red-200' : 'border-line')}>
              <span className={clsx('absolute inset-y-0 left-0 w-1', t.tone === 'success' ? 'bg-brand-500' : t.tone === 'error' ? 'bg-red-500' : 'bg-sky-500')} aria-hidden />
              <Icon className={clsx('mt-0.5 size-4 shrink-0', t.tone === 'success' ? 'text-brand-600' : t.tone === 'error' ? 'text-red-700' : 'text-sky-600')} aria-hidden />
              <div className="min-w-0 flex-1">
                {t.title && <p className="font-semibold text-ink">{t.title}</p>}
                <p className="text-ink-2">{t.message}</p>
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Đóng thông báo" className="rounded p-0.5 text-ink-3 transition-colors hover:text-ink"><X className="size-3.5" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() { return useContext(Ctx); }
