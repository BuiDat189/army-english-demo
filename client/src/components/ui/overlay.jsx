import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DM from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import { X, MoreHorizontal } from 'lucide-react';
import { Button, IconButton, Alert } from './core.jsx';
import { Field, Textarea, Input } from './form.jsx';

/** Modal cho thao tác ngắn. Trên điện thoại hiển thị dạng tấm trượt từ dưới, nội dung tự cuộn — không bị cắt. */
export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md' }) {
  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ov-anim fixed inset-0 z-50 bg-[rgb(8_12_22/0.5)] backdrop-blur-[2px]" />
        <Dialog.Content
          className={clsx('modal-anim fixed z-50 flex max-h-[92dvh] w-full flex-col bg-surface shadow-[var(--shadow-pop)] focus:outline-none',
            'inset-x-0 bottom-0 rounded-t-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-card)]', width)}
          >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-[13px] text-ink-3">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close asChild><IconButton icon={X} label="Đóng" size="sm" className="-mr-1.5 -mt-1" /></Dialog.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Drawer bên phải cho xem nhanh / biểu mẫu dài. Điện thoại: toàn màn hình. */
export function Drawer({ open, onOpenChange, title, description, children, footer, width = 'md', headerExtra }) {
  const w = { md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[width];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ov-anim fixed inset-0 z-50 bg-[rgb(8_12_22/0.5)] backdrop-blur-[1px]" />
        <Dialog.Content className={clsx('drawer-anim fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-[var(--shadow-pop)] focus:outline-none', w)}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description asChild><div className="mt-1 text-[13px] text-ink-3">{description}</div></Dialog.Description> : <Dialog.Description className="sr-only">{typeof title === 'string' ? title : 'Chi tiết'}</Dialog.Description>}
              {headerExtra}
            </div>
            <Dialog.Close asChild><IconButton icon={X} label="Đóng" size="sm" className="-mr-1.5 -mt-1" /></Dialog.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Hộp xác nhận cho thao tác xóa/hủy/reset.
 * reason: bắt buộc nhập lý do; typeToConfirm: phải gõ đúng chuỗi mới cho bấm.
 */
export function ConfirmDialog({ open, onOpenChange, title, message, confirmLabel = 'Xác nhận', tone = 'danger', reason = false, reasonLabel = 'Lý do', typeToConfirm, onConfirm }) {
  const [text, setText] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const close = (v) => { if (!v) { setText(''); setTyped(''); setError(null); } onOpenChange(v); };
  const disabled = (reason && !text.trim()) || (typeToConfirm && typed !== typeToConfirm);
  const go = async () => {
    if (busy || disabled) return;
    setBusy(true); setError(null);
    try { await onConfirm(text.trim()); close(false); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={close} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={() => close(false)} disabled={busy}>Không, quay lại</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={go} loading={busy} disabled={disabled}>{confirmLabel}</Button>
      </>}>
      <div className="space-y-4">
        {message && <div className="text-sm leading-relaxed text-ink-2">{message}</div>}
        {reason && <Field label={reasonLabel} required error={error?.fields?.reason}><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus /></Field>}
        {typeToConfirm && <Field label={`Gõ ${typeToConfirm} để xác nhận`} required><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></Field>}
        {error && <Alert tone="danger">{error.message}</Alert>}
      </div>
    </Modal>
  );
}

/** Menu thao tác (luôn có thể dùng bàn phím) */
export function Menu({ items, label = 'Thao tác khác', trigger, align = 'end' }) {
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>{trigger || <IconButton icon={MoreHorizontal} label={label} size="sm" />}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className="menu-anim z-50 min-w-48 rounded-[var(--radius-control)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          {visible.map((it, i) => (it === '-' ? <DM.Separator key={i} className="my-1 h-px bg-line" /> : (
            <DM.Item key={it.label} disabled={it.disabled} onSelect={it.onSelect}
              className={clsx('flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-canvas data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
                it.danger ? 'text-red-700' : 'text-ink')}>
              {it.icon && <it.icon className="size-4 text-current opacity-70" aria-hidden />}{it.label}
            </DM.Item>
          )))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
