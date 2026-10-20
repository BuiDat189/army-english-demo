import request from 'supertest';
import { openDb } from '../server/db/index.js';
import { createApp } from '../server/app.js';
import { seedDemo, DEMO_PASSWORD } from '../server/db/seed.js';

/** Tạo app với DB trong bộ nhớ, đã seed dữ liệu demo. */
export function makeApp({ demoMode = true } = {}) {
  const db = openDb(':memory:');
  seedDemo(db);
  const config = { root: process.cwd(), demoMode, sessionSecret: 'test-secret-test-secret-123456', secureCookie: false, timezone: 'Asia/Ho_Chi_Minh', env: 'test' };
  const app = createApp({ db, config });
  return { db, app, config };
}

/** Đăng nhập, trả về agent giữ cookie + hàm gọi kèm header chống CSRF */
export async function login(app, username, password = DEMO_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'army-app').send({ username, password });
  if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  const wrap = (method) => (url) => agent[method](url).set('X-Requested-With', 'army-app');
  return { agent, get: wrap('get'), post: wrap('post'), put: wrap('put'), del: wrap('delete') };
}
