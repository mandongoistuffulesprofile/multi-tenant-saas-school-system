# Plan: Apply Backend Guidance Launch Blockers (Sprint 1)

Scope: implement the Sprint-1 / launch-blocker items from `BACKEND_GUIDANCE.md` against the current repo, prioritizing the money path and tenant isolation. Defer Sprint 2/3 and all "SKIP/LATER" items.

## Goals
- Payment webhook becomes inbox-first, tenant resolved by `BusinessShortCode → school_payment_channels`, never by `admission_number` or `X-Tenant-ID`.
- No payment acknowledged unless the inbox row committed; every outcome logged.
- Idempotent allocation with per-student advisory lock and overpayment credit.
- Worker drains `PENDING`; unmatched → `MANUAL_REVIEW`; reconciliation cron.
- Tenant identity from signed JWT only; no default JWT secret; API as `skulapp_app`.
- One canonical Go entrypoint that builds; single migration path.
- Caddy edge with TLS, closed DB/Redis ports.
- CI: compile, race, migrate-from-empty, RLS isolation test.
- Structured logs + health/readiness + 5 alerts + backup runbook.

## Affected boundaries
- `backend/internal/daraja/mpesa.go` — rewrite `ProcessCallback` to parse + inbox insert only.
- New `backend/internal/mpesa/handler.go` or worker in `internal/mpesa/` — allocation worker.
- `backend/internal/middleware/tenant.go`, `auth.go`, `cors.go` — JWT-only tenant, alg pin, CORS allowlist.
- `backend/cmd/api/` — single entrypoint; remove committed binary.
- `migrations/` — consolidate duplicate numbers; single runner.
- `docker-compose.yml` / `devops/` — close ports, Caddy.
- `.github/workflows/` — CI.
- `backend/internal/finance/` — NUMERIC/integer cents (already cents; verify no float64 in money math).

## Data flow
1. Daraja POST → handler reads body (cap 64KB), resolves tenant via `school_payment_channels` by `BusinessShortCode`, inserts `mpesa_raw_inbox (tenant_id, trans_id)` `ON CONFLICT (tenant_id, trans_id) DO NOTHING`, logs outcome, returns 200 only on commit.
2. Worker polls `PENDING` `FOR UPDATE SKIP LOCKED`, takes `pg_advisory_xact_lock(hashtext(tenant||student))`, allocates to oldest unpaid invoices, overpayment → credit row, unmatched → `MANUAL_REVIEW`.
3. Reconciliation cron retries stuck rows every 5 min; nightly `pg_dump` offsite.

## Failure modes
- Duplicate callback → single inbox row, no double allocation.
- Unmatched BillRef → `MANUAL_REVIEW`, visible on FeesDesk.
- Concurrent callbacks for one student → advisory lock serializes.
- DB down → readiness fails, Safaricom retries (inbox-first means no data loss).

## Migration / rollout
- Expand/contract: keep old `mpesa_transactions` reads during transition; new code writes inbox only.
- Rotate secrets out of git; update `.env.example`.
- Run migrations via `skulapp_migrator` in deploy step, not API startup.

## Validation
- `go vet ./...`, `go test -race ./...`, `go build ./...`
- Migration from empty DB succeeds.
- RLS isolation test: tenant A cannot read B.
- Load test: 20 parallel callbacks for one student → no over-allocation, unique receipts.
- Restore drill from nightly backup.

## Open questions (need user decision)
1. Canonical entrypoint: `cmd/api/main.go` vs `server.go`? (F7)
2. Is legacy `pkg/middleware/rls.go` reachable in production? (F6)
3. Confirm Daraja callback retry/IP semantics (UNVERIFIED).
4. Spring Boot notification service: keep or replace with Go worker? (recommend Go)
5. SMS provider pricing/caps (UNVERIFIED).

## Impact rating (why each is needed/crucial)

Rating scale: BLOCKER = money/data loss risk if skipped; HIGH = launch risk; MED = quality.

1. Webhook rewrite (inbox-first, shortcode tenant) — BLOCKER. Fixes F1/F2/F3: wrong-school credit, swallowed errors, lost payments. Without it, a single duplicate admission no. across schools misroutes money and no audit trail exists.
2. Idempotency keys end-to-end — BLOCKER. Fixes double-credit/double-SMS on Safaricom retries; duplicate callbacks are expected, not exceptional.
3. Allocation locking + credits + NUMERIC money — BLOCKER. Fixes F4/F5: concurrent callbacks over-allocate; float rounding on money. Overpayment currently dropped silently.
4. Inbox worker + MANUAL_REVIEW + reconciliation cron — BLOCKER. Unmatched bill refs (typos) are normal in Kenya; without a visible queue money is received but invisible to bursar.
5. Timeouts + retries/backoff — HIGH. Prevents hung goroutines/pool exhaustion when Safaricom/AT slow; hard stop avoids silent drops.
6. Indexing for callback path — HIGH. F1's `UPPER(admission_number)` without tenant filter defeats the existing index; slow callbacks on large tenants.
7. CI (compile, race, migrate-from-empty, RLS isolation) — BLOCKER. Catches F7 (two main), tenant leaks before deploy; no pipeline exists today.
8. Structured logs + health/readiness + alerts + runbook — HIGH. Today callback failures leave no trace; "parent says paid" unresolvable.
9. Rate limiting + CORS allowlist + pool sizing + dep cleanup — HIGH. Brute-force auth; whole-school lockout risk; build reproducibility (F9, F12 drift).
10. Auth JWT-only tenant, no default secret, alg pin, kid — BLOCKER. F6/F8/F9: cross-tenant read via demo fallback; forged tokens via missing alg check.
11. Caddy edge, close ports, secrets rotation — BLOCKER. F8: DB port published, committed creds; plaintext tokens on rural links.
12. Nightly encrypted offsite backup + restore drill — BLOCKER. F13: single VPS holds all schools' money/grades; no backup script exists.

## Confidence note
High confidence on items with clear code anchors (1-4, 10-12) where repo patterns already exist (inbox table, FORCE RLS, pgx). Medium confidence on item 9 (dep cleanup) due to mixed JSX/TSX drift and unknown canonical entrypoint (F7) — must resolve before edits. Item 7 (CI) requires a decision on test DB setup. Recommend resolving the 5 open questions before implementation.

## Task order
1. Webhook rewrite (inbox-first, shortcode tenant)
2. Idempotency keys end-to-end
3. Allocation locking + credits + NUMERIC money
4. Inbox worker, MANUAL_REVIEW screen, reconciliation cron
5. Timeouts + retries/backoff on workers
6. Indexing for callback path
7. CI (compile, race, migrate-from-empty, RLS isolation), rollback tags
8. Structured logs, health/readiness, metrics + 5 alerts, runbook
9. Rate limiting (/auth, sync), CORS allowlist, pgxpool sizing, dependency cleanup
10. Auth: JWT-only tenant, no default secret, alg pin, kid rotation
11. Caddy edge, close ports, secrets rotation
12. Nightly encrypted offsite backup + tested restore runbook
