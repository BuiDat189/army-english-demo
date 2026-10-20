import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Repeat2, ShieldCheck, FlaskConical } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { useAuth, useLookups } from '../lib/auth.jsx';
import { dateTime } from '../lib/format.js';
import { ROLE_LABELS } from '../lib/labels.js';
import { PageHeader, Card, CardHeader, Button, Badge, KeyValue, ConfirmDialog, Alert, useToast } from '../components/ui/index.js';

export default function AccountPage() {
  const { user, permissions, demoMode, can, switchUser, refresh } = useAuth();
  const lookups = useLookups();
  const roles = useApi('/api/auth/roles');
  const demo = useApi(demoMode && user.is_demo ? '/api/auth/demo-accounts' : null);
  const status = useApi('/api/demo/status');
  const toast = useToast();
  const navigate = useNavigate();
  const [reset, setReset] = useState(false);
  const doSwitch = async (a) => {
    try { await switchUser(a.id); toast.success(`Đã chuyển sang ${a.full_name}.`); navigate('/'); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Tài khoản & phân quyền" description="Thông tin tài khoản, vai trò và quyền hiện có. Quyền được kiểm tra ở máy chủ cho từng thao tác." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tài khoản đang đăng nhập" />
          <div className="space-y-4 px-5 pb-5">
            <KeyValue items={[['Họ tên', user.full_name], ['Mã nhân sự', user.code], ['Chức danh', user.title], ['Email', user.email], ['Vai trò', <span key="r" className="flex flex-wrap gap-1">{user.roles.map((r) => <Badge key={r} tone="brand" dot={false}>{ROLE_LABELS[r]}</Badge>)}</span>]]} />
            <details className="text-sm"><summary className="cursor-pointer font-medium text-brand-700">Xem {permissions.size} quyền hiện có</summary>
              <ul className="mt-2 grid list-disc gap-1 pl-5 text-[13px] text-ink-2 sm:grid-cols-2">{[...permissions].sort().map((p) => <li key={p}><code className="text-xs">{p}</code></li>)}</ul>
            </details>
          </div>
        </Card>
        {demoMode && (
          <Card>
            <CardHeader title="Chế độ demo" icon={FlaskConical} description="Chỉ bật khi DEMO_MODE=true. Tắt chế độ này sẽ vô hiệu hóa tài khoản demo, chuyển nhanh tài khoản và nút reset." />
            <div className="space-y-4 px-5 pb-5">
              <KeyValue items={[['Dữ liệu demo tạo lúc', dateTime(status.data?.seededAt)], ['Ngày gốc của dữ liệu', status.data?.seedToday], ['Quét nhắc việc gần nhất', status.data?.remindersLastRun]]} />
              {demo.data && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><Repeat2 className="size-4 text-ink-3" />Chuyển nhanh tài khoản demo</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {demo.data.accounts.map((a) => (
                      <button key={a.id} type="button" disabled={a.id === user.id} onClick={() => doSwitch(a)} className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-left hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-default disabled:bg-brand-50">
                        <span className="block text-[13px] font-medium">{a.full_name}{a.id === user.id ? ' (đang dùng)' : ''}</span>
                        <span className="block text-xs text-ink-3">{a.roles.map((r) => ROLE_LABELS[r]).join(' · ')} · {a.username}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {can('demo.reset') ? (
                <div className="rounded-[var(--radius-control)] border border-red-200 bg-red-50/50 p-3">
                  <p className="text-sm font-medium text-red-800">Khôi phục dữ liệu demo</p>
                  <p className="mt-0.5 text-xs text-red-800/80">Xóa toàn bộ dữ liệu demo hiện tại (kể cả thao tác vừa trình diễn) và tạo lại bộ dữ liệu mẫu theo ngày hôm nay.</p>
                  <Button variant="danger" size="sm" icon={RotateCcw} className="mt-2" onClick={() => setReset(true)}>Reset dữ liệu demo</Button>
                </div>
              ) : <Alert tone="info">Chỉ quản lý được reset dữ liệu demo.</Alert>}
            </div>
          </Card>
        )}
      </div>
      <Card>
        <CardHeader title="Vai trò và quyền trong hệ thống" icon={ShieldCheck} description="Một nhân sự có thể kiêm nhiều vai trò; quyền là hợp các vai trò." />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
          {roles.data?.roles.map((r) => (
            <div key={r.key} className="rounded-[var(--radius-control)] border border-line p-3">
              <p className="text-sm font-semibold">{r.label}</p>
              <p className="mb-2 text-xs text-ink-3">{lookups.staff.filter((s) => s.roles.includes(r.key)).map((s) => s.full_name).join(', ')}</p>
              <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">{r.permissions.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ))}
        </div>
      </Card>
      <ConfirmDialog open={reset} onOpenChange={setReset} title="Reset toàn bộ dữ liệu demo?" typeToConfirm="RESET" confirmLabel="Reset dữ liệu"
        message="Mọi thay đổi trong phiên demo sẽ mất. Thao tác chỉ ảnh hưởng dữ liệu demo và chỉ khả dụng khi DEMO_MODE=true."
        onConfirm={async () => { await api.post('/api/demo/reset', { confirm: 'RESET' }); toast.success('Đã khôi phục dữ liệu demo.'); await refresh(); lookups.reload(); navigate('/'); }} />
    </div>
  );
}
