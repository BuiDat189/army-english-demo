import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Table2, BarChart3 } from 'lucide-react';
import { money, moneyShort, num } from '../lib/format.js';
import { useResolvedTheme } from '../lib/theme.js';

// Bảng màu phân loại cố định thứ tự, đã kiểm bằng validate_palette.js (độ tương phản, mù màu) cho TỪNG nền.
export const SERIES_COLORS = ['#1f7a40', '#5b6fd6', '#b7791f'];
export const SERIES_COLORS_DARK = ['#409c60', '#7184e6', '#b8852a'];
const AXIS = { light: { grid: '#e4e7ec', tick: '#5d6878', cursor: 'rgb(31 122 64 / 0.06)' }, dark: { grid: '#232c3d', tick: '#8a94a6', cursor: 'rgb(79 181 116 / 0.08)' } };
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function TooltipBox({ active, payload, label, isMoney }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-semibold text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          {p.name}: <span className="font-medium text-ink tabular">{isMoney ? money(p.value) : num(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Biểu đồ cột nhóm, một trục. Có chú giải (≥ 2 chuỗi), tooltip khi rê chuột và chế độ xem bảng.
 * series: [{ key, label }] — màu gán theo thứ tự cố định.
 */
export function GroupedBars({ data, series, xKey = 'label', isMoney = false, height = 240, title }) {
  const [table, setTable] = useState(false);
  const theme = useResolvedTheme();
  const colors = theme === 'dark' ? SERIES_COLORS_DARK : SERIES_COLORS;
  const axis = AXIS[theme] || AXIS.light;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Chú giải">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-2"><span className="size-2.5 rounded-sm" style={{ background: colors[i] }} aria-hidden />{s.label}</li>
          ))}
        </ul>
        <button type="button" onClick={() => setTable((t) => !t)} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-ink-3 hover:bg-canvas hover:text-ink" aria-pressed={table}>
          {table ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}{table ? 'Xem biểu đồ' : 'Xem dạng bảng'}
        </button>
      </div>
      {table ? (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">{title}</caption>
            <thead><tr className="border-b border-line text-left text-ink-3"><th className="py-1.5 pr-3 font-medium">Tháng</th>{series.map((s) => <th key={s.key} className="py-1.5 pr-3 text-right font-medium">{s.label}</th>)}</tr></thead>
            <tbody>{data.map((d) => <tr key={d[xKey]} className="border-b border-line/60"><td className="py-1.5 pr-3">{d[xKey]}</td>{series.map((s) => <td key={s.key} className="py-1.5 pr-3 text-right tabular">{isMoney ? money(d[s.key]) : num(d[s.key])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} role="img" aria-label={`${title}. Bấm "Xem dạng bảng" để đọc số liệu.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={axis.grid} />
              <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: axis.tick }} />
              <YAxis tickLine={false} axisLine={false} width={isMoney ? 48 : 30} allowDecimals={false} tick={{ fontSize: 11, fill: axis.tick }} tickFormatter={isMoney ? moneyShort : undefined} />
              <Tooltip cursor={{ fill: axis.cursor }} content={<TooltipBox isMoney={isMoney} />} />
              {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={colors[i]} radius={[4, 4, 0, 0]} maxBarSize={22}
                isAnimationActive={!reducedMotion()} animationBegin={i * 120} animationDuration={800} animationEasing="ease-out" />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
