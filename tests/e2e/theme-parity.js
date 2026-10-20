// Soát bảng màu nền tối: mọi biến màu/bóng khai trong @theme (nền sáng) phải được khai lại trong
// :root[data-theme="dark"]. Thiếu biến nào thì biến đó lặng lẽ giữ màu nền sáng ⇒ chữ/thẻ vô hình.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.js';

const css = fs.readFileSync(path.join(ROOT, 'client/src/index.css'), 'utf8');
const block = (start) => { const i = css.indexOf(start); const j = css.indexOf('\n}', i); return css.slice(i, j); };
const vars = (txt) => new Set([...txt.matchAll(/(--(?:color|shadow)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const light = vars(block('@theme {'));
const dark = vars(block(':root[data-theme="dark"]'));
const missing = [...light].filter((v) => !dark.has(v));
console.log(`Biến nền sáng: ${light.size} · đã khai lại cho nền tối: ${light.size - missing.length}`);
if (missing.length) { console.log('THIẾU ở nền tối:', missing.join(', ')); process.exitCode = 1; } else console.log('Đủ — không thiếu biến nào.');
