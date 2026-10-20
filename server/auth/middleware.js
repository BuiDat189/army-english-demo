import { permissionsFor } from './permissions.js';
import { HttpError } from '../lib/http.js';

export function loadUser(db) {
  const userStmt = db.prepare(`SELECT id, code, full_name, title, email, phone, status, is_demo FROM users WHERE id = ?`);
  const rolesStmt = db.prepare('SELECT role FROM user_roles WHERE user_id = ? ORDER BY role');
  return (req, _res, next) => {
    const id = req.session?.userId;
    if (id) {
      const u = userStmt.get(id);
      if (u && u.status === 'active') {
        const roles = rolesStmt.all(id).map((r) => r.role);
        req.user = { ...u, roles, perms: permissionsFor(roles) };
      }
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'));
  next();
}

/** Cần ÍT NHẤT MỘT trong các quyền */
export function can(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'));
    if (!perms.some((p) => req.user.perms.has(p))) {
      return next(new HttpError(403, 'Bạn không có quyền thực hiện thao tác này.'));
    }
    next();
  };
}

export const has = (user, perm) => !!user?.perms?.has(perm);

/** Chống CSRF đơn giản: yêu cầu ghi dữ liệu phải gửi kèm header do fetch của app đặt. */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'army-app') {
    return next(new HttpError(403, 'Yêu cầu không hợp lệ (thiếu header ứng dụng).'));
  }
  next();
}
