import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthorized } from './api.js';

const AuthCtx = createContext(null);
const LookupCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, permissions: new Set(), demoMode: false });
  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/api/auth/me');
      setState({ loading: false, user: me.user, permissions: new Set(me.permissions), demoMode: me.demoMode });
    } catch {
      const cfg = await api.get('/api/auth/config').catch(() => ({ demoMode: false }));
      setState({ loading: false, user: null, permissions: new Set(), demoMode: cfg.demoMode });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => onUnauthorized(() => setState((s) => ({ ...s, user: null, permissions: new Set() }))), []);

  const value = useMemo(() => ({
    ...state,
    can: (...perms) => perms.some((p) => state.permissions.has(p)),
    login: async (username, password) => { await api.post('/api/auth/login', { username, password }); await refresh(); },
    logout: async () => { await api.post('/api/auth/logout').catch(() => {}); setState((s) => ({ ...s, user: null, permissions: new Set() })); },
    switchUser: async (userId) => { await api.post('/api/auth/switch', { userId }); await refresh(); },
    refresh,
  }), [state, refresh]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

/** Danh mục dùng chung (nhân sự, phòng, khóa học, lớp) — nạp một lần sau đăng nhập */
export function LookupProvider({ children }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    if (!user) { setData(null); return; }
    try { setData(await api.get('/api/lookups')); } catch { /* hiển thị lỗi ở từng trang */ }
  }, [user]);
  useEffect(() => { load(); }, [load]);
  const value = useMemo(() => ({
    ...(data || { staff: [], rooms: [], courses: [], classes: [], leadSources: [] }),
    ready: !!data,
    reload: load,
    staffBy: (id) => data?.staff.find((s) => s.id === Number(id)),
    teachers: (data?.staff || []).filter((s) => s.status === 'active' && s.roles.includes('teacher')),
    activeStaff: (data?.staff || []).filter((s) => s.status === 'active'),
  }), [data, load]);
  return <LookupCtx.Provider value={value}>{children}</LookupCtx.Provider>;
}
export const useLookups = () => useContext(LookupCtx);
