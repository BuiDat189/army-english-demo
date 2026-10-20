import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './schema.js';
import { nowIso } from '../lib/time.js';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Sinh mã tăng dần theo tiền tố, ví dụ PT-000123. Gọi trong transaction để không trùng. */
export function nextCode(db, name, prefix, width = 5) {
  const row = db.prepare('INSERT INTO counters(name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value').get(name);
  return `${prefix}${String(row.value).padStart(width, '0')}`;
}

export function logActivity(db, { entityType, entityId, action, summary, userId }) {
  db.prepare('INSERT INTO activity_log(entity_type, entity_id, action, summary, user_id, created_at) VALUES (?,?,?,?,?,?)')
    .run(entityType, entityId, action, summary, userId ?? null, nowIso());
}

/** Thông báo trong app (chuông). dedupe_key giúp chạy lại không sinh trùng. */
export function notify(db, userId, { title, body = null, link = null, dedupeKey = null }) {
  if (!userId) return;
  db.prepare(`INSERT INTO notifications(user_id, title, body, link, dedupe_key, created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id, dedupe_key) DO NOTHING`).run(userId, title, body, link, dedupeKey, nowIso());
}

export function usersWithRole(db, role) {
  return db.prepare(`SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role = ? AND u.status = 'active'`).all(role).map((r) => r.id);
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
