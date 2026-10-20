import { Download } from 'lucide-react';
import { qs } from '../../lib/api.js';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { money, num, date } from '../../lib/format.js';
import { PageHeader, Card, Tabs, DataState, Button, EmptyState, Alert, FilterBar, LoadingRows } from '../../components/ui/index.js';
import { PeriodFilter } from '../../components/PeriodFilter.jsx';

const fmt = (c, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (c.type === 'money') return money(v);
  if (c.type === 'percent') return `${String(v).replace('.', ',')}%`;
  if (c.type === 'number') return num(v);
  if (c.type === 'decimal') return String(v).replace('.', ',');
  if (c.type === 'date') return date(v);
  return v;
};

// KPI đổi màu nền theo mức đạt (cột có toneKey)
const TONE_CELL = { good: 'bg-emerald-100 text-emerald-900', warn: 'bg-amber-100 text-amber-900', bad: 'bg-red-100 text-red-900' };

function ReportTable({ columns, rows, totals, caption }) {
  if (!rows.length) return <EmptyState compact title="Không có dữ liệu trong kỳ" />;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead><tr className="border-b border-line bg-canvas/70 text-left">{columns.map((c) => <th key={c.key} scope="col" className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-3 ${['money', 'number', 'percent', 'decimal'].includes(c.type) ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line/70">{columns.map((c) => <td key={c.key} className={`px-4 py-2.5 ${['money', 'number', 'percent', 'decimal'].includes(c.type) ? 'text-right tabular' : ''} ${c.toneKey ? `font-semibold ${TONE_CELL[r[c.toneKey]] || ''}` : ''}`}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody>
        {totals && <tfoot><tr className="bg-canvas font-semibold">{columns.map((c) => <td key={c.key} className={`px-4 py-2.5 ${['money', 'number', 'percent', 'decimal'].includes(c.type) ? 'text-right tabular' : ''}`}>{totals[c.key] !== undefined ? fmt(c, totals[c.key]) : ''}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const list = useApi('/api/reports');
  const [f, setF] = useUrlFilters({ type: '', period: 'month', from: '', to: '' });
  const type = f.type || list.data?.reports[0]?.key;
  const params = qs({ period: f.period, from: f.from, to: f.to });
  const rep = useApi(type ? `/api/reports/${type}${params}` : null);
  return (
    <div>
      <PageHeader title="Báo cáo" description="Mọi báo cáo tính trực tiếp từ dữ liệu nghiệp vụ (cùng nguồn với các màn hình). Xuất CSV mở được bằng Excel, có hỗ trợ tiếng Việt." />
      <Card>
        {!list.data ? <LoadingRows rows={2} /> : (
          <Tabs className="px-4 sm:px-5" value={type} onChange={(t) => setF({ type: t })} tabs={list.data.reports.map((r) => ({ value: r.key, label: (() => { const t = r.title.replace('Báo cáo ', ''); return t.charAt(0).toUpperCase() + t.slice(1); })() }))} />
        )}
        <FilterBar>
          <PeriodFilter period={f.period} from={f.from} to={f.to} onChange={setF} resolved={rep.data && { from: rep.data.from, to: rep.data.to }} />
          {type && <Button className="sm:ml-auto" variant="secondary" icon={Download} onClick={() => { window.location.href = `/api/reports/${type}${params}${params ? '&' : '?'}format=csv`; }}>Xuất CSV</Button>}
        </FilterBar>
        <DataState loading={rep.loading} error={rep.error} data={rep.data} onRetry={rep.reload}>
          {(d) => (
            <div className="space-y-5 pb-5">
              <div className="px-4 pt-4 sm:px-5"><h2 className="text-base font-semibold">{d.title}</h2><p className="text-xs text-ink-3">Kỳ: {date(d.from)} – {date(d.to)}</p></div>
              <ReportTable columns={d.columns} rows={d.rows} totals={d.totals} caption={d.title} />
              {d.extra && (
                <section>
                  <h3 className="px-4 pb-2 text-sm font-semibold sm:px-5">{d.extra.title}</h3>
                  <ReportTable columns={d.extra.columns} rows={d.extra.rows} caption={d.extra.title} />
                </section>
              )}
              {d.note && <Alert tone="info" className="mx-4 sm:mx-5">{d.note}</Alert>}
              {d.notes && <Alert tone="info" className="mx-4 sm:mx-5"><ul className="list-disc space-y-0.5 pl-4">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul></Alert>}
            </div>
          )}
        </DataState>
      </Card>
    </div>
  );
}
