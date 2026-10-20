import { config } from './config.js';
import { openDb, getMeta } from './db/index.js';
import { createApp } from './app.js';
import { seedDemo } from './db/seed.js';
import { runReminders } from './services/reminders.js';

if (config.env === 'production' && !config.demoMode && (!config.sessionSecret || config.sessionSecret.length < 24)) {
  console.error('SESSION_SECRET (>= 24 ký tự) là bắt buộc khi chạy production ngoài chế độ demo.');
  process.exit(1);
}
if (config.env === 'production' && config.demoMode) {
  console.warn('[cảnh báo] Đang chạy production với DEMO_MODE=true: tài khoản demo, chuyển nhanh tài khoản và nút reset vẫn bật.');
}

const db = openDb(config.dbFile);
if (!getMeta(db, 'demo_seeded_at') && db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  if (config.demoMode) {
    console.log('[seed] Database trống — khởi tạo dữ liệu demo…');
    seedDemo(db);
  } else {
    console.warn('[seed] Database trống và DEMO_MODE=false: không tự tạo dữ liệu demo.');
  }
}

// Quét nhắc việc định kỳ (an toàn khi chạy lại, không sinh trùng)
try { runReminders(db); } catch (e) { console.error('[reminders]', e); }
setInterval(() => { try { runReminders(db); } catch (e) { console.error('[reminders]', e); } }, 60 * 60 * 1000).unref();

const app = createApp({ db, config });
app.listen(config.port, config.host, () => {
  console.log(`ARMY ENGLISH demo API: http://${config.host}:${config.port}  (DEMO_MODE=${config.demoMode})`);
});
