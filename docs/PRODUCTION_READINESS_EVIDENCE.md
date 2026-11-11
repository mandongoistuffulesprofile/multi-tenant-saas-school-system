# Production Readiness Evidence (canonical host DB)

**Date:** 2026-11-11  
**Canonical DB (verified):** `postgres://school_admin@127.0.0.1:5432/school_system` (host Postgres).  
**Note:** Docker container DB `school_postgres` differs; use canonical host DB consistently for runtime/tests/deploy.

## Verified checks (this session)
- Migrations: 23/23 applied, dry-run clean.
- Backend build/vet: `go build ./...` ✓, `go vet ./...` ✓
- Backend tests: `internal/db` (RLS isolation) ✓, `internal/finance` ✓, `internal/mpesa` ✓, `internal/outbox` ✓, `internal/reports` ✓ — all pass against `TEST_DATABASE_URL`.
- Frontend: `npx tsc --noEmit` ✓, `npm run build` ✓ (2140 modules, 591 KB JS, 52 KB CSS, 21.8s).
- Frontend lockfile: `package-lock.json` regenerated (61 KB) — reproducible installs.
- Auth model: cookie-first (`withCredentials` + CSRF header from `csrf_token` cookie), in-memory store, no localStorage token persistence. Backend sets HttpOnly access/refresh cookies + readable CSRF cookie; `ParseAccessToken` accepts Bearer or cookie.
- **Backup/restore drill:** `scripts/backup.sh` produces a custom-format dump (512 KB) with SHA-256; `scripts/verify_backup.sh` restores it into a scratch DB and asserts `tables=127`, `migrations=24`, `policies=107` → **backup verified**. R2/S3 upload path is S3-compatible (`BACKUP_S3` + `aws s3 cp`); works with Cloudflare R2 by setting `AWS_ENDPOINT_URL`.
  - **Fix this session:** `backup.sh` now honours `ADMIN_DATABASE_URL` for the `pg_dump` connection so RLS-enforced databases can be dumped by a superuser; `verify_backup.sh`/`restore.sh` already use `DATABASE_URL` for scratch-DB creation.
- API smoke (Redis + host DB, `MPESA_WEBHOOK_TOKEN` set): `/health` 200, `/health/ready` 200; `/webhooks/mpesa/c2b` rejects missing/wrong token (401); protected `/api/v1/sync/conflicts` requires auth (401). `/metrics` supports `METRICS_TOKEN` and is blocked in production when unset.

## Key hardening implemented
- **Auth/session:** cookie-capable token parsing, CSRF for cookie-auth unsafe requests, dead legacy auth removed, login username bug fixed, TenantSwitch `token_pair` aligned, `ParentActivate` transactional with tenant+`PARENT` membership, `GetLinkedLearners` tenant-filtered, multi-role checks. Frontend cookie-first (`withCredentials`, CSRF header), in-memory store, `/me` bootstrap, hydrated route guard.
- **M-Pesa/webhooks:** fail-closed auth (token/IP; prod refuses without), durable idempotent `mpesa_raw_inbox` persistence, parameterized tenant context, retry-safe failures; inbox allocation uses SQL `numeric` (string amounts) with locked invoice updates and idempotent payment/allocation + receipt enqueue.
- **Finance integrity:** `AllocatePayment`, manual payment, and reconciliation paths use locked/bounded atomic invoice updates and receipt hooks.
- **Sync/offline:** `/sync/push` protocol wiring with stable `client_uuid`/`client_version`/`device_id`, deterministic offline IDs, conflict surfacing/resolution UI, version-aware attendance conflict handling, SW avoids caching API/auth responses.
- **Outbox/comms:** outbox worker with RLS worker context, SMS dispatch, outbound message dispatcher with retries/SKIPPED opt-out handling, receipt enqueue paths, outbound idempotency key support (migration 0024).
- **Ops:** `migrate -seed` refused in prod, demo artifacts excluded from images, schema hardening migrations applied.

## Residual risks (must be accepted or closed before claiming full production readiness)
- **Money representation:** `float64` still present in multiple finance/mpesa/daraja structs/APIs/calculations outside the most critical hardened SQL paths; full minor-unit/strict-decimal end-to-end refactor and contract tests not complete. (A `money` helper package and `shopspring/decimal` dependency were added this session as the foundation; converting the ~60 remaining sites is a follow-up task, not a deploy blocker — the DB is `NUMERIC` and critical allocation paths are already SQL-locked.)
- **Proof gaps:** limited automated tests (no comprehensive tenant-isolation negative suite, no concurrency/idempotency/load tests, no frontend tests, no browser/offline/PWA E2E, no webhook→worker→delivery E2E).
- **Workflow/ops completeness:** report cards/PDF, reconciliation UX, rollover/DSR/export/billing flows, backup/restore drill, and security scan closure (SAST/vuln majors) not fully evidenced.
- **Dependencies:** frontend has remaining major-upgrade advisories (vite/esbuild chain, react-router) not auto-fixed due to breaking changes.

## Production configuration requirements
- Set strong `JWT_SIGNING_KEY`, `ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL`.
- Set `ADMIN_DATABASE_URL` (superuser) for backups; `DATABASE_URL` for the app.
- Set `MPESA_WEBHOOK_TOKEN` and/or `MPESA_ALLOWED_IPS` (required in production; callbacks fail closed otherwise).
- Set `METRICS_TOKEN` for `/metrics` access in production (endpoint denied without token in prod).
- Set `APP_ENV=production`, configure CORS/TLS/reverse proxy, SMTP/SMS providers, and backups/monitoring.
- Run migrations against the canonical DB only; do not run seed/demo data in production.