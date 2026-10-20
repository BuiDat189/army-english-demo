import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { openDb } from '../server/db/index.js';
import { createApp } from '../server/app.js';
import { seedDemo, DEMO_PASSWORD } from '../server/db/seed.js';

function appWithCode(code) {
  const db = openDb(':memory:');
  seedDemo(db);
  return createApp({ db, config: { root: process.cwd(), demoMode: true, sessionSecret: 'test-secret-test-secret-123456', secureCookie: false, accessCode: code } });
}

describe('Cổng mã truy cập', () => {
  it('chặn trang và API khi chưa nhập mã; nhập sai bị từ chối; đúng mã thì vào được', async () => {
    const app = appWithCode('AE-TEST-2026');
    const page = await request(app).get('/students/1');
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/access?next=%2Fstudents%2F1');
    expect((await request(app).get('/api/auth/demo-accounts')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').set('X-Requested-With', 'army-app').send({ username: 'quanly', password: DEMO_PASSWORD })).status).toBe(401);
    expect((await request(app).get('/api/health')).status).toBe(200);

    const bad = await request(app).post('/access').type('form').send({ code: 'sai', next: '/' });
    expect(bad.status).toBe(401);
    expect(bad.text).toContain('Mã truy cập không đúng');

    const agent = request.agent(app);
    const ok = await agent.post('/access').type('form').send({ code: 'ae-test-2026', next: '//evil.example.com' });
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe('/'); // không chuyển hướng ra ngoài
    expect(ok.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    const login = await agent.post('/api/auth/login').set('X-Requested-With', 'army-app').send({ username: 'quanly', password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    expect((await agent.get('/api/students').set('X-Requested-With', 'army-app')).status).toBe(200);
  });

  it('không đặt ACCESS_CODE thì không có cổng', async () => {
    const app = appWithCode('');
    expect((await request(app).get('/api/auth/config')).status).toBe(200);
  });
});
