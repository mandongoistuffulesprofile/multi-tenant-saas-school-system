import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { SCHOOL_ADMIN_ROLES, FINANCE_ROLES, ACADEMIC_ROLES, ADMIN_ROLES } from "./lib/roles";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import SchoolPickerPage from "./pages/SchoolPickerPage";
import ProfilePage from "./pages/ProfilePage";
import SchoolProfilePage from "./pages/SchoolProfilePage";
import IntegrationsPage from "./pages/IntegrationsPage";
import AcademicCalendarPage from "./pages/AcademicCalendarPage";
import GradesStreamsPage from "./pages/GradesStreamsPage";
import StaffPage from "./pages/StaffPage";
import TeachingAllocationPage from "./pages/TeachingAllocationPage";
import LearnersPage from "./pages/LearnersPage";
import FinanceFeeStructuresPage from "./pages/FinanceFeeStructuresPage";
import FinanceFeeCategoriesPage from "./pages/FinanceFeeCategoriesPage";
import FinanceInvoicesPage from "./pages/FinanceInvoicesPage";
import FinancePaymentsPage from "./pages/FinancePaymentsPage";
import FinanceCreditsPage from "./pages/FinanceCreditsPage";
import FinanceAdjustmentsPage from "./pages/FinanceAdjustmentsPage";
import FinanceRefundsPage from "./pages/FinanceRefundsPage";
import FinanceMpesaPage from "./pages/FinanceMpesaPage";
import FinanceReconciliationPage from "./pages/FinanceReconciliationPage";
import CurriculumPage from "./pages/CurriculumPage";
import AssessmentPage from "./pages/AssessmentPage";
import ReportsPage from "./pages/ReportsPage";
import CommsPage from "./pages/CommsPage";
import CommsComposePage from "./pages/CommsComposePage";
import CompliancePage from "./pages/CompliancePage";
import ConsentNoticesPage from "./pages/ConsentNoticesPage";
import DsrRequestsPage from "./pages/DsrRequestsPage";
import BreachRegisterPage from "./pages/BreachRegisterPage";
import AttendancePage from "./pages/AttendancePage";
import KnecPage from "./pages/KnecPage";
import PlatformPage from "./pages/PlatformPage";
import SaaSLayout from "./components/organisms/SaaSLayout";
import OperationsCentrePage from "./pages/saas/OperationsCentrePage";
import TenantRegistryPage from "./pages/saas/TenantRegistryPage";
import TenantOnboardingPage from "./pages/saas/TenantOnboardingPage";
import CurriculumConfiguratorPage from "./pages/saas/CurriculumConfiguratorPage";
import SubscriptionsPage from "./pages/saas/SubscriptionsPage";
import IntegrationHealthPage from "./pages/saas/IntegrationHealthPage";
import ImpersonationPage from "./pages/saas/ImpersonationPage";
import PlatformAuditPage from "./pages/saas/PlatformAuditPage";
import ParentPage from "./pages/ParentPage";
import ParentLayout from "./components/organisms/ParentLayout";
import ParentHomePage from "./pages/parent/ParentHomePage";
import ParentProgressPage from "./pages/parent/ParentProgressPage";
import ParentFeesPage from "./pages/parent/ParentFeesPage";
import ParentReceiptsPage from "./pages/parent/ParentReceiptsPage";
import ParentAttendancePage from "./pages/parent/ParentAttendancePage";
import ParentNoticesPage from "./pages/parent/ParentNoticesPage";
import ParentConsentsPage from "./pages/parent/ParentConsentsPage";
import ParentActivatePage from "./pages/parent/ParentActivatePage";
import ParentForgotPage from "./pages/parent/ParentForgotPage";
import DashboardPage from "./pages/DashboardPage";
import RequireRole from "./components/RequireRole";
import { useAuthStore, isTokenValid } from "./lib/authStore";
import Layout from "./components/organisms/Layout";
import TeacherLayout from "./components/organisms/TeacherLayout";
import MyClassesPage from "./pages/teacher/MyClassesPage";
import GradingGridPage from "./pages/teacher/GradingGridPage";
import EvidenceCapturePage from "./pages/teacher/EvidenceCapturePage";
import LearnerRemarksPage from "./pages/teacher/LearnerRemarksPage";
import AttendanceRegisterPage from "./pages/teacher/AttendanceRegisterPage";
import SyncCentrePage from "./pages/teacher/SyncCentrePage";
import ClassProgressPage from "./pages/teacher/ClassProgressPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token);
  if (!isTokenValid(token)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireGuest({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token);
  if (isTokenValid(token)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<RequireGuest><LoginPage /></RequireGuest>} />
      <Route path="/forgot-password" element={<RequireGuest><ForgotPasswordPage /></RequireGuest>} />
      <Route path="/school-picker" element={<RequireAuth><SchoolPickerPage /></RequireAuth>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/school" element={<RequireRole roles={SCHOOL_ADMIN_ROLES}><SchoolProfilePage /></RequireRole>} />
        <Route path="/integrations" element={<RequireRole roles={SCHOOL_ADMIN_ROLES}><IntegrationsPage /></RequireRole>} />
        <Route path="/calendar" element={<RequireRole roles={ADMIN_ROLES}><AcademicCalendarPage /></RequireRole>} />
        <Route path="/grades-streams" element={<RequireRole roles={ACADEMIC_ROLES}><GradesStreamsPage /></RequireRole>} />
        <Route path="/staff" element={<RequireRole roles={ADMIN_ROLES}><StaffPage /></RequireRole>} />
        <Route path="/teaching-allocation" element={<RequireRole roles={ACADEMIC_ROLES}><TeachingAllocationPage /></RequireRole>} />
        <Route path="/learners" element={<RequireRole roles={ACADEMIC_ROLES}><LearnersPage /></RequireRole>} />
        <Route path="/finance/fee-categories" element={<RequireRole roles={FINANCE_ROLES}><FinanceFeeCategoriesPage /></RequireRole>} />
        <Route path="/finance/fee-structures" element={<RequireRole roles={FINANCE_ROLES}><FinanceFeeStructuresPage /></RequireRole>} />
        <Route path="/finance/invoices" element={<RequireRole roles={FINANCE_ROLES}><FinanceInvoicesPage /></RequireRole>} />
        <Route path="/finance/payments" element={<RequireRole roles={FINANCE_ROLES}><FinancePaymentsPage /></RequireRole>} />
        <Route path="/finance/credits" element={<RequireRole roles={FINANCE_ROLES}><FinanceCreditsPage /></RequireRole>} />
        <Route path="/finance/adjustments" element={<RequireRole roles={FINANCE_ROLES}><FinanceAdjustmentsPage /></RequireRole>} />
        <Route path="/finance/refunds" element={<RequireRole roles={FINANCE_ROLES}><FinanceRefundsPage /></RequireRole>} />
        <Route path="/finance/mpesa" element={<RequireRole roles={FINANCE_ROLES}><FinanceMpesaPage /></RequireRole>} />
        <Route path="/finance/reconciliation" element={<RequireRole roles={FINANCE_ROLES}><FinanceReconciliationPage /></RequireRole>} />
        <Route path="/curriculum" element={<RequireRole roles={ACADEMIC_ROLES}><CurriculumPage /></RequireRole>} />
        <Route path="/assessment" element={<RequireRole roles={ACADEMIC_ROLES}><AssessmentPage /></RequireRole>} />
        <Route path="/reports" element={<RequireRole roles={ACADEMIC_ROLES}><ReportsPage /></RequireRole>} />
        <Route path="/comms" element={<RequireRole roles={ADMIN_ROLES}><CommsPage /></RequireRole>} />
        <Route path="/comms/compose" element={<RequireRole roles={ADMIN_ROLES}><CommsComposePage /></RequireRole>} />
        <Route path="/compliance" element={<RequireRole roles={SCHOOL_ADMIN_ROLES}><CompliancePage /></RequireRole>} />
        <Route path="/compliance/consent" element={<RequireRole roles={SCHOOL_ADMIN_ROLES}><ConsentNoticesPage /></RequireRole>} />
        <Route path="/compliance/dsr" element={<RequireRole roles={SCHOOL_ADMIN_ROLES}><DsrRequestsPage /></RequireRole>} />
        <Route path="/compliance/breach" element={<RequireRole roles={SCHOOL_ADMIN_ROLES}><BreachRegisterPage /></RequireRole>} />
        <Route path="/attendance" element={<RequireRole roles={ACADEMIC_ROLES}><AttendancePage /></RequireRole>} />
        <Route path="/knec" element={<RequireRole roles={SCHOOL_ADMIN_ROLES}><KnecPage /></RequireRole>} />
        <Route path="/platform" element={<RequireRole roles={SCHOOL_ADMIN_ROLES}><SaaSLayout /></RequireRole>}>
          <Route index element={<OperationsCentrePage />} />
          <Route path="tenants" element={<TenantRegistryPage />} />
          <Route path="onboard" element={<TenantOnboardingPage />} />
          <Route path="curriculum" element={<CurriculumConfiguratorPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="integrations" element={<IntegrationHealthPage />} />
          <Route path="impersonate" element={<ImpersonationPage />} />
          <Route path="audit" element={<PlatformAuditPage />} />
        </Route>
        <Route element={<RequireAuth><ParentLayout /></RequireAuth>}>
          <Route index element={<ParentHomePage />} />
          <Route path="progress" element={<ParentProgressPage />} />
          <Route path="fees" element={<ParentFeesPage />} />
          <Route path="receipts" element={<ParentReceiptsPage />} />
          <Route path="attendance" element={<ParentAttendancePage />} />
          <Route path="notices" element={<ParentNoticesPage />} />
          <Route path="consents" element={<ParentConsentsPage />} />
        </Route>
        <Route path="/parent/activate" element={<ParentActivatePage />} />
        <Route path="/parent/forgot-password" element={<ParentForgotPage />} />
      </Route>
      <Route element={<RequireAuth><TeacherLayout /></RequireAuth>}>
        <Route path="/teacher/classes" element={<MyClassesPage />} />
        <Route path="/teacher/grading" element={<GradingGridPage />} />
        <Route path="/teacher/evidence" element={<EvidenceCapturePage />} />
        <Route path="/teacher/remarks" element={<LearnerRemarksPage />} />
        <Route path="/teacher/attendance" element={<AttendanceRegisterPage />} />
        <Route path="/teacher/sync" element={<SyncCentrePage />} />
        <Route path="/teacher/progress" element={<ClassProgressPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
