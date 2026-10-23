# Fix Plan — SkulApp / EduKe

**Status:** Proposed · **Window:** 30 working days · **Basis:** repo audit of 2026-10-22
**Assumption:** 1–2 engineers, zero production tenants, 1 demo tenant. Effort is in person-days (pd).

> **Before starting:** the working tree is dirty (modified `backend/cmd/api/main.go`, `frontend/index.html`, deleted `.jsx` views, untracked `.tsx` components). Commit or stash it first. Do not let a schema rebuild run over uncommitted work.

---

## 0. Decisions that need sign-off

These are architectural forks. The plan below assumes the recommended option.

| # | Decision | Recommended | Why |
|---|---|---|---|
| D1 | Which DB layer survives? | Keep `internal/db` (sqlx + lib/pq); retire `internal/database` (pgxpool) | 18 files use `internal/db`, 2 use `internal/database` |
| D2 | Which backend survives? | Keep `cmd/api` (Gin); retire `cmd/server` + `pkg/*` | The Dockerfile already builds `cmd/api`; the M-Pesa callback is the only unique asset in `cmd/server` |
| D3 | Child entity name | `learners` | Finance, reports, sync, attendance all use it; only `internal/mpesa/daraja.go` uses `students` |
| D4 | Schema strategy | **Rebuild a single baseline**, archive old migrations | 66 FKs point at a `schools` table that does not exist; `users(user_id)` does not exist; tenant_id is `VARCHAR` in 68 places and `UUID` in 23. Patching is more expensive than rebuilding with zero prod data |
| D5 | Auth model | `JWTManager` + Argon2id + `tenant_memberships`; users are global | Multi-school switching already exists; the legacy `users.tenant_id` model cannot support it |
| D6 | Token storage | HttpOnly `Secure` `SameSite=Lax` cookies + CSRF double-submit | Tokens in `localStorage` are stealable via XSS; this app serves parents and minors |
| D7 | Root Node service (`src/`, root `package.json`) | Archive after confirming no imports | Duplicates Go auth; three auth implementations is the root cause of the drift |
| D8 | Hosting shape | One VPS, Docker Compose, Caddy | Kubernetes/Helm buys nothing before 50+ schools |

If you disagree with D1–D8, stop and resolve it now. Half-migrating any of these is worse than either endpoint.

---

## 1. Critical path

```
A (builds + CI) ──► C (canonical schema) ──► B (tenant isolation) ──► E (money path)
                         │                          │
                         ├──► D (backups)           ├──► F (observability)
                         └──► H (async/cron)        └──► G (frontend security)
                                                          └──► I (staging/deploy) ──► J (performance/load)
```

A and C start on day 1 in parallel. E cannot be verified until C and B are done. D and F are independent and should not wait.

---

## 2. Workstream A — Build, dependencies, CI (4 pd)

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| A1 | Add missing Go modules and repair `go.sum`; pin versions compatible with Go 1.21 | `backend/go.mod`, `backend/go.sum`: `gin-gonic/gin`, `jmoiron/sqlx`, `lib/pq`, `spf13/viper`, `redis/go-redis/v9`, `go-playground/validator/v10` | `cd backend && go build ./... && go vet ./...` exits 0 |
| A2 | Implement the missing Gin middleware: request ID, auth, role, tenant-from-JWT | new `backend/internal/middleware/gin_auth.go`, `request_id.go`; delete the net/http variants once `cmd/server` is retired | No undefined symbols in `cmd/api/server.go`; route table compiles |
| A3 | Consolidate auth to one implementation | delete `internal/auth/auth.go` (legacy `GenerateJWT`/bcrypt) and `internal/auth/handler.go` (net/http login); keep `service.go`, `refresh.go`, `otp.go`, `crypto.go`, `jwt.go`; fix constructor signatures | One login path, Argon2id only, refresh rotation preserved |
| A4 | Add missing frontend dependencies | `frontend/package.json`: `axios`, `i18next`, `react-i18next`, `react-router-dom`, `zustand`, `tailwindcss`, `postcss`, `autoprefixer`; regenerate `package-lock.json` | `cd frontend && npm ci && npm run build` exits 0 |
| A5 | CI pipeline | `.github/workflows/ci.yml`: Postgres 15 + Redis 7 services; Go module + npm cache; `go vet`, `go build`, `go test ./...`, `npm ci && npm run build`; fresh-DB migration job after C6 | PRs blocked on red; branch protection enabled |
| A6 | Repo hygiene | remove the blanket `*.sh` rule from `.gitignore` (it would hide `scripts/backup.sh`); move generator scripts (`implement_*.sh`, `fix_*.sh`, etc.) to `scripts/archive/` | A new shell script can be committed |
| A7 | Retire the second backend | delete `backend/cmd/server/` and `backend/pkg/` **after** E1 ports the callback | Only one `main` package remains |
| A8 | Port the two `internal/database` (pgxpool) callers (`attendance`, `mpesa`) to `internal/db`; move `RunMigrations` into `cmd/migrate` (C6) and delete the package | `internal/attendance/attendance.go`, `internal/mpesa/daraja.go`, `internal/database/` | One DB abstraction; `go build` still green |

**Do not** add `tsc --noEmit` to the blocking CI yet — expect a backlog of type errors. Add it as a non-blocking report, then promote it after G.

---

## 3. Workstream B — Auth and tenant isolation (7 pd)

This is the only workstream that can end the company. Treat the acceptance test as a release gate.

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| B1 | Tenant comes from the verified JWT claim only. Ignore/validate `X-Tenant-ID`; delete the hardcoded `11111111-…` fallback | `internal/middleware/gin_auth.go`, `internal/middleware/tenant.go`, delete `pkg/middleware/rls.go` | A request with no token cannot reach a tenant handler; a header that disagrees with the claim gets 403 |
| B2 | Transaction-scoped RLS context. Add `db.WithTenant(ctx, tenantID, userID, fn)` using `SET LOCAL`; remove `SetSessionContext`/`ResetSessionContext` | `internal/db/database.go` | No `SET` without `LOCAL`; no tenant value survives a pooled checkout |
| B3 | Move critical writes into tenant transactions: finance, M-Pesa, assessment, attendance, sync, learner create/update | handlers in `internal/{finance,mpesa,assessment,attendance,sync,learner}` | Writes commit/rollback atomically; explicit `tenant_id = $n` filters remain as belt-and-braces |
| B4 | Uniform RLS in the baseline: `ENABLE` + `FORCE`, policy `tenant_id = current_tenant_id()`, index on `tenant_id` | `migrations/0001_baseline.sql` (C5) | Every tenant table has both flags and a policy; a query without context returns 0 rows |
| B5 | Least-privilege DB roles: app connects as `skulapp_app` (non-owner); `skulapp_migrator` owns DDL | `020_db_hardening.sql` (archived), deploy env | App role cannot bypass RLS; no plaintext role passwords in migrations |
| B6 | Regression tests: cross-tenant read/write denied; two sequential requests on the same pooled connection cannot see each other's tenant | `backend/internal/.../*_test.go`, `tests/integration/tenant_test.go` | Both tests fail on the current code and pass after B1–B3 |
| B7 | Authorization coverage audit: every route has `RequireAuth`; every write has an explicit role; parent/teacher cannot reach finance/admin endpoints | `cmd/api/server.go` route table + a table-driven test | Route count == guarded route count; no accidental public handler |
| B8 | Token hardening: reject non-HS256, validate `iss`/`aud`, 60s clock skew; keep 15-min access TTL and DB-backed refresh rotation | `internal/auth/jwt.go` | Forged `alg=none` and wrong-audience tokens rejected |
| B9 | Rate-limit expensive routes per tenant + user: assessment/sync batches, exports, SMS, invoice runs, reconciliation. Keep the stricter IP limiter on `/auth/*` | new `internal/middleware/ratelimit.go`, `cmd/api/server.go` | 429 above threshold; one noisy tenant cannot exhaust another's capacity |

**Out of scope here:** signing-key rotation (`kid`), field-level encryption, pen test. See §15.

---

## 4. Workstream C — Canonical schema and migrations (6 pd)

The migration set cannot create a database. Evidence: no `CREATE TABLE schools` anywhere but 66 `REFERENCES schools`; `users` has `id` but 20+ FKs use `users(user_id)`; `learners.tenant_id` is `VARCHAR(50)` while `tenants.id` is `UUID`; `020` indexes `audit_events`, which no migration creates, and alters `schools`, which does not exist.

With zero production data, rebuilding is the pragmatic call. Do not archaeology-fix twelve contradictory slices.

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| C1 | Freeze schema changes; commit the dirty tree; tag `pre-baseline` | git | Clean tree, recoverable tag |
| C2 | Write `docs/DATA_MODEL.md`: entities, keys, types, ownership | new doc | Reviewed before SQL is written |
| C3 | Build `scripts/schema_audit.sh` to extract every table/column referenced in Go SQL strings and diff against the model | new script | Zero unresolved tables/columns |
| C4 | Write `migrations/0001_baseline.sql`: extensions, tenants, users (global), memberships, refresh tokens, academic structure, learners + guardians, curriculum, assessment events/results/history, attendance/gate, finance, M-Pesa inbox/STK/reconciliation, receipt sequences, capitation, reports, comms, compliance, platform/billing, outbox, audit_events, sync | new file | `createdb && psql -f` succeeds on a clean Postgres 15 |
| C5 | Uniform conventions: `tenant_id UUID NOT NULL REFERENCES tenants(id)`; `timestamptz`; `numeric(14,2)` for KES; domain PKs (`learner_id`, `payment_id`); `ENABLE/FORCE RLS` + policy + index on every tenant table; partial indexes for queues | same file | Lint query finds no tenant table missing RLS or an index |
| C6 | `cmd/migrate`: checksum table, `pg_advisory_lock`, `--dry-run`, never runs at app boot | new `backend/cmd/migrate/main.go` | Two concurrent runs serialize; tampered file fails |
| C7 | Archive old slices under `migrations/archive/`; update `README.md`, `DBA_DESIGN.md`, `migrations/README.md` | docs | No doc references a deleted table (`schools`, `students`) |
| C8 | Deterministic seed: one demo tenant, users per role, ~200 learners, fee structures, one term | `migrations/seed/`, `cmd/seed` | Re-running seed is idempotent |
| C9 | CI fresh-DB job: create → migrate → seed → integration tests | `.github/workflows/ci.yml` | Green on a clean runner |

**Naming decisions baked into the baseline:** users are global; authorization lives in `tenant_memberships` (login joins memberships by subdomain); the child entity is `learners`; the audit table is `audit_events` (the code currently writes `audit_log` — update `internal/audit`); `outbox` and `mpesa_raw_inbox` are real tables.

**Data migration:** none. If a demo dataset matters, export it after C4 and re-import through the seed, not through SQL archaeology.

---

## 5. Workstream D — Backups and disaster recovery (2 pd)

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| D1 | Encrypted nightly backup: `pg_dump -Fc` → `age`/gpg → S3-compatible/offsite; retention 7 daily / 4 weekly / 12 monthly | new `scripts/backup.sh` (needs A6 first) | Backup exists off-host, encrypted |
| D2 | Schedule + monitoring | systemd timer or cron; heartbeat ping on success | Missing heartbeat for 26h pages you |
| D3 | Restore drill + DR doc: RTO 4h, RPO 24h (state them explicitly) | `docs/DR.md`, `scripts/restore.sh` | Restore into scratch DB, row counts and smoke query match; date recorded |
| D4 | Backup of object storage (report cards, exports) when those ship | `docs/DR.md` | Documented, not necessarily automated |

**Rule:** no feature work ships before D3 has passed once. A backup that has never been restored is not a backup.

---

## 6. Workstream E — M-Pesa and the money path (5 pd)

Current state: the callback exists only in the retired second binary; it writes `students`, `fee_allocations`, and `payments(student_id, payment_method)` — none of which match the canonical schema. It returns HTTP 200 even when the DB write fails, so Safaricom never retries and the payment is lost.

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| E1 | One public callback in `cmd/api`: `POST /api/v1/webhooks/mpesa/c2b` and `/stk`; excluded from JWT; IP allowlist + unguessable path/shared token | `cmd/api/server.go`, new `internal/mpesa/handler.go` | Route exists in the deployed binary; unauthenticated non-Safaricom traffic rejected |
| E2 | Inbox-first: validate, resolve tenant, `INSERT INTO mpesa_raw_inbox … ON CONFLICT (tenant_id, trans_id) DO NOTHING`, return 200 in <100 ms. No allocation inline | `internal/mpesa/handler.go` | Duplicate callback → one inbox row, 200 |
| E3 | Resolve tenant by paybill/shortcode, not by BillRef alone; add `UNIQUE(shortcode_or_account)` | baseline + `school_payment_channels` | Two schools with the same admission number cannot collide |
| E4 | Worker: `FOR UPDATE SKIP LOCKED`, allocate in one tx, idempotent on `(tenant_id, trans_id)`, attempts/backoff, `FAILED`/`MANUAL_REVIEW` | new `internal/mpesa/worker.go` | 100 concurrent duplicate callbacks → exactly one payment, one receipt, one SMS |
| E5 | Port `daraja.go` to canonical `learners` / `payments` / `payment_allocations`; delete `fee_allocations` usage | `internal/mpesa/daraja.go` | `schema_audit.sh` reports no unknown tables |
| E6 | Reconciliation: unallocated pool, manual match, flag-refund path | existing finance handlers | Unallocated payment visible; manual match is audited |
| E7 | Failure semantics tests: DB down → non-2xx (Safaricom retries); partial allocation → rollback, inbox stays `PENDING` | `tests/integration/mpesa_test.go` | No path returns 200 after a failed persist |
| E8 | Secrets: consumer key/secret/passphrase only from env/secret store; remove credentials from `.env.daraja.template` | env templates, deploy docs | `git grep` finds no live credential |
| E9 | STK status: bounded polling job, not request-time waiting; timeouts on every Daraja HTTP call | `internal/mpesa`, `internal/finance` | p95 STK request <500 ms |

**Safaricom sandbox:** re-register the callback URL with the new path. Keep the old route alive (returning 410) until sandbox verification passes.

---

## 7. Workstream F — Observability and operations (4 pd)

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| F1 | Replace `gin.Default()` with explicit middleware: recovery, structured `log/slog` JSON (request id, tenant, user, route, status, latency), redaction of `Authorization`, refresh tokens, OTPs, full phone numbers | `cmd/api/server.go`, new `internal/middleware/logging.go` | One JSON line per request; secrets never appear |
| F2 | Error tracking (Sentry/GlitchTip) with PII scrubbing | `cmd/api/main.go`, env `SENTRY_DSN` | A forced panic produces an event with request id |
| F3 | Metrics: Prometheus `/metrics` — request count/latency histogram, DB pool in-use, outbox backlog, M-Pesa pending, failed SMS. If time-boxed, start with log-derived latency | `internal/metrics` | Dashboards show p50/p95/p99 per route |
| F4 | Four alerts: 5xx >2% for 5 min; `/health/ready` failing 2 min; backup heartbeat missing; M-Pesa pending >15 min or outbox backlog >1000 | alert config | Each alert fires in staging when deliberately triggered |
| F5 | SLOs: 99.5% availability, p95 <500 ms reads, 100% callback persistence; document measurement | `docs/SLO.md` | Written and agreed |
| F6 | Runbook: DB down, Redis down, callback failing, restore, rollback, rotate keys | `docs/RUNBOOK.md` | A second engineer can execute it |
| F7 | Fix readiness: check DB **and** Redis and migration version; keep `/health` liveness dependency-free | `cmd/api/server.go` | Killing Redis flips readiness, not liveness |

**Alert routing:** Sentry + Uptime Kuma + a Telegram/Slack webhook is enough. Do not stand up Alertmanager and a full Prometheus stack before the second instance.

---

## 8. Workstream G — Frontend security and offline correctness (5 pd)

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| G1 | Service worker: cache only hashed static assets (`/assets/*`, icons, manifest); **network-only for `/api/*`**; navigation fallback to the shell; versioned cache; purge on logout | `frontend/public/sw.js` | Two users on one device cannot see each other's data; no stale fee balance after mutation |
| G2 | HttpOnly cookie auth: login/refresh set `access_token` (15 min) and `refresh_token` (30 d, path-scoped); CSRF double-submit (`csrf_token` cookie + `X-CSRF-Token`); bearer remains behind a flag for future mobile | `internal/auth`, `frontend/src/lib/api.ts`, `store` | `document.cookie` cannot read tokens; missing CSRF header → 403 |
| G3 | Security headers: CSP (`default-src 'self'`), `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options`, referrer policy | Caddy or middleware | CSP report-only first, then enforce with no console violations |
| G4 | CORS: allowlist from `ALLOWED_ORIGINS`, `credentials: true`; remove `*` | `internal/middleware/cors.go` | Unknown origin rejected |
| G5 | Offline UX: queue indicator, conflict screen, clear IndexedDB/PII on logout, duplicate-replay handling | `frontend/src/components/PWAOfflineSyncBanner.tsx`, sync pages | Airplane-mode test passes; replay does not duplicate data |
| G6 | Pagination + error boundaries on list pages; enforce max page size server-side (100) | frontend pages, list handlers | No list endpoint can return unbounded rows |

**Sequencing note:** G2 and G4 land together; cookies without an allowlist are worse than bearer tokens.

**If G2 slips:** keep tokens in memory only (not `localStorage`) and put refresh in an HttpOnly cookie. Do not leave both tokens in `localStorage` for a parent-facing app.

---

## 9. Workstream H — Async, messaging, cron (4 pd)

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| H1 | Outbox drainer: `FOR UPDATE SKIP LOCKED`, `attempts`, `next_attempt_at`, status, consumer registry; two consumers: `payment.received` (receipt + SMS), `assessment.recorded` (CQRS projection already uses a trigger — keep one path) | `internal/outbox`, `cmd/api` worker goroutine | Events move PENDING → PROCESSED exactly once |
| H2 | Cron framework: `job_runs(job_name, run_key)` unique + `pg_try_advisory_lock`; make invoice runs, arrears reminders, report generation, reconciliation, retention re-runnable | new `internal/jobs` | Running the same job twice for the same period is a no-op |
| H3 | Retry/dead-letter: `FAILED` + `last_error` view, alert on backlog; no Kafka-style DLQ | `internal/outbox`, `internal/comms` | Poison message stops after N attempts and alerts |
| H4 | SMS worker: per-tenant rate limit, opt-out check, cost guard, retry/backoff | `internal/comms`, `internal/notification` | Opted-out guardian never receives a message |
| H5 | Defer SSE/WebSockets until a customer needs live status; document the trigger (>5 s polling or a paid requirement) | `docs/DECISIONS.md` | Explicitly deferred, not forgotten |

**Topic choice:** DB-backed queues until >100 msg/s or a second deployable service. That is not close.

---

## 10. Workstream I — Staging, deploy, flags (6 pd)

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| I1 | Production compose: Postgres, PgBouncer, Redis, API, Caddy; healthchecks; no default passwords; `env_file` | `infrastructure/docker/docker-compose.prod.yml` | `docker compose up` on a clean host serves `/health/ready` |
| I2 | One multi-stage Dockerfile building `cmd/api`; non-root user | `backend/Dockerfile` | Image <100 MB, no shell/toolchain |
| I3 | Deploy script: pull → run `cmd/migrate` → start → health gate → switch Caddy upstream; rollback to previous tag. Single instance: drain + restart is acceptable; do not build blue-green machinery | `scripts/deploy.sh`, `Makefile` | Failed health gate auto-rolls back |
| I4 | Secrets: `EnvironmentFile` 0600 or secret manager; rotate JWT/encryption keys; document rotation | `docs/RUNBOOK.md` | No secret in git; rotation rehearsed |
| I5 | Feature flags: `feature_flags(tenant_id, key, enabled)` + helper; gate risky features (SMS, new report cards) | baseline + `internal/platform` | Flag off = old behavior without deploy |
| I6 | Infra documentation instead of IaC for now: host setup, firewall, TLS renewal, backup, restore | `docs/INFRA.md` | Rebuildable by hand from the doc |
| I7 | Pool math: `max_open × instances + reserve < 200`; PgBouncer transaction mode; document the number | `docs/INFRA.md` | No connection-exhaustion at 2 instances |
| I8 | HTTP server hardening: `ReadHeaderTimeout` 5s, `ReadTimeout` 30s, `WriteTimeout` 60s, `IdleTimeout` 120s, `MaxHeaderBytes` 1MB, request-body cap 2MB (1MB webhooks) | `cmd/api/server.go` | Slowloris test fails; oversized body → 413 |
| I9 | TLS + encryption at rest: Caddy automatic TLS + HSTS; managed Postgres encryption or LUKS volume; encrypted backups | Caddyfile, `docs/INFRA.md` | TLS A grade; DB volume and backups encrypted |

**Deferred:** Terraform/OpenTofu (second env), Kubernetes/Helm, service discovery, autoscaling, canary. Add them when the trigger in §15 is hit.

---

## 11. Workstream J — Performance and network (4 pd)

| ID | Task | Files / commands | Acceptance |
|---|---|---|---|
| J1 | Route timing middleware + `log_min_duration_statement=500ms`; publish p50/p95/p99 | `internal/middleware`, Postgres config | Baseline numbers recorded before tuning |
| J2 | Pagination audit: max limit 100, cursor or offset consistency, no unbounded export inline | list handlers | Every list endpoint has a bounded default |
| J3 | Server-authoritative time for money/assessment: ignore `client_ts` for ordering, store as metadata; consistent UTC | `internal/sync`, finance | Skewed device clock cannot reorder payments |
| J4 | k6 load test: login, learner list, 50-item assessment batch, 100 concurrent duplicate callbacks | `tests/load/*.js` | p95 reads <500 ms, error <1%, exactly one payment per TransID |
| J5 | Reference-data cache: in-process TTL 5 min for curriculum/fee categories; invalidate on write | `internal/curriculum`, `internal/finance` | DB read CPU drops measurably |
| J6 | Read replica trigger documented, not implemented: reporting CPU >60% sustained or export blocks interactive p95 | `docs/DECISIONS.md` | Trigger written down |

---

## 12. Schedule mapped to the 30-day window

| Window | Track 1 | Track 2 | Exit gate |
|---|---|---|---|
| **Days 1–3** | A1–A6, A8 (green builds, CI skeleton) | C1–C4 start (model + baseline) | **G0:** `go build`, `npm run build`, CI skeleton |
| **Days 4–10** | C5–C9 (schema, migrator, seed, CI DB job) | B1–B4 (tenant context, RLS, critical writes) | **G1:** clean migrate + seed; cross-tenant tests pass |
| **Days 4–7** | D1–D4 (backups + restore drill) | F1–F2 (logs + error tracking) | **G2:** restore drill recorded |
| **Days 8–14** | E1–E9 (callback, inbox, worker, tests) | F3–F7, G1 | **G3:** duplicate-callback test passes; no lost payments |
| **Days 11–18** | G2–G6 (cookies, CSP, CORS, offline) | H1–H3 (outbox + cron) | **G4:** XSS cannot read tokens; cron is idempotent |
| **Days 15–24** | I1–I9 (staging, deploy, flags, hardening) | B5–B9 finish, H4 | **G5:** deploy + rollback drill <10 min |
| **Days 15–18** | A7 (delete second backend) | docs | **G3 prerequisite satisfied** |
| **Days 20–30** | J1–J6 (perf, load) | A5 hardening, docs | **G6:** load targets met; second backend deleted |

Buffer is intentionally thin. If C slips (most likely), cut J5/J6 before cutting D or B.

---

## 13. Release gates (definition of done)

1. **G0 Build:** `go build ./...`, `go vet ./...`, `npm ci && npm run build` all green in CI.
2. **G1 Isolation:** fresh DB migrates and seeds; tenant A cannot read or write tenant B, including on a reused pooled connection.
3. **G2 Data safety:** encrypted offsite backup restored successfully; date in `docs/DR.md`.
4. **G3 Money:** duplicate webhook → one payment; DB failure → non-2xx; tenant resolved by shortcode; no write to `students`/`fee_allocations`.
5. **G4 Security:** tokens unreadable from JS; CSRF enforced; CORS allowlisted; CSP enforced; SW never caches `/api/*`.
6. **G5 Ops:** staging deploy, health gate, rollback; alerts fire; runbook executable.
7. **G6 Scale:** k6 targets met; p95/p99 published; pool math documented.

---

## 14. Traceability — every audit finding has an owner

| Finding | Task |
|---|---|
| Backend does not compile (missing deps, undefined middleware) | A1, A2 |
| Frontend does not build (axios/tailwind/i18n/router/zustand missing) | A4 |
| Two backends, two DB layers, three auth implementations | A3, A7, D1, D2, D7 |
| No tenant context is ever set | B1, B2, B3 |
| Hardcoded demo tenant fallback | B1 |
| Session-level `SET` leaks across pooled connections | B2, B6 |
| `learners` vs `students` split | D3, C4, E5 |
| Migrations reference nonexistent `schools` / `users(user_id)`; VARCHAR vs UUID | C3–C5 |
| `020` indexes missing `audit_events`; `outbox` never created | C4, C6 |
| Migration runner has no lock/checksum and runs at boot | C6 |
| `SetSessionContext`/RLS not wired to routes | B1–B4 |
| PgBouncer configured but not deployed; pool math unverified | I1, I7 |
| Service worker caches API responses | G1 |
| Tokens in `localStorage` | G2 |
| CORS `*` | G4 |
| Rate limiting only on `/auth/*` | B9 |
| No server/proxy timeouts | I8 + I1 (Caddy) |
| No backups / untested restore | D1–D3 |
| Outbox written but never drained | H1 |
| Cron can double-run | H2 |
| M-Pesa callback absent from deployed binary | E1, A7 |
| Callback returns 200 on failure | E7 |
| M-Pesa writes wrong tables | E5 |
| STK waits inline | E9 |
| No CI, zero tests | A5, B6, E7, J4 |
| No logs/metrics/tracing/alerts | F1–F4 |
| No TLS hardening or encryption-at-rest proof | I9 |
| Secrets/default passwords in compose | I1, I4, E8 |
| No pagination guarantees | J2, G6 |
| No slow-query visibility / unverified N+1 | J1 |
| Receipt-sequence and invoice-run races | B3, H2 |
| No feature-flag mechanism | I5 |
| `client_ts` can reorder money | J3 |
| No offline/skew tests | G5, J4 |
| Audit writes `audit_log`, platform reads `audit_events` | C4, F1 |

---

## 15. Explicitly deferred (and the trigger to revisit)

| Item | Revisit when |
|---|---|
| Read replicas | reporting CPU >60% sustained, or exports block p95 |
| Table partitioning (`audit_events`, `assessment_results`) | 10–50M rows, roughly 100+ active schools |
| Redis caching layer | DB read CPU >60% after in-process cache |
| WebSockets/SSE | a customer needs live payment/attendance status |
| Real broker (Kafka/RabbitMQ) | >1 deployable service or >100 msg/s |
| Kubernetes/Helm, service mesh | >2 instances or >50 schools with SLA |
| Blue-green/canary | >1 instance and a paying uptime SLA |
| Terraform/OpenTofu | second environment or cloud resources beyond one host |
| JWT key rotation (`kid`) | first external security review |
| Field-level encryption for phone/ID | paid pilot |
| WAF, pen test | before the first paying school |
| Read/write splitting, sharding, multi-region | not before 500 schools |
| Error budgets, on-call rotation, chaos | first contractual SLA / >10 schools |
| CDN / edge cache / HTTP/3 tuning | first school outside the host region, or TTFB >1s (Caddy already gives HTTP/2) |
| Load balancing, autoscaling, service discovery | second API instance / >50 schools |
| API gateway, gRPC, service mesh | external partners or >3 services; a proxy + `/v1` is enough now |
| Pub/Sub, CDC/Debezium, event sourcing | broker trigger above; not before |
| Long polling | never; prefer SSE if live updates are needed |
| Distributed tracing (OpenTelemetry) | outbox/worker traffic (H1) or second instance |
| Semantic versioning + public API changelog | first mobile app or partner integration |
| Serverless, cold starts, serverless limits | not applicable — long-running containers |
| GC tuning, thread-safety work, CAP-theorem design | not applicable to stateless Go handlers at this scale |

---

## 16. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Baseline rebuild drops a feature | High | Generate schema from handler SQL (C3); endpoint smoke tests; tag `pre-baseline`; no prod data |
| Tenant-tx refactor stalls on 198 handlers | High | Phase by critical writes (B3); keep explicit `tenant_id` filters as defense; tests gate the rest |
| Cookie migration breaks the PWA | Medium | Dual-mode bearer behind a flag; test offline with cookies; ship CSP report-only first |
| Safaricom sandbox rejects new callback | Medium | Keep old route as 410; re-register before cutover; verify with real sandbox payloads |
| Deleting `cmd/server` loses M-Pesa behavior | High | Port E1–E5 first; delete only after G3 |
| Schema rebuild reveals more code drift | High | C3 static audit before SQL; expect 1–2 extra days |
| Dirty working tree overwritten | High | Commit/stash before C1 |
| Secrets leaked during migration | Medium | Rotate JWT/encryption keys at I4; grep history for credentials |

---

## 17. First 48 hours

1. Commit or stash the current tree; tag `pre-baseline`.
2. Run `go mod tidy` + add the six Go modules; add the eight frontend packages; get both builds green locally.
3. Write `docs/DATA_MODEL.md` and run the first `schema_audit.sh` pass — this tells you how deep C really is.
4. Stand up the backup script and take one encrypted dump **before** touching the schema.
5. Open the CI skeleton with build-only jobs; add the DB job when C6 lands.


---

## 18. Execution log — 2026-10-23

Branch: `stabilization`. The pre-plan working tree was committed first. This is what was actually completed, what is partial, and what remains blocked.

### Completed and verified

| Area | Result | Evidence |
| --- | --- | --- |
| A1/A3/A7/A8 | Backend builds, vets and tests; one auth implementation; `internal/database`, `cmd/server` and `pkg/*` retired | `go build ./...`, `go vet ./...`, `go test ./...` offline |
| A5/A6 | CI (backend, fresh-DB migration twice, frontend, typecheck); blanket `*.sh` ignore removed | `.github/workflows/ci.yml`, `.gitignore` |
| C1–C7 | Single baseline from the working database; checksummed/advisory-locked `cmd/migrate`; legacy slices archived; docs updated | `0001_baseline.sql`, `backend/cmd/migrate`, `migrations/README.md` |
| C8 | Idempotent demo seed | `migrations/seed/0001_demo.sql`; login and `/school` smoke test passed |
| B1/B2 | Tenant claim is authoritative; `X-Tenant-ID` mismatch returns 403; `WithTenant`/`BeginTenantTx`/`BeginReadTx` fixed to use `set_config(..., true)`; header-only tenant resolution remains for public routes | `internal/middleware/tenant.go`, `internal/db/database.go` |
| B6 | Cross-tenant read/update test passes with RLS forced on the test tables | `backend/internal/db/rls_test.go` |
| B8 | HS256 enforced, issuer/audience validated, 60 s leeway | `internal/auth/jwt.go` |
| B9 | Redis per-tenant/IP limiter (600/min) plus stricter auth limiter | `cmd/api/server.go` |
| E1–E5 | Public C2B callback, shared token, inbox-first, worker, canonical learners/payments/allocations, shortcode uniqueness | callback 200; inbox `PROCESSED`; payment `COMPLETED`; allocation applied; invoice `PARTIALLY_PAID`, outstanding `500.00` |
| D1–D3 | Backup, restore and restore-verification scripts; verified 104 tables / 86 policies | `scripts/backup.sh`, `scripts/restore.sh`, `scripts/verify_backup.sh` |
| F1/F3/F7 | JSON request logs, request IDs, metrics, DB+Redis readiness, server timeouts, SIGTERM shutdown | `/health`, `/health/ready`, `/metrics` smoke tests |
| G2/G3 (server side) | HttpOnly access/refresh cookies, CSRF double-submit for cookie-authenticated writes, refresh rotation persisted, CORS allowlist, security headers | cookie-only `/school` 200; cookie logout without CSRF 403; refresh rotation 200 |
| H1 | Outbox drainer with `FOR UPDATE SKIP LOCKED`, attempt/backoff/last_error, worker wired | test event `PENDING → PUBLISHED` |
| I1–I2/I8 | Non-root multi-binary image; prod Compose with Postgres 18, Redis, migrate, API, SPA, Caddy; only Caddy published; HTTP timeouts/body cap | `backend/Dockerfile`, `frontend/Dockerfile`, `infrastructure/docker/docker-compose.prod.yml`, `Caddyfile` |
| Audit | Audit reads/writes unified on tenant-scoped `audit_events` instead of the global `audit_log` | `internal/audit`, `0007_audit_request_id.sql` |

### Partial / deliberately deferred

- **B3/B4 (full RLS enforcement).** Policies are enabled and strict, but `FORCE` is opt-in because the app role owns tables and most handlers still query the pool directly with explicit tenant filters. `WithTenant` is used for M-Pesa, outbox and other critical transactions. Applying `migrations/optional/0005_force_rls.sql` before the handler refactor would make unfiltered reads return zero rows and break backups. This is documented in `README.md`, `migrations/README.md` and `docs/RUNBOOK.md`.
- **B5 (least-privilege roles).** `scripts/provision_roles.sh` prepares `skulapp_app`/`reader`/`writer`/`migrator`, but the stack still connects as the owner until B3 is complete.
- **B7 (route coverage audit).** Guarded groups were reviewed manually; no table-driven route test was added.
- **D1 encryption/offsite.** The backup script supports `BACKUP_S3` but does not encrypt with `age`/gpg and no timer/heartbeat was installed.
- **E6–E9.** Reconciliation/manual match, STK polling, failure-semantics integration tests and secret-store wiring are still open.
- **F2/F4/F5/F6.** No Sentry SDK, alert config or live dashboard; runbook and SLOs are written but untested. Metrics are counters only (no latency histogram).
- **G1/G4–G6.** Frontend service-worker audit, cookie/CSRF migration of the SPA, offline UX, pagination and error boundaries remain. Server-side CORS allowlist and headers are in place.
- **H2–H4.** No cron framework (`job_runs`), SMS worker or opt-out enforcement.
- **I3/I4/I5/I7/I9.** Deploy script and pool math documented; no automated image rollback test, secret manager, feature-flag helper, PgBouncer or encrypted volume.
- **J1–J6.** No k6 load tests, cursor pagination audit, reference-data cache or read-replica trigger test.

### Blocked by environment

- **Frontend install/build (A4/G).** npm registries are unreachable/failing from this host (`registry.npmjs.org`, `registry.npmmirror.com`, `registry.yarnpkg.com`). A slow mirror attempt resolved only `axios` and `i18next` before stalling. `frontend/node_modules` is incomplete and `npm run build` / `tsc --noEmit` could not be run. The CI job is written and will exercise this on a networked runner.
- **Docker build/run.** The Docker daemon was not available for an end-to-end Compose run; images and compose files were reviewed and compile-time verified only via `go build`.
- **Full `go mod tidy`.** The real `mimetype` and `go-urn` modules were fetched and the local `third_party` fallbacks were removed. A full offline tidy still fails only on test-only modules of dependencies (`go-cmp`, `testify`, `kr/text`, etc.); build/vet/test pass with the current `go.sum`, and CI with network can run tidy.

### Recommended next actions

1. Restore npm connectivity, run `npm install && npm run build && npx tsc --noEmit`, then move the SPA to cookie auth (`withCredentials`, CSRF header, no localStorage tokens).
2. Finish the request-scoped tenant transaction refactor, then apply `migrations/optional/0005_force_rls.sql` and switch to the non-owner app role.
3. Add M-Pesa failure-semantics and auth/route coverage tests; run the k6 duplicate-callback scenario.
4. Stand up the staging VPS, run `scripts/deploy.sh`, and execute a restore drill with the backup heartbeat.
5. Run a networked `go mod tidy` to prune test-only sums; the real `mimetype`/`go-urn` modules are already in use.
