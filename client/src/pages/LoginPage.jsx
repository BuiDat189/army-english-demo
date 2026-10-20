import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, FlaskConical, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/hooks.js';
import { Button, Field, Input, Alert, useForm, Spinner } from '../components/ui/index.js';
import { ROLE_LABELS } from '../lib/labels.js';

export default function LoginPage() {
  const { user, login, demoMode, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const demo = useApi(demoMode ? '/api/auth/demo-accounts' : null);
  // 6 vai trò theo yêu cầu trung tâm lên trước, các tài khoản khác liệt kê bên dưới
  const PRIORITY = ['quanly', 'truongsales', 'tuvan', 'giaovu', 'giaovien', 'thungan'];
  const accounts = [...(demo.data?.accounts || [])].sort((a, b) => (PRIORITY.indexOf(a.username) + 1 || 99) - (PRIORITY.indexOf(b.username) + 1 || 99));
  const f = useForm({ username: '', password: '' });
  const [quick, setQuick] = useState(null);

  if (loading) return <div className="flex min-h-dvh items-center justify-center"><Spinner /></div>;
  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  const doLogin = (vals) => f.submit(async (v) => {
    await login(v.username.trim(), v.password);
    navigate(location.state?.from || '/', { replace: true });
  }, (v) => ({ username: !v.username.trim() && 'Vui lòng nhập tên đăng nhập.', password: !v.password && 'Vui lòng nhập mật khẩu.' }), vals);

  const quickLogin = async (acc) => {
    setQuick(acc.username);
    f.setValues({ username: acc.username, password: demo.data.password });
    try { await login(acc.username, demo.data.password); navigate('/', { replace: true }); } catch (e) { f.setFormError(e); } finally { setQuick(null); }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <div className="relative hidden overflow-hidden bg-side lg:block">
        {/* Hoạ tiết chấm trôi rất chậm + biểu tượng lơ lửng (tắt khi giảm chuyển động) */}
        <div className="absolute -inset-12 animate-drift opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '22px 22px' }} aria-hidden />
        <div className="absolute -bottom-24 -right-24 size-[420px] rounded-full bg-[radial-gradient(circle,rgb(79_181_116/0.35),transparent_65%)]" aria-hidden />
        <img src="/army-mark.png" alt="" width="360" height="360" aria-hidden className="pointer-events-none absolute -right-10 top-1/4 size-80 rotate-12 animate-float opacity-[0.10]" />
        <div className="stagger relative flex h-full flex-col justify-between p-12 text-white">
          <div style={{ '--i': 0 }} className="inline-flex w-fit items-center rounded-xl bg-[#fff] px-4 py-3 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)]"><img src="/army-logo.png" alt="ARMY ENGLISH – English for future leaders" width="166" height="44" className="h-11 w-auto" /></div>
          <div style={{ '--i': 1 }} className="max-w-lg">
            <h1 className="text-3xl font-semibold leading-tight">Quản lý vận hành chi nhánh</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-side-ink">Tuyển sinh, học viên, lớp học, điểm danh, học phí, chăm sóc và công việc nội bộ — trên một nguồn dữ liệu thống nhất.</p>
            <ul className="stagger mt-8 space-y-3 text-sm text-white/90">
              {['Dữ liệu liên thông từ tư vấn đến tái đăng ký', 'Công nợ tính từ phiếu thu đã xác nhận', 'Phân quyền theo vai trò, kiểm tra ở máy chủ'].map((t, i) => (
                <li key={t} style={{ '--i': i + 3 }} className="flex items-center gap-2.5"><span className="flex size-6 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15"><ShieldCheck className="size-3.5 text-star" aria-hidden /></span>{t}</li>
              ))}
            </ul>
          </div>
          <p style={{ '--i': 6 }} className="text-xs text-side-ink-2">Bản trình diễn nội bộ. Toàn bộ học viên, phụ huynh, nhân sự là dữ liệu giả.</p>
        </div>
      </div>

      <div className="flex items-center justify-center bg-surface px-5 py-10 sm:px-10">
        <div className="w-full max-w-md animate-rise">
          <span className="mb-8 inline-flex rounded-xl bg-[#fff] px-3 py-2 ring-1 ring-line lg:hidden"><img src="/army-logo.png" alt="ARMY ENGLISH" width="151" height="40" className="h-10 w-auto" /></span>
          <h2 className="text-2xl font-semibold tracking-tight">Đăng nhập</h2>
          <p className="mt-1 text-sm text-ink-3">Dùng tài khoản nhân sự của chi nhánh.</p>
          <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); doLogin(); }} noValidate>
            <Field label="Tên đăng nhập" error={f.errors.username} required>
              <Input autoComplete="username" autoFocus {...f.bind('username')} />
            </Field>
            <Field label="Mật khẩu" error={f.errors.password} required>
              <Input type="password" autoComplete="current-password" {...f.bind('password')} />
            </Field>
            {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
            <Button type="submit" size="lg" className="w-full" loading={f.submitting} icon={LogIn}>Đăng nhập</Button>
          </form>

          {demoMode && (
            <div className="mt-8">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><FlaskConical className="size-4 text-amber-600" aria-hidden />Tài khoản demo</div>
              <p className="mt-1 text-xs text-ink-3">Chế độ demo đang bật. Chọn một vai trò để đăng nhập nhanh{demo.data ? <> (mật khẩu chung: <code className="rounded bg-canvas px-1 py-0.5 font-mono text-ink">{demo.data.password}</code>)</> : null}.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {demo.loading && <Spinner />}
                {accounts.slice(0, 6).map((a) => (
                  <button key={a.id} type="button" onClick={() => quickLogin(a)} disabled={!!quick}
                    className="group flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2.5 text-left transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-[var(--shadow-lift)] disabled:opacity-60">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{a.title || a.roles.map((r) => ROLE_LABELS[r]).join(' + ')}</span>
                      <span className="block truncate text-xs text-ink-3">{a.full_name} · {a.username}</span>
                    </span>
                    {quick === a.username ? <Spinner className="size-4" /> : <LogIn className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-700" aria-hidden />}
                  </button>
                ))}
              </div>
              {accounts.length > 6 && <p className="mt-2 text-xs text-ink-3">Tài khoản khác: {accounts.slice(6).map((a) => `${a.username} (${a.title || a.roles.map((r) => ROLE_LABELS[r]).join(' + ')})`).join(', ')}.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
