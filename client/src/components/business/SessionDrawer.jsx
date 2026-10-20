import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CalendarClock, Ban, CheckCheck, MapPin, Users, Info, CalendarPlus, HeartHandshake, BookOpenCheck, Wrench } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.jsx';
import { date, weekdayLabel, dateTime, todayVN, addDays } from '../../lib/format.js';
import { Drawer, Button, StatusBadge, Badge, Field, Input, Textarea, Alert, Segmented, ConfirmDialog, Spinner, ErrorState, Timeline, useToast, Menu, Modal, DateInput, Select, FormGrid, useForm } from '../ui/index.js';
import { RescheduleModal, MakeupModal, TrialResultModal } from './ClassModals.jsx';

const HW_OPTIONS = [
  { value: 'done', label: 'Hoàn thành', activeClass: 'bg-brand-600 text-white' },
  { value: 'partial', label: 'Chưa đủ', activeClass: 'bg-amber-500 text-white' },
  { value: 'missing', label: 'Không làm', activeClass: 'bg-red-600 text-white' },
];
const learningOf = (a) => ({ hw: a?.homework_status || '', score: a?.homework_score ?? '', comment: a?.comment || '', improvement: a?.improvement || '' });
const sameLearning = (cur, a) => { const b = learningOf(a); return cur.hw === b.hw && String(cur.score) === String(b.score) && cur.comment === b.comment && cur.improvement === b.improvement; };

const ATT_OPTIONS = [
  { value: 'present', label: 'Có mặt', activeClass: 'bg-brand-600 text-white' },
  { value: 'late', label: 'Đi muộn', activeClass: 'bg-amber-500 text-white' },
  { value: 'excused', label: 'Vắng có phép', activeClass: 'bg-sky-600 text-white' },
  { value: 'absent', label: 'Vắng không phép', activeClass: 'bg-red-600 text-white' },
];

/** Drawer buổi học: thông tin, điểm danh, nội dung buổi, đổi lịch/hủy, học bù, học thử */
export default function SessionDrawer({ sessionId, open, onOpenChange, onChanged }) {
  const { data, error, loading, reload } = useApi(open && sessionId ? `/api/sessions/${sessionId}` : null, { keepPrevious: false });
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState({});
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const [homework, setHomework] = useState('');
  const [showLearning, setShowLearning] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    if (!data) return;
    setRows(Object.fromEntries(data.roster.map((r) => [r.id, { status: r.attendance?.status || '', note: r.attendance?.note || '', ...learningOf(r.attendance) }])));
    setTopic(data.session.topic || '');
    setNote(data.session.teacher_note || '');
    setHomework(data.session.homework || '');
    setSaveErr(null);
  }, [data]);

  const s = data?.session;
  const canMark = data?.can.mark;
  const dirty = data && (data.roster.some((r) => (rows[r.id]?.status || '') !== (r.attendance?.status || '') || (rows[r.id]?.note || '') !== (r.attendance?.note || '')
    || (rows[r.id] && !sameLearning(rows[r.id], r.attendance)))
    || topic !== (s.topic || '') || note !== (s.teacher_note || '') || homework !== (s.homework || ''));
  const badScore = data ? data.roster.find((r) => rows[r.id]?.score !== '' && rows[r.id]?.score !== undefined && (Number(rows[r.id].score) < 0 || Number(rows[r.id].score) > 10)) : null;
  const unmarked = data ? data.roster.filter((r) => !rows[r.id]?.status).length : 0;

  const save = async () => {
    if (saving) return;
    setSaveErr(null);
    if (unmarked) { setSaveErr({ message: `Còn ${unmarked} học viên chưa chọn trạng thái.` }); return; }
    if (badScore) { setSaveErr({ message: `Điểm BTVN của ${badScore.full_name} phải từ 0 đến 10.` }); return; }
    setSaving(true);
    try {
      const res = await api.put(`/api/sessions/${s.id}/attendance`, {
        records: data.roster.map((r) => ({
          student_id: r.id, status: rows[r.id].status, note: rows[r.id].note || null,
          homework_status: rows[r.id].hw || null, homework_score: rows[r.id].score === '' ? null : Number(rows[r.id].score), comment: rows[r.id].comment || null, improvement: rows[r.id].improvement || null,
        })),
        topic: topic || null, teacher_note: note || null, homework: homework || null,
      });
      toast.success(`Đã lưu điểm danh (${res.changed} thay đổi).${res.careCreated ? ` Tạo ${res.careCreated} việc chăm sóc vắng học.` : ''}`);
      await reload();
      onChanged?.();
    } catch (e) { setSaveErr(e); } finally { setSaving(false); }
  };

  const title = s ? (s.class_code ? `${s.class_code} · ${s.class_name}` : s.title || 'Buổi học bù') : 'Buổi học';
  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange} width="lg" title={title}
        description={s && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{weekdayLabel(s.date)} {date(s.date)} · {s.start_time}–{s.end_time}</span>
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{s.room_name}</span>
            <span className="inline-flex items-center gap-1"><Users className="size-3.5" />GV {s.teacher_name}{s.assistant_name ? ` · TG ${s.assistant_name}` : ''}</span>
          </span>
        )}
        headerExtra={s && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge kind="session" value={s.status} />
            {s.kind === 'makeup' && <Badge tone="purple">Buổi học bù</Badge>}
            {s.seq_no && <Badge tone="neutral" dot={false}>Buổi {s.seq_no}</Badge>}
            {data.can.schedule && (
              <Menu label="Thao tác buổi học" items={[
                { label: 'Đổi lịch / phòng / giáo viên', icon: CalendarClock, onSelect: () => setModal({ type: 'resched' }) },
                { label: 'Hủy buổi học', icon: Ban, danger: true, onSelect: () => setModal({ type: 'cancel' }) },
              ]} />
            )}
          </div>
        )}
        footer={canMark && <>
          {dirty && <span className="mr-auto self-center text-xs text-amber-700">Có thay đổi chưa lưu</span>}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Đóng</Button>
          <Button onClick={save} loading={saving} disabled={!dirty && !!s?.attendance_saved_at}>{s?.attendance_saved_at ? 'Lưu thay đổi' : 'Lưu điểm danh'}</Button>
        </>}>
        {error && !data && <ErrorState error={error} onRetry={reload} />}
        {loading && !data && <div className="flex justify-center py-10"><Spinner /></div>}
        {data && (
          <div className="space-y-5">
            {s.status === 'cancelled' && <Alert tone="danger" title="Buổi học đã hủy">{s.cancel_reason}. Buổi đã hủy không chiếm lịch và không trừ buổi của học viên.</Alert>}
            {!canMark && data.can.markReason && s.status !== 'cancelled' && <Alert tone="info">{data.can.markReason}</Alert>}
            {s.attendance_saved_at && <p className="text-xs text-ink-3">Đã điểm danh lúc {dateTime(s.attendance_saved_at)}. Có thể mở lại và sửa; lưu nhiều lần không tạo trùng.</p>}

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Điểm danh ({data.roster.length} học viên)</h3>
                {canMark && data.roster.length > 0 && (
                  <Button variant="secondary" size="sm" icon={CheckCheck} onClick={() => setRows((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, { ...x, status: x.status || 'present' }])))}>
                    Chưa chọn → Có mặt
                  </Button>
                )}
              </div>
              {data.prevHomework && (
                <p className="mb-2 flex items-start gap-1.5 rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-[13px] text-ink-2">
                  <BookOpenCheck className="mt-0.5 size-3.5 shrink-0 text-brand-700" /><span><b className="font-medium">BTVN giao buổi {date(data.prevHomework.date)}:</b> {data.prevHomework.homework}</span>
                </p>
              )}
              {canMark && data.roster.length > 0 && (
                <label className="mb-2 inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" className="size-4 accent-[var(--color-brand-600)]" checked={showLearning} onChange={(e) => setShowLearning(e.target.checked)} />
                  Chấm BTVN, điểm, nhận xét và hướng cải thiện từng học viên
                </label>
              )}
              {!data.roster.length && <p className="text-sm text-ink-3">Buổi học chưa có học viên.</p>}
              <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
                {data.roster.map((r) => {
                  const cur = rows[r.id] || { status: '', note: '' };
                  const saved = r.attendance;
                  const absentSaved = saved && ['absent', 'excused'].includes(saved.status) && !r.makeup;
                  return (
                    <li key={r.id} className={clsx('px-3 py-3', !cur.status && canMark && 'bg-amber-50/40')}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <Link to={`/students/${r.id}`} className="text-sm font-medium text-ink hover:text-brand-700 hover:underline">{r.full_name}</Link>
                          <span className="ml-2 text-xs text-ink-3">{r.code}</span>
                          {r.makeup && <Badge tone="purple" className="ml-2">Học bù cho buổi {date(r.makeup.original_date)} ({r.makeup.original_class})</Badge>}
                        </div>
                        {canMark ? (
                          <Segmented size="sm" ariaLabel={`Điểm danh ${r.full_name}`} value={cur.status} onChange={(v) => setRows((x) => ({ ...x, [r.id]: { ...cur, status: v } }))} options={ATT_OPTIONS} />
                        ) : saved ? <StatusBadge kind="attendance" value={saved.status} /> : <span className="text-xs text-ink-3">Chưa điểm danh</span>}
                      </div>
                      {canMark && (cur.status === 'late' || cur.status === 'excused' || cur.status === 'absent' || cur.note) && (
                        <Input className="mt-2 h-8 text-[13px]" placeholder="Ghi chú (lý do vắng, đến muộn…)" aria-label={`Ghi chú cho ${r.full_name}`} value={cur.note} onChange={(e) => setRows((x) => ({ ...x, [r.id]: { ...cur, note: e.target.value } }))} />
                      )}
                      {canMark && showLearning && (cur.status === 'present' || cur.status === 'late') && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[auto_5.5rem_1fr]">
                          <Segmented size="sm" ariaLabel={`BTVN ${r.full_name}`} value={cur.hw} onChange={(v) => setRows((x) => ({ ...x, [r.id]: { ...cur, hw: v === cur.hw ? '' : v } }))} options={HW_OPTIONS} />
                          <Input type="number" min={0} max={10} step={0.5} inputMode="decimal" className="h-8 text-[13px]" placeholder="Điểm /10" aria-label={`Điểm BTVN ${r.full_name}`}
                            value={cur.score} onChange={(e) => setRows((x) => ({ ...x, [r.id]: { ...cur, score: e.target.value } }))} />
                          <Input className="h-8 text-[13px]" placeholder="Nhận xét trên lớp" aria-label={`Nhận xét ${r.full_name}`}
                            value={cur.comment} onChange={(e) => setRows((x) => ({ ...x, [r.id]: { ...cur, comment: e.target.value } }))} />
                          <Input className="h-8 text-[13px] sm:col-span-3" placeholder="Hướng cải thiện (gợi ý cho học viên / phụ huynh)" aria-label={`Hướng cải thiện ${r.full_name}`}
                            value={cur.improvement} onChange={(e) => setRows((x) => ({ ...x, [r.id]: { ...cur, improvement: e.target.value } }))} />
                        </div>
                      )}
                      {!canMark && saved && (saved.homework_status || saved.comment) && (
                        <p className="mt-1.5 text-xs text-ink-3">
                          {saved.homework_status && <>BTVN: <b className="font-medium text-ink-2">{data.homeworkLabels?.[saved.homework_status]}</b>{saved.homework_score !== null ? ` · ${String(saved.homework_score).replace('.', ',')}/10` : ''}</>}
                          {saved.comment && <span className="ml-2">“{saved.comment}”</span>}
                          {saved.improvement && <span className="ml-2">Hướng cải thiện: {saved.improvement}</span>}
                        </p>
                      )}
                      {absentSaved && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          {can('makeup.edit') && <Button variant="secondary" size="sm" icon={CalendarPlus} onClick={() => setModal({ type: 'makeup', absence: { attendance_id: saved.id, full_name: r.full_name, date: s.date, class_code: s.class_code } })}>Xếp học bù</Button>}
                          {can('care.view') && <Link to="/care?type=absence" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><HeartHandshake className="size-3.5" />Việc chăm sóc vắng học</Link>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {data.trials.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold">Học thử trong buổi</h3>
                <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
                  {data.trials.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <div><p className="text-sm font-medium">{t.student_name}</p><p className="text-xs text-ink-3">PH {t.parent_name} · {t.lead_code}</p></div>
                      <div className="flex items-center gap-2"><StatusBadge kind="trial" value={t.status} />
                        {t.status === 'scheduled' && data.can.trialResult && s.date <= todayVN() && <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'trial', trial: t })}>Ghi kết quả</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Nội dung buổi học</h3>
              <Field label="Chủ đề / nội dung đã dạy"><Input value={topic} onChange={(e) => setTopic(e.target.value)} disabled={!canMark} placeholder="Ví dụ: Unit 5 – Speaking practice" /></Field>
              <Field label="Nhận xét chung của giáo viên"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canMark} /></Field>
              <Field label="BTVN giao cho buổi sau" hint="Buổi sau giáo viên chấm BTVN này ngay khi điểm danh.">
                <Textarea rows={2} value={homework} onChange={(e) => setHomework(e.target.value)} disabled={!canMark} placeholder="Ví dụ: Workbook trang 20–21, học thuộc 10 từ mới" />
              </Field>
            </section>

            {can('assets.report') && s.room_id && (
              <section className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2.5">
                <p className="text-[13px] text-ink-2">Phòng {s.room_name} có sự cố cơ sở vật chất?</p>
                <Button size="sm" variant="secondary" icon={Wrench} onClick={() => setModal({ type: 'issue' })}>Báo sự cố phòng học</Button>
              </section>
            )}

            <details className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-[13px]">
              <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-ink-2"><Info className="size-3.5" />Quy tắc tính buổi</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-3">{data.rules.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>

            {data.history.length > 0 && (
              <section><h3 className="mb-2 text-sm font-semibold">Lịch sử</h3>
                <Timeline items={data.history.map((h) => ({ key: h.id, title: h.summary, meta: `${h.by_name || 'Hệ thống'} · ${dateTime(h.created_at)}` }))} />
              </section>
            )}
            {saveErr && <Alert tone="danger">{saveErr.message}</Alert>}
          </div>
        )}
      </Drawer>

      <RoomIssueModal open={modal?.type === 'issue'} onOpenChange={(v) => !v && setModal(null)} session={s} />
      <RescheduleModal open={modal?.type === 'resched'} onOpenChange={(v) => !v && setModal(null)} session={s} onDone={() => { reload(); onChanged?.(); }} />
      <MakeupModal open={modal?.type === 'makeup'} onOpenChange={(v) => !v && setModal(null)} absence={modal?.absence} onDone={() => { reload(); onChanged?.(); }} />
      <TrialResultModal open={modal?.type === 'trial'} onOpenChange={(v) => !v && setModal(null)} trial={modal?.trial} onDone={() => { reload(); onChanged?.(); }} />
      <ConfirmDialog open={modal?.type === 'cancel'} onOpenChange={(v) => !v && setModal(null)} title="Hủy buổi học?" confirmLabel="Hủy buổi học" reason reasonLabel="Lý do hủy"
        message="Buổi đã hủy không chiếm phòng/giáo viên và không trừ buổi của học viên. Lịch học bù đã xếp vào buổi này sẽ bị hủy để xếp lại."
        onConfirm={async (reason) => { await api.post(`/api/sessions/${s.id}/cancel`, { reason }); toast.success('Đã hủy buổi học.'); reload(); onChanged?.(); }} />
    </>
  );
}

/** Báo sự cố cơ sở vật chất từ buổi học: theo tài sản trong phòng hoặc sự cố phát sinh mới, kèm thời gian đề xuất xử lý */
function RoomIssueModal({ open, onOpenChange, session }) {
  const toast = useToast();
  const assets = useApi(open && session?.room_id ? `/api/assets?room_id=${session.room_id}` : null, { keepPrevious: false });
  const f = useForm({ asset_id: '', title: '', description: '', severity: 'normal', requested_due: addDays(todayVN(), 2) });
  useEffect(() => { if (open) { f.setValues({ asset_id: '', title: '', description: '', severity: 'normal', requested_due: addDays(todayVN(), 2) }); f.setErrors({}); f.setFormError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!session) return null;
  const roomAssets = (assets.data?.items || []).filter((a) => a.room_id === session.room_id && a.status !== 'disposed');
  const save = () => f.submit(async (v) => {
    const r = await api.post('/api/assets/issues', { asset_id: Number(v.asset_id) || null, room_id: session.room_id, title: v.asset_id ? null : v.title, description: v.description, severity: v.severity, requested_due: v.requested_due || null, session_id: session.id });
    toast.success(`Đã báo sự cố ${r.code}. Bộ phận cơ sở vật chất và Giám đốc nhận thông báo.`); onOpenChange(false);
  }, (v) => ({ title: !v.asset_id && !v.title.trim() && 'Chọn tài sản hoặc nhập tên sự cố.', description: !v.description.trim() && 'Mô tả sự cố.' }));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Báo sự cố phòng ${session.room_name}`} description="Gửi bộ phận cơ sở vật chất xử lý theo thời gian đề xuất."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={f.submitting}>Gửi báo cáo</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Tài sản trong phòng" hint="Để trống nếu là sự cố phát sinh mới"><Select {...f.bind('asset_id')} placeholder="— Phát sinh mới —">{roomAssets.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
          {!f.values.asset_id && <Field label="Tên sự cố" required error={f.errors.title}><Input placeholder="Ví dụ: Bóng đèn nhấp nháy" {...f.bind('title')} /></Field>}
          <Field label="Mức độ"><Select {...f.bind('severity')}><option value="low">Thấp</option><option value="normal">Trung bình</option><option value="high">Cao — ảnh hưởng buổi học</option></Select></Field>
          <Field label="Đề xuất xử lý trước ngày"><DateInput min={todayVN()} {...f.bind('requested_due')} /></Field>
        </FormGrid>
        <Field label="Mô tả" required error={f.errors.description}><Textarea {...f.bind('description')} /></Field>
        {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
      </div>
    </Modal>
  );
}
