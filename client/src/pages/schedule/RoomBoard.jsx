import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { DoorOpen, Users, Wrench, Plus, FlaskConical } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, todayVN } from '../../lib/format.js';
import { Badge, Button, Modal, Field, Select, Input, DateInput, TimeInput, FormGrid, Alert, ConflictList, useForm, useToast, EmptyState, ProgressBar } from '../../components/ui/index.js';

// Lịch theo phòng: sơ đồ phòng theo tầng + lưới phòng × giờ (07:00–22:00).
const START_H = 7;
const END_H = 22;
const PX_H = 64; // bề rộng 1 giờ trên lưới (15 giờ vừa khung 1440px)
const SPAN = (END_H - START_H) * 60;
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const nowHM = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export default function RoomBoard({ day, data, onOpenSession, reload }) {
  const { rooms } = useLookups();
  const { can } = useAuth();
  const navigate = useNavigate();
  const today = todayVN();
  const [now, setNow] = useState(nowHM);
  useEffect(() => { const t = setInterval(() => setNow(nowHM()), 60_000); return () => clearInterval(t); }, []);
  const assets = useApi(can('assets.view') ? '/api/assets' : null);
  const [book, setBook] = useState(null);
  const [focusRoom, setFocusRoom] = useState(null);
  const canBook = can('schedule.edit') && day >= today;

  // Gom buổi học + lịch học thử/kiểm tra của ngày theo phòng
  const byRoom = useMemo(() => {
    const m = new Map(rooms.map((r) => [r.id, []]));
    for (const s of data.sessions.filter((x) => x.date === day && x.status !== 'cancelled')) {
      m.get(s.room_id)?.push({ kind: s.kind === 'makeup' ? 'makeup' : 'session', id: s.id, start: s.start_time, end: s.end_time, label: s.class_code || s.title || 'Học bù', sub: s.teacher_name, count: s.student_count, done: s.status === 'done' });
    }
    for (const t of data.trials.filter((x) => x.date === day)) {
      m.get(t.room_id)?.push({ kind: 'trial', id: t.id, leadId: t.lead_id, start: t.start_time, end: t.end_time, label: t.type === 'placement' ? 'Kiểm tra đầu vào' : 'Học thử', sub: t.student_name });
    }
    for (const list of m.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [data, day, rooms]);

  const broken = useMemo(() => {
    const m = new Map();
    for (const a of assets.data?.items || []) if (a.room_id && ['damaged', 'repairing'].includes(a.status)) m.set(a.room_id, [...(m.get(a.room_id) || []), a.name]);
    return m;
  }, [assets.data]);

  const floors = useMemo(() => {
    const g = new Map();
    for (const r of rooms) g.set(r.floor || 'Khác', [...(g.get(r.floor || 'Khác') || []), r]);
    return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0], 'vi'));
  }, [rooms]);

  const status = (r) => {
    const list = byRoom.get(r.id) || [];
    if (r.status === 'maintenance') return { tone: 'warning', text: 'Đang bảo trì' };
    if (day !== today) return { tone: 'neutral', text: list.length ? `${list.length} lịch trong ngày` : 'Không có lịch' };
    const cur = list.find((x) => x.start <= now && now < x.end);
    if (cur) return { tone: 'live', text: `Đang dùng: ${cur.label} đến ${cur.end}` };
    const next = list.find((x) => x.start > now);
    return next ? { tone: 'free', text: `Trống đến ${next.start}` } : { tone: 'free', text: 'Trống đến hết ngày' };
  };
  const usage = (r) => (byRoom.get(r.id) || []).reduce((s, x) => s + Math.max(0, Math.min(toMin(x.end), END_H * 60) - Math.max(toMin(x.start), START_H * 60)), 0);

  const openItem = (x) => {
    if (x.kind === 'trial') { if (can('leads.view')) navigate(`/leads/${x.leadId}`); return; }
    onOpenSession(x.id);
  };
  const clickGrid = (e, r) => {
    if (!canBook || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const m = START_H * 60 + Math.floor((e.clientX - rect.left) / (PX_H / 2)) * 30;
    if (m >= END_H * 60) return;
    const list = byRoom.get(r.id) || [];
    if (list.some((x) => toMin(x.start) <= m && m < toMin(x.end))) return;
    const nextStart = list.map((x) => toMin(x.start)).filter((s) => s > m).sort((a, b) => a - b)[0];
    setBook({ room: r, start: toHM(m), end: toHM(Math.min(m + 90, nextStart || END_H * 60)) });
  };
  const nowLeft = day === today && toMin(now) >= START_H * 60 && toMin(now) < END_H * 60 ? ((toMin(now) - START_H * 60) / 60) * PX_H : null;

  if (!rooms.length) return <EmptyState title="Chưa có phòng học" />;

  return (
    <div className="space-y-6 p-4 sm:p-5">
      {/* ---------- Sơ đồ phòng theo tầng ---------- */}
      <section aria-label="Sơ đồ phòng">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold">Sơ đồ phòng</h2>
            <p className="text-xs text-ink-3">{day === today ? `Tình trạng lúc ${now}, ngày ${date(day)}` : `Ngày ${date(day)}`} · bấm vào phòng để xem dòng lịch của phòng</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand-500" />Đang dùng</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-slate-300" />Trống</span>
            <span className="inline-flex items-center gap-1.5"><Wrench className="size-3" />Có thiết bị hỏng</span>
          </div>
        </div>
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
          {floors.map(([floor, list]) => (
            <div key={floor} className="grid grid-cols-1 border-b border-line last:border-0 sm:grid-cols-[96px_1fr]">
              <div className="flex items-center gap-2 bg-surface-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-3 sm:justify-center sm:px-2">{floor}</div>
              <div className="stagger grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
                {list.map((r, i) => {
                  const st = status(r);
                  const used = usage(r);
                  const br = broken.get(r.id);
                  return (
                    <button key={r.id} type="button" style={{ '--i': i }} onClick={() => { setFocusRoom(r.id); document.getElementById(`room-row-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}
                      className={clsx('card card-lift group flex flex-col items-start gap-2 p-3 text-left', st.tone === 'live' && 'border-brand-300 ring-1 ring-inset ring-brand-200', focusRoom === r.id && 'outline-2 outline-brand-500')}>
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-base font-semibold"><DoorOpen className="size-4 text-ink-3" aria-hidden />{r.name}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-ink-3"><Users className="size-3.5" aria-hidden />{r.capacity} chỗ</span>
                      </div>
                      <span className={clsx('inline-flex items-center gap-1.5 text-[13px]', st.tone === 'live' ? 'font-medium text-brand-700' : st.tone === 'warning' ? 'text-amber-700' : 'text-ink-2')}>
                        <span className={clsx('size-2 shrink-0 rounded-full', st.tone === 'live' ? 'animate-live bg-brand-500' : st.tone === 'warning' ? 'bg-amber-500' : 'bg-slate-300')} aria-hidden />{st.text}
                      </span>
                      <div className="w-full">
                        <div className="mb-1 flex justify-between text-[11px] text-ink-3"><span>Sử dụng trong ngày</span><span className="tabular">{Math.round((used / SPAN) * 100)}% · {(used / 60).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ</span></div>
                        <ProgressBar value={used} max={SPAN} />
                      </div>
                      {br && <Badge tone="danger" className="max-w-full"><Wrench className="size-3" aria-hidden /><span className="truncate">{br.length} thiết bị hỏng: {br.join(', ')}</span></Badge>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Lưới phòng × giờ ---------- */}
      <section aria-label="Lịch theo phòng">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold">Lịch theo phòng</h2>
            <p className="text-xs text-ink-3">{canBook ? 'Bấm vào khoảng trống để xếp buổi học vào phòng; hệ thống chặn trùng phòng, giáo viên và học viên.' : 'Bấm vào một buổi để xem chi tiết.'}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-brand-500" />Chính khóa</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-violet-500" />Học bù</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-amber-500" />Học thử / kiểm tra</span>
          </div>
        </div>
        <div className="scroll-thin overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <div style={{ width: 128 + (END_H - START_H) * PX_H }}>
            <div className="flex border-b border-line bg-surface-2">
              <div className="sticky left-0 z-20 w-32 shrink-0 border-r border-line bg-surface-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Phòng</div>
              <div className="relative h-8 flex-1">
                {Array.from({ length: END_H - START_H }, (_, i) => (
                  <span key={i} className="absolute top-2 -translate-x-1/2 text-[11px] font-medium text-ink-3 tabular" style={{ left: i * PX_H }}>{i === 0 ? '' : `${START_H + i}:00`}</span>
                ))}
              </div>
            </div>
            {rooms.map((r) => (
              <div key={r.id} id={`room-row-${r.id}`} className={clsx('flex border-b border-line last:border-0', focusRoom === r.id && 'bg-brand-50/40')}>
                <div className="sticky left-0 z-10 flex w-32 shrink-0 flex-col justify-center border-r border-line bg-surface px-3 py-2">
                  <span className="text-sm font-semibold">{r.name}</span>
                  <span className="text-[11px] text-ink-3">{r.floor} · {r.capacity} chỗ</span>
                </div>
                <div className={clsx('relative h-16 flex-1', canBook && 'cursor-cell hover:bg-brand-50/30')}
                  style={{ backgroundImage: `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${PX_H / 2}px)`, backgroundSize: `${PX_H}px 100%` }}
                  onClick={(e) => clickGrid(e, r)} title={canBook ? 'Bấm khoảng trống để xếp buổi học' : undefined}>
                  {(byRoom.get(r.id) || []).map((x) => {
                    const l = ((Math.max(toMin(x.start), START_H * 60) - START_H * 60) / 60) * PX_H;
                    const w = Math.max(28, ((Math.min(toMin(x.end), END_H * 60) - Math.max(toMin(x.start), START_H * 60)) / 60) * PX_H - 3);
                    return (
                      <button key={`${x.kind}${x.id}`} type="button" onClick={() => openItem(x)}
                        aria-label={`${x.label} ${x.start}–${x.end}, phòng ${r.name}${x.sub ? `, ${x.sub}` : ''}`}
                        title={`${x.label} · ${x.start}–${x.end}${x.sub ? ` · ${x.sub}` : ''}${x.count !== undefined ? ` · ${x.count} HV` : ''}`}
                        className={clsx('absolute inset-y-1.5 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-150 hover:z-10 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]',
                          x.kind === 'trial' ? 'border border-dashed border-amber-300 border-l-amber-500 bg-amber-50' : x.kind === 'makeup' ? 'border-l-violet-500 bg-violet-50' : 'border-l-brand-500 bg-brand-50',
                          x.done && 'opacity-75')}
                        style={{ left: l + 1, width: w }}>
                        <p className="flex items-center gap-1 truncate text-xs font-semibold text-ink">{x.kind === 'trial' && <FlaskConical className="size-3 shrink-0" aria-hidden />}{x.label}</p>
                        <p className="truncate text-[11px] text-ink-2 tabular">{x.start}–{x.end}{x.sub ? ` · ${x.sub}` : ''}</p>
                      </button>
                    );
                  })}
                  {nowLeft !== null && <span className="pointer-events-none absolute inset-y-0 z-[5] w-0.5 bg-army-red/80" style={{ left: nowLeft }} aria-hidden />}
                </div>
              </div>
            ))}
          </div>
        </div>
        {nowLeft !== null && <p className="mt-2 text-xs text-ink-3"><span className="mr-1 inline-block h-3 w-0.5 bg-army-red/80 align-middle" />Vạch đỏ: giờ hiện tại ({now})</p>}
      </section>

      <BookRoomModal slot={book} day={day} onOpenChange={(v) => !v && setBook(null)} onDone={reload} />
    </div>
  );
}

/** Xếp buổi học vào một phòng/khung giờ trống — dùng API tạo buổi có kiểm tra trùng lịch */
function BookRoomModal({ slot, day, onOpenChange, onDone }) {
  const { classes, rooms, teachers } = useLookups();
  const toast = useToast();
  const f = useForm({});
  const active = classes.filter((c) => ['active', 'planned'].includes(c.status));
  useEffect(() => {
    if (!slot) return;
    f.setValues({ class_id: '', date: day, start_time: slot.start, end_time: slot.end, room_id: String(slot.room.id), teacher_id: '', assistant_id: '', reason: '' });
    f.setErrors({}); f.setFormError(null);
  }, [slot]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!slot || f.values.room_id === undefined) return null;
  const pickClass = (id) => {
    const c = active.find((x) => x.id === Number(id));
    f.setValues((v) => ({ ...v, class_id: id, teacher_id: c?.teacher_id ? String(c.teacher_id) : v.teacher_id, assistant_id: c?.assistant_id ? String(c.assistant_id) : '' }));
  };
  const room = rooms.find((r) => r.id === Number(f.values.room_id));
  const cls = active.find((c) => c.id === Number(f.values.class_id));
  const save = () => f.submit(async (v) => {
    await api.post('/api/sessions', { ...v, class_id: Number(v.class_id), room_id: Number(v.room_id), teacher_id: Number(v.teacher_id), assistant_id: v.assistant_id ? Number(v.assistant_id) : null, reason: v.reason || 'Xếp từ lịch theo phòng' });
    toast.success(`Đã xếp buổi ${cls?.code || ''} vào ${room?.name} lúc ${v.start_time}.`);
    onOpenChange(false); onDone?.();
  }, (v) => ({
    class_id: !v.class_id && 'Chọn lớp.', teacher_id: !v.teacher_id && 'Chọn giáo viên.',
    end_time: v.end_time <= v.start_time && 'Giờ kết thúc phải sau giờ bắt đầu.', date: v.date < todayVN() && 'Không xếp lịch trong quá khứ.',
  }));
  return (
    <Modal open={!!slot} onOpenChange={onOpenChange} title={`Xếp buổi học vào ${slot.room.name}`} description={`${slot.room.floor} · ${slot.room.capacity} chỗ · khung trống bắt đầu ${slot.start}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button icon={Plus} onClick={save} loading={f.submitting}>Xếp buổi học</Button></>}>
      <div className="space-y-4">
        <Field label="Lớp" required error={f.errors.class_id}>
          <Select value={f.values.class_id} onChange={(e) => pickClass(e.target.value)} placeholder="— Chọn lớp —">
            {active.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.max_students} HV tối đa)</option>)}
          </Select>
        </Field>
        {cls && room && cls.max_students > room.capacity && <Alert tone="warning">Sĩ số tối đa của lớp ({cls.max_students}) lớn hơn sức chứa phòng {room.name} ({room.capacity}).</Alert>}
        <FormGrid>
          <Field label="Ngày" required error={f.errors.date}><DateInput min={todayVN()} {...f.bind('date')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bắt đầu" required error={f.errors.start_time}><TimeInput {...f.bind('start_time')} /></Field>
            <Field label="Kết thúc" required error={f.errors.end_time}><TimeInput {...f.bind('end_time')} /></Field>
          </div>
          <Field label="Phòng" required><Select {...f.bind('room_id')}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.capacity} chỗ</option>)}</Select></Field>
          <Field label="Giáo viên" required error={f.errors.teacher_id}><Select {...f.bind('teacher_id')} placeholder="— Chọn giáo viên —">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          <Field label="Trợ giảng" error={f.errors.assistant_id}><Select {...f.bind('assistant_id')} placeholder="— Không có —">{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</Select></Field>
          <Field label="Lý do / ghi chú"><Input placeholder="Ví dụ: buổi bổ sung, đổi phòng" {...f.bind('reason')} /></Field>
        </FormGrid>
        {f.formError && <Alert tone="danger" title={f.formError.message}><ConflictList error={f.formError} /></Alert>}
      </div>
    </Modal>
  );
}
