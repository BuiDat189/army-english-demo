import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, FlaskConical, ShieldCheck, Sparkles, Users, GraduationCap, Wallet, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/hooks.js';
import { Button, Field, Input, Alert, useForm, Spinner } from '../components/ui/index.js';
import { ROLE_LABELS } from '../lib/labels.js';

const ROLE_ACCENTS = {
  quanly: 'border-l-amber-400 hover:border-amber-400',
  truongsales: 'border-l-rose-500 hover:border-rose-400',
  tuvan: 'border-l-sky-500 hover:border-sky-400',
  giaovu: 'border-l-emerald-500 hover:border-emerald-400',
  giaovien: 'border-l-violet-500 hover:border-violet-400',
  thungan: 'border-l-amber-600 hover:border-amber-500',
};

export default function LoginPage() {
  const { user, login, demoMode, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const demo = useApi(demoMode ? '/api/auth/demo-accounts' : null);
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
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_minmax(0,580px)]">
      <div className="side-panel relative hidden overflow-hidden lg:block">
        <div className="absolute -inset-12 animate-drift opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} aria-hidden />
        <div className="absolute -bottom-28 -right-24 size-[480px] rounded-full bg-[radial-gradient(circle,rgb(16_185_129/0.32),transparent_65%)]" aria-hidden />
        <div className="absolute -left-20 top-1/3 size-[360px] rounded-full bg-[radial-gradient(circle,rgb(99_102_241/0.25),transparent_65%)]" aria-hidden />
        <img src="/army-mark.png" alt="" width="360" height="360" aria-hidden className="pointer-events-none absolute -right-8 top-16 size-80 rotate-12 animate-float opacity-[0.08]" />

        <div className="stagger relative flex h-full flex-col justify-between p-12 text-white xl:p-16">
          <div style={{ '--i': 0 }} className="flex items-center gap-3">
            <div className="inline-flex items-center rounded-2xl bg-white px-4 py-2.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.5)]">
              <img src="/army-logo.png" alt="ARMY ENGLISH – English for future leaders" width="166" height="44" className="h-10 w-auto" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-brand-300 ring-1 ring-inset ring-white/15 backdrop-blur-xs">
              <Sparkles className="size-3.5 text-star" aria-hidden />Bento Workspace 2.0
            </span>
          </div>

          <div style={{ '--i': 1 }} className="max-w-xl">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight xl:text-[38px]">
              Hệ điều hành quản trị trung tâm Anh ngữ toàn diện
            </h1>
            <p className="mt-3.5 text-[15px] leading-relaxed text-side-ink">
              Kết nối xuyên suốt 6 bộ phận từ Tư vấn tuyển sinh (EC), Học thuật, Giáo viên chủ nhiệm (CM) đến Kế toán & Giám đốc trên một luồng dữ liệu thời gian thực.
            </p>

            {/* Bento feature preview grid */}
            <div className="mt-8 grid grid-cols-3 gap-3">
              {[
                { icon: Users, title: 'CRM & Check-in', desc: 'Khóa quyền giữ khách tự động khi check-in' },
                { icon: GraduationCap, title: 'Đào tạo & BTVN', desc: 'Điểm danh, học bù, cảnh báo chuyên cần <90%' },
                { icon: Wallet, title: 'Tài chính & Duyệt', desc: 'Ví học viên, công nợ & phê duyệt 2 cấp' },
              ].map((item, idx) => (
                <div key={item.title} style={{ '--i': idx + 2 }} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-md">
                  <span className="inline-flex size-8 items-center justify-center rounded-xl bg-brand-500/20 text-brand-300 ring-1 ring-inset ring-brand-400/30">
                    <item.icon className="size-4" aria-hidden />
                  </span>
                  <p className="mt-2.5 text-xs font-bold text-white">{item.title}</p>
                  <p className="mt-1 text-[11px] leading-snug text-side-ink-2">{item.desc}</p>
                </div>
              ))}
            </div>

            <ul className="stagger mt-6 space-y-2.5 text-sm text-white/90">
              {[
                'Dữ liệu liên thông từ tư vấn đến tái đăng ký',
                'Công nợ tính từ phiếu thu đã xác nhận & số dư ví',
                'Phân quyền 6 vai trò chuẩn hóa, kiểm tra trực tiếp ở máy chủ',
              ].map((t, i) => (
                <li key={t} style={{ '--i': i + 5 }} className="flex items-center gap-2.5">
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand-500/20 ring-1 ring-brand-400/40">
                    <ShieldCheck className="size-3.5 text-brand-300" aria-hidden />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <p style={{ '--i': 8 }} className="text-xs text-side-ink-2">
            Bản trình diễn nội bộ ARMY ENGLISH. Toàn bộ học viên, phụ huynh, nhân sự là dữ liệu giả lập.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center bg-surface px-5 py-10 sm:px-10">
        <div className="w-full max-w-md animate-rise">
          <span className="mb-6 inline-flex rounded-xl bg-white px-3 py-2 shadow-xs ring-1 ring-line lg:hidden">
            <img src="/army-logo.png" alt="ARMY ENGLISH" width="151" height="40" className="h-10 w-auto" />
          </span>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200/80">
            <span className="size-1.5 rounded-full bg-brand-500" aria-hidden />Cổng đăng nhập nhân sự
          </div>
          <h2 className="mt-2.5 text-2xl font-bold tracking-tight text-ink sm:text-[26px]">Chào mừng trở lại</h2>
          <p className="mt-1 text-sm text-ink-3">Đăng nhập bằng tài khoản nội bộ hoặc chọn nhanh vai trò bên dưới.</p>

          <form className="mt-5 space-y-4 rounded-2xl border border-line bg-surface-2/60 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); doLogin(); }} noValidate>
            <Field label="Tên đăng nhập" error={f.errors.username} required>
              <Input autoComplete="username" autoFocus placeholder="VD: quanly, tuvan, giaovien..." {...f.bind('username')} />
            </Field>
            <Field label="Mật khẩu" error={f.errors.password} required>
              <Input type="password" autoComplete="current-password" placeholder="••••••••" {...f.bind('password')} />
            </Field>
            {f.formError && !f.formError.fields && <Alert tone="danger">{f.formError.message}</Alert>}
            <Button type="submit" size="lg" className="w-full" loading={f.submitting} icon={LogIn}>Đăng nhập hệ thống</Button>
          </form>

          {demoMode && (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[13px] font-bold text-ink">
                  <FlaskConical className="size-4 text-amber-600" aria-hidden />Trải nghiệm nhanh 6 vai trò Demo
                </div>
                {demo.data && <code className="rounded-md bg-canvas px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-2 ring-1 ring-inset ring-line">MK: {demo.data.password}</code>}
              </div>
              <p className="mt-1 text-xs text-ink-3">Bấm 1 chạm vào vai trò bất kỳ để vào thẳng giao diện của bộ phận đó:</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {demo.loading && <Spinner />}
                {accounts.slice(0, 6).map((a) => (
                  <button key={a.id} type="button" onClick={() => quickLogin(a)} disabled={!!quick}
                    className={clsx(
                      'group flex items-center justify-between gap-2 rounded-xl border border-line border-l-4 bg-surface px-3.5 py-2.5 text-left shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-50/30 hover:shadow-[var(--shadow-lift)] disabled:opacity-60',
                      ROLE_ACCENTS[a.username] || 'border-l-brand-500',
                    )}>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-ink group-hover:text-brand-700">{a.title || a.roles.map((r) => ROLE_LABELS[r]).join(' + ')}</span>
                      <span className="block truncate text-xs text-ink-3">{a.full_name} · <span className="font-mono">{a.username}</span></span>
                    </span>
                    {quick === a.username ? <Spinner className="size-4" /> : <ArrowRight className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />}
                  </button>
                ))}
              </div>
              {accounts.length > 6 && <p className="mt-2.5 text-xs text-ink-3">Tài khoản khác: {accounts.slice(6).map((a) => `${a.username} (${a.title || a.roles.map((r) => ROLE_LABELS[r]).join(' + ')})`).join(', ')}.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
