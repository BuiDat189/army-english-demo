// Đóng gói tài liệu hướng dẫn: bản HTML mở trực tiếp + bản PDF A4 (Chrome ẩn).
// Chạy: node tests/e2e/guide-pdf.js   (cần ảnh ở docs/huong-dan/img — tạo bằng guide-shots.js)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, ROOT } from './lib.js';

const DIR = path.join(ROOT, 'docs', 'huong-dan');
const body = fs.readFileSync(path.join(DIR, 'huong-dan.html'), 'utf8');
const full = `<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
const htmlFile = path.join(DIR, 'HUONG-DAN-SU-DUNG.html');
fs.writeFileSync(htmlFile, full);

const browser = await launch();
const shots = process.argv.includes('--shots');
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Ảnh lazy-load: nạp hết trước khi in
  await page.evaluate(async () => {
    for (const img of document.images) img.loading = 'eager';
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  });
  const broken = await page.evaluate(() => [...document.images].filter((i) => i.closest('figure') && !i.naturalWidth).map((i) => i.getAttribute('src')));
  if (broken.length) console.log('Ảnh lỗi:', broken.join(', '));
  if (shots) {
    const out = process.argv[process.argv.indexOf('--shots') + 1];
    await page.screenshot({ path: path.join(out, 'doc_desktop.png') });
    await page.evaluate(() => document.getElementById('cm').scrollIntoView());
    await page.screenshot({ path: path.join(out, 'doc_desktop_role.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, 'doc_mobile.png') });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log('Bề rộng trang ở 390px:', wide);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  const pdf = path.join(ROOT, 'docs', 'HUONG-DAN-SU-DUNG.pdf');
  await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#5d6878;padding:0 12mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>ARMY ENGLISH – Hướng dẫn sử dụng</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>' });
  console.log(`HTML: ${htmlFile}\nPDF: ${pdf} (${Math.round(fs.statSync(pdf).size / 1024)} KB)`);
} finally {
  await browser.close();
}
