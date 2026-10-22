import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Target, ListChecks, Info, CalendarCheck, ClipboardCheck, AlertTriangle, RefreshCcw, Wallet } from 'lucide-react';
import { money, num, date } from '../../lib/format.js';
import { STATUS, OPEN_LEAD_STATUSES } from '../../lib/labels.js';
import { Card, CardHeader, Badge } from '../../components/ui/index.js';

// Màu nền KPI theo mức đạt (kèm chữ "Đạt / Gần đạt / Chưa đạt", không chỉ dùng màu)
const TONE = {
  good: { box: 'bg-emerald-100/80 ring-emerald-200 text-emerald-900', bar: 'bg-emerald-500', text: 'Đạt' },
  warn: { box: 'bg-amber-100/80 ring-amber-200 text-amber-900', bar: 'bg-amber-500', text: 'Gần đạt' },
  bad: { box: 'bg-red-100/80 ring-red-200 text-red-900', bar: 'bg-red-500', text: 'Chưa đạt' },
  neutral: { box: 'bg-slate-100 ring-slate-200 text-slate-800', bar: 'bg-slate-400', text: 'Chưa có buổi' },
};

function KpiBox({ k }) {
  const t = TONE[k.tone] || TONE.neutral;
  return (
    <div className={clsx('rounded-2xl p-4 ring-1 ring-inset transition-shadow hover:shadow-xs', t.box)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold">{k.label}</p>
        <span className="rounded-full bg-surface/80 px-2.5 py-0.5 text-[11px] font-bold shadow-2xs">{t.text}</span>
      </div>
      <p className="mt-2 text-2xl font-extrabold tabular">{num(k.value)}<span className="text-sm font-medium opacity-75"> / {num(k.target)} {k.unit}</span></p>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface/80" aria-hidden><div className={clsx('h-full rounded-full transition-all duration-500', t.bar)} style={{ width: `${Math.min(100, k.pct ?? 0)}%` }} /></div>
    </div>
  );
}

const WHEN = { overdue: ['Quá hạn', 'danger'], today: ['Hôm nay', 'warning'], upcoming: ['Sắp tới', 'info'] };
const relLink = (t) => (t.related_type === 'lead' ? `/leads/${t.related_id}` : t.related_type === 'class' ? `/classes/${t.related_id}` : t.related_type === 'student' ? `/students/${t.related_id}` : `/tasks?id=${t.id}`);

export default function WorkPanel({ work }) {
  if (!work || (!work.ec && !work.cm && !work.cash && !work.proposals.length)) return null;
  const { ec, cm, cash, proposals } = work;
  return (
    <Card>
      <CardHeader title="Khu vực của tôi" icon={Target} description="Đề xuất cần xử lý và KPI cá nhân — màu nền đổi theo mức đạt." />
      <div className="grid grid-cols-1 gap-5 px-4 pb-5 sm:px-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {ec && (
            <section aria-label="KPI tư vấn">
              <h3 className="mb-2.5 flex items-center gap-1.5 text-sm font-bold text-ink"><Target className="size-4 text-brand-600" aria-hidden />KPI tư vấn (EC)</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{ec.kpis.map((k) => <KpiBox key={k.key} k={k} />)}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {OPEN_LEAD_STATUSES.map((s) => (
                  <Link key={s} to={`/leads?status=${s}`} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-line transition-colors hover:bg-brand-50 hover:ring-brand-200">
                    {STATUS.lead[s][0]}: <b className="tabular text-ink">{ec.byStatus[s] || 0}</b>
                  </Link>
                ))}
              </div>
              <p className="mt-2.5 text-[13px] text-ink-2">
                {ec.followDue > 0 ? <Link to="/leads?appointment=overdue" className="font-semibold text-red-700 hover:underline">{ec.followDue} khách tới/trễ hẹn liên hệ lại</Link> : 'Không có khách trễ hẹn liên hệ.'}
                {' · '}Kỳ này: <b>{num(ec.checkinsPeriod)}</b> check-in · <b>{num(ec.enrolled)}</b> đăng ký mới · doanh thu <b>{money(ec.revenue)}</b>
              </p>
            </section>
          )}
          {cm && (
            <section aria-label="KPI chủ nhiệm">
              <h3 className="mb-2.5 flex items-center gap-1.5 text-sm font-bold text-ink"><ClipboardCheck className="size-4 text-brand-600" aria-hidden />KPI chủ nhiệm (CM) hôm nay</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{cm.kpis.map((k) => <KpiBox key={k.key} k={k} />)}</div>
              {cm.sessionsToday.length > 0 && (
                <ul className="mt-3 divide-y divide-line rounded-xl bg-surface-2/50 ring-1 ring-inset ring-line">
                  {cm.sessionsToday.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-[13px]">
                      <Link to={`/schedule?session=${s.id}`} className="font-semibold hover:text-brand-700 hover:underline">{s.start_time} · {s.class_code}</Link>
                      <span className="flex gap-1.5">
                        <Badge tone={s.status === 'done' ? 'success' : 'neutral'}>{s.status === 'done' ? 'Đã điểm danh' : 'Chưa điểm danh'}</Badge>
                        {s.status === 'done' && <Badge tone={s.graded >= s.present ? 'success' : 'warning'}>BTVN {s.graded}/{s.present}</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2.5 text-[13px] sm:grid-cols-4">
                <Link to="/classes" className="rounded-xl bg-surface-2 p-3 ring-1 ring-inset ring-line transition-colors hover:ring-brand-300"><p className="text-xs text-ink-3">Học viên lớp tôi</p><p className="mt-0.5 text-lg font-bold tabular">{num(cm.students)}</p></Link>
                <Link to="/learning?tab=support" className={clsx('rounded-xl p-3 ring-1 ring-inset', cm.flagged ? 'bg-red-100 ring-red-200 text-red-900' : 'bg-surface-2 ring-line')}><p className="text-xs opacity-80">Cảnh báo &lt;90%</p><p className="mt-0.5 text-lg font-bold tabular">{num(cm.flagged)}</p></Link>
                <Link to="/students?renewal=1" className={clsx('rounded-xl p-3 ring-1 ring-inset', cm.renewalDue ? 'bg-amber-100 ring-amber-200 text-amber-900' : 'bg-surface-2 ring-line')}><p className="text-xs opacity-80">Tới hạn tái phí</p><p className="mt-0.5 text-lg font-bold tabular">{num(cm.renewalDue)}</p></Link>
                <Link to="/class-events" className={clsx('rounded-xl p-3 ring-1 ring-inset', cm.resultsOverdue ? 'bg-red-100 ring-red-200 text-red-900' : 'bg-surface-2 ring-line')}><p className="text-xs opacity-80">Trễ trả KQ test</p><p className="mt-0.5 text-lg font-bold tabular">{num(cm.resultsOverdue)}</p></Link>
              </div>
              <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
                <span className="inline-flex items-center gap-1"><RefreshCcw className="size-3.5" aria-hidden />Tái phí kỳ này: <b>{num(cm.renewals)}</b> · <b>{money(cm.renewRevenue)}</b></span>
                {cm.eventsMissing.length > 0 && <Link to="/class-events" className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline"><CalendarCheck className="size-3.5" aria-hidden />Chưa đặt lịch test/họp PH tháng này: {cm.eventsMissing.join(', ')}</Link>}
              </p>
            </section>
          )}
          {cash && (
            <section aria-label="Thực thu" className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-emerald-100/80 p-4 text-emerald-900 ring-1 ring-inset ring-emerald-200"><p className="flex items-center gap-1.5 text-[13px] font-semibold"><Wallet className="size-4" aria-hidden />Thực thu hôm nay</p><p className="mt-1.5 text-xl font-extrabold tabular">{money(cash.today)}</p></div>
              <div className="rounded-2xl bg-sky-100/80 p-4 text-sky-900 ring-1 ring-inset ring-sky-200"><p className="text-[13px] font-semibold">Thực thu tháng (lũy kế)</p><p className="mt-1.5 text-xl font-extrabold tabular">{money(cash.month)}</p><Link to="/reports?type=daily" className="mt-1 inline-block text-xs font-semibold underline">Mở báo cáo ngày</Link></div>
            </section>
          )}
          {(ec || cm) && (
            <details className="text-xs text-ink-3">
              <summary className="inline-flex cursor-pointer items-center gap-1 font-semibold text-brand-700"><Info className="size-3.5" aria-hidden />Quy tắc KPI</summary>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{work.rules.map((r) => <li key={r}>{r}</li>)}</ul>
            </details>
          )}
        </div>
        <section aria-label="Đề xuất cần xử lý">
          <h3 className="mb-2.5 flex items-center gap-1.5 text-sm font-bold text-ink"><ListChecks className="size-4 text-brand-600" aria-hidden />Đề xuất cần xử lý <Badge tone={proposals.some((p) => p.when_tag === 'overdue') ? 'danger' : 'neutral'}>{proposals.length}</Badge></h3>
          {!proposals.length ? <p className="rounded-xl bg-surface-2 p-4 text-sm text-ink-3 ring-1 ring-inset ring-line">Không có việc cần xử lý trong 3 ngày tới.</p> : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface-2/40 ring-1 ring-inset ring-line">
              {proposals.map((p) => (
                <li key={p.id} className={clsx('px-3.5 py-2.5 transition-colors hover:bg-surface', p.when_tag === 'overdue' && 'bg-red-100/60')}>
                  <div className="flex items-start justify-between gap-2">
                    <Link to={relLink(p)} className="min-w-0 text-[13px] font-semibold text-ink hover:text-brand-700 hover:underline">{p.title}</Link>
                    <Badge tone={WHEN[p.when_tag][1]}>{WHEN[p.when_tag][0]}</Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{p.due_date ? `${date(p.due_date)}${p.due_time ? ` ${p.due_time}` : ''} · ` : ''}{p.description || ''}</p>
                </li>
              ))}
            </ul>
          )}
          {proposals.some((p) => p.when_tag === 'overdue') && <p className="mt-2 flex items-center gap-1 text-xs font-medium text-red-700"><AlertTriangle className="size-3.5" aria-hidden />Có việc quá hạn — xử lý trước.</p>}
          <Link to="/tasks" className="mt-2.5 inline-block text-xs font-semibold text-brand-700 hover:underline">Xem tất cả công việc</Link>
        </section>
      </div>
    </Card>
  );
}
