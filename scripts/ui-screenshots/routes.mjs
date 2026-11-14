/**
 * Screenshot manifest for docs/ui-design/screenshots.
 *
 * Every path here is taken from frontend/src/App.tsx. `check-routes.mjs` parses
 * the router and fails when App.tsx has a route this file does not describe, so
 * the two cannot drift silently.
 *
 * Fields per route:
 *   path        route path as declared in App.tsx ("*" and param routes allowed)
 *   file        output PNG name; keep the numeric prefix so the set sorts
 *   persona     "public" | "admin" | "teacher" | "parent" | "platform"
 *   settleMs    extra wait after network idle before the shutter (default 1500)
 *   waitForText text that must appear before the shot is taken (optional)
 *   expectText  text that must appear in the captured page (optional)
 *   minText     minimum visible characters (default 120) — catches blank shells
 *   resolve     "first-report-card" resolves the seeded report card id
 *   skip        { reason } for routes that should not be photographed
 */

export const PERSONAS = {
  public: null,
  admin: { email: "admin@demo.test", password: "ShuleYetu2026!Demo" },
  teacher: { email: "teacher@demo.test", password: "ShuleYetu2026!Demo" },
  parent: { email: "parent@demo.test", password: "ShuleYetu2026!Demo" },
  platform: { email: "platform@demo.test", password: "ShuleYetu2026!Demo" },
};

export const routes = [
  // ---------- public / auth ----------
  { path: "/login", file: "00-login.png", persona: "public" },
  { path: "/forgot-password", file: "01-forgot-password.png", persona: "public" },
  { path: "/auth/reset", file: "02-reset-password.png", persona: "public" },
  { path: "/parent/activate", file: "03-parent-activate.png", persona: "public" },
  { path: "/parent/forgot", file: "04-parent-forgot-password.png", persona: "public" },

  // ---------- admin shell ----------
  { path: "/select-school", file: "05-select-school.png", persona: "admin", minText: 60 },
  { path: "/dashboard", file: "10-admin-dashboard.png", persona: "admin" },
  { path: "/learners", file: "11-admin-learners.png", persona: "admin" },
  { path: "/grades-streams", file: "12-admin-grades-streams.png", persona: "admin" },
  { path: "/teaching-allocation", file: "13-admin-teaching-allocation.png", persona: "admin" },
  { path: "/staff", file: "14-admin-staff.png", persona: "admin" },
  { path: "/structure", file: "15-admin-structure.png", persona: "admin" },
  { path: "/imports/learners", file: "16-admin-import-learners.png", persona: "admin" },
  { path: "/finance/invoices", file: "17-admin-finance-invoices.png", persona: "admin" },
  { path: "/gate/admin", file: "18-admin-gate-admin.png", persona: "admin", expectText: "Gate" },

  // ---------- finance ----------
  { path: "/finance/payments", file: "20-admin-finance-payments.png", persona: "admin" },
  { path: "/finance/fee-categories", file: "21-admin-fee-categories.png", persona: "admin" },
  { path: "/finance/fee-structures", file: "22-admin-fee-structures.png", persona: "admin" },
  { path: "/finance/mpesa", file: "23-admin-mpesa-ledger.png", persona: "admin" },
  { path: "/finance/reconciliation", file: "26-admin-reconciliation.png", persona: "admin" },
  { path: "/finance/adjustments", file: "27-admin-finance-adjustments.png", persona: "admin" },
  { path: "/finance/credits", file: "28-admin-finance-credits.png", persona: "admin" },
  { path: "/finance/refunds", file: "29-admin-finance-refunds.png", persona: "admin" },
  { path: "/finance/holding-tank", file: "37-admin-holding-tank.png", persona: "admin" },
  { path: "/finance/capitation", file: "38-admin-finance-capitation.png", persona: "admin" },
  { path: "/finance/receipt-sequences", file: "39-admin-finance-receipt-sequences.png", persona: "admin" },
  { path: "/finance/stk", file: "53-admin-finance-stk.png", persona: "admin" },
  { path: "/finance/statement", file: "54-admin-finance-statement.png", persona: "admin" },

  // ---------- academics / compliance / comms ----------
  { path: "/calendar", file: "30-admin-calendar.png", persona: "admin" },
  { path: "/curriculum", file: "31-admin-curriculum.png", persona: "admin" },
  { path: "/assessment", file: "32-admin-assessment.png", persona: "admin" },
  { path: "/cbc-assessment", file: "33-admin-cbc-assessment.png", persona: "admin", devOnly: true },
  { path: "/reports", file: "34-admin-reports.png", persona: "admin" },
  { path: "/attendance", file: "35-admin-attendance.png", persona: "admin" },
  {
    path: "/reports/cards/:card_id/print",
    file: "36-admin-report-card-print.png",
    persona: "admin",
    resolve: "first-report-card",
  },
  { path: "/bom-oversight", file: "40-admin-bom-oversight.png", persona: "admin", devOnly: true },
  { path: "/comms", file: "41-admin-comms.png", persona: "admin" },
  { path: "/comms/compose", file: "42-admin-comms-compose.png", persona: "admin" },
  { path: "/compliance", file: "43-admin-compliance.png", persona: "admin" },
  { path: "/compliance/breach-register", file: "44-admin-breach-register.png", persona: "admin" },
  { path: "/compliance/consent-notices", file: "45-admin-consent-notices.png", persona: "admin" },
  { path: "/compliance/dsr-requests", file: "46-admin-dsr-requests.png", persona: "admin" },
  { path: "/knec", file: "47-admin-knec.png", persona: "admin" },
  { path: "/compliance/retention-policies", file: "48-admin-retention-policies.png", persona: "admin" },
  { path: "/compliance/dpia", file: "49-admin-dpia.png", persona: "admin" },

  // ---------- school settings ----------
  { path: "/school", file: "50-admin-school.png", persona: "admin" },
  { path: "/integrations", file: "51-admin-integrations.png", persona: "admin" },
  { path: "/profile", file: "52-admin-profile.png", persona: "admin" },

  // ---------- teacher workspace ----------
  { path: "/teacher/classes", file: "60-teacher-classes.png", persona: "teacher" },
  { path: "/teacher/attendance", file: "61-teacher-attendance.png", persona: "teacher" },
  { path: "/teacher/grading", file: "62-teacher-grading.png", persona: "teacher" },
  { path: "/teacher/progress", file: "63-teacher-progress.png", persona: "teacher" },
  { path: "/teacher/remarks", file: "64-teacher-remarks.png", persona: "teacher" },
  { path: "/teacher/evidence", file: "65-teacher-evidence.png", persona: "teacher" },
  { path: "/teacher/sync", file: "66-teacher-sync.png", persona: "teacher" },

  // ---------- parent portal ----------
  { path: "/parent", file: "70-parent-home.png", persona: "parent" },
  { path: "/parent/fees", file: "71-parent-fees.png", persona: "parent" },
  { path: "/parent/attendance", file: "72-parent-attendance.png", persona: "parent" },
  { path: "/parent/consents", file: "73-parent-consents.png", persona: "parent" },
  { path: "/parent/notices", file: "74-parent-notices.png", persona: "parent" },
  { path: "/parent/progress", file: "75-parent-progress.png", persona: "parent" },
  { path: "/parent/receipts", file: "76-parent-receipts.png", persona: "parent" },

  // ---------- platform owner console ----------
  { path: "/platform/operations", file: "80-saas-operations.png", persona: "platform" },
  { path: "/platform/tenants", file: "81-saas-tenant-registry.png", persona: "platform" },
  { path: "/platform/onboard", file: "82-saas-tenant-onboarding.png", persona: "platform" },
  { path: "/platform/curriculum", file: "84-saas-curriculum.png", persona: "platform" },
  { path: "/platform/subscriptions", file: "85-saas-subscriptions.png", persona: "platform" },
  { path: "/platform/integrations", file: "86-saas-integration-health.png", persona: "platform" },
  { path: "/platform/impersonate", file: "87-saas-impersonation.png", persona: "platform" },
  { path: "/platform/audit", file: "88-saas-platform-audit.png", persona: "platform" },
  {
    path: "/platform/tenants/:tenantId/setup",
    file: "83-saas-tenant-setup.png",
    persona: "platform",
    resolve: "first-tenant",
  },

  // ---------- deliberately not photographed ----------
  { path: "/", skip: { reason: "redirects to /dashboard" } },
  { path: "/fees", skip: { reason: "redirect alias for /finance/invoices" } },
  { path: "/students", skip: { reason: "redirect alias for /learners" } },
  { path: "/invoices", skip: { reason: "redirect alias for /finance/invoices" } },
  { path: "/payments", skip: { reason: "redirect alias for /finance/payments" } },
  { path: "/mpesa", skip: { reason: "redirect alias for /finance/mpesa" } },
  { path: "/assessments", skip: { reason: "redirect alias for /assessment" } },
  { path: "/finance/record", skip: { reason: "redirect alias for /finance/payments?action=record" } },
  { path: "/record-payment", skip: { reason: "redirect alias for /finance/payments?action=record" } },
  { path: "/saas-admin", skip: { reason: "redirect alias for /platform/operations" } },
  { path: "*", skip: { reason: "not-found screen; covered by while-navigating checks" } },
];

export default routes;
