import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Nạp .env nếu có (Node >= 20.12 có sẵn process.loadEnvFile, không cần dotenv)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && !process.env.VITEST) {
  process.loadEnvFile(envFile);
}

const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const isCloud = Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);

export const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || (isCloud ? '0.0.0.0' : '127.0.0.1'),
  dbFile: process.env.DB_FILE ? path.resolve(ROOT, process.env.DB_FILE) : path.join(ROOT, 'data', 'army-demo.sqlite'),
  // Chế độ demo: bật tài khoản demo, chuyển nhanh tài khoản, nút reset. Phải tắt khi không phải môi trường demo.
  demoMode: bool(process.env.DEMO_MODE, true),
  // Để trống: server tự sinh một secret ngẫu nhiên và lưu trong bảng meta của DB local (không nằm trong repo).
  sessionSecret: process.env.SESSION_SECRET || '',
  secureCookie: bool(process.env.COOKIE_SECURE, false),
  // Mã truy cập chung trước trang đăng nhập (khi đưa demo ra ngoài). Để trống = tắt.
  accessCode: (process.env.ACCESS_CODE || '').trim().toUpperCase(),
  timezone: 'Asia/Ho_Chi_Minh',
};
