import React from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { isTokenValid, useAuthStore } from "./lib/authStore";
import {
  ACADEMIC_ROLES,
  ADMIN_ROLES,
  FINANCE_ROLES,
  SCHOOL_ADMIN_ROLES,
  Role,
} from "./lib/roles";
import Layout from "./components/organisms/Layout";
import ParentLayout from "./components/organisms/ParentLayout";
import TeacherLayout from "./components/organisms/TeacherLayout";
import SaaSLayout from "./components/organisms/SaaSLayout";
import RequireRole from "./components/RequireRole";
import { PWAOfflineSyncBanner } from "./components/PWAOfflineSyncBanner";

import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import DashboardPage from "./pages/DashboardPage";
import SchoolPickerPage from "./pages/SchoolPickerPage";
import SchoolProfilePage from "./pages/SchoolProfilePage";
import IntegrationsPage from "./pages/IntegrationsPage";
import AcademicCalendarPage from "./pages/AcademicCalendarPage";
import StaffPage from "./pages/StaffPage";
import LearnersPage from "./pages/LearnersPage";
import GradesStreamsPage from "./pages/GradesStreamsPage";
import TeachingAllocationPage from "./pages/TeachingAllocationPage";
import CurriculumPage from "./pages/CurriculumPage";
import AssessmentPage from "./pages/AssessmentPage";
import AttendancePage from "./pages/AttendancePage";
import ReportsPage from "./pages/ReportsPage";
import KnecPage from "./pages/KnecPage";
import CommsPage from "./pages/CommsPage";
import CommsComposePage from "./pages/CommsComposePage";
import CompliancePage from "./pages/CompliancePage";
import BreachRegisterPage from "./pages/BreachRegisterPage";
import ConsentNoticesPage from "./pages/ConsentNoticesPage";
import DsrRequestsPage from "./pages/DsrRequestsPage";
import FinanceFeeCategoriesPage from "./pages/FinanceFeeCategoriesPage";
import FinanceFeeStructuresPage from "./pages/FinanceFeeStructuresPage";
import FinanceInvoicesPage from "./pages/FinanceInvoicesPage";
import FinancePaymentsPage from "./pages/FinancePaymentsPage";
import FinanceMpesaPage from "./pages/FinanceMpesaPage";
import BoardPackPage from "./pages/BoardPackPage";
import FinanceReconciliationPage from "./pages/FinanceReconciliationPage";
import FinanceCreditsPage from "./pages/FinanceCreditsPage";
import FinanceAdjustmentsPage from "./pages/FinanceAdjustmentsPage";
import FinanceRefundsPage from "./pages/FinanceRefundsPage";
import PlatformPage from "./pages/PlatformPage";
import ProfilePage from "./pages/ProfilePage";

import ParentHomePage from "./pages/parent/ParentHomePage";
import ParentActivatePage from "./pages/parent/ParentActivatePage";
import ParentForgotPage from "./pages/parent/ParentForgotPage";
import ParentAttendancePage from "./pages/parent/ParentAttendancePage";
import ParentConsentsPage from "./pages/parent/ParentConsentsPage";
import ParentFeesPage from "./pages/parent/ParentFeesPage";
import ParentNoticesPage from "./pages/parent/ParentNoticesPage";
import ParentProgressPage from "./pages/parent/ParentProgressPage";
import ParentReceiptsPage from "./pages/parent/ParentReceiptsPage";

import MyClassesPage from "./pages/teacher/MyClassesPage";
import GradingGridPage from "./pages/teacher/GradingGridPage";
import AttendanceRegisterPage from "./pages/teacher/AttendanceRegisterPage";
import ClassProgressPage from "./pages/teacher/ClassProgressPage";
import EvidenceCapturePage from "./pages/teacher/EvidenceCapturePage";
import LearnerRemarksPage from "./pages/teacher/LearnerRemarksPage";
import SyncCentrePage from "./pages/teacher/SyncCentrePage";

import OperationsCentrePage from "./pages/saas/OperationsCentrePage";
import TenantRegistryPage from "./pages/saas/TenantRegistryPage";
import TenantOnboardingPage from "./pages/saas/TenantOnboardingPage";
import CurriculumConfiguratorPage from "./pages/saas/CurriculumConfiguratorPage";
import SubscriptionsPage from "./pages/saas/SubscriptionsPage";
import IntegrationHealthPage from "./pages/saas/IntegrationHealthPage";
import ImpersonationPage from "./pages/saas/ImpersonationPage";
import PlatformAuditPage from "./pages/saas/PlatformAuditPage";

/* Demo-ready presentation pages (self-contained, no API required). */
import { FeesDesk } from "./pages/FeesDesk";
import { CBCAssessment } from "./pages/CBCAssessment";
import { StudentsDesk } from "./pages/StudentsDesk";
import { BOMOversight } from "./pages/BOMOversight";
import { SaaSAdminDesk } from "./pages/SaaSAdminDesk";

/** Requires a non-expired access token. */
function Protected() {
  const token = useAuthStore((state) => state.token);
  if (!isTokenValid(token)) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

/** Wraps a page in a role check. */
function guard(roles: string[], element: React.ReactNode) {
  return <RequireRole roles={roles}>{element}</RequireRole>;
}

const SAAS_ROLES = ["SAAS_ADMIN", "SUPER_ADMIN"];
const PARENT_ROLES: string[] = [Role.Parent, Role.Guardian];

export default function App() {
  return (
    <>
      <PWAOfflineSyncBanner />
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/parent/activate" element={<ParentActivatePage />} />
        <Route path="/parent/forgot" element={<ParentForgotPage />} />

        {/* Authenticated */}
        <Route element={<Protected />}>
          <Route path="/select-school" element={<SchoolPickerPage />} />

          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/school" element={guard(SCHOOL_ADMIN_ROLES, <SchoolProfilePage />)} />
            <Route path="/integrations" element={guard(SCHOOL_ADMIN_ROLES, <IntegrationsPage />)} />
            <Route path="/calendar" element={guard(ADMIN_ROLES, <AcademicCalendarPage />)} />
            <Route path="/staff" element={guard(ADMIN_ROLES, <StaffPage />)} />
            <Route path="/learners" element={guard(ACADEMIC_ROLES, <LearnersPage />)} />
            <Route path="/grades-streams" element={guard(SCHOOL_ADMIN_ROLES, <GradesStreamsPage />)} />
            <Route path="/teaching-allocation" element={guard(SCHOOL_ADMIN_ROLES, <TeachingAllocationPage />)} />
            <Route path="/curriculum" element={guard(ACADEMIC_ROLES, <CurriculumPage />)} />
            <Route path="/assessment" element={guard(ACADEMIC_ROLES, <AssessmentPage />)} />
            <Route path="/attendance" element={guard(ACADEMIC_ROLES, <AttendancePage />)} />
            <Route path="/reports" element={guard(ACADEMIC_ROLES, <ReportsPage />)} />
            <Route path="/knec" element={guard(SCHOOL_ADMIN_ROLES, <KnecPage />)} />
            <Route path="/comms" element={guard(ADMIN_ROLES, <CommsPage />)} />
            <Route path="/comms/compose" element={guard(ADMIN_ROLES, <CommsComposePage />)} />
            <Route path="/compliance" element={guard(SCHOOL_ADMIN_ROLES, <CompliancePage />)} />
            <Route path="/compliance/breach-register" element={guard(SCHOOL_ADMIN_ROLES, <BreachRegisterPage />)} />
            <Route path="/compliance/consent-notices" element={guard(SCHOOL_ADMIN_ROLES, <ConsentNoticesPage />)} />
            <Route path="/compliance/dsr-requests" element={guard(SCHOOL_ADMIN_ROLES, <DsrRequestsPage />)} />

            <Route path="/finance/fee-categories" element={guard(FINANCE_ROLES, <FinanceFeeCategoriesPage />)} />
            <Route path="/finance/fee-structures" element={guard(FINANCE_ROLES, <FinanceFeeStructuresPage />)} />
            <Route path="/finance/invoices" element={guard(FINANCE_ROLES, <FinanceInvoicesPage />)} />
            <Route path="/finance/payments" element={guard(FINANCE_ROLES, <FinancePaymentsPage />)} />
            <Route path="/finance/mpesa" element={guard(FINANCE_ROLES, <FinanceMpesaPage />)} />
            <Route path="/finance/board-pack" element={guard(FINANCE_ROLES, <BoardPackPage />)} />
            <Route path="/finance/reconciliation" element={guard(FINANCE_ROLES, <FinanceReconciliationPage />)} />
            <Route path="/finance/credits" element={guard(FINANCE_ROLES, <FinanceCreditsPage />)} />
            <Route path="/finance/adjustments" element={guard(FINANCE_ROLES, <FinanceAdjustmentsPage />)} />
            <Route path="/finance/refunds" element={guard(FINANCE_ROLES, <FinanceRefundsPage />)} />
            <Route path="/platform" element={guard(SCHOOL_ADMIN_ROLES, <PlatformPage />)} />

            {/* Presentation pages kept from the executive demo */}
            <Route path="/fees" element={<Navigate to="/finance/invoices" replace />} />
            <Route path="/cbc-assessment" element={guard(ACADEMIC_ROLES, <CBCAssessment />)} />
            <Route path="/students" element={<Navigate to="/learners" replace />} />
            <Route path="/bom-oversight" element={guard(SCHOOL_ADMIN_ROLES, <BOMOversight />)} />
          </Route>

          {/* Parent portal */}
          <Route
            element={guard(
              PARENT_ROLES,
              <ParentLayout>
                <Outlet />
              </ParentLayout>,
            )}
          >
            <Route path="/parent" element={<ParentHomePage />} />
            <Route path="/parent/attendance" element={<ParentAttendancePage />} />
            <Route path="/parent/consents" element={<ParentConsentsPage />} />
            <Route path="/parent/fees" element={<ParentFeesPage />} />
            <Route path="/parent/notices" element={<ParentNoticesPage />} />
            <Route path="/parent/progress" element={<ParentProgressPage />} />
            <Route path="/parent/receipts" element={<ParentReceiptsPage />} />
          </Route>

          {/* Teacher workspace */}
          <Route
            element={guard(
              ACADEMIC_ROLES,
              <TeacherLayout>
                <Outlet />
              </TeacherLayout>,
            )}
          >
            <Route path="/teacher/classes" element={<MyClassesPage />} />
            <Route path="/teacher/grading" element={<GradingGridPage />} />
            <Route path="/teacher/attendance" element={<AttendanceRegisterPage />} />
            <Route path="/teacher/progress" element={<ClassProgressPage />} />
            <Route path="/teacher/evidence" element={<EvidenceCapturePage />} />
            <Route path="/teacher/remarks" element={<LearnerRemarksPage />} />
            <Route path="/teacher/sync" element={<SyncCentrePage />} />
          </Route>

          {/* Platform owner console */}
          <Route
            element={guard(
              SAAS_ROLES,
              <SaaSLayout>
                <Outlet />
              </SaaSLayout>,
            )}
          >
            <Route path="/saas-admin" element={<SaaSAdminDesk />} />
            <Route path="/platform/tenants" element={<TenantRegistryPage />} />
            <Route path="/platform/onboard" element={<TenantOnboardingPage />} />
            <Route path="/platform/curriculum" element={<CurriculumConfiguratorPage />} />
            <Route path="/platform/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/platform/integrations" element={<IntegrationHealthPage />} />
            <Route path="/platform/impersonate" element={<ImpersonationPage />} />
            <Route path="/platform/audit" element={<PlatformAuditPage />} />
            <Route path="/platform/operations" element={<OperationsCentrePage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}
