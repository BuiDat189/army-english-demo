import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import * as DM from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import {
  Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Bell, Search, LogOut, Repeat2, ChevronDown, FlaskConical, UserCog, CheckCheck, X, Sun, Moon, Monitor,
} from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { visibleNav, PAGE_TITLES } from '../../nav.js';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { dateTime } from '../../lib/format.js';
import { getThemePref, setThemePref, useResolvedTheme } from '../../lib/theme.js';
import { Avatar, IconButton, Spinner, useToast } from '../ui/index.js';
import { ROLE_LABELS } from '../../lib/labels.js';

function readCollapsed() { try { return localStorage.getItem('army.sidebar') === 'collapsed'; } catch { return false; } }

export default function AppShell() {
  const { user, can } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);
  const toggle = () => {
    setCollapsed((c) => { try { localStorage.setItem('army.sidebar', c ? 'open' : 'collapsed'); } catch { /* bỏ qua */ } return !c; });
  };
  const nav = visibleNav(can);
  const title = PAGE_TITLES.find(([p]) => (p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)))?.[1] || '';

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow">Bỏ qua menu, tới nội dung</a>
      {/* Sidebar desktop */}
      <aside className={clsx('side-panel fixed inset-y-0 left-0 z-30 hidden flex-col transition-[width] duration-300 ease-[var(--ease-out-soft)] lg:flex', collapsed ? 'w-[72px]' : 'w-64')} aria-label="Điều hướng chính">
        <SidebarContent nav={nav} collapsed={collapsed} canHr={can('hr.view')} />
        <div className="border-t border-white/10 p-2">
          <button type="button" onClick={toggle} className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] text-side-ink-2 transition-colors hover:bg-side-hover hover:text-white" aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'} title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}>
            {collapsed ? <PanelLeftOpen className="size-[18px] shrink-0" /> : <PanelLeftClose className="size-[18px] shrink-0" />}
            {!collapsed && 'Thu gọn menu'}
          </button>
        </div>
      </aside>
      {/* Sidebar điện thoại/tablet */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 animate-fade-in bg-[rgb(8_12_22/0.5)] backdrop-blur-[1px]" aria-hidden="true" onClick={() => setMobileOpen(false)} />
          <aside className="side-panel absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-side-in flex-col shadow-[var(--shadow-pop)]">
            <IconButton icon={X} label="Đóng menu" className="absolute right-2 top-2.5 z-10 text-side-ink hover:bg-side-hover hover:text-white" onClick={() => setMobileOpen(false)} />
            <SidebarContent nav={nav} collapsed={false} canHr={can('hr.view')} />
          </aside>
        </div>
      )}

      <div className={clsx('transition-[padding] duration-300 ease-[var(--ease-out-soft)]', collapsed ? 'lg:pl-[72px]' : 'lg:pl-64')}>
        <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <IconButton icon={MenuIcon} label="Mở menu" className="lg:hidden" onClick={() => setMobileOpen(true)} />
            <p key={title} className="hidden min-w-0 animate-fade-in truncate text-[15px] font-semibold text-ink md:block md:w-48 lg:w-56">{title}</p>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-1">
              <DemoBadge />
              <ThemeMenu />
              <Notifications />
              <AccountMenu user={user} />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6">
          {/* Mỗi lần đổi trang: nội dung trồi nhẹ lên (tắt khi giảm chuyển động) */}
          <div key={location.pathname} className="animate-rise">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ nav, collapsed, canHr }) {
  return (
    <>
      <div className={clsx('flex h-16 shrink-0 items-center gap-3 border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-4')}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#fff] p-1 shadow-[0_4px_14px_-4px_rgb(0_0_0/0.5)]">
          <img src="/army-mark.png" alt={collapsed ? 'ARMY ENGLISH' : ''} width="32" height="32" className="size-8" />
        </span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-bold tracking-wide text-white">ARMY ENGLISH</p>
            <p className="truncate text-[11px] font-medium text-side-ink-2">English for future leaders</p>
          </div>
        )}
      </div>
      {!collapsed && <div className="px-5 pt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-star/80">Chi nhánh demo</div>}
      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-2 [scrollbar-color:rgb(255_255_255/0.2)_transparent]">
        {nav.map((g) => (
          <div key={g.group || 'main'} className="mb-1.5">
            {g.group && !collapsed && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-side-ink-2">{g.group}</div>}
            {g.group && collapsed && <div className="mx-3 my-2.5 h-px bg-white/10" />}
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const label = it.labelLimited && !canHr ? it.labelLimited : it.label;
                return (
                  <li key={it.to}>
                    <NavLink to={it.to} end={it.end} title={collapsed ? label : undefined}
                      className={({ isActive }) => clsx('group relative flex h-9 items-center gap-3 rounded-lg text-[13.5px] font-medium transition-colors duration-150',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        isActive ? 'bg-side-active text-white' : 'text-side-ink hover:bg-side-hover hover:text-white')}>
                      {({ isActive }) => (<>
                        {isActive && <span className="absolute inset-y-2 left-0 w-[3px] animate-fade-in rounded-r bg-star" aria-hidden />}
                        <it.icon className={clsx('size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110', isActive ? 'text-star' : 'text-side-ink-2 group-hover:text-white')} aria-hidden />
                        {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
                      </>)}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

/** Chọn nền: Sáng / Tối / Theo hệ thống */
function ThemeMenu() {
  const theme = useResolvedTheme();
  const [pref, setPref] = useState(getThemePref);
  const choose = (p) => { setPref(p); setThemePref(p); };
  const opts = [['light', 'Nền sáng', Sun], ['dark', 'Nền tối', Moon], ['system', 'Theo hệ thống', Monitor]];
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button type="button" aria-label={`Đổi nền (đang dùng ${theme === 'dark' ? 'nền tối' : 'nền sáng'})`} title="Đổi nền sáng/tối"
          className="relative inline-flex size-9 items-center justify-center overflow-hidden rounded-md text-ink-2 transition-colors hover:bg-canvas">
          <Sun className={clsx('absolute size-[18px] transition-[transform,opacity] duration-300', theme === 'dark' ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} aria-hidden />
          <Moon className={clsx('absolute size-[18px] transition-[transform,opacity] duration-300', theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')} aria-hidden />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={8} className="menu-anim z-50 w-48 rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          {opts.map(([k, l, I]) => (
            <DM.Item key={k} onSelect={() => choose(k)} className={clsx('flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-canvas', pref === k ? 'font-medium text-brand-700' : 'text-ink')}>
              <I className="size-4" aria-hidden />{l}{pref === k && <span className="ml-auto text-xs">Đang chọn</span>}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function DemoBadge() {
  const { demoMode } = useAuth();
  if (!demoMode) return null;
  return (
    <span className="hidden items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 sm:inline-flex" title="Toàn bộ dữ liệu là dữ liệu giả lập để trình diễn">
      <FlaskConical className="size-3.5" aria-hidden />Dữ liệu demo
    </span>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, results: [] });
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setState({ loading: false, results: [] }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      try { const r = await api.get(`/api/search?q=${encodeURIComponent(q.trim())}`); setState({ loading: false, results: r.results }); setActive(0); } catch { setState({ loading: false, results: [] }); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const go = (r) => { setOpen(false); setQ(''); navigate(r.link); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, state.results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && state.results[active]) { e.preventDefault(); go(state.results[active]); }
    if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); }
  };
  const TYPE = { student: 'Học viên', lead: 'Khách', class: 'Lớp' };
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input ref={ref} type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown} placeholder="Tìm học viên, phụ huynh, SĐT, lớp…" aria-label="Tìm kiếm nhanh" role="combobox" aria-expanded={open && q.length >= 2} aria-controls="global-search-list"
        className="field-input h-9 bg-canvas pl-9 pr-14 [&::-webkit-search-cancel-button]:hidden" />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 text-[10px] font-medium text-ink-3 sm:block">Ctrl K</kbd>
      {open && q.trim().length >= 2 && (
        <div id="global-search-list" role="listbox" className="animate-pop-in absolute left-0 right-0 top-11 z-40 max-h-96 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          {state.loading && !state.results.length && <div className="flex items-center gap-2 px-3 py-3 text-sm text-ink-3"><Spinner className="size-4" />Đang tìm…</div>}
          {!state.loading && !state.results.length && <div className="px-3 py-3 text-sm text-ink-3">Không tìm thấy kết quả phù hợp.</div>}
          {state.results.map((r, i) => (
            <button key={`${r.type}-${r.id}`} type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => go(r)}
              className={clsx('flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left', i === active ? 'bg-brand-50' : 'hover:bg-canvas')}>
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{r.title}</span><span className="block truncate text-xs text-ink-3">{r.subtitle}</span></span>
              <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-[11px] text-ink-3">{TYPE[r.type]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi('/api/notifications');
  const navigate = useNavigate();
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);
  const unread = data?.unread || 0;
  const prevUnread = useRef(0);
  const [ring, setRing] = useState(false);
  useEffect(() => {
    if (unread > prevUnread.current) { setRing(true); const t = setTimeout(() => setRing(false), 700); prevUnread.current = unread; return () => clearTimeout(t); }
    prevUnread.current = unread;
    return undefined;
  }, [unread]);
  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) await api.post(`/api/notifications/${n.id}/read`).catch(() => {});
    reload();
    if (n.link) navigate(n.link);
  };
  return (
    <Popover.Root open={open} onOpenChange={(v) => { setOpen(v); if (v) reload(); }}>
      <Popover.Trigger asChild>
        <button type="button" className="relative inline-flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-canvas" aria-label={`Thông báo${unread ? `, ${unread} chưa đọc` : ''}`}>
          <Bell className={clsx('size-[18px] origin-top', ring && 'animate-shake')} />
          {unread > 0 && <span key={unread} className="absolute right-1 top-1 min-w-4 animate-pop-in rounded-full bg-army-red px-1 text-center text-[10px] font-semibold leading-4 text-white tabular ring-2 ring-surface">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="menu-anim z-50 w-[min(92vw,380px)] rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div><p className="text-sm font-semibold">Thông báo trong app</p><p className="text-xs text-ink-3">Chỉ hiển thị nội bộ, không gửi ra ngoài</p></div>
            {unread > 0 && <button type="button" onClick={async () => { await api.post('/api/notifications/read-all'); reload(); }} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><CheckCheck className="size-3.5" />Đánh dấu đã đọc</button>}
          </div>
          <ul className="scroll-thin max-h-[60vh] overflow-y-auto py-1">
            {!data?.items?.length && <li className="px-4 py-8 text-center text-sm text-ink-3">Không có thông báo.</li>}
            {data?.items?.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-canvas">
                  <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-500')} aria-hidden />
                  <span className="min-w-0">
                    <span className={clsx('block text-sm', n.read_at ? 'text-ink-2' : 'font-medium text-ink')}>{n.title}{!n.read_at && <span className="sr-only"> (chưa đọc)</span>}</span>
                    {n.body && <span className="block truncate text-xs text-ink-3">{n.body}</span>}
                    <span className="block text-[11px] text-ink-3">{dateTime(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AccountMenu({ user }) {
  const { logout, switchUser, demoMode } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data } = useApi(demoMode && user?.is_demo ? '/api/auth/demo-accounts' : null);
  const doSwitch = async (a) => {
    try { await switchUser(a.id); toast.success(`Đã chuyển sang tài khoản ${a.full_name} (${a.roleLabels.join(', ')}).`); navigate('/'); } catch (e) { toast.error(e.message); }
  };
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-md py-1 pl-1 pr-1.5 hover:bg-canvas" aria-label="Tài khoản">
          <Avatar name={user.full_name} size="sm" />
          <span className="hidden text-left leading-tight xl:block"><span className="block max-w-36 truncate text-[13px] font-medium">{user.full_name}</span><span className="block max-w-36 truncate text-[11px] text-ink-3">{user.roles.map((r) => ROLE_LABELS[r]).join(' · ')}</span></span>
          <ChevronDown className="hidden size-3.5 text-ink-3 xl:block" aria-hidden />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={8} className="menu-anim z-50 w-72 rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          <div className="px-3 py-2.5">
            <p className="text-sm font-semibold">{user.full_name}</p>
            <p className="text-xs text-ink-3">{user.title}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">{user.roles.map((r) => <span key={r} className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-800">{ROLE_LABELS[r]}</span>)}</div>
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item onSelect={() => navigate('/account')} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-canvas"><UserCog className="size-4 text-ink-3" />Tài khoản & phân quyền</DM.Item>
          {demoMode && data?.accounts?.length > 0 && (
            <DM.Sub>
              <DM.SubTrigger className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-canvas data-[state=open]:bg-canvas"><Repeat2 className="size-4 text-ink-3" />Chuyển nhanh tài khoản demo</DM.SubTrigger>
              <DM.Portal>
                <DM.SubContent sideOffset={6} className="menu-anim z-50 max-h-[70vh] w-72 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
                  <p className="px-3 py-2 text-[11px] text-ink-3">Chỉ có trong chế độ demo. Dữ liệu và menu thay đổi theo quyền của tài khoản.</p>
                  {data.accounts.map((a) => (
                    <DM.Item key={a.id} disabled={a.id === user.id} onSelect={() => doSwitch(a)} className="flex cursor-pointer flex-col items-start rounded-md px-3 py-2 outline-none data-[highlighted]:bg-canvas data-[disabled]:cursor-default data-[disabled]:bg-brand-50/60">
                      <span className="text-sm font-medium">{a.full_name}{a.id === user.id && ' (đang dùng)'}</span>
                      <span className="text-xs text-ink-3">{a.roleLabels.join(' · ')}</span>
                    </DM.Item>
                  ))}
                </DM.SubContent>
              </DM.Portal>
            </DM.Sub>
          )}
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item onSelect={async () => { await logout(); navigate('/login'); }} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-red-700 outline-none data-[highlighted]:bg-red-50"><LogOut className="size-4" />Đăng xuất</DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
