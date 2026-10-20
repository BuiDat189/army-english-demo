import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { GraduationCap, UserPlus, CalendarDays, Wallet, AlertTriangle, ListTodo, Info, ChevronRight, Clock, MapPin, FlaskConical, Sparkles } from 'lucide-react';
import { useApi, useUrlFilters } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { money, num, date, relativeDay, dateTime } from '../../lib/format.js';
import { APPROVAL_TYPES } from '../../lib/labels.js';
import { Card, CardHeader, StatTile, StatusBadge, Badge, ErrorState, Skeleton, EmptyState } from '../../components/ui/index.js';
import { PeriodFilter } from '../../components/PeriodFilter.jsx';
import { GroupedBars } from '../../components/charts.jsx';
import LivePanel from './LivePanel.jsx';
import WorkPanel from './WorkPanel.jsx';

const KPI_ICONS = { studying: GraduationCap, leadsOpen: UserPlus, classesToday: CalendarDays, income: Wallet, receivablesDue: AlertTriangle, tasksOverdue: ListTodo };
const KPI_ORDER = ['studying', 'leadsOpen', 'classesToday', 'income', 'receivablesDue', 'tasksOverdue'];

export default function DashboardPage() {
  const { user } = useAuth();
  const [f, setF] = useUrlFilters({ period: 'month', from: '', to: '' });
  const { data, error, loading, reload } = useApi(`/api/dashboard${qs({ period: f.period, from: f.from, to: f.to })}`);
  const navigate = useNavigate();
  const [showDefs, setShowDefs] = useState(false);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23' }).format(new Date()));
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';

  return (
    <div>
      <section className="side-panel relative mb-5 overflow-hidden rounded-[var(--radius-card)] border border-white/10 px-5 py-5 text-white shadow-[var(--shadow-lift)] sm:px-6">
        <img src="/army-mark.png" alt="" width="200" height="200" aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-48 rotate-12 animate-float opacity-[0.09] sm:size-56" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-star"><Sparkles className="size-3.5" aria-hidden />ARMY ENGLISH · Chi nhánh demo</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-[28px]">{greet}, {user.full_name.split(' ').at(-1)}</h1>
            <p className="mt-1 text-sm text-side-ink">{data ? `${new Intl.DateTimeFormat('vi-VN', { weekday: 'long', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())}, ${date(data.today)}. Số liệu tính trực tiếp từ dữ liệu nghiệp vụ.` : 'Đang tải số liệu…'}</p>
            {data && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {data.scheduleVisible && <span className="rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-inset ring-white/15">{data.todaySessions.length} buổi học hôm nay</span>}
                {data.trialsToday.length > 0 && <span className="rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-inset ring-white/15">{data.trialsToday.length} lịch học thử / kiểm tra</span>}
                {data.todo.approvals?.length > 0 && <span className="rounded-full bg-star/15 px-2.5 py-1 text-star ring-1 ring-inset ring-star/30">{data.todo.approvals.length} đề xuất {data.todo.approvals[0]?.mode === 'to_pay' ? 'chờ chi' : 'chờ xử lý'}</span>}
              </div>
            )}
          </div>
          <div className="[&_.text-ink-3]:text-side-ink"><PeriodFilter period={f.period} from={f.from} to={f.to} onChange={setF} resolved={data?.period} /></div>
        </div>
      </section>

      {error && !data && <Card><ErrorState error={error} onRetry={reload} /></Card>}
      {!data && loading && <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)}</div>}

      {data && (
        <div className={clsx('space-y-5 transition-opacity', loading && 'opacity-70')}>
          <WorkPanel work={data.work} />
          <section aria-label="Chỉ số chính">
            <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
              {KPI_ORDER.filter((k) => data.kpis[k]).map((k, i) => {
                const x = data.kpis[k];
                return (
                  <StatTile key={k} style={{ '--i': i }} label={x.label} icon={KPI_ICONS[k]} tone={x.value > 0 ? x.tone : 'neutral'} href={x.link}
                    numeric={x.value} format={x.money ? money : num} sub={x.sub} definition={data.definitions[k]} onClick={() => navigate(x.link)} />
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-3">
              <button type="button" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" onClick={() => setShowDefs((s) => !s)} aria-expanded={showDefs}>
                <Info className="size-3.5" />{showDefs ? 'Ẩn định nghĩa chỉ số' : 'Định nghĩa chỉ số'}
              </button>
              <span>Nhấn vào thẻ để mở danh sách tương ứng.</span>
            </div>
            {showDefs && (
              <Card className="mt-2 p-4">
                <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
                  {Object.entries(data.definitions).filter(([k]) => data.kpis[k] || k === 'enrolledInPeriod').map(([k, d]) => (
                    <div key={k}><dt className="font-medium text-ink">{data.kpis[k]?.label || 'Đăng ký trong kỳ'}</dt><dd className="text-ink-3">{d}</dd></div>
                  ))}
                </dl>
              </Card>
            )}
          </section>

          <div className={clsx('stagger grid grid-cols-1 gap-5', data.scheduleVisible && 'xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]')}>
            {data.scheduleVisible && <div style={{ '--i': 3 }} className="min-w-0"><TodaySchedule data={data} /></div>}
            <div style={{ '--i': 4 }} className="min-w-0"><TodoPanel data={data} /></div>
          </div>

          <LivePanel live={data.live} definitions={data.definitions} />

          {data.charts && (
            <div className="stagger grid grid-cols-1 gap-5 lg:grid-cols-2">
              {'leads' in data.charts[0] && (
                <Card style={{ '--i': 5 }}>
                  <CardHeader title="Tuyển sinh 6 tháng gần nhất" description={`Đăng ký trong kỳ đang lọc: ${data.enrolledInPeriod ?? '—'} đăng ký`} />
                  <div className="px-4 pb-4 sm:px-5"><GroupedBars title="Tuyển sinh theo tháng" data={data.charts} series={[{ key: 'newEnrollments', label: 'Đăng ký mới' }, { key: 'leads', label: 'Khách mới' }, { key: 'renewals', label: 'Tái đăng ký' }]} /></div>
                </Card>
              )}
              {'income' in data.charts[0] && (
                <Card style={{ '--i': 6 }}>
                  <CardHeader title="Tiền thực thu và phải thu phát sinh" description="Thực thu = phiếu thu đã xác nhận (không gồm phiếu trừ số dư) + phiếu nạp tiền. Phải thu phát sinh = học phí sau giảm của đăng ký mới trong tháng." />
                  <div className="px-4 pb-4 sm:px-5"><GroupedBars title="Tiền theo tháng" isMoney data={data.charts} series={[{ key: 'income', label: 'Thực thu' }, { key: 'billed', label: 'Phải thu phát sinh' }]} /></div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function nowHM() {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}
const addMin = (hm, m) => { const t = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) + m; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** Chấm nhấp nháy cho buổi đang diễn ra (kèm chữ, không chỉ dùng màu) */
function LiveBadge({ start, end, done }) {
  const now = nowHM();
  if (done) return null;
  if (start <= now && now < end) return <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200"><span className="size-2 animate-live rounded-full bg-brand-500" aria-hidden />Đang diễn ra</span>;
  if (now < start && start <= addMin(now, 60)) return <Badge tone="info">Sắp bắt đầu</Badge>;
  return null;
}

function TodaySchedule({ data }) {
  const items = [
    ...data.todaySessions.map((s) => ({ kind: 'session', time: s.start_time, s })),
    ...data.trialsToday.filter((t) => !t.session_id).map((t) => ({ kind: 'trial', time: t.start_time, t })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <Card>
      <CardHeader title="Lịch hôm nay" icon={CalendarDays} description={`${data.todaySessions.length} buổi học · ${data.trialsToday.length} lịch học thử/kiểm tra`}
        actions={<Link to={`/schedule?view=day&date=${data.today}`} className="text-[13px] font-medium text-brand-700 hover:underline">Mở lịch</Link>} />
      {!items.length ? <EmptyState compact title="Hôm nay không có lịch học" description="Xem lịch tuần để chuẩn bị các buổi sắp tới." /> : (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((it) => (it.kind === 'session' ? (
            <li key={`s${it.s.id}`}>
              <Link to={`/schedule?view=day&date=${data.today}&session=${it.s.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-canvas sm:px-5">
                <div className="w-14 shrink-0 text-center"><p className="text-sm font-semibold tabular">{it.s.start_time}</p><p className="text-xs text-ink-3 tabular">{it.s.end_time}</p></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.s.class_code ? `${it.s.class_code} · ${it.s.class_name}` : it.s.title}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-3">
                    <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{it.s.room_name}</span>
                    <span>GV: {it.s.teacher_name}{it.s.assistant_name ? ` · TG: ${it.s.assistant_name}` : ''}</span>
                    <span>{it.s.student_count} học viên</span>
                  </p>
                </div>
                {it.s.kind === 'makeup' && <Badge tone="purple">Học bù</Badge>}
                <LiveBadge start={it.s.start_time} end={it.s.end_time} done={it.s.status !== 'scheduled'} />
                <StatusBadge kind="session" value={it.s.status} />
              </Link>
            </li>
          ) : (
            <li key={`t${it.t.id}`}>
              <Link to={`/leads/${it.t.lead_id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-canvas sm:px-5">
                <div className="w-14 shrink-0 text-center"><p className="text-sm font-semibold tabular">{it.t.start_time}</p><p className="text-xs text-ink-3 tabular">{it.t.end_time}</p></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.t.type === 'placement' ? 'Kiểm tra đầu vào' : 'Học thử'}: {it.t.student_name}</p>
                  <p className="mt-0.5 text-xs text-ink-3">{it.t.room_name} · {it.t.teacher_name}</p>
                </div>
                <LiveBadge start={it.t.start_time} end={it.t.end_time} />
                <Badge tone="warning">{it.t.type === 'placement' ? 'Kiểm tra' : 'Học thử'}</Badge>
              </Link>
            </li>
          )))}
        </ul>
      )}
      {data.trialsToday.some((t) => t.session_id) && (
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-xs text-ink-3 sm:px-5"><FlaskConical className="size-3.5" />Học thử ghép lớp hôm nay: {data.trialsToday.filter((t) => t.session_id).map((t) => `${t.student_name} (${t.class_code} ${t.start_time})`).join(', ')}</p>
      )}
    </Card>
  );
}

function TodoPanel({ data }) {
  const { todo } = data;
  const [tab, setTab] = useState(() => (todo.trials ? 'trials' : todo.absences ? 'absences' : 'approvals'));
  const tabs = [
    todo.trials && { value: 'trials', label: 'Học thử & hẹn gọi', count: todo.trials.length + (todo.followups?.length || 0) },
    todo.absences && { value: 'absences', label: 'HV vắng', count: todo.absences.length },
    todo.receivables && { value: 'receivables', label: 'Khoản quá hạn', count: todo.receivables.length },
    todo.approvals && { value: 'approvals', label: todo.approvals[0]?.mode === 'to_pay' ? 'Chờ chi' : 'Chờ duyệt', count: todo.approvals.length },
  ].filter(Boolean);
  const Row = ({ to, title, sub, right }) => (
    <li><Link to={to} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-canvas sm:px-5">
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{title}</p>{sub && <p className="truncate text-xs text-ink-3">{sub}</p>}</div>
      {right}<ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
    </Link></li>
  );
  return (
    <Card>
      <CardHeader title="Cần xử lý" icon={Clock} />
      <div className="px-4 sm:px-5">
        <div role="tablist" className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
              className={clsx('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors duration-200', tab === t.value ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-ink-2 ring-line hover:bg-canvas')}>
              {t.label} <span className="tabular">({t.count})</span>
            </button>
          ))}
        </div>
      </div>
      <ul key={tab} className="mt-3 animate-fade-in divide-y divide-line border-t border-line">
        {tab === 'trials' && (<>
          {todo.trials.map((t) => <Row key={`t${t.id}`} to={`/leads/${t.lead_id}`} title={`${t.type === 'placement' ? 'Kiểm tra đầu vào' : 'Học thử'}: ${t.student_name}`} sub={`${relativeDay(t.date, data.today)} ${t.start_time} · PH ${t.parent_name}`} right={<Badge tone="warning">Đã hẹn</Badge>} />)}
          {todo.followups?.map((l) => <Row key={`f${l.id}`} to={`/leads/${l.id}`} title={`Gọi lại: ${l.parent_name}`} sub={`Hẹn ${dateTime(l.next_contact_at)} · HV ${l.student_name}`} right={l.next_contact_at.slice(0, 10) < data.today ? <Badge tone="danger">Trễ hẹn</Badge> : <Badge tone="info">Hôm nay</Badge>} />)}
          {!todo.trials.length && !todo.followups?.length && <li><EmptyState compact title="Không có lịch học thử hay hẹn gọi" /></li>}
        </>)}
        {tab === 'absences' && (todo.absences.length ? todo.absences.map((a) => (
          <Row key={a.id} to={a.status && !['absent', 'excused'].includes(a.status) ? `/care?id=${a.id}` : `/students/${a.student_id}?tab=attendance`} title={a.student_name} sub={a.title}
            right={a.priority ? <StatusBadge kind="care" value={a.status} /> : <StatusBadge kind="attendance" value={a.status} />} />
        )) : <li><EmptyState compact title="Không có học viên vắng cần xử lý" /></li>)}
        {tab === 'receivables' && (todo.receivables.length ? todo.receivables.map((r) => (
          <Row key={r.id} to={`/students/${r.student_id}?tab=finance`} title={r.student_name} sub={`${r.code} · hạn ${date(r.due_date)}`} right={<span className="text-sm font-semibold text-red-700 tabular">{money(r.overdue)}</span>} />
        )) : <li><EmptyState compact title="Không có khoản quá hạn" /></li>)}
        {tab === 'approvals' && (todo.approvals.length ? todo.approvals.map((a) => (
          <Row key={a.id} to={`/approvals?id=${a.id}`} title={a.title} sub={`${a.code} · ${APPROVAL_TYPES[a.type]}${a.requester ? ` · ${a.requester}` : ''}`} right={a.amount ? <span className="text-sm tabular">{money(a.amount)}</span> : null} />
        )) : <li><EmptyState compact title="Không có đề xuất cần xử lý" /></li>)}
      </ul>
      <div className="border-t border-line px-4 py-2.5 sm:px-5">
        <Link className="text-[13px] font-medium text-brand-700 hover:underline" to={{ trials: '/leads?appointment=trial_upcoming', absences: '/training?tab=absences', receivables: '/finance?status=overdue', approvals: '/approvals' }[tab] || '/'}>Xem tất cả</Link>
      </div>
    </Card>
  );
}
