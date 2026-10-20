import crypto from 'node:crypto';

// Cổng mã truy cập chung: chặn MỌI yêu cầu (trang, tệp, API) trước khi tới trang đăng nhập.
// Chỉ bật khi đặt biến ACCESS_CODE — dùng khi đưa bản demo ra ngoài qua đường hầm/hosting.
const COOKIE = 'army_access';
const PUBLIC = new Set(['/access', '/army-logo.png', '/favicon.png', '/api/health']);
const tries = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page({ error = '', next = '/' } = {}) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ARMY ENGLISH – Mã truy cập</title><link rel="icon" href="/favicon.png">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font-family:system-ui,"Segoe UI",Roboto,Arial,sans-serif;
background:radial-gradient(circle at 1px 1px,rgb(255 255 255/.06) 1px,transparent 0) 0 0/18px 18px,linear-gradient(160deg,#15233d,#0c1628);color:#101828}
.card{width:100%;max-width:400px;background:#fff;border-radius:16px;padding:28px;box-shadow:0 24px 60px -20px rgb(0 0 0/.6);animation:rise .4s cubic-bezier(.22,1,.36,1) both}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
img{height:40px;width:auto}h1{font-size:20px;margin:20px 0 4px}p{margin:0 0 18px;color:#5b6962;font-size:14px;line-height:1.5}
label{display:block;font-size:13px;font-weight:600;color:#39473f;margin-bottom:6px}
input{width:100%;height:44px;border:1px solid #cbd3cf;border-radius:8px;padding:0 12px;font-size:16px;letter-spacing:.08em;text-transform:uppercase}
input:focus{outline:none;border-color:#2d904f;box-shadow:0 0 0 3px rgb(45 144 79/.2)}
button{margin-top:14px;width:100%;height:44px;border:0;border-radius:8px;background:#1f7a40;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
button:hover{background:#19683a}.err{margin-top:10px;color:#b91c1c;font-size:13px;font-weight:600}.foot{margin-top:18px;font-size:12px;color:#5b6962}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
</style></head><body><main class="card">
<img src="/army-logo.png" alt="ARMY ENGLISH" width="151" height="40">
<h1>Bản trình diễn nội bộ</h1><p>Nhập mã truy cập được gửi kèm đường link để xem bản demo.</p>
<form method="post" action="/access"><input type="hidden" name="next" value="${esc(next)}">
<label for="code">Mã truy cập</label><input id="code" name="code" autocomplete="off" autofocus required ${error ? 'aria-invalid="true" aria-describedby="e"' : ''}>
${error ? `<div class="err" id="e" role="alert">${esc(error)}</div>` : ''}
<button type="submit">Vào bản demo</button></form>
<div class="foot">Toàn bộ dữ liệu trong bản demo là dữ liệu giả.</div></main></body></html>`;
}

export function accessGate({ code, secret }) {
  const token = crypto.createHmac('sha256', secret).update(`access:${code}`).digest('hex');
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const readCookie = (req) => {
    const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
  };
  const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

  return (req, res, next) => {
    if (req.path === '/access' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const ip = req.ip;
        const t = tries.get(ip);
        if (t && t.n >= 8 && Date.now() - t.at < 10 * 60_000) {
          res.status(429).type('html').send(page({ error: 'Nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.', next: safeNext(form.get('next')) }));
          return;
        }
        const given = String(form.get('code') || '').trim().toUpperCase();
        if (given && same(crypto.createHmac('sha256', secret).update(`access:${given}`).digest('hex'), token)) {
          tries.delete(ip);
          res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 24 * 3600 * 1000 });
          res.redirect(303, safeNext(form.get('next')));
          return;
        }
        tries.set(ip, { n: (t && Date.now() - t.at < 10 * 60_000 ? t.n : 0) + 1, at: Date.now() });
        res.status(401).type('html').send(page({ error: 'Mã truy cập không đúng.', next: safeNext(form.get('next')) }));
      });
      return;
    }
    if (req.path === '/access') return res.type('html').send(page({ next: safeNext(req.query.next) }));
    if (PUBLIC.has(req.path)) return next();
    if (same(readCookie(req), token)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Cần mã truy cập để xem bản demo.', accessRequired: true });
    return res.redirect(302, `/access?next=${encodeURIComponent(req.originalUrl)}`);
  };
}
