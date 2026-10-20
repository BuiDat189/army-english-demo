import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, LookupProvider, useAuth } from './lib/auth.jsx';
import { ToastProvider, Spinner, ErrorState } from './components/ui/index.js';
import AppShell from './components/layout/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';

const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage.jsx'));
const LeadsPage = lazy(() => import('./pages/leads/LeadsPage.jsx'));
const LeadDetailPage = lazy(() => import('./pages/leads/LeadDetailPage.jsx'));
const StudentsPage = lazy(() => import('./pages/students/StudentsPage.jsx'));
const StudentDetailPage = lazy(() => import('./pages/students/StudentDetailPage.jsx'));
const ClassesPage = lazy(() => import('./pages/classes/ClassesPage.jsx'));
const ClassDetailPage = lazy(() => import('./pages/classes/ClassDetailPage.jsx'));
const SchedulePage = lazy(() => import('./pages/schedule/SchedulePage.jsx'));
const TrainingPage = lazy(() => import('./pages/training/TrainingPage.jsx'));
const LearningPage = lazy(() => import('./pages/learning/LearningPage.jsx'));
const PerformancePage = lazy(() => import('./pages/performance/PerformancePage.jsx'));
const FinancePage = lazy(() => import('./pages/finance/FinancePage.jsx'));
const ReceiptPrintPage = lazy(() => import('./pages/finance/ReceiptPrintPage.jsx'));
const CarePage = lazy(() => import('./pages/care/CarePage.jsx'));
const TasksPage = lazy(() => import('./pages/tasks/TasksPage.jsx'));
const HrPage = lazy(() => import('./pages/hr/HrPage.jsx'));
const ApprovalsPage = lazy(() => import('./pages/approvals/ApprovalsPage.jsx'));
const AssetsPage = lazy(() => import('./pages/assets/AssetsPage.jsx'));
const IssueDetailPage = lazy(() => import('./pages/assets/IssueDetailPage.jsx'));
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage.jsx'));
const NoticesPage = lazy(() => import('./pages/notices/NoticesPage.jsx'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const AcademicCalendarPage = lazy(() => import('./pages/academic/AcademicCalendarPage.jsx'));

function FullLoader() {
  return <div className="flex min-h-[50vh] items-center justify-center"><Spinner className="size-6" /></div>;
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

/** Chặn truy cập trang khi thiếu quyền (backend vẫn kiểm tra quyền ở từng API) */
function Guard({ perms, children }) {
  const { can } = useAuth();
  if (perms && !can(...perms)) return <div className="card"><ErrorState error={{ status: 403, message: 'Vai trò hiện tại không được phép truy cập trang này.' }} /></div>;
  return <Suspense fallback={<FullLoader />}>{children}</Suspense>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <LookupProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/finance/receipts/:id/print" element={<RequireAuth><Guard perms={['finance.view']}><ReceiptPrintPage /></Guard></RequireAuth>} />
              <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route index element={<Guard perms={['dashboard.view']}><DashboardPage /></Guard>} />
                <Route path="leads" element={<Guard perms={['leads.view']}><LeadsPage /></Guard>} />
                <Route path="leads/:id" element={<Guard perms={['leads.view']}><LeadDetailPage /></Guard>} />
                <Route path="students" element={<Guard perms={['students.view', 'students.view_own']}><StudentsPage /></Guard>} />
                <Route path="students/:id" element={<Guard perms={['students.view', 'students.view_own']}><StudentDetailPage /></Guard>} />
                <Route path="classes" element={<Guard perms={['classes.view', 'classes.view_own']}><ClassesPage /></Guard>} />
                <Route path="classes/:id" element={<Guard perms={['classes.view', 'classes.view_own']}><ClassDetailPage /></Guard>} />
                <Route path="class-events" element={<Guard perms={['classes.view', 'classes.view_own']}><AcademicCalendarPage /></Guard>} />
                <Route path="schedule" element={<Guard perms={['classes.view', 'classes.view_own']}><SchedulePage /></Guard>} />
                <Route path="training" element={<Guard perms={['attendance.edit', 'attendance.edit_own', 'makeup.edit']}><TrainingPage /></Guard>} />
                <Route path="learning" element={<Guard perms={['checkin.edit', 'learning.edit', 'learning.edit_own', 'support.view']}><LearningPage /></Guard>} />
                <Route path="performance" element={<Guard perms={['performance.view']}><PerformancePage /></Guard>} />
                <Route path="finance" element={<Guard perms={['finance.view']}><FinancePage /></Guard>} />
                <Route path="finance/receipts" element={<Navigate to="/finance?tab=receipts" replace />} />
                <Route path="finance/receipts/:id" element={<Guard perms={['finance.view']}><ReceiptPrintPage embedded /></Guard>} />
                <Route path="care" element={<Guard perms={['care.view']}><CarePage /></Guard>} />
                <Route path="tasks" element={<Guard><TasksPage /></Guard>} />
                <Route path="hr" element={<Guard perms={['hr.view', 'teaching.log']}><HrPage /></Guard>} />
                <Route path="approvals" element={<Guard><ApprovalsPage /></Guard>} />
                <Route path="assets" element={<Guard perms={['assets.view', 'assets.report']}><AssetsPage /></Guard>} />
                <Route path="assets/issues/:id" element={<Guard perms={['assets.view', 'assets.report']}><IssueDetailPage /></Guard>} />
                <Route path="inventory" element={<Guard perms={['inventory.view']}><InventoryPage /></Guard>} />
                <Route path="notices" element={<Guard><NoticesPage /></Guard>} />
                <Route path="reports" element={<Guard perms={['reports.enrollment', 'reports.attendance', 'reports.finance', 'reports.teaching', 'reports.tasks', 'reports.daily', 'reports.staff_ec', 'reports.staff_cm', 'assets.view']}><ReportsPage /></Guard>} />
                <Route path="account" element={<Guard><AccountPage /></Guard>} />
                <Route path="*" element={<div className="card"><ErrorState error={{ status: 404, message: 'Trang không tồn tại hoặc đã được di chuyển.' }} /></div>} />
              </Route>
            </Routes>
          </LookupProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
