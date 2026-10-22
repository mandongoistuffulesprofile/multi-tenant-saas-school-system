# Completeness Closure Plan — Parallel Lanes

**Goal:** move the Kenyan Primary School SaaS from its current partial state to "every V-ID works end-to-end, every plan §4 endpoint is implemented or explicitly waived, and all 8 plan §11 mandatory tests pass."

**Baseline (measured, this tree):** 98 routes registered in one file · ~100 tables across 22 `.sql` files · 0 test files · 0 CI · 0 git commits · 8 endpoint families entirely absent · 2 duplicate schema sources.

**Method:** base-branch enablers → Agent Manager worktree lanes → cross-cutting test lanes → integration.

---

## 1. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | Close the 8 missing endpoint families + write-depth where a view needs it, and land all 8 §11 mandatory tests. **Not** full §4 parity on all 15 modules. |
| D2 | Parallelism | Stabilize shared contracts on the base branch first, then one Agent Manager worktree per lane. |
| D3 | M-Pesa / SMS | `ChannelProvider` interface + faithful Daraja adapter + deterministic fake driver. No network or credentials required for any test to pass. |
| D4 | Legacy `src/` | Port the two behaviours Go never received (security-question reset, login lockout/session rotation), then delete `src/`, root `package.json`, `src/db/migrations.sql`. |

---

## 2. Definition of done

`make verify` must be green and all of the following must hold:

1. **Route coverage** — every endpoint in plan §4 is either registered or listed in `docs/coverage.md` with a written waiver. A Go test walks the router registry and fails if any registered route is missing from `docs/coverage.md`.
2. **View coverage** — every V-ID in `design/ui-ux/` maps to a routed page *and* a passing Playwright smoke test.
3. **Mandatory tests** — all 8 §11 items exist and pass.
4. **Schema integrity** — every migration has a matching `down.sql`; every created table is either referenced by code or listed as intentional in `docs/coverage.md`.
5. **Clean-checkout reproduction** — `docker compose up` on a fresh clone yields a fully migrated schema (`schema_migrations` shows all applied) and `GET /health/ready` returns 200, with no manual `psql -f` step.
6. **i18n** — no hardcoded user-facing strings in `frontend/src/pages/**` (enforced by an ESLint rule).
7. **No stray artifacts** — no compiled binaries, no `dist/`, no `node_modules/` tracked.

---

## 3. Baseline → target scorecard

| Metric | Now | Target |
|---|---|---|
| Plan §4 endpoints implemented | ~98 / ~230 | 100% of in-scope, rest waived in writing |
| Endpoint families present | 8 / 15 | 15 / 15 |
| View IDs routable + smoke-tested | ~0 / 40 | 40 / 40 |
| Go test files | 0 | ≥ 40 (one suite per package) |
| Frontend test files | 0 | ≥ 25 unit + ≥ 10 E2E |
| §11 mandatory tests | 0 / 8 | 8 / 8 |
| Migrations with `down.sql` | 0 / 22 | 100% |
| Migrations on a runner with `schema_migrations` | 0 | 100% |
| RLS `FORCE` on tenant tables | ~100% | 100% + leak test |
| `Idempotency-Key` enforced on money/sync POSTs | 0 | 100% |
| DB-level audit triggers | 0 | all money/identity tables |
| Structured log lines w/ `request_id`/`tenant_id`/`user_id` | 0 | 100% |
| Unreferenced (dead) tables | ≥ 3 (`school_terms`, `sessions`, `audit_log` vs `audit_events`) | 0 |
| Clean-checkout `docker compose up` → schema ready | fails (bad mount) | passes |
| Git commits / branches / CI | 0 / 0 / none | ≥ 1 baseline + CI workflow |

---

## 4. Phase 0 — Enablers (base branch, single owner, sequential)

**This phase must land on `main` before any lane worktree is created.** Its whole purpose is to remove every shared-file hotspot so lanes never touch the same file.

### E0.1 — Git baseline and hygiene
- Extend `.gitignore`: `backend/api` (15 MB compiled binary), `backend/dist/`, `frontend/dist/`, `.kilo/worktrees/`, `*.tsbuildinfo`, `.env` variants already covered.
- Delete: `backend/api`, `frontend/dist/`, `backend/internal/audit/handler_fix.txt`, root `-h`.
- `git init` already done — create the first commit on `main`, tag `baseline`.
- Create `AGENTS.md` at repo root recording the lane ownership table (see §5) so every lane agent obeys it.

### E0.2 — Backend route registry (defuses `server.go`)
Create `backend/internal/router/router.go`:

```go
type Route struct {
    Method  string
    Path    string
    Group   string
    Roles   []string   // empty = authenticated, nil = public
    Handler gin.HandlerFunc
}

type Builder struct { gin *gin.RouterGroup; routes []Route }
func (b *Builder) Handle(method, path string, roles []string, h gin.HandlerFunc)
func (b *Builder) Routes() []Route
```

- Each module package gains a `Register(b *router.Builder)` function; `server.go` becomes pure assembly (`router.New().Mount(auth.Register).Mount(school.Register)…`).
- The `Routes()` registry is the substrate for the **role-matrix test** (§11 #7): the test enumerates it and asserts per-role reachability.
- Split `backend/internal/finance/service.go` (1 373 lines) into `service.go` / `handler.go` / `invoices.go` / `payments.go` / `allocations.go` / `mpesa.go`.
- Split the other single-file packages the same way (`learner`, `staff`, `assessment`, `attendance`, `school`, `compliance`, `comms`, `reports`, `platform`, `calendar`, `curriculum`, `knec`).

### E0.3 — Migration runner, renumbering, schema reconciliation
- New `backend/cmd/migrate/main.go`: `up` / `status` / `rollback`, applies files in sorted order, records `version, name, checksum, applied_at` in a new `schema_migrations` table, refuses checksum drift.
- **Flatten** `migrations/sliceN/` into one monotonic sequence `NNNN_name.sql`; this removes the duplicate `020` (slice2 `020_db_hardening` vs slice3 `020_create_curriculum_global_tables`) and brings slice7 under the plan.
- **Reconcile the schema** (authoritative decisions, no lane may re-litigate):
  - **Drop `school_terms`** — fully redundant with `terms` (`terms` already has `start_date`, `end_date`, `midterm_start`, `midterm_end`, `is_current`) and referenced by no code.
  - **Keep `tenant_branding_settings`** — unreferenced but a real feature (V-H02 logo/stamp); L4 wires it.
  - **Move audit to `audit_events`** — Go currently writes the non-partitioned `audit_log` (slice0/009) while the plan mandates the partitioned `audit_events` (slice0/001). Migrate writers, then drop `audit_log`.
  - **Drop `sessions`** — superseded by `refresh_tokens`. **Keep `login_attempts`** (L7 login lockout port) and **`email_log`** (delivery logging).
  - **Add `idempotency_keys`** (`key, tenant_id, user_id, method, path, request_hash, response_status, response_body, created_at`, UNIQUE on `(tenant_id, key)`) for the §9 header contract.
  - **Add `audit_trigger()` + triggers** on the money and identity tables (`payments`, `payment_allocations`, `invoices`, `invoice_lines`, `credits`, `adjustments`, `refunds`, `mpesa_transactions`, `users`, `tenant_memberships`, `refresh_tokens`, `password_reset_tokens`); `REVOKE UPDATE, DELETE ON audit_events` from the app role so the append-only guarantee is enforced by the DB, not by convention.
  - **Add `export_jobs`** if `exports` (slice6/029) lacks a run/lease model sufficient for `POST /exports` + `GET /exports/:id`.
- Every migration ships a `down.sql`; `make verify` fails if any `.sql` lacks one.

### E0.4 — Test harness
- `backend/internal/testutil/`: `NewTestServer(t)` spins a Gin router against a **per-run test database** (`CREATE DATABASE test_<uuid>` on the compose Postgres), applies all migrations via the E0.3 runner, and returns seeded fixtures — two tenants (`schoolA`, `schoolB`), one user per role from `middleware/roles.go`, plus a parent linked to a learner.
- `backend/internal/testutil/tenant.go`: helpers `AsTenant(ctx, tenantID)`, `AsRole(ctx, role)`.
- Frontend: add `vitest` + `@testing-library/react` + `jsdom` + `@playwright/test`; `npm test`, `npm run test:e2e`; `vite.config.ts` gains a `test` block.
- Playwright `webServer` boots API + Vite with a dedicated test DB.

### E0.5 — Worktree-safe infrastructure + object storage
- `infrastructure/docker/docker-compose.yml`:
  - **Fix the broken mount** — `./migrations:/docker-entrypoint-initdb.d` resolves to `infrastructure/docker/migrations`, which does not exist. Replace with the E0.3 `migrate` service running `cmd/migrate up` against the live DB (the init-dir mount is also inert on restart, since it only runs on an empty `PGDATA`).
  - **Remove fixed `container_name:`** and **parameterize ports** (`${POSTGRES_PORT:-5432}`, `${REDIS_PORT:-6379}`, `${PGBOUNCER_PORT:-6432}`, `${API_PORT:-8080}`, `${MINIO_PORT:-9000}`) so parallel worktrees do not collide.
  - **Add MinIO** (S3-compatible) — object storage is in plan §1 but absent from the stack, and `evidence_files`, report-card PDFs, and school logos all need it.
- `.kilo/setup-script.sh` (runs once per worktree creation): derive a per-worktree port set and DB name from `$WORKTREE_PATH` (short hash), write `backend/.env` + `frontend/.env`, start Postgres + Redis + MinIO only. Must finish inside the 5-minute Agent Manager setup timeout.
- `.kilo/run-script.sh`: start the API and Vite for that worktree against its own ports.
- `frontend/vite.config.ts`: proxy target becomes `process.env.VITE_DEV_API_TARGET ?? "http://localhost:8080"` so each worktree reaches its own API.

### E0.6 — Observability, idempotency, outbox publisher
- `backend/internal/observability/logger.go`: `slog` JSON logger emitting `request_id`, `tenant_id`, `user_id`, `event`, `level`, `message`; replace all 6 `log.Printf` call sites.
- `backend/internal/observability/metrics.go`: counters/gauges for webhook success rate, callback lag, sync backlog size, delivery rate per channel, grant-grade grid load time; expose `/metrics`.
- `backend/internal/middleware/idempotency.go`: requires `Idempotency-Key` on money + sync POSTs; replays the stored response for a repeat key; 400 on a reused key with a differing request hash.
- `backend/internal/middleware/tracing.go`: propagate `request_id` (already generated) + OpenTelemetry trace context.
- `backend/internal/outbox/publisher.go`: the continuous dispatcher that `internal/outbox/service.go` currently lacks — polls `GetPending`, publishes to registered `ChannelProvider`s, calls `MarkPublished`/`MarkFailed`, honours backoff.

### E0.7 — Frontend seams (defuses `App.tsx` and `translations.ts`)
- Split `frontend/src/App.tsx` into `frontend/src/routes/{authRoutes,adminRoutes,teacherRoutes,parentRoutes,saasRoutes}.tsx`, composed by `App.tsx`. Each lane owns exactly one routes file.
- Split `frontend/src/i18n/translations.ts` into `frontend/src/i18n/{en,sw}/{auth,finance,assessment,learners,teacher,parent,saas,common}.json`, merged by `i18n/index.ts`. **Each lane owns its own domain file in both locales** — this is what makes parallel frontend work conflict-free.
- Split `frontend/src/lib/api.ts` into a thin axios instance (`lib/apiClient.ts`) + per-domain modules `frontend/src/api/{finance,assessment,learners,gate,reports,comms,platform}.ts`. Lanes own their module; `apiClient.ts` is E0-owned and frozen during Phase 1.
- `frontend/src/lib/types.ts` → `frontend/src/lib/types/<domain>.ts` with a barrel, same ownership rule.

### E0.8 — Verification gate
- Root `Makefile`: `make verify` = `go vet` + `go build` + `go test ./...` + `tsc --noEmit` + `vitest run` + `playwright test` + `make coverage-check` + `make clean-checkout` (spins a throwaway compose project, migrates, curls `/health/ready`).
- `make coverage-check` asserts every registered route appears in `docs/coverage.md` and that no row is marked `TODO`.
- `.github/workflows/ci.yml` running `make verify` on push and PR.

### E0.9 — Baseline characterization tests
Before any feature work: a table-driven smoke test over the **existing 98 routes** asserting each returns a non-500 with seeded tenant data. This is the regression net every lane inherits — a lane that breaks an existing route fails its own PR.

### E0.10 — Coverage matrix
Create `docs/coverage.md`: one row per plan §4 endpoint → status (`implemented` / `waived` + reason) → route → owning lane → test file → linked V-ID. Machine-checked by E0.8.

---

## 5. Phase 1 — Eight parallel lanes (one worktree each)

**Mechanics:** Agent Manager creates `.kilo/worktrees/<lane>` on branch `lane/<lane>` from `main` after E0 lands. One agent session per lane. Merge back by **PR or merge** — never `git stash` (shared across worktrees).

### Ownership rules (non-negotiable)
1. A lane touches **only** the files in its ownership row. Any need for a file outside it → post to the board and request a base-branch change; do not edit it.
2. Migration files use the lane's **reserved number range** (below) so alphabetical order == intended order. Cross-lane schema dependencies must be declared in the lane spec and pre-created in E0.
3. A lane must not modify `server.go` (now pure assembly), `App.tsx` (now pure composition), `apiClient.ts`, `i18n/index.ts`, or the `Makefile`.
4. A lane is done when: its endpoints are registered via its module's `Register(b)`, its unit + integration tests pass, `go vet` and `tsc` are clean, and its rows in `docs/coverage.md` are filled in.

### Lane table

| Lane | Gap family | Owns (files) | Endpoints to add | Views | §11 tests |
|---|---|---|---|---|---|
| **L1 Money & M-Pesa** | Webhooks 0/7 | `backend/internal/mpesa/`, `backend/internal/webhooks/`, `backend/internal/finance/*`, `backend/internal/channels/` | `POST /webhooks/mpesa/c2b/validate`, `/confirm/{channel_token}`, `/stk/callback`, `/b2c/result`, `/b2c/timeout`; `POST /webhooks/sms/dlr`; `POST /webhooks/whatsapp`; `POST /pay/stk-push`; `GET /pay/stk-status/:id`; `POST /reconciliation/:txn/match`; `POST /reconciliation/:txn/flag-refund` | V-B01..V-B09 | #3 webhook idempotency/replay, #8 webhook load |
| **L2 Sync & Offline** | Sync 0/4 | `backend/internal/sync/`, `backend/internal/assessment/`, `frontend/src/lib/sync.ts`, `frontend/src/lib/offline.ts`, `frontend/src/pages/teacher/{GradingGridPage,SyncCentrePage,EvidenceCapturePage}.tsx`, `frontend/src/api/assessment.ts` | `POST /sync/push`, `GET /sync/pull`, `GET /sync/conflicts`, `POST /sync/conflicts`, `POST /sync/conflicts/:id/resolve`; `PUT /assessment-results/batch`; `POST /evidence` | V-T02, V-T03, V-T06, V-T07 | #5 sync conflict |
| **L3 Gate & Attendance** | Gate writes 0/5 | `backend/internal/gate/`, `backend/internal/attendance/`, `frontend/src/pages/GatePage.tsx`, `frontend/src/pages/teacher/AttendanceRegisterPage.tsx`, `frontend/src/pages/AttendancePage.tsx`, `frontend/src/api/gate.ts` | `POST /gate/devices/pair`, `WS /gate/stream`, `POST /gate/events/batch`, `GET /gate/devices`, `POST /gate/tags`, `POST /gate/override`, `GET /gate/policy`, `PUT /gate/policy` | V-T05, V-G01..V-G03, V-H19, V-H26 | — |
| **L4 School, People & Imports** | M3/M4 write depth, imports 0 | `backend/internal/learner/`, `backend/internal/staff/`, `backend/internal/calendar/`, `backend/internal/school/`, `backend/internal/importer/`, `frontend/src/pages/{LearnersPage,StaffPage,GradesStreamsPage,TeachingAllocationPage,SchoolProfilePage,IntegrationsPage}.tsx`, `frontend/src/api/learners.ts` | `PUT`/`DELETE /learners/:id`; guardian CRUD + claim codes; enrolment CRUD + `POST /enrolments/promote`; `POST /learners/:id/transfer-out`, `POST /learners/transfer-in`; `POST /learners/validate`; `GET /learners/:id/timeline`; `CRUD /imports`; `POST /staff/:id/invite`; `PUT /staff/:id/role`; class-group rollover; teaching-assignment CRUD; `POST /school/assets`; `POST /school/integrations/mpesa/register-urls/{channel_id}`; `POST /school/integrations/test-sms` | V-H02..V-H13 | — |
| **L5 Reports, Comms, Parent & Compliance** | M8/M11/M12 writes | `backend/internal/reports/`, `backend/internal/comms/`, `backend/internal/compliance/`, `frontend/src/pages/parent/**`, `frontend/src/pages/{ReportsPage,CommsComposePage,ConsentNoticesPage,DsrRequestsPage,BreachRegisterPage}.tsx`, `frontend/src/api/reports.ts` | `POST /report-runs`; `GET /report-runs/:id`; `GET /report-cards/:id/pdf`; `POST /report-runs/:id/publish`; `PUT /report-cards/:id/comments`; `CRUD /comms/templates`; `POST /broadcasts`; `POST /messages/:id/retry`; `GET`/`PUT /opt-outs`; `POST /consents/:id/revoke`; `CRUD /dsr`; `CRUD /breaches`; `GET /audit`; `GET /audit/export`; `GET`/`PUT /retention-policies` | V-H18, V-H22, V-H23, V-P01..V-P08 | #6 consent-gate |
| **L6 Platform, Analytics & Exports** | M13/M14/M15 | `backend/internal/platform/`, `backend/internal/analytics/`, `backend/internal/exports/`, `frontend/src/pages/saas/**`, `frontend/src/pages/PlatformPage.tsx`, `frontend/src/api/platform.ts` | `POST /platform/tenants`; `PATCH /platform/tenants/:id`; `POST /platform/suspend`; `POST /platform/reactivate`; `POST /platform/migrations`; `POST /platform/impersonate`; `DELETE /platform/impersonations/:id`; `CRUD /platform/plans`; `CRUD /platform/subscriptions`; `GET /platform/health/integrations`; `GET /platform/audit`; `GET /analytics/{overview,cohort-progress,learning-areas,attendance,finance}`; `POST /exports`; `GET /exports/:id`; `GET /exports/templates` | V-S01..V-S08, V-H24, V-H25 | — |
| **L7 Auth, RLS & Legacy Removal** | Auth hardening | `backend/internal/auth/`, `backend/internal/middleware/`, `backend/internal/tenant/`, `frontend/src/pages/{LoginPage,ForgotPasswordPage,ProfilePage,SchoolPickerPage}.tsx`, `frontend/src/pages/parent/{ParentActivatePage,ParentForgotPage}.tsx` | `GET`/`PATCH /me`; `POST /auth/tenant/switch`; `POST /auth/invite/accept`; security-question reset endpoints | V-A01..V-A05, V-H01 | #1 cross-tenant leak, #2 pooled-connection, #7 role-matrix |
| **L8 Frontend Platform & Design System** | Frontend-wide | `frontend/src/components/**`, `frontend/src/hooks/**`, `frontend/src/lib/types/**`, `frontend/public/{sw.js,manifest.json}`, `frontend/src/styles/**` | — (no API) | V-H05, V-H19 grid/table ergonomics | — |

**Migration number reservations** (E0 uses `0001–0099`):

```
L1 0100–0119    L2 0120–0139    L3 0140–0159    L4 0160–0179
L5 0180–0199    L6 0200–0219    L7 0220–0239    L8 0240–0249
```

**L7 responsibilities beyond endpoints** (D4): port security-question password reset and login lockout / session rotation from the Node tree into Go (reusing the `security_questions`, `user_security_answers`, `reset_challenges`, `login_attempts` tables that slice0/010 and slice0/009 already create), then delete `src/`, the root `package.json`, and `src/db/migrations.sql`.

---

## 6. Phase 2 — Three cross-cutting test lanes (parallel)

Run after Phase 1 merges, against the integrated `main`, because each is cross-domain.

| Lane | Owns | Delivers |
|---|---|---|
| **T1 Isolation & Roles** | `backend/internal/testutil/isolation_test.go`, `backend/internal/testutil/roles_test.go`, `backend/internal/router/registry_test.go` | §11 #1 cross-tenant leak test — every tenant table: insert as tenant A, query as tenant B, expect zero rows. §11 #2 pooled-connection tenant-context test — `SET LOCAL app.current_tenant_id` per transaction, no cross-tenant read via connection reuse. §11 #7 role-matrix test — enumerate the router registry, assert per-role reachability for every capability. |
| **T2 Money Properties & Webhook Load** | `backend/internal/finance/properties_test.go`, `backend/internal/webhooks/load_test.go` | §11 #4 allocation property tests — sum of allocations == payment amount, learner balance never negative, surplus becomes credit, invoices immutable. §11 #3 webhook idempotency/replay — same TransID twice returns the original result with no duplicate ledger entry. §11 #8 webhook load test — retry storm; raw payload persisted first, 200 returned quickly, downstream work from the queue. |
| **T3 Sync, Consent & Performance** | `backend/internal/sync/conflict_test.go`, `backend/internal/compliance/consent_test.go`, `frontend/e2e/**` | §11 #5 sync conflict tests — two devices edit the same result offline; both values held; never auto-overwritten; tombstones for deletes. §11 #6 consent-gate tests — every outbound path (message, photo, portal, gate biometric) checks valid consent at send/use time. Performance budgets: grading grid <2 s on 3G, gate tap-to-result <1.5 s, page weight <30 KB JSON. |

---

## 7. Phase 3 — Integration (single owner, sequential)

1. Merge the 8 Phase-1 lane branches into `main` (merge or PR; resolve conflicts inside each worktree per Agent Manager guidance — never `git stash`).
2. Merge the 3 Phase-2 test lanes; the whole §11 suite must be green in one CI run.
3. **i18n completion sweep** — now that every lane has contributed strings, sweep all pages for hardcoded user-facing text and backfill `en` + `sw`. (Depends on all lanes; cannot be parallelized earlier.)
4. **Final `make verify`** including `make clean-checkout` from a fresh clone.
5. Update `docs/coverage.md` to final state; every row `implemented` or `waived` with a reason.
6. Update `README.md` — replace the manual `psql -f` step with `make migrate`; document `make verify`.

---

## 8. Failure modes and mitigations

| Failure mode | Mitigation |
|---|---|
| Two lanes edit the same file | Ownership table in `AGENTS.md` (§5); E0 removes every shared hotspot from the lane path; agents request base-branch changes via the board rather than editing out-of-scope files |
| Lane migration number collides | Reserved ranges (§5); `make verify` fails on duplicate `NNNN` prefixes |
| Lane depends on another lane's table | All cross-lane schema objects pre-created in E0.3; lane specs state dependencies explicitly before worktrees are created |
| Worktrees collide on ports / container names | E0.5 removes fixed container names and parameterizes ports; `.kilo/setup-script.sh` derives a per-worktree port set from `$WORKTREE_PATH` |
| Test DB collisions across worktrees | E0.4 creates a uniquely-named database per test run (`test_<uuid>`), never a shared fixed name |
| Lane breaks an existing route | E0.9 characterization suite over the existing 98 routes — caught by that lane's own PR |
| Migration checksum drift / out-of-order application | E0.3 runner applies in sorted order and refuses to apply a changed file under an existing version |
| `git stash` used during merge (shared across worktrees) | Prohibited by AGENTS.md; merge conflicts resolved inside the worktree |
| Scope creep back to full §4 parity | D1 fixed; `docs/coverage.md` is the enforcement surface — an unimplemented endpoint must be an explicit written waiver, not silence |
| Feature lands without a test | Definition of done §2 requires every endpoint row in `docs/coverage.md` to name a test file |

---

## 9. Explicitly out of scope

- Grades 10–12, boarding, library, HR/payroll, LMS, expenditure ledger, real-time KEMIS/NEMIS API, WhatsApp as a primary channel (plan §13).
- Live Safaricom Daraja / Africa's Talking sandbox calls in the test suite (D3 — adapters are contract-faithful; a fake driver drives all tests; live mode activates only when credentials are present).
- Full §4 endpoint parity beyond the 8 families and the write-depth named in §5 (D1).
- Frontend design tokens beyond what L8 needs for the shared components (a full visual redesign is a separate initiative).

---

## 10. First three actions for the implementing agent

1. Read `AGENTS.md` §5 ownership rules before touching any file.
2. Run `make verify` on a clean checkout to get the true baseline (it will fail at `clean-checkout` and `coverage-check` — that is expected and is the starting score).
3. Execute E0.1 → E0.10 **in order on `main`**, one commit per E-item, before creating any worktree.
