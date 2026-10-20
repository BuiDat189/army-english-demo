// Chụp ảnh các trang để kiểm tra bố cục bằng mắt.
// node tests/e2e/shoot.js --user quanly --pages /,/leads --widths 1440,390 --out shots
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launch, loggedInPage, settle, layoutIssues, ROOT } from './lib.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const user = arg('user', 'quanly');
const pages = arg('pages', '/').split(',');
const widths = arg('widths', '1440').split(',').map(Number);
const out = path.resolve(ROOT, arg('out', 'tests/e2e/shots'));
const full = process.argv.includes('--full');
const actions = arg('click', '');
const theme = arg('theme', '');

fs.mkdirSync(out, { recursive: true });
const srv = await startServer();
const browser = await launch();
let failed = 0;
try {
  for (const w of widths) {
    const anon = process.argv.includes('--anon');
    const { ctx, page, errors } = anon
      ? await (async () => { const c = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, locale: 'vi-VN' }); const pg = await c.newPage(); const er = []; pg.on('pageerror', (e) => er.push(e.message)); return { ctx: c, page: pg, errors: er }; })()
      : await loggedInPage(browser, srv.url, user, { width: w, height: w < 500 ? 844 : 900 });
    if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('army.theme', t); } catch { /* bỏ qua */ } }, theme);
    for (const p of pages) {
      await page.goto(srv.url + p);
      await settle(page);
      if (actions) for (const sel of actions.split('|')) { await page.click(sel).catch((e) => console.log('click fail', sel, e.message.split('\n')[0])); await settle(page); }
      await page.waitForTimeout(900); // chờ hiệu ứng xuất hiện / số chạy kết thúc
      const name = `${user}_${p.replace(/[^a-z0-9]+/gi, '_') || 'root'}_${w}${theme ? `_${theme}` : ''}.png`;
      await page.screenshot({ path: path.join(out, name), fullPage: full });
      const issues = await layoutIssues(page);
      console.log(`${name}  ${issues.length ? `⚠ ${issues.join(' | ')}` : 'bố cục OK'}${errors.length ? `  console: ${errors.splice(0).join(' | ')}` : ''}`);
      if (issues.length) failed++;
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await srv.close();
}
process.exitCode = failed ? 1 : 0;
