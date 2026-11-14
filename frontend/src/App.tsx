import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { onInstallPromptReady, requestInstall, watchInstallPrompt } from "./lib/installPrompt";

function useInstallPrompt() {
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const handleReady = (event: any) => {
      if (!mounted) return;
      setReady(true);
    };
    onInstallPromptReady(handleReady);
    watchInstallPrompt();
    return () => {
      mounted = false;
    };
  }, []);

  return ready;
}
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

// Pages are loaded on demand: the entry bundle carries the shell and the
// router, not every admin, finance and compliance screen.
const LoginPage = lazy(() => import("./pages/LoginPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const SchoolPickerPage = lazy(() => import("./pages/SchoolPickerPage"));
const SchoolProfilePage = lazy(() => import("./pages/SchoolProfilePage"));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage"));
const AcademicCalendarPage = lazy(() => import("./pages/AcademicCalendarPage"));
const StaffPage = lazy(() => import("./pages/StaffPage"));
const LearnersPage = lazy(() => import("./pages/LearnersPage"));
const ImportLearnersPage = lazy(() => import("./pages/ImportLearnersPage"));
const TeachingAllocationPage = lazy(() => import("./pages/TeachingAllocationPage"));
const CurriculumPage = lazy(() => import("./pages/CurriculumPage"));
const AssessmentPage = lazy(() => import("./pages/AssessmentPage"));
const AttendancePage = lazy(() => import("./pages/AttendancePage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const ReportCardPrint = lazy(() => import("./pages/ReportCardPrint"));
const KnecPage = lazy(() => import("./pages/KnecPage"));
const CommsPage = lazy(() => import("./pages/CommsPage"));
const CommsComposePage = lazy(() => import("./pages/CommsComposePage"));
const CompliancePage = lazy(() => import("./pages/CompliancePage"));
const BreachRegisterPage = lazy(() => import("./pages/BreachRegisterPage"));
const ConsentNoticesPage = lazy(() => import("./pages/ConsentNoticesPage"));
const DsrRequestsPage = lazy(() => import("./pages/DsrRequestsPage"));
const RetentionPoliciesPage = lazy(() => import("./pages/RetentionPoliciesPage"));
const DPIAPage = lazy(() => import("./pages/DPIAPage"));
const FinanceFeeCategoriesPage = lazy(() => import("./pages/FinanceFeeCategoriesPage"));
const FinanceFeeStructuresPage = lazy(() => import("./pages/FinanceFeeStructuresPage"));
const FinanceInvoicesPage = lazy(() => import("./pages/FinanceInvoicesPage"));
const FinancePaymentsPage = lazy(() => import("./pages/FinancePaymentsPage"));
const FinanceMpesaPage = lazy(() => import("./pages/FinanceMpesaPage"));
const FinanceReconciliationPage = lazy(() => import("./pages/FinanceReconciliationPage"));
const HoldingTankReconciliationPage = lazy(() => import("./pages/HoldingTankReconciliationPage"));
const FinanceCreditsPage = lazy(() => import("./pages/FinanceCreditsPage"));
const FinanceAdjustmentsPage = lazy(() => import("./pages/FinanceAdjustmentsPage"));
const FinanceRefundsPage = lazy(() => import("./pages/FinanceRefundsPage"));
const FinanceCapitationPage = lazy(() => import("./pages/FinanceCapitationPage"));
const FinanceReceiptSequencesPage = lazy(() => import("./pages/FinanceReceiptSequencesPage"));
const FinanceSTKPage = lazy(() => import("./pages/FinanceSTKPage"));
const FinanceLearnerStatementPage = lazy(() => import("./pages/FinanceLearnerStatementPage"));
const StructurePage = lazy(() => import("./pages/StructurePage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const GateAdminPage = lazy(() => import("./pages/GateAdminPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const ParentHomePage = lazy(() => import("./pages/parent/ParentHomePage"));
const ParentActivatePage = lazy(() => import("./pages/parent/ParentActivatePage"));
const ParentForgotPage = lazy(() => import("./pages/parent/ParentForgotPage"));
const ParentAttendancePage = lazy(() => import("./pages/parent/ParentAttendancePage"));
const ParentConsentsPage = lazy(() => import("./pages/parent/ParentConsentsPage"));
const ParentFeesPage = lazy(() => import("./pages/parent/ParentFeesPage"));
const ParentNoticesPage = lazy(() => import("./pages/parent/ParentNoticesPage"));
const ParentProgressPage = lazy(() => import("./pages/parent/ParentProgressPage"));
const ParentReceiptsPage = lazy(() => import("./pages/parent/ParentReceiptsPage"));
const MyClassesPage = lazy(() => import("./pages/teacher/MyClassesPage"));
const GradingGridPage = lazy(() => import("./pages/teacher/GradingGridPage"));
const AttendanceRegisterPage = lazy(() => import("./pages/teacher/AttendanceRegisterPage"));
const ClassProgressPage = lazy(() => import("./pages/teacher/ClassProgressPage"));
const EvidenceCapturePage = lazy(() => import("./pages/teacher/EvidenceCapturePage"));
const LearnerRemarksPage = lazy(() => import("./pages/teacher/LearnerRemarksPage"));
const SyncCentrePage = lazy(() => import("./pages/teacher/SyncCentrePage"));
const OperationsCentrePage = lazy(() => import("./pages/saas/OperationsCentrePage"));
const TenantRegistryPage = lazy(() => import("./pages/saas/TenantRegistryPage"));
const TenantOnboardingPage = lazy(() => import("./pages/saas/TenantOnboardingPage"));
const TenantSetupPage = lazy(() => import("./pages/saas/TenantSetupPage"));
const CurriculumConfiguratorPage = lazy(() => import("./pages/saas/CurriculumConfiguratorPage"));
const SubscriptionsPage = lazy(() => import("./pages/saas/SubscriptionsPage"));
const IntegrationHealthPage = lazy(() => import("./pages/saas/IntegrationHealthPage"));
const ImpersonationPage = lazy(() => import("./pages/saas/ImpersonationPage"));
const PlatformAuditPage = lazy(() => import("./pages/saas/PlatformAuditPage"));

import { ErrorBoundary } from "./components/organisms/ErrorBoundary";
import PWAInstallCard from "./components/PWAInstallCard";




/* Demo-ready presentation pages (self-contained, no API required, dev only). */
const CBCAssessment = lazy(() =>
  import("./pages/CBCAssessment").then((m) => ({ default: m.CBCAssessment })),
);
const BOMOversight = lazy(() =>
  import("./pages/BOMOversight").then((m) => ({ default: m.BOMOversight })),
);

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

/** Renders a lazily loaded page in its own Suspense boundary, so arriving at a
 *  route keeps the surrounding layout on screen while the chunk downloads. */
function page(Component: React.LazyExoticComponent<React.ComponentType<any>>) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
      <Component />
    </Suspense>
  );
}

const SAAS_ROLES = ["SAAS_ADMIN", "SUPER_ADMIN"];
const PARENT_ROLES: string[] = [Role.Parent, Role.Guardian];

export default function App() {
  const canInstall = useInstallPrompt();
  return (
    <>

      <PWAInstallCard canInstall={canInstall} onInstallRequest={requestInstall} />
      <PWAUpdateBanner />
      <PWAOfflineSyncBanner />
      <ErrorBoundary>
        <Routes>
          {/* Public */}
        <Route path="/login" element={page(LoginPage)} />
        <Route path="/forgot-password" element={page(ForgotPasswordPage)} />
        <Route path="/auth/reset" element={page(ResetPasswordPage)} />
        <Route path="/parent/activate" element={page(ParentActivatePage)} />
        <Route path="/parent/forgot" element={page(ParentForgotPage)} />

        {/* Authenticated */}
        <Route element={<Protected />}>
          <Route path="/select-school" element={page(SchoolPickerPage)} />

          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={page(DashboardPage)} />
            <Route path="/profile" element={page(ProfilePage)} />
            <Route path="/school" element={guard(SCHOOL_ADMIN_ROLES, page(SchoolProfilePage))} />
            <Route path="/gate/admin" element={guard(SCHOOL_ADMIN_ROLES, page(GateAdminPage))} />
            <Route path="/integrations" element={guard(SCHOOL_ADMIN_ROLES, page(IntegrationsPage))} />
            <Route path="/calendar" element={guard(ADMIN_ROLES, page(AcademicCalendarPage))} />
            <Route path="/staff" element={guard(ADMIN_ROLES, page(StaffPage))} />
            <Route path="/learners" element={guard(ACADEMIC_ROLES, page(LearnersPage))} />
            <Route path="/imports/learners" element={guard(SCHOOL_ADMIN_ROLES, page(ImportLearnersPage))} />
            <Route path="/grades-streams" element={guard(SCHOOL_ADMIN_ROLES, page(StructurePage))} />
            <Route path="/structure" element={guard(SCHOOL_ADMIN_ROLES, page(StructurePage))} />
            <Route path="/teaching-allocation" element={guard(SCHOOL_ADMIN_ROLES, page(TeachingAllocationPage))} />
            <Route path="/curriculum" element={guard(ACADEMIC_ROLES, page(CurriculumPage))} />
            <Route path="/assessment" element={guard(ACADEMIC_ROLES, page(AssessmentPage))} />
            <Route path="/attendance" element={guard(ACADEMIC_ROLES, page(AttendancePage))} />
            <Route path="/reports" element={guard(ACADEMIC_ROLES, page(ReportsPage))} />
            <Route path="/reports/cards/:card_id/print" element={guard([...ACADEMIC_ROLES, ...PARENT_ROLES], page(ReportCardPrint))} />
            <Route path="/knec" element={guard(SCHOOL_ADMIN_ROLES, page(KnecPage))} />
            <Route path="/comms" element={guard(ADMIN_ROLES, page(CommsPage))} />
            <Route path="/comms/compose" element={guard(ADMIN_ROLES, page(CommsComposePage))} />
            <Route path="/compliance" element={guard(SCHOOL_ADMIN_ROLES, page(CompliancePage))} />
            <Route path="/compliance/breach-register" element={guard(SCHOOL_ADMIN_ROLES, page(BreachRegisterPage))} />
            <Route path="/compliance/consent-notices" element={guard(SCHOOL_ADMIN_ROLES, page(ConsentNoticesPage))} />
            <Route path="/compliance/dsr-requests" element={guard(SCHOOL_ADMIN_ROLES, page(DsrRequestsPage))} />
            <Route path="/compliance/retention-policies" element={guard(SCHOOL_ADMIN_ROLES, page(RetentionPoliciesPage))} />
            <Route path="/compliance/dpia" element={guard(SCHOOL_ADMIN_ROLES, page(DPIAPage))} />

            <Route path="/finance/fee-categories" element={guard(FINANCE_ROLES, page(FinanceFeeCategoriesPage))} />
            <Route path="/finance/fee-structures" element={guard(FINANCE_ROLES, page(FinanceFeeStructuresPage))} />
            <Route path="/finance/invoices" element={guard(FINANCE_ROLES, page(FinanceInvoicesPage))} />
            <Route path="/finance/payments" element={guard(FINANCE_ROLES, page(FinancePaymentsPage))} />
            <Route path="/finance/mpesa" element={guard(FINANCE_ROLES, page(FinanceMpesaPage))} />
            <Route path="/finance/reconciliation" element={guard(FINANCE_ROLES, page(FinanceReconciliationPage))} />
            <Route path="/finance/holding-tank" element={guard(FINANCE_ROLES, page(HoldingTankReconciliationPage))} />
            <Route path="/finance/credits" element={guard(FINANCE_ROLES, page(FinanceCreditsPage))} />
            <Route path="/finance/adjustments" element={guard(FINANCE_ROLES, page(FinanceAdjustmentsPage))} />
            <Route path="/finance/refunds" element={guard(FINANCE_ROLES, page(FinanceRefundsPage))} />
            <Route path="/finance/capitation" element={guard(FINANCE_ROLES, page(FinanceCapitationPage))} />
            <Route path="/finance/receipt-sequences" element={guard(FINANCE_ROLES, page(FinanceReceiptSequencesPage))} />
            <Route path="/finance/stk" element={guard(FINANCE_ROLES, page(FinanceSTKPage))} />
            <Route path="/finance/statement" element={guard(FINANCE_ROLES, page(FinanceLearnerStatementPage))} />

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
            <Route path="*" element={page(NotFoundPage)} />
            {/* Non-production demo screens (disabled in production builds) */}
            {import.meta.env.DEV && (
              <>
                <Route path="/cbc-assessment" element={guard(ACADEMIC_ROLES, page(CBCAssessment))} />
                <Route path="/bom-oversight" element={guard(SCHOOL_ADMIN_ROLES, page(BOMOversight))} />
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
            <Route path="/parent" element={page(ParentHomePage)} />
            <Route path="/parent/attendance" element={page(ParentAttendancePage)} />
            <Route path="/parent/consents" element={page(ParentConsentsPage)} />
            <Route path="/parent/fees" element={page(ParentFeesPage)} />
            <Route path="/parent/notices" element={page(ParentNoticesPage)} />
            <Route path="/parent/progress" element={page(ParentProgressPage)} />
            <Route path="/parent/receipts" element={page(ParentReceiptsPage)} />
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
            <Route path="/teacher/classes" element={page(MyClassesPage)} />
            <Route path="/teacher/grading" element={page(GradingGridPage)} />
            <Route path="/teacher/attendance" element={page(AttendanceRegisterPage)} />
            <Route path="/teacher/progress" element={page(ClassProgressPage)} />
            <Route path="/teacher/evidence" element={page(EvidenceCapturePage)} />
            <Route path="/teacher/remarks" element={page(LearnerRemarksPage)} />
            <Route path="/teacher/sync" element={page(SyncCentrePage)} />
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
            <Route path="/platform/tenants" element={page(TenantRegistryPage)} />
            <Route path="/platform/onboard" element={page(TenantOnboardingPage)} />
            <Route path="/platform/tenants/:tenantId/setup" element={page(TenantSetupPage)} />
            <Route path="/platform/curriculum" element={page(CurriculumConfiguratorPage)} />
            <Route path="/platform/subscriptions" element={page(SubscriptionsPage)} />
            <Route path="/platform/integrations" element={page(IntegrationHealthPage)} />
            <Route path="/platform/impersonate" element={page(ImpersonationPage)} />
            <Route path="/platform/audit" element={page(PlatformAuditPage)} />
            <Route path="/platform/operations" element={page(OperationsCentrePage)} />
          </Route>
        </Route>


      </Routes>
      </ErrorBoundary>
    </>
  );
}
