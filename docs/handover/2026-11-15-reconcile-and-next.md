# Handover — reconciliation and the next slice (2026-11-15)

`main` is the single source of truth. It is at `9f49e58` on `origin/main`.
`integration/kitui-final`, `integration/kitui` and `stabilization` were compared
against it, not merged wholesale.

## 1. Branch reconciliation — done, verified

| Branch | Relationship to `main` at `d6ccbe1` | Action |
| --- | --- | --- |
| `stabilization` | 0 commits ahead | none |
| `integration/kitui` | subset of `integration/kitui-final` | none |
| `integration/kitui-final` | 17 commits, all patch-equivalent except `77aa60f` | `77aa60f` cherry-picked as `9f49e58` |

Checked with `git cherry -v main integration/kitui-final` (one `+`, sixteen `-`),
not from a summary. The cherry-pick was done on `reconcile/kitui-final` off
`main`; conflicts were resolved in `backend/internal/assessment/write.go`,
`backend/internal/finance/mpesa_events.go` and
`backend/internal/finance/write.go`.

**Resolution rule used:** keep `main`'s newer error handling, `lock_timeout`
handling and invoice FSM; adopt the branch's decimal and inbox additions.

Adopted: `mpesa_inbox` writes in `ResolveMPESAEvent` with the error check kept,
checked STK metadata type assertions, shortcode → tenant resolution on C2B
callbacks, decimal scans in `EventGrid`/arrears/capitation, decimal
`invoice_lines`/`payment_allocations` bindings, `money.Decimal` in finance
dashboard aggregation, `InboxContext.Amount` as `money.Decimal`, and removal of
the `X-Tenant-ID`/subdomain tenant fallback.

**Deliberately dropped — do not "restore" these when merging the old branch:**

- `RecordPayment` consumed a receipt number via
  `nextval(pg_get_serial_sequence('receipt_sequences','receipt_number'))`.
  `receipt_sequences` has `last_number`, not a serial, and `payments` has no
  `receipt_number` column. There is therefore no receipt number in the
  response. A durable one needs the `payment_ledger` write (see §5).
- The overpayment "credit row" inserted into `payment_allocations` with
  `invoice_id = NULL`, but that column is `NOT NULL`, so the insert always
  failed silently. The unallocated remainder is still reported as
  `overpayment` on the response and stays visible to reconciliation.

Do not merge `integration/kitui-final` back into `main`: it would reintroduce
both dropped hunks and duplicate the cherry-pick. Retire or reset those branches
once nobody is working on them.

## 2. Landed this pass (all on `main`)

| Commit | What |
| --- | --- |
| `f59aff4` | `cmd/devuser` sets `app.current_user_role='SAAS_ADMIN'` in its bootstrap transaction. Without it the `tenant_memberships` INSERT was filtered by forced RLS: user row created, no membership, login returned `NO_ACTIVE_SCHOOL`. Personas made by `devuser` can now sign in. |
| `cab0817` | Comms broadcast grade picker reads `/structure/grades` instead of mapping message templates to grades, with an explicit empty state. |
| `e7219a3` | Screenshot manifest prefix `83` no longer duplicated (`83-saas-tenant-setup` → `89-…`); `check-routes.mjs` now fails on a repeated two-digit prefix. |
| `4038d52` | `list_scope_estate_test.go`: two-tenant coverage for `ListPlatformInvoices`, `ListTenantUsage` and `ListExports`. |
| `9f49e58` | The reconciliation above. |
| `54182fc` | Invoice, invoice-line and capitation read DTOs are `money.Decimal` (exact strings on the wire) instead of `float64`; SPA types accept `number \| string`; JSON shape pinned by tests. |
| `ef58ee2` | Not-found and reset-password screens translated; `keyCoverage.test.ts` walks every literal `t()` key in the source and requires it in both locales. |
| `d4f1534` | Learner import and the CBC assessment grid translated (CBC previously hardcoded Kiswahili headings in English mode). |
| `02cea30` | Curriculum viewer translated. |

## 3. What was actually verified — and what was not

Run in the cloud workspace (Go 1.26 installed at `~/sdk/go`, `npm ci` in
`frontend/`):

- `go build ./...`, `go vet ./...`, `go test ./...` — pass.
- `npx tsc --noEmit` — pass.
- `node scripts/ui-screenshots/check-routes.mjs` — 85 routes, manifest matches.
- `node scripts/check-api-contract.mjs` — 173 SPA calls match 290 routes.
- `internal/validation` test that forbids raw driver errors in 500s caught two
  hunks the cherry-pick had reintroduced; both now use `validation.DBError` /
  `validation.ServerError`.

**Not verified here.** This workspace has no usable Docker daemon, no Postgres
and no Redis, so:

- every DB-backed Go test (`TEST_DATABASE_URL`) skipped — including the new
  platform list test and the existing `list_scope_test.go`;
- `rlscheck` was not run;
- no API, no browser, no screenshot capture, no `--sweep`;
- the login flow through the fixed `devuser` was not exercised. The fix is a
  one-line GUC addition in the same transaction; it still needs a real run.
- `middleware/tenant.go` no longer accepts `X-Tenant-ID`/subdomain for
  unauthenticated routes. Nothing in the SPA or contract check depended on it,
  but a tenant-aware public route would now get no tenant. Watch the route
  sweep for this.

## 4. How to bring your local clone to this state

```bash
git fetch origin
git checkout main
git pull --ff-only origin main          # should land on 9f49e58

# The in-progress cherry-pick on your machine (reconcile/kitui-final) is now
# redundant: origin/main already contains the reconciled 77aa60f. Do not finish
# it. Either
git cherry-pick --abort                 # if a cherry-pick is still in progress
git branch -D reconcile/kitui-final     # then delete the scratch branch
# or just delete the branch if no cherry-pick is in progress.

# Your stashed WIP (parent-scope finance + decimal hardening):
git stash list
git stash pop                           # attendance/service.go will conflict, expected
```

If you want the old integration branch kept for archaeology, leave it alone;
just never merge it into `main`.

Recreate dev personas with the fixed bootstrap (no manual psql workaround):

```bash
cd backend
DATABASE_URL=... go run ./cmd/migrate -dir ../migrations -seed
DATABASE_URL=... DEV_EMAIL=teacher@demo.test DEV_PHONE=254700000002 \
  DEV_ROLE=TEACHER DEV_TENANT=demo-school DEV_PASSWORD='…' go run ./cmd/devuser
DATABASE_URL=... DEV_EMAIL=bursar@demo.test DEV_PHONE=254700000003 \
  DEV_ROLE=BURSAR DEV_TENANT=demo-school DEV_PASSWORD='…' go run ./cmd/devuser
```

Then confirm login (this is the check that was blocked here):

```bash
curl -s -X POST localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"teacher@demo.test","password":"…"}'
# expect 200 with access/refresh tokens, not NO_ACTIVE_SCHOOL
```

And exercise the two screens that only ever had jsdom coverage:
`docs/handover/2026-11-15-visual-checks.md` (CBC queue at `/cbc-assessment`,
payments dialog and `INVOICE_BUSY` retry at `/finance/payments`).

## 5. Still unattended (re-checked against the tree, not copied)

| # | Item | Evidence / where | Done when |
| --- | --- | --- | --- |
| 1 | ~~RLS live probe covers 9 of 104 tenant tables~~ **Done 2026-11-15** (`b0d7ff7`) | `rlscheck` now seeds 14 tables including `academic_years`, `guardians`, `tenant_memberships`, `invoices` and `payments`, children after parents, and removes the probe users it creates. | — |
| 2 | ~~Read DTOs carried money as `float64`~~ **Done 2026-11-15** (`54182fc`) | Invoice, invoice-line and capitation read DTOs now use `money.Decimal` and serialise as exact strings; `invoice_json_test.go` pins the wire shape and the SPA types accept `number \| string`. | — |
| 3 | ~~`RecordPayment` issues no durable receipt number~~ **Done 2026-11-15** (`b4ae5a7`) | The number is consumed from `receipt_sequences` under a row lock, written with the ledger row in the payment transaction and returned as `receipt_number`; `0061` links ledger rows to payments so a replay returns the same number. | — |
| 4 | Seven pages are still hardcoded English — **not done, and it needs a native speaker first** | Remaining: `AcademicCalendarPage`, `FinanceMpesaPage`, `FinanceReconciliationPage`, `ForgotPasswordPage`, `ReportCardPrint`, `SaaSAdminDesk`, `SchoolProfilePage` (2,625 lines). The Kiswahili already in `translations.ts` is visibly wrong — `fees` is rendered `mali` (property), `auto_renew` is `janaja la kuimarisha` (nonsense), `subdomain` is `salama`. | Someone who reads Kiswahili rewrites the existing `sw` strings, then the seven pages are translated against that corrected glossary. `keyCoverage.test.ts` only proves a key exists, not that the translation means anything. |
| 5 | ~~`kitchen`, `inkind`, `valueledger` still have no test files~~ **Done 2026-11-15** (`57a53e8`) | Each package has a DB-backed test with a success path and a refusal path (overdrawing stock, a commodity with no rate). Writing them exposed seven runtime defects, all fixed in the same commit. | — |
| 6 | CBC rubric sync is disabled, not implemented | no rubric-score table/endpoint; the UI labels its queue local | rubric score model + endpoint and the UI posts again, or the queue is removed |
| 7 | Three declared screenshots never captured | `33-admin-cbc-assessment.png`, `36-admin-report-card-print.png`, `40-admin-bom-oversight.png` absent from `docs/ui-design/training/` (prefix duplication is fixed now) | captured and asserted, reviewed before promoting |
| 8 | `cmd/rlscheck` false failures on a long-lived DB | five drift-only tables plus a skipped `tenant_usage` on dev databases; fresh run is clean | trust the CI fresh-database run; document or drop drift tables. **Partly addressed 2026-11-15**: a probe that looks parents up in the session tenant now reports `SKIP` instead of a false pass, and cross inserts are judged on rows written rather than "no error". |
| 9 | Plan document added by the cherry-pick | `docs/audit/MASTER_IMPLEMENTATION_PLAN.md` (382 lines) is now on `main` | read before starting new work; it may overlap items above |

## 5a. The database was finally available — what that proved (2026-11-15)

Postgres was not usable in earlier passes, so every DB test skipped. This pass
ran a real cluster (embedded PostgreSQL 18.3, fresh `migrate -seed`) as a
**non-superuser** role (`NOSUPERUSER NOBYPASSRLS`) — a superuser silently
bypasses RLS, which is how three wrong test expectations survived:

- `ListExports` selected `COALESCE(parameters, '')` on a JSONB column; invalid
  SQL, 500 as soon as an export row existed (`e092c5e`).
- Platform and finance tests asserted the driver error was echoed in the 500,
  and read `allocated_amount` as a number although it is a fixed-2dp string.
  Both contradicted the repo's sanitized-error contract.
- `auth_lookup_credentials` is granted to `skulapp_app` by `0031`; a role not
  named there needs its own `GRANT EXECUTE` before the login tests can run.

The whole suite now passes with `TEST_DATABASE_URL` pointing at that role.

## 6. Suggested next slice

`#4`, after a Kiswahili glossary rewrite: the translations are the product of a
bad machine pass, and adding seven more pages on top of them would multiply the
error. Then `#6` (CBC rubric sync needs a rubric-score table and endpoint first)
and `#7` (the three screenshots need Redis, a built SPA and a browser, none of
which this workspace has).

Still unverified for the same reason: no browser run, no screenshot capture and
no live login through `devuser` — the login-membership fix is covered by a test
that asserts the membership row exists, not by a real sign-in.
