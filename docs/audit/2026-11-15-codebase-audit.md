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

## P0 — Nine endpoints queried a schema that did not exist (fixed)

The API and the migrations had drifted. On a database built from `migrations/`
alone these handlers failed every call, and the SPA showed an empty or error
state as if there were no data.

| Endpoint | Was | Now |
| --- | --- | --- |
| `GET /structure/teaching-assignments` | no table at all | `teaching_assignments` created by 0057; `internal/assessment/write.go` opens an assessment against it too |
| `GET /gate/tags`, `GET /gate/events` | `column sp.first_name does not exist` | queries read `users.first_name`/`last_name` (added by 0005); `staff_profiles` holds employment data, not names |
| `GET /finance/holding-tank` | `column "msisdn" does not exist` | queries read `sender_phone`, `transaction_code`, `resolved_student_id`; 0058 adds `resolved_at` |
| `GET/POST /compliance/retention-policies` | no table | `retention_policies` created by 0057 |
| `GET/PUT /school/finance-settings` | no table | `school_finance_settings` created by 0057 |
| `GET /sync/conflicts` | no table | `sync_conflicts` created by 0057 |
| `GET /platform/usage` | no table | `tenant_usage` created by 0057 |
| `GET /platform/subscriptions` | no table | `subscriptions` created by 0056 |

Five of the nine were missing tables that existed only in `migrations/archive`;
0057 recreates them with the archived shape and the column names the queries
use, plus the tenant-isolation and platform-bypass policy pair every other
tenant table has. Two were query drift rather than missing schema and are fixed
in the handlers. The empty-list bug that made several of these screens look
broken even after the schema landed (`null` instead of `[]`) is fixed on
holding-tank, gate tags, platform usage and platform subscriptions.

Verified on `unified_fresh`, a database created by `go run ./cmd/migrate -dir
../migrations -seed` with nothing else applied: every endpoint answers 200, a
written row round-trips (`POST /compliance/retention-policies` then list,
`PUT /school/finance-settings` then read), and the screenshot harness passes on
all nine affected screens — `/structure`, `/grades-streams`, `/gate/admin`,
`/finance/holding-tank`, `/compliance/retention-policies`, `/integrations`,
`/teacher/sync`, `/platform/operations`, `/platform/subscriptions`.

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

## P1 — Sixteen SPA calls hit routes that do not exist (fixed)

Frontend and backend disagreed on the contract in eight pages. Each 404 logged a
console error, which is exactly what the screenshot harness fails a route on —
that is how they surfaced. The pattern was `PUT` where the Go API wrote `PATCH`,
plus paths never re-pointed after the backend moved from the old Node slices to
Go, plus four resources the API could write but never read back.

| Page | Was | Now |
| --- | --- | --- |
| `AttendancePage` | `PUT /attendance/registers/:id` | `PATCH`, and the body sends the field it edits (`session_type`, not `status`) |
| `AttendancePage` | `DELETE /attendance/registers/:id` | route added: marks and register deleted in one tenant transaction |
| `DPIAPage` | `GET /compliance/dpia` | route added: the page can list what it creates |
| `FinanceCapitationPage` | `GET`/`POST /finance/capitation` | `/finance/capitation/receipts`, and it reads the bare array the API returns |
| `FinanceLearnerStatementPage` | `GET /finance/statement/:id` | `GET /finance/learners/:id/statement` |
| `FinanceReceiptSequencesPage` | `GET`/`POST/PUT /finance/receipt-sequences` | list, create and `PATCH` added; the page's three calls match |
| `FinanceSTKPage` | `GET` list, `GET` channels, `POST /mpesa/stk-push`, `GET .../:id/status` | list and channel routes added; create posts to `/mpesa/stk-requests`; status reads `/:id` |
| `ReportsPage` | `PUT /reports/templates/:id` (two call sites) | `PATCH` |
| `StructurePage` | `PUT /structure/streams/:id`, `PUT /structure/class-groups/:id` | `PATCH` |

Where the UI was right and the API was missing a read, the API gained it rather
than the page losing a feature: `GET /compliance/dpia`,
`GET /finance/mpesa/stk-requests`, `GET /finance/mpesa/channels`,
`GET /finance/receipt-sequences`, `POST /finance/receipt-sequences`,
`PATCH /finance/receipt-sequences/:id`, `DELETE /attendance/registers/:register_id`.
`UpdateRegister` also accepts `session_type` now — the page's edit modal changes
the session, and the old handler only ever accepted `OPEN`/`CLOSED`, so a
corrected verb alone would have returned 400.

A scripted cross-check of all 306 calls the SPA makes against all 288 routes the
API registers now reports zero unmatched. Screenshot run over the nine affected
routes: **seven pass**. `/structure` and `/grades-streams` still fail, on a
*different* defect — `relation "teaching_assignments" does not exist` — see the
P0 above.

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

## P1 — i18n fell back to raw keys in 32 places (fixed)

`t()` returns the literal key when the key is absent. Confirmed on screen: the
parent tab bar read **`parent.child`** (`components/organisms/ParentLayout.tsx:16`).

An earlier count in this document said 134; the measured number, after loading
the real `translations` object and asking i18next `exists()` for every key the
code references, was 32 keys — 31 absent from both locales and `parent.child`
absent from English only. The inflated figure came from a regex scan that did
not apply `mergeLocale`'s lifting of flat `common` keys to the root. The other
things it named were already present: `wizard.step_*` and `auth.welcome*`
resolve, because they live in `common`.

The bigger finding is how `gate.*` was broken: the whole group sat **nested
inside `auth`** in both locales, so `t("gate.title")` never resolved. The keys
existed; the path did not. Nested groups are invisible to a key-presence check
that only looks at names.

Fixed in `frontend/src/i18n/`:

- `gate` moved to a top-level group in both locales, with the Swahili corrected
  (it read "Stadi ya skena ya klerk" / "Tembelea nje").
- The 31 missing keys added in English and Kiswahili, including the learner
  termination dialog, select-all, sponsorship, `academic_year`, `class_group`,
  `dashboard` and `username`.
- `parent.child` added to English.
- Both locales now carry the same 393 keys; the app references 280 of them and
  all resolve in both.
- Development now reports a missing key once, by name, with the file to edit;
  production keeps rendering the key rather than throwing mid-render.
- The `app_lang` choice is applied at startup: the header toggle wrote it but
  nothing read it back, so a Kiswahili user returned to English on every
  reload. Verified in a browser: the parent tab bar reads "My Child" in English
  and "Mtoto Wangu" in Kiswahili, with no raw keys on `/parent` or `/gate`.

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
3. ~~Fix the 16 contract calls (mechanical, mostly `PUT` → `PATCH`).~~ Done —
   seven of the nine affected routes now pass; see the P1 above.
4. ~~Fill the missing i18n keys and make a missing key fail in development.~~
   Done — see the i18n finding above.
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
