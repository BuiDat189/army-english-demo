import { useEffect, useState } from 'react';

// Nền sáng/tối: lựa chọn của từng người xem lưu trong trình duyệt (chỉ là tuỳ chọn hiển thị).
const KEY = 'army.theme';
const listeners = new Set();

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}
export function resolveTheme(pref = getThemePref()) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(pref = getThemePref(), { animate = false } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-switching');
    setTimeout(() => root.classList.remove('theme-switching'), 260);
  }
  const t = resolveTheme(pref);
  root.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0d1526' : '#15233d');
  listeners.forEach((fn) => fn(t));
}
export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* bỏ qua: chế độ riêng tư */ }
  applyTheme(pref, { animate: true });
}

// Theo dõi hệ điều hành khi đang chọn "Theo hệ thống"
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getThemePref() === 'system') applyTheme('system', { animate: true }); });
}

/** Nền đang áp dụng ('light' | 'dark') — dùng cho biểu đồ cần đổi màu theo nền */
export function useResolvedTheme() {
  const [t, setT] = useState(() => (typeof document !== 'undefined' ? document.documentElement.dataset.theme || 'light' : 'light'));
  useEffect(() => { listeners.add(setT); return () => listeners.delete(setT); }, []);
  return t;
}
