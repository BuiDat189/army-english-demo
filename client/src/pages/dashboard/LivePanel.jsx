import { Link } from 'react-router-dom';
import { TrendingUp, RefreshCcw, PiggyBank, CalendarClock, BookOpenCheck, UserCheck, ChevronRight } from 'lucide-react';
import { money, date } from '../../lib/format.js';
import { Card, CardHeader, Badge, EmptyState, ProgressBar } from '../../components/ui/index.js';

/** "Live": doanh số mới/tái phí theo khóa, học viên tới hạn tái phí, BTVN chưa chấm, check-in hôm nay */
export default function LivePanel({ live, definitions }) {
  if (!live || !Object.keys(live).length) return null;
  const { sales, renewal, learning, checkin } = live;
  const maxCourse = sales ? Math.max(1, ...sales.byCourse.map((c) => c.new + c.renew)) : 1;
  return (
    <section aria-label="Theo dõi trực tiếp" className="stagger grid grid-cols-1 gap-5 lg:grid-cols-2">
      {sales && (
        <Card style={{ '--i': 5 }}>
          <CardHeader title="Doanh số mới & tái phí" icon={TrendingUp} description="Tiền thực thu trong kỳ đang lọc, tách theo loại đăng ký" />
          <div className="space-y-4 px-4 pb-4 sm:px-5">
            <div className="grid grid-cols-3 gap-2">
              <Figure label="Học viên mới" value={money(sales.new)} sub={`${sales.newStudents} đăng ký`} title={definitions?.salesNew} />
              <Figure label="Tái phí" value={money(sales.renew)} sub={`${sales.renewStudents} đăng ký`} title={definitions?.salesRenew} icon={RefreshCcw} />
              <Figure label="Nạp tiền (số dư)" value={money(sales.topups)} sub={`${sales.topupCount} phiếu nạp`} title={definitions?.topups} icon={PiggyBank} />
            </div>
            {sales.byCourse.length ? (
              <ul className="space-y-2.5">
                {sales.byCourse.map((c) => (
                  <li key={c.course}>
                    <div className="mb-1 flex flex-wrap justify-between gap-2 text-[13px]"><span className="font-medium">{c.course}</span><span className="tabular text-ink-2">{money(c.new + c.renew)}</span></div>
                    <div className="flex h-2 overflow-hidden rounded-full bg-canvas" role="img" aria-label={`${c.course}: mới ${money(c.new)}, tái phí ${money(c.renew)}`}>
                      <span className="h-full bg-brand-500" style={{ width: `${(c.new / maxCourse) * 100}%` }} />
                      <span className="h-full bg-violet-500" style={{ width: `${(c.renew / maxCourse) * 100}%` }} />
                    </div>
                  </li>
                ))}
                <li className="flex gap-4 pt-1 text-xs text-ink-3"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand-500" />Học viên mới</span><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-violet-500" />Tái phí</span></li>
              </ul>
            ) : <EmptyState compact title="Chưa có phiếu thu trong kỳ" />}
          </div>
        </Card>
      )}
      {renewal && (
        <Card style={{ '--i': 6 }}>
          <CardHeader title="Học viên tới hạn tái phí" icon={CalendarClock} description={definitions?.renewalDue}
            actions={<Link to="/reports?type=renewal" className="text-[13px] font-medium text-brand-700 hover:underline">Báo cáo</Link>} />
          <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-2 sm:px-5">
            {[['Tháng này', renewal.thisMonth, 'danger'], ['Tháng sau', renewal.nextMonth, 'warning']].map(([label, list, tone]) => (
              <div key={label}>
                <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">{label}<Badge tone={tone} dot={false}>{list.length}</Badge></p>
                {list.length ? (
                  <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
                    {list.slice(0, 6).map((x) => (
                      <li key={x.id}><Link to={`/students/${x.student_id}?tab=classes`} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px] hover:bg-canvas">
                        <span className="min-w-0"><span className="block truncate font-medium">{x.student_name}</span><span className="text-xs text-ink-3">{x.class_code} · còn {x.remaining} buổi</span></span>
                        <span className="shrink-0 text-xs tabular text-ink-2">{date(x.expected_end)}</span>
                      </Link></li>
                    ))}
                    {list.length > 6 && <li className="px-3 py-1.5 text-xs text-ink-3">và {list.length - 6} học viên khác</li>}
                  </ul>
                ) : <p className="text-[13px] text-ink-3">Không có học viên.</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
      {learning && (
        <Card style={{ '--i': 7 }}>
          <CardHeader title="BTVN & nhận xét" icon={BookOpenCheck} description="Buổi 7 ngày qua chưa chấm BTVN/nhận xét · học viên không làm BTVN 14 ngày qua"
            actions={<Link to="/learning?tab=homework" className="text-[13px] font-medium text-brand-700 hover:underline">Xem tất cả</Link>} />
          <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-2 sm:px-5">
            <div>
              <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">Chưa chấm<Badge tone={learning.ungradedCount ? 'warning' : 'success'} dot={false}>{learning.ungradedCount} buổi</Badge></p>
              <ul className="space-y-1.5 text-[13px]">{learning.ungraded.map((s) => <li key={s.id} className="flex justify-between gap-2"><span>{date(s.date)} · {s.class_code}</span><span className="text-ink-3">{s.missing_grade}/{s.present} HV</span></li>)}</ul>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">Không làm BTVN<Badge tone={learning.missingCount ? 'danger' : 'success'} dot={false}>{learning.missingCount} HV</Badge></p>
              <ul className="space-y-1.5 text-[13px]">{learning.missing.map((x) => <li key={`${x.student_id}${x.class_code}`} className="flex justify-between gap-2"><Link to={`/students/${x.student_id}?tab=learning`} className="truncate hover:text-brand-700 hover:underline">{x.full_name}</Link><span className="shrink-0 text-ink-3">{x.times} buổi</span></li>)}</ul>
            </div>
          </div>
        </Card>
      )}
      {checkin && (
        <Card style={{ '--i': 8 }}>
          <Link to="/learning?tab=checkin" className="group flex items-center gap-4 p-4 sm:p-5">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200"><UserCheck className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink-3">Check-in tại quầy hôm nay</span>
              <span className="block text-xl font-semibold tabular">{checkin.checked}<span className="text-sm font-normal text-ink-3"> / {checkin.expected} học viên có lịch</span></span>
              <ProgressBar className="mt-2" value={checkin.checked} max={Math.max(1, checkin.expected)} />
            </span>
            <ChevronRight className="size-5 text-ink-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Card>
      )}
    </section>
  );
}

function Figure({ label, value, sub, title, icon: Icon }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line px-3 py-2.5" title={title}>
      <p className="flex items-center gap-1 text-xs text-ink-3">{Icon && <Icon className="size-3" />}{label}</p>
      <p className="mt-0.5 truncate text-[15px] font-semibold tabular">{value}</p>
      <p className="text-[11px] text-ink-3">{sub}</p>
    </div>
  );
}
