import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardPen, BookOpenCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { date, todayVN } from '../../lib/format.js';
import { Button, EmptyState, DataState, Modal, Field, Input, Select, DateInput, Alert, useToast } from '../../components/ui/index.js';

const sc = (x) => (x === null || x === undefined ? '—' : String(Math.round(x * 10) / 10).replace('.', ','));

/** Điểm kiểm tra của lớp: bảng điểm (học viên × bài kiểm tra) và nhập điểm cả lớp một lần */
export default function AssessmentsTab({ cls, students, canEdit }) {
  const { data, error, loading, reload } = useApi(`/api/learning/assessments?class_id=${cls.id}`);
  const [open, setOpen] = useState(false);
  const tests = useMemo(() => {
    const m = new Map();
    for (const a of data?.items || []) {
      const k = `${a.taken_at}|${a.title}`;
      if (!m.has(k)) m.set(k, { key: k, title: a.title, taken_at: a.taken_at, kind: a.kind, max: a.max_score, scores: new Map() });
      m.get(k).scores.set(a.student_id, a);
    }
    return [...m.values()].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  }, [data]);
  const active = students.filter((s) => s.status === 'active');
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">Điểm quy về thang 10 để tính trung bình. Điểm dưới 6,5 được tô đỏ và tính vào gợi ý bổ trợ học tập.</p>
        {canEdit && <Button icon={ClipboardPen} onClick={() => setOpen(true)}>Nhập điểm bài kiểm tra</Button>}
      </div>
      <DataState loading={loading} error={error} data={data} onRetry={reload}>
        {() => (!tests.length ? <EmptyState icon={BookOpenCheck} title="Chưa có điểm kiểm tra" description={canEdit ? 'Bấm "Nhập điểm bài kiểm tra" để nhập điểm cho cả lớp.' : undefined} /> : (
          <div className="scroll-thin overflow-x-auto rounded-[var(--radius-control)] border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-canvas text-left text-xs text-ink-3">
                <tr>
                  <th className="sticky left-0 bg-canvas px-3 py-2 font-medium">Học viên</th>
                  {tests.map((t) => <th key={t.key} className="whitespace-nowrap px-3 py-2 text-right font-medium" title={`${data.kinds[t.kind]} · thang ${t.max}`}>{t.title}<span className="block font-normal">{date(t.taken_at)}</span></th>)}
                  <th className="px-3 py-2 text-right font-medium">TB (/10)</th>
                </tr>
              </thead>
              <tbody>
                {active.map((s) => {
                  const vals = tests.map((t) => t.scores.get(s.id)).filter(Boolean).map((a) => (a.score * 10) / a.max_score);
                  const avg = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
                  return (
                    <tr key={s.id} className="border-t border-line/70">
                      <td className="sticky left-0 bg-surface px-3 py-2"><Link to={`/students/${s.id}?tab=learning`} className="font-medium hover:text-brand-700 hover:underline">{s.full_name}</Link></td>
                      {tests.map((t) => {
                        const a = t.scores.get(s.id);
                        return <td key={t.key} className={`px-3 py-2 text-right tabular ${a && (a.score * 10) / a.max_score < 6.5 ? 'font-semibold text-red-700' : ''}`} title={a?.comment || undefined}>{a ? sc(a.score) : '—'}</td>;
                      })}
                      <td className={`px-3 py-2 text-right font-semibold tabular ${avg !== null && avg < 6.5 ? 'text-red-700' : ''}`}>{sc(avg)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </DataState>
      <ScoreEntryModal open={open} onOpenChange={setOpen} cls={cls} students={active} kinds={data?.kinds || {}} onDone={reload} />
    </div>
  );
}

function ScoreEntryModal({ open, onOpenChange, cls, students, kinds, onDone }) {
  const toast = useToast();
  const [v, setV] = useState({ title: '', kind: 'unit', taken_at: todayVN(), max_score: 10 });
  const [scores, setScores] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/api/learning/assessments', {
        class_id: cls.id, ...v, max_score: Number(v.max_score) || 10,
        scores: students.map((s) => ({ student_id: s.id, score: scores[s.id]?.score ?? '', comment: scores[s.id]?.comment || null })),
      });
      toast.success(`Đã nhập điểm cho ${r.count} học viên.`);
      setScores({}); setV({ title: '', kind: 'unit', taken_at: todayVN(), max_score: 10 });
      onOpenChange(false); onDone?.();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const fe = err?.fields || {};
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title={`Nhập điểm – ${cls.code}`} description="Để trống điểm của học viên vắng thi. Có thể ghi nhận xét ngắn cho từng học viên."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button loading={busy} onClick={save}>Lưu điểm</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Tên bài kiểm tra" required error={fe.title}><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Ví dụ: Kiểm tra Unit 5–6" /></Field>
          <Field label="Loại"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Ngày kiểm tra" required error={fe.taken_at}><DateInput value={v.taken_at} max={todayVN()} onChange={(e) => setV({ ...v, taken_at: e.target.value })} /></Field>
          <Field label="Thang điểm"><Input type="number" min={1} max={100} value={v.max_score} onChange={(e) => setV({ ...v, max_score: e.target.value })} /></Field>
        </div>
        <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {students.map((s, i) => (
            <li key={s.id} className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_6rem_1.4fr]">
              <span className="text-sm font-medium">{s.full_name}</span>
              <Input type="number" min={0} max={v.max_score} step={0.25} inputMode="decimal" aria-label={`Điểm ${s.full_name}`} placeholder="Điểm" className="h-8"
                aria-invalid={fe[`scores.${i}.score`] ? 'true' : undefined}
                value={scores[s.id]?.score ?? ''} onChange={(e) => setScores({ ...scores, [s.id]: { ...scores[s.id], score: e.target.value } })} />
              <Input aria-label={`Nhận xét ${s.full_name}`} placeholder="Nhận xét (không bắt buộc)" className="h-8"
                value={scores[s.id]?.comment ?? ''} onChange={(e) => setScores({ ...scores, [s.id]: { ...scores[s.id], comment: e.target.value } })} />
            </li>
          ))}
        </ul>
        {err && <Alert tone="danger">{err.message}{Object.entries(fe).filter(([k]) => k.startsWith('scores.')).length ? ' Kiểm tra các ô điểm được đánh dấu.' : ''}</Alert>}
      </div>
    </Modal>
  );
}
