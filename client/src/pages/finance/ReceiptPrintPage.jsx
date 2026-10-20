import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { applyTheme } from '../../lib/theme.js';
import clsx from 'clsx';
import { ArrowLeft, Printer } from 'lucide-react';
import { useApi } from '../../lib/hooks.js';
import { money, date, dateTime } from '../../lib/format.js';
import { METHODS } from '../../lib/labels.js';
import { Button, Card, ErrorState, LoadingRows, StatusBadge } from '../../components/ui/index.js';

// Đọc số tiền bằng chữ tiếng Việt
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function readTriple(n, full) {
  const h = Math.floor(n / 100); const t = Math.floor((n % 100) / 10); const u = n % 10;
  const out = [];
  if (full || h) out.push(`${DIGITS[h]} trăm`);
  if (t === 0 && u) { if (full || h) out.push('lẻ'); } else if (t === 1) out.push('mười'); else if (t > 1) out.push(`${DIGITS[t]} mươi`);
  if (u) out.push(u === 1 && t > 1 ? 'mốt' : u === 5 && t > 0 ? 'lăm' : u === 4 && t > 1 ? 'tư' : DIGITS[u]);
  return out.join(' ');
}
export function moneyInWords(n) {
  if (!n) return 'Không đồng';
  const units = ['', ' nghìn', ' triệu', ' tỷ'];
  const groups = [];
  let x = n;
  while (x > 0) { groups.push(x % 1000); x = Math.floor(x / 1000); }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    parts.push(readTriple(groups[i], i < groups.length - 1) + units[i % 4]);
  }
  const s = `${parts.join(' ')} đồng`.replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Mẫu phiếu thu nội bộ (xem/in). Không phải hóa đơn điện tử. */
export default function ReceiptPrintPage({ embedded }) {
  const { id } = useParams();
  // Chứng từ giấy: bản in riêng luôn nền sáng; trong app thì chỉ chuyển sáng lúc bấm in
  useEffect(() => {
    const root = document.documentElement;
    const light = () => { root.dataset.theme = 'light'; };
    const back = () => applyTheme();
    if (!embedded) light();
    window.addEventListener('beforeprint', light);
    window.addEventListener('afterprint', back);
    return () => { window.removeEventListener('beforeprint', light); window.removeEventListener('afterprint', back); back(); };
  }, [embedded]);
  const { data, error, loading, reload } = useApi(`/api/finance/receipts/${id}`);
  if (error && !data) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card>{loading && <LoadingRows />}</Card>;
  const r = data.receipt;
  const cancelled = r.status === 'cancelled';
  return (
    <div className={clsx(!embedded && 'min-h-dvh bg-canvas p-4 sm:p-8 print:bg-surface print:p-0')}>
      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-2">
        {embedded ? <Link to="/finance?tab=receipts" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />Danh sách phiếu thu</Link> : <span />}
        <div className="flex gap-2">
          {embedded && <Button variant="secondary" onClick={() => window.open(`/finance/receipts/${r.id}/print`, '_blank', 'noopener')}>Mở bản in</Button>}
          <Button icon={Printer} onClick={() => window.print()}>In phiếu</Button>
        </div>
      </div>
      <article className="relative mx-auto max-w-3xl overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10 print:max-w-none print:rounded-none print:border-0">
        {cancelled && <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden><span className="-rotate-12 rounded-lg border-4 border-red-500/60 px-6 py-2 text-5xl font-bold tracking-widest text-red-500/50">ĐÃ HỦY</span></div>}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <span className="inline-flex rounded-lg bg-[#fff] px-2 py-1"><img src="/army-logo.png" alt="ARMY ENGLISH" width="151" height="40" className="h-10 w-auto" /></span>
            <p className="mt-2 text-xs text-ink-3">Hệ thống Anh ngữ ARMY ENGLISH · Chi nhánh demo</p>
          </div>
          <div className="text-right text-sm">
            <p>Số: <b className="tabular">{r.code}</b></p>
            <p>Ngày thu: <b className="tabular">{date(r.paid_at)}</b></p>
            <div className="mt-1"><StatusBadge kind="receipt" value={r.status} /></div>
          </div>
        </header>
        <h1 className="mt-6 text-center text-2xl font-bold tracking-wide">PHIẾU THU NỘI BỘ</h1>
        <p className="mt-1 text-center text-xs font-medium uppercase tracking-wider text-red-700">Chứng từ nội bộ — không phải hóa đơn điện tử</p>
        <dl className="mt-8 grid grid-cols-[150px_1fr] gap-y-3 text-sm sm:grid-cols-[190px_1fr]">
          <dt className="text-ink-3">Học viên</dt><dd className="font-medium">{r.student_name} ({r.student_code})</dd>
          <dt className="text-ink-3">Người nộp tiền</dt><dd>{r.payer_name || r.parent_name || '—'}</dd>
          <dt className="text-ink-3">Nội dung</dt><dd>Học phí khóa {r.course_name}{r.class_code ? `, lớp ${r.class_code}` : ''} — đăng ký {r.enrollment_code}</dd>
          <dt className="text-ink-3">Số tiền</dt><dd className="text-lg font-bold tabular">{money(r.amount)}</dd>
          <dt className="text-ink-3">Bằng chữ</dt><dd className="italic">{moneyInWords(r.amount)}</dd>
          <dt className="text-ink-3">Hình thức</dt><dd>{METHODS[r.method]}</dd>
          {r.note && <><dt className="text-ink-3">Ghi chú</dt><dd>{r.note}</dd></>}
          <dt className="text-ink-3">Công nợ còn lại</dt><dd className="tabular">{money(data.finance.debt)} (tại thời điểm xem)</dd>
        </dl>
        {cancelled && <p className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">Phiếu đã hủy lúc {dateTime(r.cancelled_at)} bởi {r.cancelled_by_name}. Lý do: {r.cancel_reason}</p>}
        <div className="mt-12 grid grid-cols-2 gap-6 text-center text-sm">
          <div><p className="font-medium">Người nộp tiền</p><p className="text-xs text-ink-3">(Ký, ghi rõ họ tên)</p><div className="h-20" /></div>
          <div><p className="font-medium">Người thu tiền</p><p className="text-xs text-ink-3">(Ký, ghi rõ họ tên)</p><div className="h-14" /><p>{r.collector}</p></div>
        </div>
        <footer className="mt-8 border-t border-line pt-3 text-[11px] text-ink-3">Phiếu được tạo từ hệ thống quản lý chi nhánh (bản demo, dữ liệu giả) lúc {dateTime(r.created_at)}. Giao dịch chuyển khoản/quẹt thẻ được ghi nhận thủ công, hệ thống không kết nối ngân hàng.</footer>
      </article>
    </div>
  );
}
