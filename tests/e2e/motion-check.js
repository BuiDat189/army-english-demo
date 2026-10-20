// Đo hiệu ứng có CHẠY thật không (không kết luận từ mã): liệt kê animation đang chạy ngay sau khi tải,
// và kiểm tra khi bật "giảm chuyển động" thì mọi animation kết thúc gần như tức thì.
import { startServer, launch, loggedInPage } from './lib.js';

const srv = await startServer();
const browser = await launch();
const probe = async (page, label) => {
  const r = await page.evaluate(() => {
    const anims = document.getAnimations();
    const names = {};
    let maxDur = 0;
    for (const a of anims) {
      const n = a.animationName || a.constructor.name;
      names[n] = (names[n] || 0) + 1;
      const d = a.effect?.getComputedTiming?.().duration;
      if (typeof d === 'number') maxDur = Math.max(maxDur, d);
    }
    return { count: anims.length, names, maxDur };
  });
  console.log(`${label}: ${r.count} animation · dài nhất ${Math.round(r.maxDur)}ms · ${Object.entries(r.names).map(([k, v]) => `${k}×${v}`).join(', ')}`);
  return r;
};
let fail = 0;
try {
  for (const reduce of [false, true]) {
    const { ctx, page } = await loggedInPage(browser, srv.url, 'quanly');
    if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${srv.url}/`);
    await page.waitForSelector('[aria-label^="Học viên đang học"]');
    const a = await probe(page, reduce ? 'Giảm chuyển động · Tổng quan' : 'Bình thường · Tổng quan');
    await page.goto(`${srv.url}/students/1?tab=finance`);
    await page.getByRole('button', { name: 'Đề nghị hoàn' }).first().click();
    const b = await probe(page, reduce ? 'Giảm chuyển động · mở modal' : 'Bình thường · mở modal');
    if (!reduce && (a.count < 5 || b.count < 1)) { console.log('  ✗ hiệu ứng không chạy như kỳ vọng'); fail++; }
    if (reduce && (a.maxDur > 1 || b.maxDur > 1)) { console.log('  ✗ còn hiệu ứng dài khi bật giảm chuyển động'); fail++; }
    await ctx.close();
  }
} finally {
  await browser.close();
  await srv.close();
}
console.log(fail ? `Có ${fail} lỗi` : 'Hiệu ứng chạy khi bình thường, tắt khi giảm chuyển động.');
process.exitCode = fail ? 1 : 0;
