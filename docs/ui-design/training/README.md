# Training screenshots

Full-page captures of every route in `frontend/src/App.tsx`, for building
training material. Generated 2026-11-15 from
`main` at `ce7ab33` (85 declared routes: 71 captured, 11 not photographed by
design, 3 skipped at run time).

| | |
| --- | --- |
| Size | 1440 px viewport at `deviceScaleFactor: 2` — every PNG is 2880 px wide, full page height |
| Data | fresh migrated database + demo tenant (`demo-school`), one `SCHOOL_ADMIN`, `BURSAR`, `TEACHER`, `PARENT`, `CLERK`, `DEPUTY_HEADTEACHER` and a `SAAS_ADMIN` |
| Personas | each image was taken while signed in as the persona named in its section |
| Defects | 18 routes are marked **defect**: the page loaded but the API answered 404/403/500. They are still included because the broken state is what a user sees; the causes are in [the audit](../audit/2026-11-15-codebase-audit.md) |

Regenerate with the harness (never by hand):

```bash
cd frontend && npm run build && npx vite preview --port 4173 &
node scripts/ui-screenshots/capture.mjs --out docs/ui-design/training
```

On a host whose Chrome cannot capture beyond the viewport (chrome-headless-shell
aborts with `Protocol error (Page.captureScreenshot): Target closed`), add
`--expand`: it grows the viewport to the document height and takes a normal
viewport shot, producing the same full-page image. If system fonts are missing
every page renders with invisible text — set `FONTCONFIG_FILE` as described in
`scripts/ui-screenshots/README.md`.

## Signed-out screens (5)

| Screenshot | Route | Status | Notes |
| --- | --- | --- | --- |
| ![](00-login.png) | `/login` | ok |  |
| ![](01-forgot-password.png) | `/forgot-password` | ok |  |
| ![](02-reset-password.png) | `/auth/reset` | ok |  |
| ![](03-parent-activate.png) | `/parent/activate` | ok |  |
| ![](04-parent-forgot-password.png) | `/parent/forgot` | ok |  |

## School administrator (40)

| Screenshot | Route | Status | Notes |
| --- | --- | --- | --- |
| ![](05-select-school.png) | `/select-school` | ok |  |
| ![](10-admin-dashboard.png) | `/dashboard` | ok |  |
| ![](11-admin-learners.png) | `/learners` | ok |  |
| ![](12-admin-grades-streams.png) | `/grades-streams` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](13-admin-teaching-allocation.png) | `/teaching-allocation` | ok |  |
| ![](14-admin-staff.png) | `/staff` | ok |  |
| ![](15-admin-structure.png) | `/structure` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](16-admin-import-learners.png) | `/imports/learners` | ok |  |
| ![](17-admin-finance-invoices.png) | `/finance/invoices` | ok |  |
| ![](18-admin-gate-admin.png) | `/gate/admin` | **defect** | 2 API 5xx response(s); 2 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](20-admin-finance-payments.png) | `/finance/payments` | ok |  |
| ![](21-admin-fee-categories.png) | `/finance/fee-categories` | ok |  |
| ![](22-admin-fee-structures.png) | `/finance/fee-structures` | ok |  |
| ![](23-admin-mpesa-ledger.png) | `/finance/mpesa` | ok |  |
| ![](26-admin-reconciliation.png) | `/finance/reconciliation` | ok |  |
| ![](27-admin-finance-adjustments.png) | `/finance/adjustments` | ok |  |
| ![](28-admin-finance-credits.png) | `/finance/credits` | ok |  |
| ![](29-admin-finance-refunds.png) | `/finance/refunds` | ok |  |
| ![](30-admin-calendar.png) | `/calendar` | ok |  |
| ![](31-admin-curriculum.png) | `/curriculum` | ok |  |
| ![](32-admin-assessment.png) | `/assessment` | ok |  |
| ![](34-admin-reports.png) | `/reports` | ok |  |
| ![](35-admin-attendance.png) | `/attendance` | ok |  |
| ![](37-admin-holding-tank.png) | `/finance/holding-tank` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](38-admin-finance-capitation.png) | `/finance/capitation` | **defect** | 1 console error(s): Failed to load resource: the server responded with a status of 404 (Not Found) |
| ![](39-admin-finance-receipt-sequences.png) | `/finance/receipt-sequences` | **defect** | 1 console error(s): Failed to load resource: the server responded with a status of 404 (Not Found) |
| ![](41-admin-comms.png) | `/comms` | ok |  |
| ![](42-admin-comms-compose.png) | `/comms/compose` | ok |  |
| ![](43-admin-compliance.png) | `/compliance` | ok |  |
| ![](44-admin-breach-register.png) | `/compliance/breach-register` | ok |  |
| ![](45-admin-consent-notices.png) | `/compliance/consent-notices` | ok |  |
| ![](46-admin-dsr-requests.png) | `/compliance/dsr-requests` | ok |  |
| ![](47-admin-knec.png) | `/knec` | ok |  |
| ![](48-admin-retention-policies.png) | `/compliance/retention-policies` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](49-admin-dpia.png) | `/compliance/dpia` | **defect** | 1 console error(s): Failed to load resource: the server responded with a status of 404 (Not Found) |
| ![](50-admin-school.png) | `/school` | ok |  |
| ![](51-admin-integrations.png) | `/integrations` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](52-admin-profile.png) | `/profile` | ok |  |
| ![](53-admin-finance-stk.png) | `/finance/stk` | **defect** | 2 console error(s): Failed to load resource: the server responded with a status of 404 (Not Found) |
| ![](54-admin-finance-statement.png) | `/finance/statement` | ok |  |

## Teacher (8)

| Screenshot | Route | Status | Notes |
| --- | --- | --- | --- |
| ![](60-teacher-classes.png) | `/teacher/classes` | ok |  |
| ![](61-teacher-attendance.png) | `/teacher/attendance` | ok |  |
| ![](62-teacher-grading.png) | `/teacher/grading` | ok |  |
| ![](63-teacher-progress.png) | `/teacher/progress` | ok |  |
| ![](64-teacher-remarks.png) | `/teacher/remarks` | ok |  |
| ![](65-teacher-evidence.png) | `/teacher/evidence` | ok |  |
| ![](66-teacher-sync.png) | `/teacher/sync` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](67-teacher-gate-kiosk.png) | `/gate` | ok |  |

## Parent / guardian (8)

| Screenshot | Route | Status | Notes |
| --- | --- | --- | --- |
| ![](70-parent-home.png) | `/parent` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](71-parent-fees.png) | `/parent/fees` | **defect** | 1 console error(s): Failed to load resource: the server responded with a status of 403 (Forbidden) |
| ![](72-parent-attendance.png) | `/parent/attendance` | ok |  |
| ![](73-parent-consents.png) | `/parent/consents` | ok |  |
| ![](74-parent-notices.png) | `/parent/notices` | ok |  |
| ![](75-parent-progress.png) | `/parent/progress` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](76-parent-receipts.png) | `/parent/receipts` | **defect** | 1 console error(s): Failed to load resource: the server responded with a status of 403 (Forbidden) |
| ![](77-parent-child.png) | `/parent/child` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |

## Platform (SaaS) administrator (10)

| Screenshot | Route | Status | Notes |
| --- | --- | --- | --- |
| ![](80-saas-operations.png) | `/platform/operations` | **defect** | 2 API 5xx response(s); 2 uncaught page error(s): AxiosError: Request failed with status code 500; 2 console error(s):… |
| ![](81-saas-tenant-registry.png) | `/platform/tenants` | ok |  |
| ![](82-saas-tenant-onboarding.png) | `/platform/onboard` | ok |  |
| ![](83-saas-admin-desk.png) | `/platform/desk` | ok |  |
| ![](83-saas-tenant-setup.png) | `/platform/tenants/demo-school/setup` | ok |  |
| ![](84-saas-curriculum.png) | `/platform/curriculum` | ok |  |
| ![](85-saas-subscriptions.png) | `/platform/subscriptions` | **defect** | 1 API 5xx response(s); 1 console error(s): Failed to load resource: the server responded with a status of 500 (Intern… |
| ![](86-saas-integration-health.png) | `/platform/integrations` | ok |  |
| ![](87-saas-impersonation.png) | `/platform/impersonate` | ok |  |
| ![](88-saas-platform-audit.png) | `/platform/audit` | ok |  |

## Not photographed

| Route | Why |
| --- | --- |
| `/reports/cards/:card_id/print` | unresolved first-report-card |
| `/cbc-assessment` | dev-only route: this build serves the not-found page — start the frontend with `npm run dev` to capture it |
| `/bom-oversight` | dev-only route: this build serves the not-found page — start the frontend with `npm run dev` to capture it |
