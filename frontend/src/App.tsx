import React from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./lib/authStore";
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
import PWAUpdateBanner from "./components/PWAUpdateBanner";

import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import DashboardPage from "./pages/DashboardPage";
import SchoolPickerPage from "./pages/SchoolPickerPage";
import { ErrorBoundary } from "./components/organisms/ErrorBoundary";
import SchoolProfilePage from "./pages/SchoolProfilePage";
import IntegrationsPage from "./pages/IntegrationsPage";
import AcademicCalendarPage from "./pages/AcademicCalendarPage";
import StaffPage from "./pages/StaffPage";
import LearnersPage from "./pages/LearnersPage";
import ImportLearnersPage from "./pages/ImportLearnersPage";
import TeachingAllocationPage from "./pages/TeachingAllocationPage";
import CurriculumPage from "./pages/CurriculumPage";
import AssessmentPage from "./pages/AssessmentPage";
import AttendancePage from "./pages/AttendancePage";
import ReportsPage from "./pages/ReportsPage";
import { ReportCardPrint } from "./pages/ReportCardPrint";
import KnecPage from "./pages/KnecPage";
import CommsPage from "./pages/CommsPage";
import CommsComposePage from "./pages/CommsComposePage";
import CompliancePage from "./pages/CompliancePage";
import BreachRegisterPage from "./pages/BreachRegisterPage";
import ConsentNoticesPage from "./pages/ConsentNoticesPage";
import DsrRequestsPage from "./pages/DsrRequestsPage";
import RetentionPoliciesPage from "./pages/RetentionPoliciesPage";
import DPIAPage from "./pages/DPIAPage";
import FinanceFeeCategoriesPage from "./pages/FinanceFeeCategoriesPage";
import FinanceFeeStructuresPage from "./pages/FinanceFeeStructuresPage";
import FinanceInvoicesPage from "./pages/FinanceInvoicesPage";
import FinancePaymentsPage from "./pages/FinancePaymentsPage";
import FinanceMpesaPage from "./pages/FinanceMpesaPage";
import FinanceReconciliationPage from "./pages/FinanceReconciliationPage";
import HoldingTankReconciliationPage from "./pages/HoldingTankReconciliationPage";
import FinanceCreditsPage from "./pages/FinanceCreditsPage";
import FinanceAdjustmentsPage from "./pages/FinanceAdjustmentsPage";
import FinanceRefundsPage from "./pages/FinanceRefundsPage";
import FinanceCapitationPage from "./pages/FinanceCapitationPage";
import FinanceReceiptSequencesPage from "./pages/FinanceReceiptSequencesPage";
import FinanceSTKPage from "./pages/FinanceSTKPage";
import FinanceLearnerStatementPage from "./pages/FinanceLearnerStatementPage";
import StructurePage from "./pages/StructurePage";
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
import TenantSetupPage from "./pages/saas/TenantSetupPage";
import CurriculumConfiguratorPage from "./pages/saas/CurriculumConfiguratorPage";
import SubscriptionsPage from "./pages/saas/SubscriptionsPage";
import IntegrationHealthPage from "./pages/saas/IntegrationHealthPage";
import ImpersonationPage from "./pages/saas/ImpersonationPage";
import PlatformAuditPage from "./pages/saas/PlatformAuditPage";

/* Demo-ready presentation pages (self-contained, no API required). */
import { CBCAssessment } from "./pages/CBCAssessment";
import { BOMOversight } from "./pages/BOMOversight";

/** Requires an authenticated session (hydrated from HttpOnly cookies via /me). */
function Protected() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const userId = useAuthStore((state) => state.userId);
  if (!hydrated) {
    return <div className="p-4 text-sm text-slate-600">Loading session...</div>;
  }
  if (!userId) {
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
      <PWAUpdateBanner />
      <PWAOfflineSyncBanner />
      <ErrorBoundary>
        <Routes>
          {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset" element={<ResetPasswordPage />} />
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
            <Route path="/imports/learners" element={guard(SCHOOL_ADMIN_ROLES, <ImportLearnersPage />)} />
            <Route path="/grades-streams" element={guard(SCHOOL_ADMIN_ROLES, <StructurePage />)} />
            <Route path="/structure" element={guard(SCHOOL_ADMIN_ROLES, <StructurePage />)} />
            <Route path="/teaching-allocation" element={guard(SCHOOL_ADMIN_ROLES, <TeachingAllocationPage />)} />
            <Route path="/curriculum" element={guard(ACADEMIC_ROLES, <CurriculumPage />)} />
            <Route path="/assessment" element={guard(ACADEMIC_ROLES, <AssessmentPage />)} />
            <Route path="/attendance" element={guard(ACADEMIC_ROLES, <AttendancePage />)} />
            <Route path="/reports" element={guard(ACADEMIC_ROLES, <ReportsPage />)} />
            <Route path="/reports/cards/:card_id/print" element={guard([...ACADEMIC_ROLES, ...PARENT_ROLES], <ReportCardPrint />)} />
            <Route path="/knec" element={guard(SCHOOL_ADMIN_ROLES, <KnecPage />)} />
            <Route path="/comms" element={guard(ADMIN_ROLES, <CommsPage />)} />
            <Route path="/comms/compose" element={guard(ADMIN_ROLES, <CommsComposePage />)} />
            <Route path="/compliance" element={guard(SCHOOL_ADMIN_ROLES, <CompliancePage />)} />
            <Route path="/compliance/breach-register" element={guard(SCHOOL_ADMIN_ROLES, <BreachRegisterPage />)} />
            <Route path="/compliance/consent-notices" element={guard(SCHOOL_ADMIN_ROLES, <ConsentNoticesPage />)} />
            <Route path="/compliance/dsr-requests" element={guard(SCHOOL_ADMIN_ROLES, <DsrRequestsPage />)} />
            <Route path="/compliance/retention-policies" element={guard(SCHOOL_ADMIN_ROLES, <RetentionPoliciesPage />)} />
            <Route path="/compliance/dpia" element={guard(SCHOOL_ADMIN_ROLES, <DPIAPage />)} />

            <Route path="/finance/fee-categories" element={guard(FINANCE_ROLES, <FinanceFeeCategoriesPage />)} />
            <Route path="/finance/fee-structures" element={guard(FINANCE_ROLES, <FinanceFeeStructuresPage />)} />
            <Route path="/finance/invoices" element={guard(FINANCE_ROLES, <FinanceInvoicesPage />)} />
            <Route path="/finance/payments" element={guard(FINANCE_ROLES, <FinancePaymentsPage />)} />
            <Route path="/finance/mpesa" element={guard(FINANCE_ROLES, <FinanceMpesaPage />)} />
            <Route path="/finance/reconciliation" element={guard(FINANCE_ROLES, <FinanceReconciliationPage />)} />
            <Route path="/finance/holding-tank" element={guard(FINANCE_ROLES, <HoldingTankReconciliationPage />)} />
            <Route path="/finance/credits" element={guard(FINANCE_ROLES, <FinanceCreditsPage />)} />
            <Route path="/finance/adjustments" element={guard(FINANCE_ROLES, <FinanceAdjustmentsPage />)} />
            <Route path="/finance/refunds" element={guard(FINANCE_ROLES, <FinanceRefundsPage />)} />
            <Route path="/finance/capitation" element={guard(FINANCE_ROLES, <FinanceCapitationPage />)} />
            <Route path="/finance/receipt-sequences" element={guard(FINANCE_ROLES, <FinanceReceiptSequencesPage />)} />
            <Route path="/finance/stk" element={guard(FINANCE_ROLES, <FinanceSTKPage />)} />
            <Route path="/finance/statement" element={guard(FINANCE_ROLES, <FinanceLearnerStatementPage />)} />

            {/* Backwards-compatible aliases: bookmarks, PWA shortcuts and older
                links must keep resolving after routes are renamed. */}
            <Route path="/fees" element={<Navigate to="/finance/invoices" replace />} />
            <Route path="/students" element={<Navigate to="/learners" replace />} />
            <Route path="/invoices" element={<Navigate to="/finance/invoices" replace />} />
            <Route path="/payments" element={<Navigate to="/finance/payments" replace />} />
            <Route path="/mpesa" element={<Navigate to="/finance/mpesa" replace />} />
            <Route path="/assessments" element={<Navigate to="/assessment" replace />} />
            <Route path="/finance/record" element={<Navigate to="/finance/payments?action=record" replace />} />
            <Route path="/record-payment" element={<Navigate to="/finance/payments?action=record" replace />} />
            <Route path="*" element={<NotFoundPage />} />
            {/* Non-production demo screens (disabled in production builds) */}
            {import.meta.env.DEV && (
              <>
                <Route path="/cbc-assessment" element={guard(ACADEMIC_ROLES, <CBCAssessment />)} />
                <Route path="/bom-oversight" element={guard(SCHOOL_ADMIN_ROLES, <BOMOversight />)} />
              </>
            )}
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
            <Route path="/saas-admin" element={<Navigate to="/platform/operations" replace />} />
            <Route path="/platform/tenants" element={<TenantRegistryPage />} />
            <Route path="/platform/onboard" element={<TenantOnboardingPage />} />
            <Route path="/platform/tenants/:tenantId/setup" element={<TenantSetupPage />} />
            <Route path="/platform/curriculum" element={<CurriculumConfiguratorPage />} />
            <Route path="/platform/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/platform/integrations" element={<IntegrationHealthPage />} />
            <Route path="/platform/impersonate" element={<ImpersonationPage />} />
            <Route path="/platform/audit" element={<PlatformAuditPage />} />
            <Route path="/platform/operations" element={<OperationsCentrePage />} />
          </Route>
        </Route>


      </Routes>
      </ErrorBoundary>
    </>
  );
}
