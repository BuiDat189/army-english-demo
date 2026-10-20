import { useState, useEffect } from 'react';
import { Select, Input, Button, DateInput } from './ui/index.js';
import { date } from '../lib/format.js';

export const PERIODS = [
  ['today', 'Hôm nay'], ['week', 'Tuần này'], ['month', 'Tháng này'], ['last_month', 'Tháng trước'], ['last30', '30 ngày qua'], ['quarter', 'Quý này'], ['custom', 'Tùy chọn…'],
];

/** Bộ lọc kỳ: chọn nhanh hoặc khoảng ngày tùy chọn. Giá trị lưu trên URL ở trang cha. */
export function PeriodFilter({ period, from, to, onChange, resolved }) {
  const [f, setF] = useState(from || '');
  const [t, setT] = useState(to || '');
  useEffect(() => { setF(from || ''); setT(to || ''); }, [from, to]);
  const invalid = f && t && f > t;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Kỳ báo cáo" value={period} onChange={(e) => onChange({ period: e.target.value, from: '', to: '' })} className="w-40">
        {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {period === 'custom' && (
        <>
          <DateInput aria-label="Từ ngày" value={f} onChange={(e) => setF(e.target.value)} className="w-40" />
          <span className="text-ink-3">→</span>
          <DateInput aria-label="Đến ngày" value={t} onChange={(e) => setT(e.target.value)} className="w-40" aria-invalid={invalid ? 'true' : undefined} />
          <Button variant="secondary" disabled={!f || !t || invalid} onClick={() => onChange({ period: 'custom', from: f, to: t })}>Áp dụng</Button>
          {invalid && <span className="text-xs text-red-700">Ngày bắt đầu phải trước ngày kết thúc.</span>}
        </>
      )}
      {resolved && <span className="text-xs text-ink-3 tabular">{date(resolved.from)} – {date(resolved.to)}</span>}
    </div>
  );
}
