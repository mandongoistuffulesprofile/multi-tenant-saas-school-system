# Codebase audit — 2026-11-15

Whole-repository scan of `main` at `ce7ab33`, run against a **freshly migrated
empty database**, not a developer's long-lived one. That distinction matters:
most of what follows is invisible on a database that has been patched by hand
over months, and is what a new school would hit on day one.

**Method.** `go build ./...`, `go vet ./...`, `go test ./...` (all 125 backend
files), `npx tsc --noEmit`, `npx vitest run`, then a scripted cross-check of
every API path the SPA calls against every route `cmd/api/server.go` registers,
then the full screenshot harness (85 routes, 71 images) against the real stack
(Go API + built SPA + PostgreSQL + Redis). Every 404/500 below was reproduced
with `curl` against that stack; the quoted `pq:` strings are the API's own
responses.

## Where the unified codebase stands

`main` is at `ce7ab33` ("Route the gate terminal, the parent child view and the
platform desk"), one merge plus three commits ahead of the previous audit base.
New since then: `/gate` (KioskPage), `/platform/desk` (SaaSAdminDesk) and
`/parent/child` (ParentChildPage), and the screenshot manifest was extended to
all 85 declared routes, so the harness and the router are still in step.

Green: `go build`, `go vet`, the whole Go test suite, `tsc --noEmit`, 15 Vitest
tests. 53 of 71 photographed routes pass their assertions, which is the honest
headline: the core (learners, finance, calendar, curriculum, assessment,
reports, comms, compliance, school, platform registry/onboarding) works.

Red: 18 of 71 do not, and they are not cosmetic. They fall into three
independent defect classes below.

---

## P0 — Nine endpoints query a schema that does not exist

The API and the migrations have drifted. On a database built from
`migrations/` alone these handlers fail every call, and the SPA shows an empty
or error state as if there were no data.

| Endpoint | API answer | Code | What the schema actually has |
| --- | --- | --- | --- |
| `GET /structure/teaching-assignments` | `pq: relation "teaching_assignments" does not exist` | `internal/structure/service.go:414`, also `internal/assessment/write.go:434` | `teaching_allocations` |
| `GET /gate/tags`, `GET /gate/events` | `pq: column sp.first_name does not exist` | `internal/attendance/service.go:412,485` | `staff_profiles` has no name columns; names live on `users`, joined through `memberships` |
| `GET /finance/holding-tank` | `pq: column "msisdn" does not exist` | `internal/finance/service.go` | `mpesa_holding_tank.sender_phone` |
| `GET/POST /compliance/retention-policies` | `pq: relation "retention_policies" does not exist` | `internal/compliance/write.go:429,454` | no such table |
| `GET/PATCH /school/finance-settings` | `pq: relation "school_finance_settings" does not exist` | `internal/school/service.go:338,369` | no such table |
| `GET /sync/conflicts` | `pq: relation "sync_conflicts" does not exist` | `internal/sync/service.go:443,520` | no such table |
| `GET /platform/usage` | `pq: relation "tenant_usage" does not exist` | `internal/platform/service.go:214` | no such table |
| `GET /platform/subscriptions` | `pq: relation "subscriptions" does not exist` | `internal/platform/service.go:125` | no such table |

**Impact.** `/grades-streams`, `/structure`, `/gate/admin`,
`/finance/holding-tank`, `/compliance/retention-policies`, `/integrations`,
`/teacher/sync`, `/platform/operations` and `/platform/subscriptions` are all
dead on a fresh install. `/platform/operations` additionally throws an uncaught
`AxiosError` in the render path, so the platform console shows a React error
boundary rather than a message.

**Fix.** Either add the four missing tables as migrations (they are referenced
by handlers that already exist, so the shape is defined by the queries), or
move the handlers onto the tables that do exist — `teaching_allocations` for
`teaching_assignments`, `users` joined via `memberships` for staff names,
`sender_phone` for `msisdn`. This is the single highest-value slice in the
repo: nine screens come back at once.

## P0 — The parent portal is broken end to end

`GET /me/linked-learners` fails on `learner_guardians.relationship_type`:

```
pq: column lg.relationship_type does not exist (SQLSTATE 42703)
```

`internal/auth/parent.go:53` selects `COALESCE(lg.relationship_type, '')`; the
column is `relationship`. Same message at `internal/reports/service.go:297,575`.
Because every parent screen waits on this call, `/parent`, `/parent/progress`,
`/parent/child` and the child picker on every other parent page render
"No linked children found" — an empty state, not an error, so a parent is told
they have no children rather than that the lookup failed.

Two more parent faults, independent of that:

- `/parent/fees` calls `GET /finance/invoices` and `/parent/receipts` calls
  `GET /finance/payments`: staff endpoints, guarded by `RoleFinanceStaff`. A
  parent gets **403** and then an empty list. Parent scoping exists on the
  backend (`/finance/parent/...`, `GET /me/linked-learners`) but these pages do
  not use it.
- The bottom tab bar shows the raw key `parent.child` as a label (see the i18n
  finding).

**Fix.** Rename the column reference, point the two parent pages at their
parent-scoped endpoints, add the missing i18n key. One migration-free slice
that unbreaks six screens.

## P1 — Sixteen SPA calls hit routes that do not exist

Frontend and backend disagree on the contract in eight pages. Every row
reproduced with `curl` against the running API, status shown as returned:

| Page | Call | Reality |
| --- | --- | --- |
| `AttendancePage` | `PUT /attendance/registers/:id` | backend uses `PATCH` |
| `AttendancePage` | `DELETE /attendance/registers/:id` | no delete route exists |
| `DPIAPage` | `GET /compliance/dpia` | only `POST` exists — the page has no way to list |
| `FinanceCapitationPage` | `GET`/`POST /finance/capitation` | backend has `/finance/capitation/receipts` |
| `FinanceLearnerStatementPage` | `GET /finance/statement/:id` | backend has `/finance/learners/:id/statement` |
| `FinanceReceiptSequencesPage` | `GET /finance/receipt-sequences` | backend has `/finance/receipt-sequences/:period` |
| `FinanceReceiptSequencesPage` | `PUT /finance/receipt-sequences/:id` | only `GET` on that path |
| `FinanceReceiptSequencesPage` | `POST /finance/receipt-sequences` | backend has `/receipt-sequences/:id/increment` |
| `FinanceSTKPage` | `GET /finance/mpesa/stk-requests` | only `POST` exists |
| `FinanceSTKPage` | `GET /finance/mpesa/channels` | no such route |
| `FinanceSTKPage` | `POST /finance/mpesa/stk-push` | backend has `/finance/mpesa/stk-requests` |
| `FinanceSTKPage` | `GET /finance/mpesa/stk-requests/:id/status` | backend has `/finance/mpesa/stk-requests/:id` |
| `ReportsPage` | `PUT /reports/templates/:id` | backend uses `PATCH` |
| `StructurePage` | `PUT /structure/streams/:id` | backend uses `PATCH` |
| `StructurePage` | `PUT /structure/class-groups/:id` | backend uses `PATCH` |

Each 404 logs a console error, which is exactly what the screenshot harness
fails a route on — that is how they surfaced. Note the pattern: `PUT` where the
Go API wrote `PATCH`, and paths that were never re-pointed after the backend
moved from the old Node slices to Go. A one-line change per call, but 15 of
them, and no test currently notices.

## P1 — Five backend domains have no UI at all

The reverse of the check above: routes the API serves that no SPA code calls
and that have no page. Confirmed by grepping the whole frontend for the domain
name (zero hits):

| Domain | Routes | Frontend refs |
| --- | --- | --- |
| `kitchen` | `GET/POST` (4) | 0 |
| `inkind` | `GET/POST/PATCH/DELETE` (7) | 0 |
| `value-ledger` | `GET` (1) | 0 |
| `opening-balances` | `POST` (2) | 0 |
| `delegated-tokens` | `GET/POST` (4) | 0 |

Useful work exists on the server (school feeding/kitchen, in-kind donations,
value ledger, opening balances, delegated access tokens) that a school
administrator can never reach. Either build the screens or stop advertising the
capability.

## P1 — i18n falls back to raw keys in 134 places

`t()` returns the literal key when the key is absent, and 134 keys used in the
SPA are not in `i18n/translations.ts`. Most are silently masked by a
`defaultValue`; the ones that are not render as keys. Confirmed on screen: the
parent tab bar reads **`parent.child`** (`components/organisms/ParentLayout.tsx:16`,
key missing from both languages). Whole clusters are affected: every
`gate.*` key in the new `KioskPage`, the learner wizard's `wizard.step_*`, and
the login page's `auth.welcome*` set.

**Fix.** Add the missing keys in EN and SW, and make `t()` log or fail in
development when a key is missing so the next one is caught at build time.

## P2 — Smaller defects found while reading

- **`cmd/devuser` matches on an empty phone.** It looks a user up with
  `WHERE phone_number = $1 OR email = $2`; with `DEV_PHONE` unset, every row
  whose phone is empty matches, so consecutive invocations with different
  emails overwrite the *same* user and pile up memberships. I hit this
  creating the persona accounts (an `admin@demo.test` that also held
  `SAAS_ADMIN` on `platform-ops`, forcing tenant selection on login). The CI
  smoke script only creates one user, which is why it never showed. Fix: only
  include the phone branch when `DEV_PHONE` is non-empty.
- **The comms grade picker is populated with message templates.**
  `CommsPage.tsx:325`: `const grades = templates.map(...)` — the variable is a
  stand-in for a grade list, so anything using it offers template names where
  grades belong.
- **`check-routes.mjs` tolerates duplicate numeric prefixes.** The manifest now
  contains both `83-saas-admin-desk.png` and `83-saas-tenant-setup.png`; the
  checker enforces the `NN-slug.png` shape and unique filenames, but not unique
  `NN`, so two pages share a sort key and the ordering is arbitrary.
- **Money crosses the API boundary as `float64`** (`internal/finance/service.go`
  DTOs: `total_amount`, `amount_paid`, `amount_outstanding`, `unit_amount`,
  `line_amount`). The database is `NUMERIC`; the JSON round-trip is where
  rounding can appear. Fine until a Kenya Power-style 1-cent mismatch, then
  hard to find.
- **Twelve list queries have no `LIMIT`** (`fee_invoices`, `users` scans in
  handlers). With one demo school it is invisible; the first school with 4,000
  invoices makes those screens slow and the response large.

## Screenshot harness — two environment traps worth knowing

1. **Missing fonts produce complete, plausible, text-less screenshots.** On a
   host without system fonts, Chrome renders every glyph invisibly and the
   harness's byte-size and text-length checks still see a page: the first run
   here produced 16 beautiful screenshots with no words on them. Pointing
   `FONTCONFIG_FILE` at a bundled `fonts.conf` fixed it. This is documented in
   `scripts/ui-screenshots/README.md` now; a preflight check would be better
   (see follow-ups).
2. **`--expand` for headless-shell.** `chrome-headless-shell` aborts
   beyond-viewport captures (`Target closed`). The new flag grows the viewport
   to the document height and takes a normal viewport shot, giving the same
   full-page image; every image in `docs/ui-design/training/` was produced that
   way at 2x.

## Suggested order

1. Rename the three wrong columns (`relationship_type`, `msisdn`, staff names),
   point the parent pages at parent endpoints, add `parent.child`. One slice,
   unbreaks the whole parent portal.
2. Add the four missing tables, or repoint the nine handlers. One slice,
   unbreaks nine admin/platform screens.
3. Fix the 16 contract calls (mechanical, mostly `PUT` → `PATCH`).
4. Fill the 134 i18n keys and make a missing key fail in development.
5. Decide the fate of the five UI-less domains — build or de-advertise.

## Reproducing this audit

```bash
# fresh database, demo tenant, one user per role
DATABASE_URL=... go run ./cmd/migrate -dir ../migrations -seed
DATABASE_URL=... DEV_EMAIL=admin@demo.test DEV_PHONE=254700000001 \
  DEV_ROLE=SCHOOL_ADMIN DEV_TENANT=demo-school DEV_PASSWORD='...' go run ./cmd/devuser

# contract cross-check (frontend calls vs registered routes)
node .kilo/tmp/xcheck.mjs   # throwaway script, prints unmatched in both directions

# the pages themselves
node scripts/ui-screenshots/capture.mjs --out docs/ui-design/training --expand
```
