import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, MapPin, FlaskConical, CalendarDays } from 'lucide-react';
import { useApi, useUrlFilters, useMediaQuery } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { date, addDays, startOfWeek, todayVN, WEEKDAYS, WEEKDAYS_SHORT, isoWeekday } from '../../lib/format.js';
import { PageHeader, Card, Button, IconButton, Select, Segmented, Checkbox, ErrorState, LoadingRows, EmptyState, Badge } from '../../components/ui/index.js';
import { useState } from 'react';
import SessionDrawer from '../../components/business/SessionDrawer.jsx';
import { TrialResultModal } from '../../components/business/ClassModals.jsx';
import RoomBoard from './RoomBoard.jsx';

export default function SchedulePage() {
  const today = todayVN();
  const { can, user } = useAuth();
  const { classes, teachers, rooms } = useLookups();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [f, setF] = useUrlFilters({ view: 'week', date: today, class_id: '', teacher_id: '', room_id: '', cancelled: '', session: '' });
  const allView = can('classes.view');
  // Điện thoại không có xem tuần; giáo viên (chỉ thấy lịch mình) không có xem theo phòng
  const view = (isMobile && f.view === 'week') || (!allView && f.view === 'rooms') ? 'day' : f.view;
  const weekStart = startOfWeek(f.date);
  const from = view === 'week' ? weekStart : f.date;
  const to = view === 'week' ? addDays(weekStart, 6) : f.date;
  // Điện thoại: luôn tải cả tuần để thanh chọn ngày hiện số buổi
  const { data, error, loading, reload } = useApi(`/api/sessions${qs({ from: weekStart, to: addDays(weekStart, 6), class_id: f.class_id, teacher_id: f.teacher_id, room_id: f.room_id, include_cancelled: f.cancelled ? '1' : '' })}`);
  const shift = (n) => setF({ date: addDays(f.date, view === 'week' ? n * 7 : n) });
  const [trial, setTrial] = useState(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const itemsOn = (d) => {
    if (!data) return [];
    return [
      ...data.sessions.filter((s) => s.date === d).map((s) => ({ kind: 'session', time: s.start_time, s })),
      ...data.trials.filter((t) => t.date === d).map((t) => ({ kind: 'trial', time: t.start_time, t })),
    ].sort((a, b) => a.time.localeCompare(b.time));
  };

  return (
    <div>
      <PageHeader title="Lịch học" description={allView ? 'Lịch tuần của toàn chi nhánh: buổi chính khóa, học bù, học thử và kiểm tra đầu vào.' : 'Lịch dạy của bạn.'} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label={view === 'week' ? 'Tuần trước' : 'Ngày trước'} variant="secondary" onClick={() => shift(-1)} />
            <Button variant="secondary" onClick={() => setF({ date: today })}>Hôm nay</Button>
            <IconButton icon={ChevronRight} label={view === 'week' ? 'Tuần sau' : 'Ngày sau'} variant="secondary" onClick={() => shift(1)} />
          </div>
          <p className="min-w-0 text-sm font-semibold tabular">{view === 'week' ? `${date(from)} – ${date(to)}` : `${WEEKDAYS[isoWeekday(f.date)]}, ${date(f.date)}`}</p>
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <Segmented ariaLabel="Chế độ xem" value={view} onChange={(v) => setF({ view: v })} options={[
              !isMobile && { value: 'week', label: 'Tuần' }, { value: 'day', label: 'Ngày' }, allView && { value: 'rooms', label: 'Theo phòng' },
            ].filter(Boolean)} />
            {allView && <>
              <Select aria-label="Lọc theo lớp" className="w-36" value={f.class_id} onChange={(e) => setF({ class_id: e.target.value })} placeholder="Mọi lớp">{classes.filter((c) => c.status !== 'finished').map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</Select>
              <Select aria-label="Lọc theo giáo viên" className="w-44" value={f.teacher_id} onChange={(e) => setF({ teacher_id: e.target.value })} placeholder="Mọi giáo viên">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select>
              <Select aria-label="Lọc theo phòng" className="w-32" value={f.room_id} onChange={(e) => setF({ room_id: e.target.value })} placeholder="Mọi phòng">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
            </>}
            <Checkbox label="Hiện buổi đã hủy" checked={!!f.cancelled} onChange={(c) => setF({ cancelled: c ? '1' : '' })} />
          </div>
        </div>

        {view !== 'week' && (
          <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-3 py-2" role="tablist" aria-label="Chọn ngày trong tuần">
            {days.map((d) => {
              const n = data ? itemsOn(d).length : null;
              return (
                <button key={d} type="button" role="tab" aria-selected={d === f.date} onClick={() => setF({ date: d })}
                  className={clsx('flex min-w-[44px] flex-1 flex-col items-center rounded-md px-1 py-1.5 text-xs', d === f.date ? 'bg-brand-600 text-white' : d === today ? 'bg-brand-50 text-brand-800' : 'text-ink-2 hover:bg-canvas')}>
                  <span className="font-medium">{WEEKDAYS_SHORT[isoWeekday(d)]}</span><span className="text-sm font-semibold tabular">{d.slice(8)}</span>
                  <span className={clsx('text-[10px]', d === f.date ? 'text-white/80' : 'text-ink-3')}>{n === null ? ' ' : `${n} lịch`}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && !data && <ErrorState error={error} onRetry={reload} />}
        {!data && loading && <LoadingRows />}
        {data && view === 'week' && (
          <div className="scroll-thin overflow-x-auto">
            <div className="grid min-w-[980px] grid-cols-7 divide-x divide-line">
              {days.map((d) => (
                <div key={d} className={clsx('min-h-[420px]', d === today && 'bg-brand-50/40')}>
                  <div className={clsx('sticky top-0 border-b border-line px-2.5 py-2 text-center', d === today ? 'bg-brand-50' : 'bg-canvas/60')}>
                    <p className="text-xs font-medium text-ink-3">{WEEKDAYS[isoWeekday(d)]}</p>
                    <p className={clsx('text-sm font-semibold tabular', d === today && 'text-brand-700')}>{date(d).slice(0, 5)}{d === today && ' · Hôm nay'}</p>
                  </div>
                  <div className="stagger space-y-2 p-2">
                    {itemsOn(d).map((it) => <ScheduleCard key={`${it.kind}${it.s?.id || it.t.id}`} it={it} compact onOpen={(id) => setF({ session: String(id) })} onTrial={setTrial} canOpenLead={(t) => can('leads.view_all') || (can('leads.view') && t.lead_owner_id === user?.id)} today={today} />)}
                    {!itemsOn(d).length && <p className="pt-6 text-center text-xs text-ink-3">Không có lịch</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {data && view === 'rooms' && <RoomBoard day={f.date} data={data} onOpenSession={(id) => setF({ session: String(id) })} reload={reload} />}
        {data && view === 'day' && (
          <div className="space-y-2 p-3 sm:p-4">
            {!itemsOn(f.date).length ? <EmptyState icon={CalendarDays} title="Không có lịch trong ngày" /> : itemsOn(f.date).map((it) => <ScheduleCard key={`${it.kind}${it.s?.id || it.t.id}`} it={it} onOpen={(id) => setF({ session: String(id) })} onTrial={setTrial} canOpenLead={(t) => can('leads.view_all') || (can('leads.view') && t.lead_owner_id === user?.id)} today={today} />)}
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-ink-3 sm:px-5">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-brand-500" />Chính khóa</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-violet-500" />Học bù (có nhãn “Học bù”)</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-amber-500" />Học thử / kiểm tra (có nhãn)</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-red-400" />Đã hủy (gạch ngang, có nhãn)</span>
        </div>
      </Card>
      <SessionDrawer open={!!f.session} sessionId={f.session} onOpenChange={(v) => !v && setF({ session: '' })} onChanged={reload} />
      <TrialResultModal open={!!trial} onOpenChange={(v) => !v && setTrial(null)} trial={trial} onDone={reload} />
    </div>
  );
}

function ScheduleCard({ it, compact, onOpen, onTrial: setTrial, canOpenLead, today }) {
  if (it.kind === 'trial') {
    const t = it.t;
    // Người không phụ trách khách (giáo viên/CM khác): bấm để ghi kết quả khi đã tới ngày
    const onTrial = canOpenLead?.(t) ? null : setTrial;
    const As = onTrial ? 'button' : Link;
    const props = onTrial ? { type: 'button', onClick: () => (t.date <= today ? onTrial(t) : null), title: t.date <= today ? 'Ghi kết quả' : 'Chưa tới ngày kiểm tra' } : { to: `/leads/${t.lead_id}` };
    return (
      <As {...props} className="block w-full rounded-md border border-dashed border-amber-300 border-l-4 border-l-amber-500 bg-amber-50/60 px-2.5 py-2 text-left transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-amber-50">
        <p className="text-xs font-semibold tabular text-amber-900">{t.start_time}–{t.end_time}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-ink"><FlaskConical className="size-3.5 shrink-0" aria-hidden />{t.type === 'placement' ? 'Kiểm tra đầu vào' : 'Học thử'}</p>
        <p className="truncate text-xs text-ink-2">{t.student_name}</p>
        <p className="truncate text-xs text-ink-3">{t.room_name} · {t.teacher_name}</p>
        {onTrial && t.date <= today && <p className="mt-1 text-[11px] font-medium text-amber-800">Bấm để ghi kết quả</p>}
      </As>
    );
  }
  const s = it.s;
  const cancelled = s.status === 'cancelled';
  return (
    <button type="button" onClick={() => onOpen(s.id)}
      className={clsx('block w-full rounded-md border border-line border-l-4 bg-surface px-2.5 py-2 text-left shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[var(--shadow-lift)]',
        cancelled ? 'border-l-red-400 opacity-70' : s.kind === 'makeup' ? 'border-l-violet-500' : 'border-l-brand-500')}>
      <div className="flex items-center justify-between gap-1">
        <p className={clsx('text-xs font-semibold tabular', cancelled && 'line-through')}>{s.start_time}–{s.end_time}</p>
        {s.status === 'done' && <span className="text-[10px] font-medium text-brand-700">Đã điểm danh</span>}
      </div>
      <p className={clsx('mt-0.5 truncate text-[13px] font-semibold text-ink', cancelled && 'line-through')}>{s.class_code || s.title || 'Học bù'}</p>
      {!compact && s.class_name && <p className="truncate text-xs text-ink-2">{s.class_name}</p>}
      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-3"><MapPin className="size-3 shrink-0" aria-hidden />{s.room_name} · {s.teacher_name.split(' ').slice(-1)}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <span className="text-[11px] text-ink-3">{s.student_count} HV</span>
        {s.kind === 'makeup' && <Badge tone="purple" dot={false} className="px-1.5 py-0 text-[10px]">Học bù</Badge>}
        {s.trial_count > 0 && <Badge tone="warning" dot={false} className="px-1.5 py-0 text-[10px]">+{s.trial_count} học thử</Badge>}
        {cancelled && <Badge tone="danger" dot={false} className="px-1.5 py-0 text-[10px]">Đã hủy</Badge>}
      </div>
    </button>
  );
}
