# What is still unattended — 2026-11-15

Everything here was re-checked against the tree at `e4f7abf`, not copied from the
audit. Each item names the evidence, why it matters, and what "done" means, so it
can be picked up without re-deriving the problem.

## A. CI proves empty states only

**Evidence.** `migrations/seed/0001_demo.sql` is 52 lines: one school, one learner,
no `academic_years`, `class_groups`, `attendance`, `consents` or report cards. The
smoke job (`scripts/ci/screenshot-smoke.sh`) creates a single persona
(`SCHOOL_ADMIN`) and captures 13 routes (`CAPTURE_ONLY`) — none under `/parent*`,
although `routes.mjs` declares a `parent` persona and ten parent routes.

**Why it matters.** Every passing screenshot is a screen with no rows. A handler
that joins a missing row, a badge that only renders with data, or a parent screen
that 403s would still show green. The parent portal was broken end to end once
already and the smoke run did not notice.

**Done when.** The seed creates a small but complete school — one academic year,
two class groups, ~6 learners, an attendance register with marks, an invoice with a
partial payment, a consent and a report card — and the smoke run includes the
parent persona and at least `/parent`, `/parent/fees`, `/parent/attendance`.

## B. Nothing calls every route, so 5xx and 404 classes still pass CI

**Evidence.** `scripts/ci/screenshot-smoke.sh` covers 13 routes; the full manifest
covers 85. The contract check added this session
(`scripts/check-api-contract.mjs`) compares *paths* statically — it would not catch a
handler that panics, a missing table, or a query drift, which is what the audit's
nine P0s were.

**Done when.** A CI job boots the API against a database built from `migrations/`
alone (no seed), logs in as one persona per role, calls every route the SPA and the
personas use with plausible parameters, and fails on any 5xx (4xx is acceptable only
from an explicit allowlist of "deliberately unauthorized" cases). This is the gate
that would have caught `relation "teaching_assignments" does not exist` and the
parent-portal 500s.

## C. Tenant isolation is unverified

**Evidence.** `scripts/audit/verify_rls.sh` inserts into `tenants` and `students`,
tables that no longer exist, so it cannot run at all. `migrations/` enables or forces
RLS on 18 tables; `0057` added five of them (`teaching_assignments`,
`retention_policies`, `school_finance_settings`, `sync_conflicts`, `tenant_usage`)
with a policy pair that has never been exercised.

**Done when.** The script enumerates `pg_class` for every RLS-enabled table (so new
tables are covered automatically), seeds two tenants, and for each table proves
tenant A cannot see tenant B's rows — and that the platform role can (the bypass
policy). It runs in CI against the migrations-only database, skipping tables it
cannot populate and reporting them rather than silently passing.

## D. Visual state of this session's UI changes

**Evidence.** The CBC offline banner and the translated payments dialog are asserted
by jsdom text only. `docs/handover/2026-11-15-visual-checks.md` has the runbook and a
paste-ready prompt for a machine with Postgres + Redis.

**Done when.** Both screens have been seen in a browser, the `INVOICE_BUSY` panel was
reproduced against a held row and retried successfully, and any wording or layout
defect found is fixed with a test.

## E. Three declared screenshots have never been captured

**Evidence.** `routes.mjs` declares 74 images; `33-admin-cbc-assessment.png`,
`36-admin-report-card-print.png` and `40-admin-bom-oversight.png` are absent from
`docs/ui-design/training/`. `check-routes.mjs` validates the `NN-slug.png` shape but
not unique `NN`, and `83` is used twice (`83-saas-admin-desk`,
`83-saas-tenant-setup`).

**Done when.** All three exist and pass their assertions, and the prefix check rejects
duplicates.

## F. Known defects with no owner

| Where | What | Done when |
| --- | --- | --- |
| `backend/cmd/devuser/main.go:113` | `WHERE phone_number = $1 OR email = $2` with an empty `DEV_PHONE` matches any user whose phone is empty, so successive personas overwrite one account and pile up memberships | the phone branch is only included when `DEV_PHONE` is non-empty, with a test |
| `frontend/src/pages/CommsPage.tsx:325` | the grade picker is built from message templates (`// placeholder for grade picker`) | real grades, or the control is removed |
| `backend/internal/finance/service.go:371-373,484-485,1637` | money crosses the API as `float64` while the database is `NUMERIC` | DTOs carry `numeric`/string, or a documented tolerance test proves the rounding is bounded |
| `backend/internal/kitchen`, `inkind`, `valueledger` | reachable over HTTP, no test files at all | each handler has at least one failure and one success test |

## G. CBC rubric sync is disabled, not implemented

**Evidence.** The component no longer posts; the queue is labelled local. There is no
server model for sub-strand rubric scores, so `POST /assessment/cbc/bulk-sync` was not
invented.

**Done when.** Either a rubric-score table and endpoint exist and the UI posts again,
or the offline queue is removed and the page stops promising sync.

## H. i18n: twelve pages still hardcoded

**Evidence.** 51 files in `frontend/src/pages`, 38 call `useTranslation`. The payments
page was translated this session; these still do not:
`AcademicCalendarPage`, `CBCAssessment`, `CurriculumPage`, `FinanceMpesaPage`,
`FinanceReconciliationPage`, `ForgotPasswordPage`, `ImportLearnersPage`,
`NotFoundPage`, `ReportCardPrint`, `ResetPasswordPage`, `SaaSAdminDesk`,
`SchoolProfilePage`.

**Done when.** Each renders from keys that exist in both locales, verified by the
existing missing-key reporter rather than a regex count.

## I. Platform lists are fixed but only partly tested

**Evidence.** `ListSubscriptions` is covered by
`backend/internal/platform/list_scope_test.go`; `ListPlatformInvoices`,
`ListTenantUsage` and `ListExports` got the same treatment (estate scope + `COALESCE`
for nullable columns) without their own tests.

**Done when.** One table-driven test covers all four, or each has a case.

Already done this session and not to be redone: the SPA↔route contract check
(`scripts/check-api-contract.mjs`, wired into the `frontend` CI job), the payments
translation, the CBC queue replacement, and the platform estate scoping.
