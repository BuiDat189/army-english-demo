import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from './api.js';

/**
 * Tải dữ liệu từ API. Giữ dữ liệu cũ khi đang tải lại (không nhấp nháy),
 * bỏ qua phản hồi đến muộn của yêu cầu cũ.
 */
export function useApi(url, { keepPrevious = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !!url });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) { setState({ data: null, error: null, loading: false }); return; }
    const my = ++seq.current;
    setState((s) => ({ data: keepPrevious ? s.data : null, error: null, loading: true }));
    try {
      const data = await api.get(url);
      if (my === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (my === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, [url, keepPrevious]);
  useEffect(() => { load(); }, [load]);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload: load, setData };
}

/** Bộ lọc lưu trên URL: chia sẻ link/nhấn thẻ thống kê mở đúng bộ lọc, reload không mất. */
export function useUrlFilters(defaults = {}) {
  const [params, setParams] = useSearchParams();
  const values = { ...defaults };
  for (const k of Object.keys(defaults)) if (params.has(k)) values[k] = params.get(k);
  for (const [k, v] of params.entries()) if (!(k in values)) values[k] = v;
  const set = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '' || v === defaults[k]) next.delete(k); else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }, [setParams]); // eslint-disable-line react-hooks/exhaustive-deps
  return [values, set];
}

export function useMediaQuery(q) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}
