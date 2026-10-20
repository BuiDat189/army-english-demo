import session from 'express-session';

/** Lưu phiên đăng nhập trong SQLite để khởi động lại server không mất phiên. */
export class SqliteSessionStore extends session.Store {
  constructor(db, { ttlMs = 1000 * 60 * 60 * 12 } = {}) {
    super();
    this.db = db;
    this.ttlMs = ttlMs;
    this.getStmt = db.prepare('SELECT sess, expires_at FROM app_sessions WHERE sid = ?');
    this.setStmt = db.prepare('INSERT INTO app_sessions(sid, sess, expires_at) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at');
    this.delStmt = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE app_sessions SET expires_at = ? WHERE sid = ?');
    this.pruneStmt = db.prepare('DELETE FROM app_sessions WHERE expires_at < ?');
    this.pruneTimer = setInterval(() => this.pruneStmt.run(Date.now()), 10 * 60 * 1000);
    this.pruneTimer.unref?.();
  }
  expiry(sess) {
    const exp = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + this.ttlMs;
    return exp;
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row || row.expires_at < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { this.setStmt.run(sid, JSON.stringify(sess), this.expiry(sess)); cb?.(null); } catch (e) { cb?.(e); }
  }
  destroy(sid, cb) {
    try { this.delStmt.run(sid); cb?.(null); } catch (e) { cb?.(e); }
  }
  touch(sid, sess, cb) {
    try { this.touchStmt.run(this.expiry(sess), sid); cb?.(null); } catch (e) { cb?.(e); }
  }
  clearAll() { this.db.prepare('DELETE FROM app_sessions').run(); }
}
