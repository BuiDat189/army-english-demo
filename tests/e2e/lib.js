// Hạ tầng kiểm thử trình duyệt: chạy server thật trên DB tạm (cổng ngẫu nhiên) + Chrome ẩn có sẵn trên máy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { openDb } from '../../server/db/index.js';
import { createApp } from '../../server/app.js';
import { seedDemo, DEMO_PASSWORD } from '../../server/db/seed.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

export async function startServer() {
  if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) throw new Error('Chưa build frontend. Chạy: npm run build');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'army-e2e-'));
  const db = openDb(path.join(dir, 'e2e.sqlite'));
  seedDemo(db);
  const config = { root: ROOT, demoMode: true, sessionSecret: 'e2e-secret-e2e-secret-e2e-1234', secureCookie: false, timezone: 'Asia/Ho_Chi_Minh', env: 'test' };
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, db, close: () => new Promise((r) => { server.close(() => { db.close(); r(); }); }) };
}

export async function launch() {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('Không tìm thấy Chrome/Chromium. Đặt biến CHROME_PATH.');
  return chromium.launch({ executablePath, headless: true, args: ['--disable-gpu', '--no-first-run'] });
}

/** Mở context đã đăng nhập sẵn bằng tài khoản demo */
export async function loggedInPage(browser, baseUrl, username, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const res = await ctx.request.post(`${baseUrl}/api/auth/login`, { headers: { 'X-Requested-With': 'army-app' }, data: { username, password: DEMO_PASSWORD } });
  if (!res.ok()) throw new Error(`Đăng nhập ${username} thất bại: ${res.status()}`);
  return { ctx, page, errors };
}

export async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(150);
}

/** Đo tràn ngang trang & phần tử bị cắt khỏi viewport */
export async function layoutIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) issues.push(`Trang tràn ngang: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const st = getComputedStyle(el);
      if (st.position === 'fixed') continue;
      let p = el.parentElement; let clipped = false;
      while (p && p !== document.body) { const ps = getComputedStyle(p); if (ps.overflowX === 'auto' || ps.overflowX === 'scroll' || ps.overflowX === 'hidden') { clipped = true; break; } p = p.parentElement; }
      if (!clipped && r.right > vw + 2) { issues.push(`Phần tử vượt mép phải: <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> right=${Math.round(r.right)}`); if (issues.length > 6) break; }
    }
    return issues;
  });
}

export { ROOT, DEMO_PASSWORD };
