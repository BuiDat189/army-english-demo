import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeft, Pencil, UserPlus, Star, Unlink, PauseCircle, Wallet, Percent, Undo2, Printer, Ban, BookPlus, School, XCircle, CalendarPlus, HeartHandshake, Archive, RotateCcw, Plus, Phone, Mail,
  Repeat, FileX2, PiggyBank, UserCheck, CalendarClock,
} from 'lucide-react';
import { api, newIdempotencyKey } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useAuth, useLookups } from '../../lib/auth.jsx';
import { date, dateTime, money, phone, age } from '../../lib/format.js';
import { METHODS, CARE_TYPES, CARE_CHANNELS } from '../../lib/labels.js';
import {
  Card, CardHeader, Button, StatusBadge, Badge, KeyValue, Tabs, Timeline, DataTable, EmptyState, ErrorState, LoadingRows, Alert, Menu, ConfirmDialog, ProgressBar, Drawer, Modal, Field, Input, Select, Textarea, FormGrid, useToast, ConflictList, DateInput,
} from '../../components/ui/index.js';
import { StudentFormDrawer, ContactModal, ParentEditModal } from './StudentForms.jsx';
import { CollectReceiptModal, DiscountModal, RefundModal } from '../../components/business/FinanceModals.jsx';
import { AssignClassModal, MakeupModal } from '../../components/business/ClassModals.jsx';
import EnrollmentFields, { emptyEnrollment, validateEnrollment, toEnrollmentPayload } from '../../components/business/EnrollmentFields.jsx';
import CareCaseModal from '../../components/business/CareCaseModal.jsx';
import { TagsModal, TagChips, WalletCard, TopupModal, ApplyWalletModal, RequestModal, LearningTab } from '../../components/business/StudentExtras.jsx';
import { todayVN } from '../../lib/format.js';

export default function StudentDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); if (t === 'overview') n.delete('tab'); else n.set('tab', t); return n; }, { replace: true });
  const { data, error, loading, reload } = useApi(`/api/students/${id}`);
  const { can } = useAuth();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const close = (v) => !v && setModal(null);

  if (error && !data) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card>{loading && <LoadingRows />}</Card>;
  const { student: s, summary } = data;
  const tabs = [
    { value: 'overview', label: 'Tổng quan' },
    { value: 'classes', label: 'Khóa/lớp học', count: data.enrollments.length },
    { value: 'attendance', label: 'Điểm danh', count: data.attendance.length },
    { value: 'learning', label: 'Học tập' },
    data.can.finance && { value: 'finance', label: 'Học phí' },
    data.can.care && { value: 'care', label: 'Chăm sóc', count: summary.openCare || undefined },
  ].filter(Boolean);

  return (
    <div>
      <Link to="/students" className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />Danh sách học viên</Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand-100 text-base font-semibold text-brand-800" aria-hidden>{s.full_name.split(' ').slice(-1)[0][0]}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{s.full_name}</h1><StatusBadge kind="student" value={s.status} /></div>
            <p className="text-sm text-ink-3">{s.code}{s.dob ? ` · ${date(s.dob)} (${age(s.dob)} tuổi)` : ''}{s.level ? ` · ${s.level}` : ''}</p>
            <TagChips tags={s.tags} onEdit={data.can.edit ? () => setModal({ type: 'tags' }) : null} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.can.checkin && s.status === 'active' && (data.checkins?.[0]?.date === todayVN()
            ? <Badge tone="success">Đã check-in hôm nay</Badge>
            : <Button variant="secondary" icon={UserCheck} onClick={async () => { try { await api.post('/api/learning/checkins', { student_id: s.id }); toast.success('Đã check-in.'); reload(); } catch (e) { toast.error(e.message); } }}>Check-in</Button>)}
          {can('enrollments.create') && s.status !== 'archived' && <Button variant="secondary" icon={BookPlus} onClick={() => setModal({ type: 'enroll' })}>Đăng ký khóa</Button>}
          {data.can.edit && <Button variant="secondary" icon={Pencil} onClick={() => setModal({ type: 'edit' })}>Sửa</Button>}
          {data.can.edit && <Menu items={[
            s.status !== 'archived' && { label: 'Lưu trữ hồ sơ', icon: Archive, danger: true, onSelect: () => setModal({ type: 'archive' }) },
            s.status === 'archived' && { label: 'Khôi phục hồ sơ', icon: RotateCcw, onSelect: async () => { try { await api.post(`/api/students/${s.id}/restore`); toast.success('Đã khôi phục.'); reload(); } catch (e) { toast.error(e.message); } } },
          ]} />}
        </div>
      </div>
      {s.status === 'archived' && <Alert tone="warning" className="mb-4" title="Hồ sơ đã lưu trữ">{s.archived_reason}</Alert>}

      <div className={clsx('mb-4 grid grid-cols-2 gap-3', data.wallet?.balance > 0 ? 'md:grid-cols-5' : 'md:grid-cols-4')}>
        <MiniStat label="Khóa đang học" value={data.enrollments.filter((e) => e.status === 'active').length} />
        <MiniStat label="Buổi đã học" value={summary.attended} />
        <MiniStat label="Buổi vắng" value={summary.absences} />
        {data.can.finance ? <MiniStat label="Công nợ" value={money(summary.debt)} tone={summary.debt > 0 ? 'danger' : undefined} /> : <MiniStat label="Việc chăm sóc mở" value={summary.openCare ?? '—'} />}
        {data.wallet?.balance > 0 && <MiniStat label="Số dư" value={money(data.wallet.balance)} />}
      </div>

      <Card>
        <Tabs className="px-4 sm:px-5" tabs={tabs} value={tab} onChange={setTab} />
        <div className="p-4 sm:p-5">
          {tab === 'overview' && <Overview data={data} reload={reload} setModal={setModal} />}
          {tab === 'classes' && <ClassesTab data={data} reload={reload} setModal={setModal} />}
          {tab === 'attendance' && <AttendanceTab data={data} reload={reload} setModal={setModal} />}
          {tab === 'learning' && <LearningTab data={data} />}
          {tab === 'finance' && data.can.finance && <FinanceTab data={data} reload={reload} setModal={setModal} />}
          {tab === 'care' && data.can.care && <CareTab data={data} reload={reload} setModal={setModal} />}
        </div>
      </Card>

      <StudentFormDrawer open={modal?.type === 'edit'} onOpenChange={close} student={s} onSaved={reload} />
      <ContactModal open={modal?.type === 'contact'} onOpenChange={close} studentId={s.id} onDone={reload} />
      <ParentEditModal open={modal?.type === 'parent'} onOpenChange={close} parent={modal?.parent} onDone={reload} />
      <EnrollDrawer open={modal?.type === 'enroll'} onOpenChange={close} student={s} previous={modal?.previous}
        renew={!!modal?.previous || data.enrollments.some((e) => ['active', 'completed', 'reserved'].includes(e.status))} onDone={() => { reload(); setTab('finance'); }} />
      <TagsModal open={modal?.type === 'tags'} onOpenChange={close} student={s} suggestions={data.tagSuggestions} onDone={reload} />
      {data.wallet && <TopupModal open={modal?.type === 'topup'} onOpenChange={close} student={s} onDone={reload} />}
      {data.wallet && <ApplyWalletModal open={modal?.type === 'applyWallet'} onOpenChange={close} enrollment={modal?.enrollment} balance={data.wallet.balance} onDone={reload} />}
      <RequestModal open={modal?.type === 'request'} onOpenChange={close} type={modal?.request} enrollment={modal?.enrollment} student={s} balance={data.wallet?.balance || 0} onDone={reload} />
      <AssignClassModal open={modal?.type === 'assign'} onOpenChange={close} enrollment={modal?.type === 'assign' ? { ...modal.enrollment, studentName: s.full_name } : null} onDone={reload} />
      <CollectReceiptModal open={modal?.type === 'collect'} onOpenChange={close} enrollment={modal?.type === 'collect' ? modal.enrollment : null} studentName={s.full_name} onDone={reload} />
      <DiscountModal open={modal?.type === 'discount'} onOpenChange={close} enrollment={modal?.type === 'discount' ? modal.enrollment : null} onDone={reload} />
      <RefundModal open={modal?.type === 'refund'} onOpenChange={close} enrollment={modal?.type === 'refund' ? modal.enrollment : null} onDone={reload} />
      <MakeupModal open={modal?.type === 'makeup'} onOpenChange={close} absence={modal?.type === 'makeup' ? modal.absence : null} onDone={reload} />
      <CareCaseModal open={modal?.type === 'care'} onOpenChange={close} studentId={s.id} onDone={reload} />
      <ConfirmDialog open={modal?.type === 'archive'} onOpenChange={close} title="Lưu trữ hồ sơ học viên?" reason reasonLabel="Lý do lưu trữ" confirmLabel="Lưu trữ"
        message="Hồ sơ đã phát sinh nghiệp vụ không bị xóa; chỉ chuyển sang trạng thái lưu trữ và có thể khôi phục." onConfirm={async (reason) => { await api.post(`/api/students/${s.id}/archive`, { reason }); toast.success('Đã lưu trữ hồ sơ.'); reload(); }} />
      <ConfirmDialog open={modal?.type === 'cancelEnroll'} onOpenChange={close} title="Hủy đăng ký khóa?" reason reasonLabel="Lý do hủy" confirmLabel="Hủy đăng ký"
        message={modal?.enrollment && <>Đăng ký <b>{modal.enrollment.code}</b> sẽ chuyển sang “Đã hủy”. Phần học phí chưa thu sẽ không còn là công nợ. Nếu cần hoàn tiền, tạo đề nghị hoàn phí riêng.</>}
        onConfirm={async (reason) => { await api.post(`/api/enrollments/${modal.enrollment.id}/cancel`, { reason }); toast.success('Đã hủy đăng ký.'); reload(); }} />
      <ConfirmDialog open={modal?.type === 'reserve'} onOpenChange={close} title="Bảo lưu đăng ký?" reason reasonLabel="Lý do bảo lưu" confirmLabel="Bảo lưu" tone="primary"
        message={modal?.enrollment && <>Học viên rời lớp <b>{modal.enrollment.class_code || '—'}</b> (giải phóng chỗ). Học phí, công nợ và số buổi đã học được giữ nguyên; khi học lại dùng “Xếp lớp”.</>}
        onConfirm={async (reason) => { await api.post(`/api/enrollments/${modal.enrollment.id}/reserve`, { reason }); toast.success('Đã bảo lưu đăng ký.'); reload(); }} />
      <ConfirmDialog open={modal?.type === 'cancelReceipt'} onOpenChange={close} title={`Hủy phiếu thu ${modal?.receipt?.code || ''}?`} reason reasonLabel="Lý do hủy phiếu" confirmLabel="Hủy phiếu thu"
        message="Phiếu thu đã xác nhận không bị xóa. Phiếu chuyển sang “Đã hủy”, lưu lý do và người hủy; công nợ được tính lại." onConfirm={async (reason) => { await api.post(`/api/finance/receipts/${modal.receipt.id}/cancel`, { reason }); toast.success('Đã hủy phiếu thu.'); reload(); }} />
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  return <div className="card px-4 py-3"><p className="text-xs text-ink-3">{label}</p><p className={clsx('mt-1 text-lg font-semibold tabular', tone === 'danger' && 'text-red-700')}>{value}</p></div>;
}

function Overview({ data, reload, setModal }) {
  const { student: s, contacts, timeline } = data;
  const toast = useToast();
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-sm font-semibold">Thông tin học viên</h2>
          <KeyValue items={[['Họ tên', s.full_name], ['Mã học viên', s.code], ['Ngày sinh', s.dob ? date(s.dob) : null], ['Giới tính', s.gender === 'male' ? 'Nam' : s.gender === 'female' ? 'Nữ' : null], ['Trường', s.school], ['Trình độ hiện tại', s.level], ['Ngày tạo hồ sơ', dateTime(s.created_at)], ['Ghi chú', s.note]]} />
        </section>
        {contacts && (
          <section>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Người liên hệ</h2>{data.can.edit && <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setModal({ type: 'contact' })}>Thêm</Button>}</div>
            <ul className="space-y-2">
              {contacts.map((p) => (
                <li key={p.id} className="rounded-[var(--radius-control)] border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{p.full_name} <span className="font-normal text-ink-3">· {p.relationship}</span> {p.is_primary ? <Badge tone="success" className="ml-1">Liên hệ chính</Badge> : null}</p>
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2"><span className="inline-flex items-center gap-1 tabular"><Phone className="size-3.5 text-ink-3" />{phone(p.phone)}</span>{p.email && <span className="inline-flex items-center gap-1"><Mail className="size-3.5 text-ink-3" />{p.email}</span>}</p>
                      {p.siblings && <p className="mt-1 text-xs text-ink-3">Anh/chị/em cùng phụ huynh: {p.siblings.split(';').map((x) => { const [n, sid] = x.split('|'); return <Link key={sid} to={`/students/${sid}`} className="mr-2 font-medium text-brand-700 hover:underline">{n}</Link>; })}</p>}
                    </div>
                    {data.can.edit && <Menu items={[
                      { label: 'Sửa thông tin phụ huynh', icon: Pencil, onSelect: () => setModal({ type: 'parent', parent: p }) },
                      !p.is_primary && { label: 'Đặt làm liên hệ chính', icon: Star, onSelect: async () => { await api.post(`/api/students/${s.id}/contacts/${p.id}/primary`); reload(); } },
                      contacts.length > 1 && { label: 'Gỡ liên kết', icon: Unlink, danger: true, onSelect: async () => { try { await api.del(`/api/students/${s.id}/contacts/${p.id}`); toast.success('Đã gỡ liên kết.'); reload(); } catch (e) { toast.error(e.message); } } },
                    ]} />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Lịch sử xuyên suốt</h2>
        <p className="mb-3 text-xs text-ink-3">Từ tư vấn, học thử, đăng ký đến học tập, học phí và chăm sóc.</p>
        <Timeline items={timeline.map((t, i) => ({ key: i, title: t.link ? <Link to={t.link} className="font-medium text-brand-700 hover:underline">{t.text}</Link> : t.text, meta: `${t.by ? `${t.by} · ` : ''}${dateTime(t.at)}`, tone: t.kind === 'receipt_cancelled' || t.kind === 'enrollment_cancelled' ? 'danger' : t.kind === 'lead' || t.kind === 'consult' || t.kind === 'trial' ? 'muted' : undefined }))} />
      </section>
    </div>
  );
}

function ClassesTab({ data, setModal }) {
  const { can } = useAuth();
  const { courses } = useLookups();
  if (!data.enrollments.length) return <EmptyState title="Chưa đăng ký khóa nào" action={can('enrollments.create') && <Button icon={BookPlus} onClick={() => setModal({ type: 'enroll' })}>Đăng ký khóa</Button>} />;
  return (
    <div className="space-y-3">
      {data.enrollments.map((e) => {
        const u = e.usage;
        const next = courses.find((c) => c.id === courses.find((x) => x.id === e.course_id)?.next_course_id);
        const renewed = data.enrollments.some((x) => x.previous_enrollment_id === e.id && x.status !== 'cancelled');
        return (
          <div key={e.id} className="rounded-[var(--radius-control)] border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{e.course_name}</p><StatusBadge kind="enrollment" value={e.status} />{e.kind === 'renew' ? <Badge tone="purple">Tái phí</Badge> : <Badge tone="info">Học viên mới</Badge>}</div>
                {e.package_name && <p className="mt-0.5 text-[13px] text-ink-2">Gói phí: <b className="font-medium">{e.package_name}</b> · {e.free_absences} buổi nghỉ không tính phí · bảo lưu {e.reserve_count}/{e.reserve_limit} lần</p>}
                {e.status === 'pending_approval' && <p className="mt-1 text-[13px] font-medium text-violet-700">Học phí đang chờ Giám đốc duyệt — chưa thu được học phí (có thể nạp tiền cọc).</p>}
                {e.status === 'reserved' && e.reserved_to && <p className="mt-1 text-[13px] font-medium text-amber-700">Bảo lưu {date(e.reserved_from)} – {date(e.reserved_to)}</p>}
                {e.fee_summary && <p className="mt-0.5 text-[13px] text-ink-2">Đã đóng {money(e.fee_summary.paid)} / {money(e.fee_summary.net)}</p>}
                <p className="mt-0.5 text-[13px] text-ink-3">{e.code} · đăng ký {date(e.enrolled_at)}{e.class_code ? <> · lớp <Link className="font-medium text-brand-700 hover:underline" to={`/classes/${e.class_id}`}>{e.class_code}</Link> (GV {e.teacher_name})</> : ' · chưa xếp lớp'}</p>
                {e.cancel_reason && <p className="mt-1 text-[13px] text-red-700">Lý do hủy: {e.cancel_reason}</p>}
                {e.note && <p className="mt-1 text-[13px] text-ink-2">{e.note}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {['pending_class', 'reserved'].includes(e.status) && can('classes.edit', 'enrollments.create') && <Button size="sm" icon={School} onClick={() => setModal({ type: 'assign', enrollment: e })}>Xếp lớp</Button>}
                {e.status === 'active' && u.remaining <= 4 && !renewed && can('enrollments.create') && next && <Button size="sm" variant="secondary" icon={BookPlus} onClick={() => setModal({ type: 'enroll', previous: { ...e, next_course_id: next.id } })}>Tái đăng ký {next.name}</Button>}
                {['pending_approval', 'pending_class', 'active', 'reserved'].includes(e.status) && can('classes.edit', 'finance.refund_request', 'requests.create', 'finance.discount_request') && <Menu label={`Thao tác đăng ký ${e.code}`} items={[
                  can('finance.discount_request') && !can('finance.view') && { label: 'Đề nghị giảm học phí', icon: Percent, onSelect: () => setModal({ type: 'discount', enrollment: e }) },
                  can('requests.create') && { label: 'Đề nghị đổi gói phí', icon: Repeat, onSelect: () => setModal({ type: 'request', request: 'package_change', enrollment: e }) },
                  ['pending_class', 'active'].includes(e.status) && can('requests.create') && { label: `Đề nghị bảo lưu (${e.reserve_count ?? 0}/${e.reserve_limit ?? 0} lần)`, icon: PauseCircle, onSelect: () => setModal({ type: 'request', request: 'reserve', enrollment: e }) },
                  ['pending_class', 'active'].includes(e.status) && can('requests.create') && { label: 'Đề nghị chuyển lớp', icon: Repeat, onSelect: () => setModal({ type: 'request', request: 'class_transfer', enrollment: e }) },
                  ['pending_class', 'active'].includes(e.status) && can('requests.create') && { label: 'Đề nghị lên level mới', icon: BookPlus, onSelect: () => setModal({ type: 'request', request: 'level_up', enrollment: e }) },
                  can('requests.create') && { label: 'Đề nghị hủy hợp đồng (kèm hoàn phí)', icon: FileX2, onSelect: () => setModal({ type: 'request', request: 'contract_cancel', enrollment: e }) },
                  can('classes.edit', 'finance.refund_request') && { label: 'Hủy đăng ký', icon: XCircle, danger: true, onSelect: () => setModal({ type: 'cancelEnroll', enrollment: e }) },
                ]} />}
              </div>
            </div>
            {['active', 'completed'].includes(e.status) && u && (
              <div className="mt-3">
                <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-ink-3"><span>Đã tính {u.used}/{u.total} buổi · có mặt {u.attended} · nghỉ {u.absences}{u.freeAbsences ? ` (miễn phí ${u.freeUsed}/${u.freeAbsences})` : ''}</span><span className={u.remaining <= 4 && e.status === 'active' ? 'font-semibold text-amber-700' : ''}>Còn {u.remaining} buổi{e.expected_end ? <> · <CalendarClock className="inline size-3.5 align-[-2px]" /> dự kiến hết học phí {date(e.expected_end)}</> : ''}</span></div>
                <ProgressBar value={u.used} max={u.total} tone={u.remaining <= 4 && e.status === 'active' ? 'warning' : 'brand'} />
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink-3">Cách tính buổi: có mặt/đi muộn trừ 1 buổi; nghỉ có phép hay không phép đều tính là nghỉ và trừ 1 buổi, trừ các buổi nghỉ trong hạn mức miễn phí của gói (gói 96 buổi: 4 buổi). Buổi trung tâm cho nghỉ được bù cuối khóa, không trừ phí.</p>
    </div>
  );
}

function AttendanceTab({ data, setModal }) {
  const { can } = useAuth();
  const columns = [
    { key: 'date', header: 'Ngày', mobile: 'title', render: (a) => <span className="tabular">{date(a.date)} {a.start_time}</span> },
    { key: 'class', header: 'Lớp', render: (a) => a.class_code || a.title || '—' },
    { key: 'topic', header: 'Nội dung', render: (a) => <span className="text-ink-2">{a.topic || '—'}</span> },
    { key: 'status', header: 'Điểm danh', render: (a) => <div className="flex flex-wrap gap-1"><StatusBadge kind="attendance" value={a.status} />{a.is_makeup ? <Badge tone="purple">Buổi học bù</Badge> : null}</div> },
    { key: 'note', header: 'Ghi chú', render: (a) => a.note || '—' },
    { key: 'makeup', header: 'Học bù', stop: true, render: (a) => {
      if (a.is_makeup || !['absent', 'excused'].includes(a.status)) return '—';
      if (a.makeup_status) return <span className="text-[13px]"><StatusBadge kind="makeup" value={a.makeup_status} /> <span className="text-ink-3">{date(a.makeup_date)} {a.makeup_time}</span></span>;
      return can('makeup.edit') ? <Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => setModal({ type: 'makeup', absence: { attendance_id: a.id, full_name: data.student.full_name, date: a.date, class_code: a.class_code } })}>Xếp học bù</Button> : <span className="text-ink-3">Chưa xếp</span>;
    } },
  ];
  return <div className="-mx-4 -my-4 sm:-mx-5 sm:-my-5"><DataTable columns={columns} rows={data.attendance} dense pageSize={20} empty={<EmptyState compact title="Chưa có dữ liệu điểm danh" />} /></div>;
}

function FinanceTab({ data, setModal }) {
  const { can } = useAuth();
  const enrolls = data.enrollments;
  const reserved = (eid) => (data.refunds || []).filter((r) => r.enrollment_id === eid && ['requested', 'approved', 'paid'].includes(r.status)).reduce((s, r) => s + r.amount, 0);
  const receiptCols = [
    { key: 'code', header: 'Số phiếu', mobile: 'title', nowrap: true, render: (r) => <Link to={`/finance/receipts/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.code}</Link> },
    { key: 'paid_at', header: 'Ngày thu', nowrap: true, render: (r) => date(r.paid_at) },
    { key: 'enrollment_code', header: 'Đăng ký', nowrap: true },
    { key: 'amount', header: 'Số tiền', align: 'right', render: (r) => <span className={r.status === 'cancelled' ? 'text-ink-3 line-through' : 'font-medium'}>{money(r.amount)}</span> },
    { key: 'method', header: 'Hình thức', render: (r) => METHODS[r.method] },
    { key: 'collector', header: 'Người thu' },
    { key: 'status', header: 'Trạng thái', render: (r) => <span title={r.cancel_reason || undefined}><StatusBadge kind="receipt" value={r.status} /></span> },
    { key: 'act', header: '', stop: true, render: (r) => <Menu items={[
      { label: 'Xem / in phiếu', icon: Printer, onSelect: () => window.open(`/finance/receipts/${r.id}/print`, '_blank', 'noopener') },
      r.status === 'confirmed' && can('finance.cancel') && { label: 'Hủy phiếu thu', icon: Ban, danger: true, onSelect: () => setModal({ type: 'cancelReceipt', receipt: r }) },
    ]} /> },
  ];
  return (
    <div className="space-y-5">
      {data.wallet && <WalletCard wallet={data.wallet} canCollect={can('finance.collect')} canRequest={can('requests.create')}
        onTopup={() => setModal({ type: 'topup' })} onTransfer={() => setModal({ type: 'request', request: 'fee_transfer' })} />}
      {!enrolls.length && <EmptyState compact title="Chưa có khoản phải thu" />}
      {enrolls.map((e) => {
        const f = e.finance;
        return (
          <div key={e.id} className="rounded-[var(--radius-control)] border border-line">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{e.code} · {e.course_name}</p><StatusBadge kind="payment" value={f.paymentStatus} /></div>
                <p className="text-xs text-ink-3">Đăng ký {date(e.enrolled_at)}{e.package_name ? ` · ${e.package_name}` : ''} · <StatusBadge kind="enrollment" value={e.status} /></p>
              </div>
              <div className="flex flex-wrap gap-2">
                {f.debt > 0 && can('finance.collect') && <Button size="sm" icon={Wallet} onClick={() => setModal({ type: 'collect', enrollment: e })}>Thu tiền</Button>}
                {f.debt > 0 && data.wallet?.balance > 0 && can('finance.collect') && e.status !== 'cancelled' && <Button size="sm" variant="secondary" icon={PiggyBank} onClick={() => setModal({ type: 'applyWallet', enrollment: e })}>Trừ số dư</Button>}
                {e.status !== 'cancelled' && f.debt > 0 && can('finance.discount_request') && <Button size="sm" variant="secondary" icon={Percent} onClick={() => setModal({ type: 'discount', enrollment: e })}>Đề nghị giảm</Button>}
                {f.paid - reserved(e.id) > 0 && can('finance.refund_request') && <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setModal({ type: 'refund', enrollment: { ...e, reservedRefund: reserved(e.id) } })}>Đề nghị hoàn</Button>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-5">
              {[['Học phí', money(f.fee)], ['Giảm đã duyệt', f.discount ? `− ${money(f.discount)}` : '0 đ'], ['Phải thu', money(f.net)], ['Đã thu', money(f.paid)], ['Công nợ', <span key="d" className={f.debt > 0 ? 'font-semibold text-red-700' : 'font-semibold text-brand-700'}>{money(f.debt)}</span>]].map(([k, v]) => (
                <div key={k}><p className="text-xs text-ink-3">{k}</p><p className="text-sm font-medium tabular">{v}</p></div>
              ))}
            </div>
            {e.discounts?.length > 0 && (
              <div className="border-t border-line px-4 py-2.5 text-[13px]">
                {e.discounts.map((d) => <p key={d.id} className="flex flex-wrap items-center gap-2"><span>Giảm {d.kind === 'percent' ? `${d.value}%` : money(d.value)} ({money(d.amount)}) — {d.reason}</span><StatusBadge kind="discount" value={d.status} />{d.approval_code && <Link to={`/approvals?id=${d.approval_id}`} className="text-xs text-brand-700 hover:underline">{d.approval_code}</Link>}</p>)}
              </div>
            )}
            {f.installments.length > 0 && (
              <div className="scroll-thin overflow-x-auto border-t border-line">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-2 font-medium">Đợt</th><th className="px-4 py-2 font-medium">Hạn</th><th className="px-4 py-2 text-right font-medium">Số tiền</th><th className="px-4 py-2 text-right font-medium">Đã phân bổ</th><th className="px-4 py-2 text-right font-medium">Còn lại</th><th className="px-4 py-2 font-medium">Tình trạng</th></tr></thead>
                  <tbody>{f.installments.map((i) => (
                    <tr key={i.id} className="border-t border-line/70"><td className="px-4 py-2">Đợt {i.seq}</td><td className="px-4 py-2 tabular">{date(i.due_date)}</td><td className="px-4 py-2 text-right tabular">{money(i.amount)}</td><td className="px-4 py-2 text-right tabular">{money(i.paid)}</td><td className="px-4 py-2 text-right tabular">{money(i.remaining)}</td><td className="px-4 py-2"><StatusBadge kind="installment" value={i.status} /></td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Lịch sử phiếu thu</h2>
        <div className="overflow-hidden rounded-[var(--radius-control)] border border-line"><DataTable columns={receiptCols} rows={data.receipts} dense empty={<EmptyState compact title="Chưa có phiếu thu" />} /></div>
      </section>
      {data.refunds?.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Hoàn phí</h2>
          <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {data.refunds.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]"><span>{r.code} · {money(r.amount)} · {r.reason}</span><span className="flex items-center gap-2"><StatusBadge kind="refund" value={r.status} />{r.approval_code && <Link to={`/approvals?id=${r.approval_id}`} className="text-xs text-brand-700 hover:underline">{r.approval_code}</Link>}</span></li>)}
          </ul>
        </section>
      )}
      <p className="text-xs text-ink-3">Công nợ = học phí − giảm phí đã duyệt − phiếu thu đã xác nhận. Đề nghị giảm phí đang chờ duyệt chưa làm giảm công nợ. Hoàn phí chỉ được ghi nhận khi thu ngân xác nhận đã chi.</p>
    </div>
  );
}

function CareTab({ data, setModal }) {
  const { can } = useAuth();
  return (
    <div className="space-y-5">
      <div className="flex justify-end">{can('care.edit') && <Button size="sm" icon={Plus} onClick={() => setModal({ type: 'care' })}>Tạo việc chăm sóc</Button>}</div>
      {!data.care.length ? <EmptyState compact icon={HeartHandshake} title="Chưa có việc chăm sóc" /> : (
        <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {data.care.map((c) => (
            <li key={c.id}><Link to={`/care?id=${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-canvas">
              <div><p className="text-sm font-medium">{c.title}</p><p className="text-xs text-ink-3">{c.code} · {CARE_TYPES[c.type]} · {c.owner_name || 'Chưa giao'}{c.due_date ? ` · hạn ${date(c.due_date)}` : ''}</p></div>
              <StatusBadge kind="care" value={c.status} />
            </Link></li>
          ))}
        </ul>
      )}
      {data.careLogs?.length > 0 && (
        <section><h2 className="mb-2 text-sm font-semibold">Lịch sử liên hệ</h2>
          <Timeline items={data.careLogs.map((l) => ({ key: l.id, title: <><b className="font-medium">{CARE_CHANNELS[l.channel]}:</b> {l.content}</>, body: l.result ? `Kết quả: ${l.result}` : null, meta: `${l.by_name} · ${dateTime(l.created_at)} · ${l.case_title}` }))} />
        </section>
      )}
    </div>
  );
}

function EnrollDrawer({ open, onOpenChange, student, previous, renew, onDone }) {
  const { courses } = useLookups();
  const { can } = useAuth();
  const toast = useToast();
  const [v, setV] = useState(emptyEnrollment());
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(null);
  useEffect(() => { if (open) { setV(emptyEnrollment(previous?.next_course_id || '')); setErrors({}); setErr(null); key.current = newIdempotencyKey(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const fee = courses.find((c) => c.id === Number(v.course_id))?.tuition_fee;
  const save = async () => {
    if (busy) return;
    const e = validateEnrollment(v, fee);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/api/enrollments', { student_id: student.id, ...toEnrollmentPayload(v), previous_enrollment_id: previous?.id || null }, { idempotencyKey: key.current });
      toast.success(r.duplicate ? 'Đăng ký đã được tạo trước đó (không tạo trùng).' : r.status === 'pending_approval' ? 'Đã tạo đăng ký — học phí đã gửi Giám đốc duyệt.' : 'Đã tạo đăng ký khóa học.');
      onOpenChange(false); onDone?.();
    } catch (x) { setErr(x); if (x.fields) setErrors(x.fields); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} width="lg" title={previous ? 'Tái đăng ký khóa tiếp theo' : 'Đăng ký khóa học'} description={`${student.full_name} · ${student.code}${previous ? ` · nối tiếp ${previous.code} (${previous.course_name})` : ''}`}
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Hủy</Button><Button onClick={save} loading={busy}>Tạo đăng ký</Button></>}>
      {!can('approvals.decide') && <Alert tone="info" className="mb-4">Học phí {previous ? 'tái phí' : 'đăng ký'} cần <b>Giám đốc trung tâm duyệt</b>. Sau khi duyệt, kế toán mới thu được học phí; doanh số ghi cho người tạo đăng ký.</Alert>}
      <EnrollmentFields value={v} onChange={setV} errors={errors} renew={renew} />
      {err && !err.fields && <Alert tone="danger" className="mt-4" title={err.message}><ConflictList error={err} /></Alert>}
    </Drawer>
  );
}
