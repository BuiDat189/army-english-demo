// Gọi API thật của backend. Header X-Requested-With dùng cho chống CSRF phía server.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Lỗi ${status}`);
    this.status = status;
    this.fields = body?.fields || null;
    this.conflicts = body?.conflicts || null;
    this.body = body;
  }
}

const listeners = new Set();
export function onUnauthorized(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request(method, url, body, { idempotencyKey } = {}) {
  const headers = { 'X-Requested-With': 'army-app', Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, { error: 'Không kết nối được máy chủ. Kiểm tra mạng hoặc server đang chạy.' });
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; } }
  if (!res.ok) {
    // Cổng mã truy cập (bản demo đưa ra ngoài): hết hạn thì quay lại trang nhập mã
    if (res.status === 401 && data?.accessRequired) {
      window.location.assign(`/access?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    if (res.status === 401 && !url.startsWith('/api/auth/login')) listeners.forEach((fn) => fn());
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}, opts) => request('POST', url, body, opts),
  put: (url, body = {}, opts) => request('PUT', url, body, opts),
  del: (url) => request('DELETE', url),
};

/** Ghép query string, bỏ qua giá trị rỗng */
export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
