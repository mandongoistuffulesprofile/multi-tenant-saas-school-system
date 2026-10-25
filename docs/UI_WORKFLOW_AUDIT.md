# UI & Workflow Audit — School SaaS

Living audit of incomplete workflows, missing screens and dead-end UI, page by page.
Scope: current frontend source (`frontend/src`) running against the Go API and the
`skulapp_smoke_test` database.

## Test environment

| Item | Value |
| --- | --- |
| Frontend (Vite dev) | `http://localhost:5174` |
| Frontend (prebuilt fallback) | `http://localhost:5173` |
| Backend | `http://localhost:8080` |
| School admin | `smoke@skulapp.test` / `SmokePass123!` (tenant `smoke-school`) |
| SaaS admin | `saas@skulapp.test` / `SaasPass123!` (tenant `platform-ops`) |
| Tenant used by school pages | `smoke-school` |

Severity: **P0** blocks the workflow, **P1** workflow cannot be completed without
workarounds, **P2** missing convenience/consistency, **P3** cosmetic.

Last updated: 2026-10-23.

| Area | Findings | P0 | P1 | P2 |
| --- | ---: | ---: | ---: | ---: |
| Authentication & entry | 4 | 1 | 2 | 1 |
| SaaS Admin console | 15 | 6 | 8 | 1 |
| School admin console | 25 | 8 | 13 | 4 |
| Parent portal | 7 | 3 | 3 | 1 |
| Teacher workspace | 9 | 3 | 3 | 3 |
| **Total** | **60** | **21** | **29** | **10** |

### Top P0 blockers
1. `SAAS_ADMIN` is rejected by every `/platform/*` API (SA-10).
2. Login ignores the school code and always lands on `/dashboard` (AU-01, AU-02).
3. SaaS console nav sends you to the school page (SA-15).
4. Tenant onboarding/registry are simulated (SA-02, SA-03).
5. Learner wizard loses guardian and fee data (SD-05).
6. Staff creation dialog is incomplete (SD-04).
7. Invoices and payments have no actions (SD-08, SD-09).
8. Assessment entry and report generation are absent (SD-11, SD-12).
9. Attendance cannot be saved by admin or teacher (SD-15, TE-02).
10. Communications compose has no recipients and fetches during render (SD-13).
11. Parent pay, consents and progress are mocked or broken (PA-02, PA-04, PA-06).
12. Teacher remarks/evidence cannot save (TE-04, TE-05).

---

## Authentication & entry

### AU-01 — The “School Code” field is mislabeled and ignored (P0)
- Screen: `/login` (`pages/LoginPage.tsx`).
- The first field is labelled “School Code” but is bound to `identifier`; the
  email field is separate. The request is
  `{ identifier: email || identifier, password }`.
- If both fields are filled, the school code is **dropped**. If only the school
  code is filled, it is sent as the identity and fails. The backend supports
  `tenant_code` / `subdomain`, but the frontend never sends either.
- Consequence: a user in more than one school cannot choose one and silently
  gets the first active membership (oldest `created_at`).
- Fix: send `tenant_code` separately, resolve/display the school, and validate
  the pair before submitting.

### AU-02 — Post-login landing ignores the user’s role (P1)
- `LoginPage` always calls `navigate("/dashboard")`.
- Correct landing should be: `SAAS_ADMIN` → `/saas-admin`, parent/guardian →
  `/parent`, teacher → `/teacher/classes`, school admin → `/dashboard`.
- `SchoolPickerPage` also navigates to `/` after a tenant switch, so it has the
  same problem.
- A SaaS admin therefore lands in the school shell, where the header/sidebar
  are school navigation and the console has no entry point.

### AU-03 — Multi-school selection is never triggered (P1)
- After login the frontend never checks whether the user has more than one
  membership, and never redirects to `/select-school`.
- `/select-school` works if typed manually: it lists memberships and calls
  `POST /auth/tenant/switch`, replacing the token pair.
- Missing: an entry point (“Switch school”), a school code/name search, the
  current school indicator, and role-aware redirect after switching.

### AU-04 — Two conflicting password-reset flows (P2)
- Login’s “Forgot Password?” goes to `/forgot-password`, which asks for a phone
  number and calls `/auth/otp/request` then `/auth/password/reset`.
- The parent flow (`/parent/forgot`) asks for an email and calls
  `/auth/password/reset/request` then `/auth/password/reset/confirm`.
- Users log in with email, but the main reset flow asks only for a phone. There
  is no “email or phone” choice, no cooldown/rate-limit copy, and the two flows
  have different success screens.

---

## SaaS Admin console

Route prefix: `/saas-admin` and `/platform/*`. Layout: `SaaSLayout`.
Roles expected: `SAAS_ADMIN`, `SUPER_ADMIN`.

### SA-01 — SaaS dashboard is a hard-coded demo (P0)
- Screen: `/saas-admin` (`pages/SaaSAdminDesk.tsx`).
- Shows 3 fixed schools (Mandongoi, St. Peter's, Kyuso), fixed KPIs, fixed paybills.
- Makes **no API calls**; the real database has different tenants.
- “Fungua Shule (Login As)” only shows a toast; it does not impersonate or switch tenant.
- “Sajili Shule Mpya” opens a local wizard that does not submit anything.
- Missing: real tenant list, search/filter, pagination, tenant detail, license actions.

### SA-02 — Tenant onboarding does not create a tenant (P0)
- Screen: `/platform/onboard` (`pages/saas/TenantOnboardingPage.tsx`).
- Two-step form (school details → admin user) then `setTimeout(1500)` and a
  “Tenant created successfully” screen. No `POST /platform/tenants`, no admin
  invitation, no school row, no membership, no subscription.
- Missing: validation, duplicate subdomain check, plan selection with price,
  admin invite/OTP, success screen with the real tenant id, failure/retry state.
- Backend endpoint already exists: `POST /api/v1/platform/tenants`.

### SA-03 — Tenant registry is mock data with dead actions (P0)
- Screen: `/platform/tenants` (`pages/saas/TenantRegistryPage.tsx`).
- Rows are hard-coded (`Nairobi Academy`, `Mombasa Primary`, `Kisumu Hill`).
- “Suspend” and “Impersonate” buttons have no handlers.
- No tenant detail route, no edit, no status history, no subscription/billing link.
- Backend endpoints already exist: `GET/POST /platform/tenants`,
  `PATCH /platform/tenants/:id`, `PUT /platform/tenants/:id/status`.

### SA-04 — Impersonation is simulated (P1)
- Screen: `/platform/impersonate` (`pages/saas/ImpersonationPage.tsx`).
- Form waits 1s and shows a fake active session; no `POST /platform/impersonations`.
- Missing: tenant picker backed by real tenants, reason validation, read-only
  banner, expiry countdown, “end session” API call, audit entry, list of active
  sessions.
- Backend endpoints exist: `GET/POST /platform/impersonations`,
  `POST /platform/impersonations/:id/end`.

### SA-05 — Subscriptions screen is mock data and can stall (P0)
- Screen: `/platform/subscriptions` (`pages/saas/SubscriptionsPage.tsx`).
- Plans and subscriptions are hard-coded in `useEffect`; no API call.
- The state machine has no error path and always replaces real data with the
  mock rows.
- Missing: change plan, renew, cancel, grace period, invoice history, proration,
  payment status, tenant drill-down.
- Backend endpoints exist: `GET/POST /platform/subscriptions`,
  `GET /platform/plans`, `POST/PATCH /platform/plans`.

### SA-06 — Curriculum configurator is read-only mock data (P1)
- Screen: `/platform/curriculum` (`pages/saas/CurriculumConfiguratorPage.tsx`).
- Two hard-coded versions; no create, edit, publish, unpublish or diff.
- Missing: version editor, learning-area/strand tree, publish confirmation,
  effective-date validation, rollback.
- Backend endpoints exist: `POST /platform/curriculum/versions`,
  `POST /platform/curriculum/versions/:version_id/publish`.

### SA-07 — Integration health has no actions (P2)
- Screen: `/platform/integrations` (`pages/saas/IntegrationHealthPage.tsx`).
- Static rows; no refresh, retry, configure credentials, view failed callbacks or
  queue contents.
- Missing: per-channel detail, last error, webhook replay, secret rotation.

### SA-08 — Platform audit cannot be searched (P1)
- Screen: `/platform/audit` (`pages/saas/PlatformAuditPage.tsx`).
- Three static rows; the search box is not wired; no date range, action filter,
  tenant filter, pagination or export.
- Missing: real `GET /audit/logs` (or platform audit endpoint), row detail,
  correlation with request ids.

### SA-09 — Operations Centre silently reports zero (P1)
- Screen: `/platform/operations` (`pages/saas/OperationsCentrePage.tsx`).
- Calls `/platform/usage`, `/platform/plans`, `/platform/subscriptions` with no
  `catch`, then renders `0` tenants / `KES 0` when the calls fail.
- Integration health table is hard-coded.
- Missing: visible error/forbidden state, real MRR, alert list/drill-down,
  refresh, time range.

### SA-10 — SaaS admin is locked out of every `/platform/*` API (P0)
- `backend/cmd/api/server.go` guards all `/platform/*` routes with
  `middleware.RequireRole(middleware.RoleSchoolAdministrators...)`
  (`SCHOOL_ADMIN`, `HEAD`, `DEPUTY`).
- A user with only `SAAS_ADMIN` (or `SUPER_ADMIN`) receives
  `403 {"code":"FORBIDDEN"}` for `/platform/tenants`, `/platform/plans`,
  `/platform/subscriptions`, `/platform/usage`.
- Consequence: every SaaS console page above is unusable even after wiring the UI.
- Fix direction: introduce platform roles in the role lists and use them for
  `/platform/*`; keep school-scoped access only where intended.

### SA-11 — `/platform` means two different things (P1)
- `/platform` is a **school-admin** page (`pages/PlatformPage.tsx`) in the school
  layout (plans/subscriptions/exports for one school).
- `/platform/tenants`, `/platform/onboard`, … are the **SaaS owner** console.
- Same prefix, different guard, different layout. It is easy to land on the wrong
  screen and there is no explicit school↔console switcher.
- Missing: distinct prefixes (e.g. `/console/*` vs `/school/platform`) or a
  clearly labelled switcher for users with both roles.

### SA-12 — Login does not resolve multi-school or platform users (P1)
- Login accepts only identifier + password; no school code is sent.
- Backend picks the first active membership. A user belonging to several schools
  cannot choose one at login; `/select-school` exists but is only reachable
  manually.
- A `SAAS_ADMIN` lands on `/dashboard` (school dashboard) for its membership
  tenant, not on `/saas-admin`.
- Missing: tenant selection at login (or redirect to `/select-school`) and a
  role-based post-login landing. The console link exists in the school sidebar,
  but login never routes a SaaS admin there automatically.

### SA-13 — No tenant detail / lifecycle UI (P1)
- Registry has no row click, detail drawer or route.
- Missing: school profile, contacts, license tier, subscription, invoices,
  usage, payment channels, audit history, suspend/resume/renew, grace period,
  data export/delete.

### SA-14 — No SaaS billing screens (P1)
- `GET /platform/invoices`, `POST /platform/exports` and export templates exist in
  the API but have no UI in the console.
- Missing: invoice list/detail, mark paid/void, download, dunning, revenue report.

### SA-15 — Console navigation points at the school page (P0)
- `components/organisms/SaaSLayout.tsx` defines the first tab as `/platform`,
  labelled “Operations”. `/platform` is the **school** `PlatformPage`, guarded by
  `SCHOOL_ADMIN`/`HEAD`/`DEPUTY`. Clicking it as `SAAS_ADMIN` makes `RequireRole`
  redirect to `/dashboard` (the school shell).
- The real operations screen is `/platform/operations`, which is **not in the
  sidebar**; `/saas-admin` is also not in the sidebar.
- The `/platform` `NavLink` prefix-matches every `/platform/*` route, so the
  active-tab highlight is ambiguous.
- The SaaSLayout header has no sign-out, user menu, language selector, tenant
  switcher or impersonation/read-only banner. A SaaS admin cannot log out from
  the console.

---

## School admin console

Audited as `SCHOOL_ADMIN` for tenant `smoke-school`. Source review plus the
screens reachable from the sidebar. Many backend endpoints already exist; the
gaps below are mostly missing or dead UI.

### SD-01 — Dashboard is two counters, no workflow (P1)
- Screen: `/dashboard` (`pages/DashboardPage.tsx`).
- Renders only “Learners” and “Attendance Registers” counts. No fee collection,
  arrears, enrolment trend, attendance rate, recent payments, upcoming exams,
  alerts or quick actions.
- Every request is wrapped in `.catch(() => ({ data: [] }))`, so a 403/500 is
  displayed as `0` with no error or retry.
- A `SAAS_ADMIN` signing in lands here, not on the console; the two SaaS cards
  then call `/platform/*` which that role is not allowed to use (see SA-10).

### SD-02 — School profile cannot be edited (P1)
- Screen: `/school` (`pages/SchoolProfilePage.tsx`).
- Read-only name, subdomain, type, funding mode, county, licence tier, status.
- No edit action, logo/stamp upload, contact details, academic settings, motto,
  payment-channel setup or branding.
- Loading failure collapses to “School not found” with no retry.
- Missing UI even though `PATCH /school` and `GET/PUT /school/finance-settings`
  are available.

### SD-03 — Academic calendar is read-only (P1)
- Screen: `/calendar` (`pages/AcademicCalendarPage.tsx`).
- Shows years, terms and exam windows, but there is no way to create/edit a
  year or term, activate/close a term, or add an exam window.
- No term dates validation, no “current term” indicator, no overlap detection.
- Backend exposes list + create only (`GET/POST /calendar/years`,
  `GET/POST /calendar/terms`, `GET/POST /calendar/exam-windows`); there are no
  update/activate/close endpoints yet.

### SD-04 — Staff onboarding is incomplete (P0)
- Screen: `/staff` (`pages/StaffPage.tsx`).
- List + “Add Staff” only. No edit, deactivate, resend invite, reset password,
  view detail, assign subjects/classes, or employment history.
- The Add Staff dialog has a **read-only, unbound TSC Number field** and never
  collects `subjects` or `employment_date`, although the form type has them.
- `POST /staff` failures are swallowed (`.catch(() => {})`); the dialog closes
  silently on success too, with no confirmation.
- No search, role filter, status filter or pagination.
- Backend exposes only `GET /staff` and `POST /staff`; staff edit, deactivate
  and invitation/reset endpoints still need to be added.

### SD-05 — Learner wizard captures only step 1 (P0)
- Screen: `/learners` (`pages/LearnersPage.tsx`).
- Three-step “Add Learner” wizard. Only step 0 fields are real state and are
  submitted. Step 1 guardian phone/email are hard-coded `value=""` with a no-op
  `onChange` — they cannot be typed into. Step 2 fee checkboxes are `checked`
  with no-op handlers and are not submitted.
- “Bulk Import” and “Export” buttons have no handlers.
- No learner detail, edit, deactivate, transfer, statement, fee-options,
  guardian linking, photo or documents.
- Search/grade/stream filters are client-side only; no pagination.
- Backend exposes list/create/get only; learner update, guardian linking and
  admissions lifecycle endpoints are missing server-side.

### SD-06 — Fee categories is the only near-complete CRUD (P2)
- Screen: `/finance/fee-categories`.
- Create/edit/delete works against the API and has field errors.
- Missing: search/pagination, reorder, activate/deactivate, usage counts, and a
  confirmation dialog before delete (it currently deletes immediately).

### SD-07 — Fee structures cannot be maintained (P1)
- Screen: `/finance/fee-structures`.
- “Add Fee Structure” only; no edit, deactivate, clone, delete or detail view.
- No way to target a structure to grade/term/boarding type or preview totals;
  no validation summary, no bulk copy from another year.
- List has no filters or search.
- Backend exposes list + create only; no update/deactivate/clone endpoints.

### SD-08 — Invoices are read-only (P0)
- Screen: `/finance/invoices`.
- Table only. No create invoice, generate invoice run, issue/void, add line,
  discount/adjust, send reminder, record payment, print/download or detail view.
- No status/term/grade filters, totals, ageing or pagination.
- Backend supports invoice runs, invoice lines, payments/allocate and statements.

### SD-09 — Payments are read-only (P0)
- Screen: `/finance/payments`.
- Table only. No record manual payment, allocate to invoices, reverse, refund,
  receipt print, reconciliation status or M-Pesa lookup.
- Missing totals by channel/date, search by receipt/admission number, export.
- Backend supports `/finance/payments`, `/finance/payments/allocate`,
  `/finance/refunds`, receipts and reconciliation.

### SD-10 — Curriculum is a viewer (P1)
- Screen: `/curriculum`.
- Select a version and read learning areas; no strand/sub-strand drill-down,
  grade mapping, weighting profiles or teaching allocation.
- No “set school curriculum” / activate version action.
- `TeachingAllocationPage` and `GradesStreamsPage` exist but are not linked from
  this workflow.

### SD-11 — Assessment has no data entry (P0)
- Screen: `/assessment`.
- Two read-only tables (events, results). No create event, select class/learning
  area, enter marks, upload evidence, compute competency, publish/reopen results.
- The CBC rubric selector and batch result endpoints exist in the backend but are
  not reachable from this page.
- No term/grade/class filters, no moderation or approval state.

### SD-12 — Reports cannot be generated (P0)
- Screen: `/reports`.
- Shows only counts of templates/runs/cards plus a card table.
- No “generate report cards”, term/grade selection, preview, publish, download,
  print or comment/moderation workflow.
- `ReportCardPrint` exists but is not linked from the list.
- Backend exposes report runs, publish and card comments.

### SD-13 — Communications compose is broken and has no recipients (P0)
- Screen: `/comms/compose` (`pages/CommsComposePage.tsx`).
- Templates are fetched **during render** (`if (templates.length === 0) api.get(...)`),
  which can loop when the template list is empty and violates React data-loading
  rules.
- There is no recipient selection at all: no class, grade, learner, guardian,
  staff group, phone list or channel (SMS/email/in-app). `POST /comms/messages`
  is sent with only template + body.
- Success/failure uses `alert()`; no preview, cost estimate, scheduling, opt-out
  check or delivery report.
- `/comms` itself is list-only: no template CRUD, broadcast send/retry, opt-out
  management or message detail.
- Backend has broadcasts, send, retry and opt-outs endpoints.

### SD-14 — Compliance is read-only (P1)
- Screen: `/compliance` plus consent/DSR/breach subpages.
- All five datasets are displayed as tables; no create consent notice, revoke
  consent, open/handle a DSR, record a breach, resolve a breach, export an access
  log or manage retention policies.
- No status workflow, SLA timer, evidence attachment or approval.
- Backend has `POST/PATCH` for notices, revoke, breach resolve and DSR updates.

### SD-15 — Attendance cannot be taken (P0)
- Screen: `/attendance`.
- Read-only registers and marks. No create register, open/close, mark present/
  absent/late, batch save, submit/lock, summary or correction.
- No class/date picker, no “today” shortcut, no offline indicator.
- Teacher workspace has `/teacher/attendance`; the admin page does not link to it
  and has no administrative override.
- Backend supports register CRUD, summary and `/attendance/marks/batch`.

### SD-16 — KNEC is a status page (P1)
- Screen: `/knec`.
- Shows counts of tools/submissions/exports and a tools table.
- No export generation, download, submission upload, validation errors, retry or
  status timeline; no term/series selection.
- Backend currently exposes read-only `/knec/tools`, `/knec/submissions` and
  `/knec/exports`; generation/upload endpoints still need to be built.

### SD-17 — School “Platform” page is informational only (P2)
- Screen: `/platform` (`pages/PlatformPage.tsx`).
- Counts plus a plans table. No change plan, renewal, invoice download, usage
  detail, export request or payment method.
- Shares the `/platform` prefix with the SaaS console (SA-11), which makes the
  navigation ambiguous.

### SD-18 — Profile is locale + sign-out only (P2)
- Screen: `/profile`.
- Only language switch and logout. No name/phone/email edit, password change,
  MFA setup, active sessions, notification preferences or avatar.
- `PATCH /me` is used only for locale.

### SD-19 — Errors and empty states are inconsistent (P1, cross-cutting)
- Several pages swallow failures and render `0` or an empty table with no
  explanation (`DashboardPage`, `OperationsCentrePage`, `PlatformPage`, list
  pages with `.catch(() => {})`).
- Others show a generic error with retry, and others show a blank content area.
- No global 401/403 handler: an expired session or forbidden role looks like an
  empty dataset. No toast/error boundary per request.
- Loading is often a full-page state, so one slow endpoint blanks the page.

### SD-20 — Client-side role gating diverges from the backend (P1)
- `RequireRole` trusts the `roles` array in localStorage. A stale or tampered
  role set renders pages whose API calls all fail, showing empty tables instead
  of a 403/Forbidden screen. The backend remains the real authority.
- `SAAS_ADMIN` has no backend role group at all; the school sidebar exposes the
  `/saas-admin` link, but every console API is rejected.
- `/dashboard` and `/profile` are not role-guarded, so any authenticated user
  can land on the school dashboard (including SaaS admins and parents).
- There is no “switch school”/“switch workspace” control; `/select-school` is
  only reachable manually.
- Missing: one shared role/permission map (frontend + backend), a Forbidden page
  and role-aware navigation.

### SD-21 — No pagination or server-side search anywhere (P2, cross-cutting)
- List pages fetch full collections and filter in the browser (learners, staff,
  invoices, payments, audit). This will not scale and hides backend paging
  capability.
- No page-size selector, total counts, CSV export or saved views.

### SD-22 — Finance operations are read-only (P1)
- Screens: `/finance/mpesa`, `/finance/reconciliation`, `/finance/credits`,
  `/finance/adjustments`, `/finance/refunds`.
- All five are list-only tables. No initiate/requery STK, no match or
  flag-refund, no create credit/adjustment/refund, no retry, filters or export.
- Backend write endpoints exist for every one of these actions.

### SD-23 — Grades & streams is a filter, not management (P1)
- Screen: `/grades-streams` (`pages/GradesStreamsPage.tsx`).
- Fetches learners and filters by **hard-coded** grade/stream lists. No create/
  edit/delete stream, class group, capacity, rollover or teacher assignment.
- Backend `/structure/*` endpoints exist.
- The page is routed but **absent from the sidebar**, so it is unreachable
  without typing the URL.

### SD-24 — Teaching allocation cannot be saved (P1)
- Screen: `/teaching-allocation`.
- Fetches learning areas, uses a hard-coded 3-teacher array, and keeps
  allocations in React state only. No save/API, term/class selection or workload
  validation.
- Backend has teaching-assignment endpoints.
- Also absent from the sidebar.

### SD-25 — Demo pages are hardcoded and orphaned (P1)
- `/fees` (`FeesDesk.tsx`): hard-coded MANDONGOI_FEES and unmatched
  transactions, fake STK/toasts, no API.
- `/students` (`StudentsDesk.tsx`): hard-coded MANDONGOI_REGISTER; CSV export is
  local only.
- `/cbc-assessment`: hard-coded learners and assessments.
- `/bom-oversight`: static report; only `window.print()`.
- `ReportCardPrint.tsx` is **not routed anywhere** and only prints a static
  placeholder.
- None of these are in the sidebar; wire them to real data or remove them.

> Environment note: during the audit the Chrome window was not visible, so
> background tabs froze some XHRs (Staff/Integrations looked stuck). Re-check
> those two screens with a visible window before treating them as product bugs;
> the API itself returned `200` with valid JSON.

---

## Parent portal

### PA-01 — Home is a static child card (P1)
- Screen: `/parent` (`pages/parent/ParentHomePage.tsx`).
- Fetches linked learners, but balances are never fetched and always show
  `KES 0`; “last synced” is the literal string “Just now”.
- “View”, “Pay Fees”, “Notices” and “Consents” buttons have no handlers.
- No attendance summary, fee due date, latest notice, report-card alert or
  child switcher.

### PA-02 — Fee payment is mocked (P0)
- Screen: `/parent/fees`.
- Two invoices are hard-coded; `Total Outstanding` is computed from them.
- “Initiate M-Pesa Payment” waits 2.5 s and reports success; no
  `/finance/mpesa/stk-requests` call, no phone prompt, no polling, no failure
  path, no receipt.
- No invoice detail, statement download, partial payment or payment history.

### PA-03 — Attendance is hard-coded (P1)
- Screen: `/parent/attendance`.
- Three fixed marks for “Brian Omondi” are injected in `useEffect`; no API call.
- No child selector, term/date range, attendance percentage, absence reason or
  excusal request.

### PA-04 — Consents cannot be changed (P0)
- Screen: `/parent/consents`.
- Consents are local hard-coded rows. The `ToggleButton` exists but is **never
  rendered** (the action column renders an empty fragment), so grant/revoke is
  impossible. The local `toggle` function is dead code.
- No consent notice text, version, timestamp or API persistence.

### PA-05 — Notices are hard-coded (P2)
- Screen: `/parent/notices`.
- Three fixed notices; no API, read/unread state, attachments, filtering or
  detail view.

### PA-06 — Progress calls an endpoint parents cannot use (P0)
- Screen: `/parent/progress`.
- Calls `/reports/cards`, which the backend guards with `RoleAcademicStaff`
  (`SCHOOL_ADMIN`, `HEAD`, `DEPUTY`, `BURSAR`, `CLERK`, `TEACHER`). A parent or
  guardian gets `403`, the error is swallowed, and the page always shows
  “No published reports”.
- The page needs a parent-scoped report-card endpoint (or a scoped query
  parameter enforced server-side), never the school-wide list.
- No term/year selector, subject breakdown or teacher comments beyond the card.
- “Download PDF” is a no-op.

### PA-07 — Receipts are hard-coded and cannot download (P1)
- Screen: `/parent/receipts`.
- Two fixed receipts; no API. “Download All PDFs” is a non-clickable button.
- No receipt detail, payment method filter or M-Pesa reference.

> Parent activation (`/parent/activate`) and password reset do call the API;
> they were not exercised end-to-end because no parent smoke user exists yet.

---

## Teacher workspace

### TE-01 — Classes are derived from all learners (P1)
- Screen: `/teacher/classes` (`pages/teacher/MyClassesPage.tsx`).
- Fetches `/learners` and groups by grade/stream label; it does not use teaching
  assignments or class groups. A teacher sees every learner in the school, and
  the grouping may not match real streams.
- No class detail, learner profile, attendance shortcut or progress summary.

### TE-02 — Attendance register cannot save (P0)
- Screen: `/teacher/attendance`.
- Registers and learners load, and present/absent/late marks can be toggled in
  local state.
- The primary “Save Register” button has `onClick={() => {}}`; marks are never
  sent to `/attendance/marks/batch`. There is no submit/lock, existing-mark
  hydration, validation, offline queue or success/error feedback.
- No date picker, class filter or summary counts.

### TE-03 — Grading only writes to the local queue (P1)
- Screen: `/teacher/grading`.
- Tapping a CBC level calls `saveAssessmentResult(...)` from `lib/offline`; it
  does not call the API until the separate Sync Centre is used.
- No explicit save/submit/publish, no per-cell sync state, no conflict handling,
  no moderation or evidence link.
- Event list is unfiltered; no term/class/learning-area selection.

### TE-04 — Remarks cannot be saved or published (P0)
- Screen: `/teacher/remarks`.
- “Save Draft” only clears the textarea; “Publish” is `onClick={() => {}}`.
- No API call to learner remarks or report-card comments, no autosave, no
  approval state.

### TE-05 — Evidence capture is a stub (P0)
- Screen: `/teacher/evidence`.
- Submit clears the two inputs and stops; no API, camera/audio capture, tag scan,
  learner lookup, timestamp or attachment upload.

### TE-06 — Class progress is read-only (P2)
- Screen: `/teacher/progress`.
- Lists learners and results but has no term/learning-area filter, no competency
  heatmap, no intervention notes or export.

### TE-07 — Sync Centre is the only real offline path (P2)
- Screen: `/teacher/sync`.
- Reads the local queue, shows pending operations and calls `syncNow()`. This is
  the only place teacher-entered assessment data reaches the server.
- No per-item retry, conflict resolution, last-sync timestamp or failure reason;
  the page does not refresh its `syncing` flag after completion.

### TE-08 — Teacher navigation is minimal (P2)
- Only classes, grading, attendance, progress, evidence, remarks and sync.
- No timetable, lesson plans, assignments, learner detail, messaging or school
  notices; teachers cannot reach the shared `/comms` or `/reports` pages.

### TE-09 — Privacy scope is too broad (P1, cross-cutting)
- Both teacher classes and progress use the tenant-wide `/learners` and
  `/assessment/results` endpoints. The backend scopes by tenant, not by the
  teacher’s assigned classes, so a teacher can see learners they do not teach.

---

## Backend readiness vs UI

The API is substantially ahead of the frontend. Most missing screens have a
working endpoint; some domains are missing both sides.

| Capability | API | UI | Verdict |
| --- | --- | --- | --- |
| Login / tenant switch / refresh | Yes (supports `tenant_code`) | Login ignores school code; no auto school picker | Fix UI + role landing |
| SaaS tenant lifecycle | Yes | Mock / blocked by RBAC | Wire + fix RBAC |
| School profile | GET/PATCH | Read-only | Wire edit |
| Academic calendar | List + create | Read-only | Add create/edit/close (API + UI) |
| Staff | List + create | List + broken create | Add lifecycle API + UI |
| Learners | List/create/get | List + broken 3-step wizard | Add update/guardian API + fix wizard |
| Fee categories | Full CRUD | Full CRUD | Works |
| Fee structures | List + create | List + create | Add edit/clone |
| Invoices | List/create/lines | Read-only | Add actions |
| Payments | List/create/allocate | Read-only | Add actions |
| M-Pesa / reconciliation / credits / adjustments / refunds | List + write | Read-only | Add actions |
| Curriculum | List/pin/create/publish | Read-only | Wire pin + editor |
| Assessment | Events/results/grid/batch/evidence | Read-only | Wire entry |
| Reports | Templates/runs/cards/publish | Read-only | Wire generation/publish |
| Communications | Templates/messages/broadcasts/retry/opt-out | Broken compose | Rebuild compose |
| Attendance | Registers/marks/batch | Read-only / dead save | Wire admin + teacher |
| Compliance | Full writes | Read-only | Wire workflows |
| KNEC | Read-only | Read-only | Build generation/upload on both sides |
| Parent portal | Linked learners + scoped gaps | Mostly mock | Rebuild most pages |
| Teacher workspace | Learner/assessment APIs | Partial, dead saves | Wire saves + scope by class |

## What works today

- Email/password login for a single-school user.
- `/select-school` if typed manually (lists memberships, switches token).
- Dashboard counts, school profile read, fee-category CRUD, staff list/create
  (partial), learner list/create (partial), fee-structure create.
- Read-only finance, curriculum, assessment, reports, compliance, attendance and
  KNEC tables.
- Teacher grading writes to the local offline queue; Sync Centre pushes it.
- Parent activation and password reset call the API.

## What is not end-to-end

Tenant onboarding, tenant lifecycle, staff lifecycle, learner admissions,
fee billing, invoicing, M-Pesa collection, reconciliation, attendance capture,
assessment entry, report-card generation, communications, compliance workflows,
KNEC exports, parent fees/consents/receipts/progress, teacher attendance/remarks/
evidence, and SaaS billing/impersonation.

## Recommended fix order

1. **Unblock routing and auth**: platform RBAC (SA-10), login `tenant_code`
   (AU-01), role-based landing (AU-02), SaaS nav (SA-15).
2. **SaaS core**: real tenant registry, onboarding, detail/lifecycle.
3. **School money**: learner wizard (SD-05), staff (SD-04), invoices/payments
   (SD-08/09), fee structures.
4. **Academic**: assessment entry (SD-11), reports (SD-12), attendance (SD-15,
   TE-02), teacher saves (TE-03/04/05).
5. **Parent and comms**: parent pay/consents/progress (PA-02/04/06), compose
   (SD-13).
6. **Compliance, KNEC, demo cleanup**: wire or remove the orphaned demo pages
   (SD-25).

## Coverage note

Source and API coverage is complete for every route in `frontend/src/App.tsx`
and every page under `frontend/src/pages/` (including `saas/`, `parent/` and
`teacher/`). Browser screenshots were blocked because the Chrome window was not
visible; the Staff and Integrations loading behaviour should be re-checked
visually, although both APIs returned `200` with valid JSON.

**Audit status: complete (source + API).**
