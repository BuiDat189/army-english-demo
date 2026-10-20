// npm run seed — khởi tạo lại dữ liệu demo (xóa dữ liệu demo cũ).
import { config } from '../config.js';
import { openDb } from './index.js';
import { seedDemo } from './seed.js';

if (!config.demoMode && !process.argv.includes('--force')) {
  console.error('DEMO_MODE=false: từ chối seed dữ liệu demo. Dùng --force nếu thật sự muốn.');
  process.exit(1);
}
const db = openDb(config.dbFile);
const t = Date.now();
seedDemo(db);
const count = (t2) => db.prepare(`SELECT COUNT(*) n FROM ${t2}`).get().n;
console.log(`Đã seed dữ liệu demo vào ${config.dbFile} trong ${Date.now() - t} ms`);
console.log(`  Nhân sự ${count('users')} · Học viên ${count('students')} · Phụ huynh ${count('parents')} · Khách ${count('leads')} · Lớp ${count('classes')} · Buổi học ${count('class_sessions')} · Phiếu thu ${count('receipts')}`);
db.close();
