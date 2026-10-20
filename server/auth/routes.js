import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { parse, HttpError, forbidden } from '../lib/http.js';
import { requireAuth } from './middleware.js';
import { ROLES, describeRoles } from './permissions.js';
import { DEMO_PASSWORD } from '../db/seed.js';

const attempts = new Map(); // khóa tạm khi đăng nhập sai nhiều lần

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
}
function save(req) {
  return new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
}

export function authRoutes({ db, config }) {
  const r = Router();

  r.get('/config', (_req, res) => {
    res.json({ demoMode: config.demoMode, timezone: config.timezone });
  });

  // Danh sách tài khoản demo (chỉ khi bật chế độ demo). Mật khẩu demo là thông tin công khai của bản demo.
  r.get('/demo-accounts', (_req, res) => {
    if (!config.demoMode) return res.json({ accounts: [] });
    const rows = db.prepare(`SELECT u.id, u.username, u.full_name, u.title, group_concat(r.role) roles
      FROM users u JOIN user_roles r ON r.user_id = u.id
      WHERE u.is_demo = 1 AND u.status = 'active' AND u.username IS NOT NULL GROUP BY u.id ORDER BY u.id`).all();
    res.json({
      password: DEMO_PASSWORD,
      accounts: rows.map((x) => ({ ...x, roles: x.roles.split(','), roleLabels: x.roles.split(',').map((k) => ROLES[k]) })),
    });
  });

  r.post('/login', async (req, res) => {
    const body = parse(z.object({
      username: z.string().trim().min(1, 'Vui lòng nhập tên đăng nhập.').max(60),
      password: z.string().min(1, 'Vui lòng nhập mật khẩu.').max(200),
    }), req.body);
    const key = `${req.ip}|${body.username.toLowerCase()}`;
    const a = attempts.get(key);
    if (a && a.count >= 5 && Date.now() - a.at < 60_000) {
      throw new HttpError(429, 'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau 1 phút.');
    }
    const user = db.prepare('SELECT id, password_hash, status, is_demo FROM users WHERE username = ? COLLATE NOCASE').get(body.username);
    const ok = user && user.password_hash && user.status === 'active' && (await bcrypt.compare(body.password, user.password_hash));
    if (!ok || (user.is_demo && !config.demoMode)) {
      attempts.set(key, { count: (a && Date.now() - a.at < 60_000 ? a.count : 0) + 1, at: Date.now() });
      throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    attempts.delete(key);
    await regenerate(req);
    req.session.userId = user.id;
    await save(req);
    res.json({ ok: true });
  });

  r.post('/logout', async (req, res) => {
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie('army.sid');
    res.json({ ok: true });
  });

  // Chuyển nhanh tài khoản demo — CHỈ bật trong chế độ demo, chỉ giữa các tài khoản demo.
  r.post('/switch', requireAuth, async (req, res) => {
    if (!config.demoMode) throw forbidden('Chuyển nhanh tài khoản chỉ có trong chế độ demo.');
    if (!req.user.is_demo) throw forbidden('Chỉ tài khoản demo mới được chuyển nhanh.');
    const id = Number(req.body?.userId);
    const target = db.prepare(`SELECT id FROM users WHERE id = ? AND is_demo = 1 AND status = 'active' AND username IS NOT NULL`).get(id);
    if (!target) throw new HttpError(404, 'Không tìm thấy tài khoản demo.');
    await regenerate(req);
    req.session.userId = target.id;
    await save(req);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, (req, res) => {
    const u = req.user;
    res.json({
      user: { id: u.id, code: u.code, full_name: u.full_name, title: u.title, email: u.email, is_demo: !!u.is_demo, roles: u.roles, roleLabels: u.roles.map((k) => ROLES[k]) },
      permissions: [...u.perms],
      demoMode: config.demoMode,
    });
  });

  r.get('/roles', requireAuth, (_req, res) => res.json({ roles: describeRoles() }));

  return r;
}
