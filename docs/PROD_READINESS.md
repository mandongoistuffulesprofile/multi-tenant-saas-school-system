# Production readiness — verified 2026-11-11

This is the evidence-backed status, not a feature wish list.

## Verified now

| Check | Result |
| --- | --- |
| `go build ./...`, `go vet ./...` | Pass |
| `go test ./... -count=1` with `TEST_DATABASE_URL` (migrated database) | Pass: RLS, finance/mpesa/outbox isolation + concurrency, reports |
| Frontend `npx tsc --noEmit` | Pass |
| Frontend `npm run build` | Pass (lockfile committed; `npm ci` reproducible) |
| SPA auth | HttpOnly cookies (`withCredentials`), CSRF double-submit header on unsafe methods, single-flight refresh; no token persisted to localStorage |
| Offline-first auth | Non-sensitive identity/roles cached (never tokens) so an offline reload still renders the app and can flush the sync queue; explicit 401/403 clears it |
| Credential lifecycle | No passwords in seeds or docs; `cmd/devuser`/`cmd/setpassword` generate 24-char unambiguous passwords (argon2id, unique per-user salt) and print them once; passwords persist and are reusable for normal logins (no rotation per sign-in). Login lockout + tenant membership resolution tested under FORCE RLS; email reset token is hashed, one-shot, policy-checked, and revokes sessions/refresh tokens. UI covers email link (`/auth/reset?token=…`), security questions, and platform-issued support codes (`/forgot-password`); SMS is not used for password recovery. |
| Password recovery | Free self-service via three security questions (argon2id-hashed answers) plus a SaaS-admin last-resort queue with one-time codes. Flow, controls and runbook below. |
| Docker images | `skulapp-api:latest` and `skulapp-web:latest` build from the committed Dockerfiles |
| Compose stack (`infrastructure/docker/docker-compose.prod.yml`) on a fresh PostgreSQL 18 volume | Previously verified with 24 migrations, 127 tables, 107 policies. Migrations 0026–0027 (password recovery) also apply cleanly with `cmd/migrate`; a full fresh-volume re-run is pending. |
| `GET /health` / `GET /health/ready` inside the stack | `{"status":"healthy"}` / `{"status":"ready"}` |
| Web container | Serves the built SPA (`index.html`) |
| FORCE RLS | `relrowsecurity=true` and `relforcerowsecurity=true` on `schools`, `learners`, `payments`, `invoices` on the fresh database (`migrations/0009_force_rls.sql`) |
| `TestTenantRLS` | Pass: no-context reads return 0 rows; cross-tenant update affects 0 rows |
| M-Pesa inbox / outbox workers | Started by the API (`mpesa.StartWorker`, `outbox.StartWorker`) |
| CI (`.github/workflows/ci.yml`) | Postgres 18 + Redis services; build, vet, migrations (twice), full test suite; frontend `npm ci`, build, blocking type check |

### Deployment fixes verified in this pass

- Postgres 18 requires the data volume at `/var/lib/postgresql` (not `.../data`); the prod compose file now uses the correct path.
- The baseline dump references `extensions.uuid_generate_v4()`. `cmd/migrate` now bootstraps `CREATE SCHEMA IF NOT EXISTS extensions` and `uuid-ossp` before applying migrations, so a brand-new database migrates unattended.
- FORCE RLS hid `tenant_memberships` during login, so every sign-in failed on an RLS-enforced database. Migration `0025_tenant_membership_self_access.sql` adds a self-select policy; login now reads memberships in a transaction scoped by `app.current_user_id`, and `TestTenantRLS` covers it.
- The ETag middleware buffered every response but flushed only GET bodies, so login and reset calls returned `200` with `Content-Length: 0`; the SPA could not read `token_pair` or reset confirmations. Only GET responses are buffered now, and `middleware/cache_test.go` covers write bodies, ETags, and 304s.

### Password recovery (free, no SMS)

- **User path:** `POST /api/v1/auth/password/reset/questions` returns the account's three configured questions. `POST /api/v1/auth/password/reset/answers` verifies all three answers and sets a policy-checked password. Answers are normalised (trim, lowercase, collapse whitespace) and stored as argon2id hashes; the API never returns them. A successful reset revokes sessions and refresh tokens.
- **Setup:** Profile → *Account recovery* (or the dismissible banner in the app shell). Requires the current password and exactly three distinct questions from `security_questions`; re-saving replaces the set.
- **Last resort (SaaS admin):** a user who cannot answer their questions presses *Ask a platform administrator* (`POST /auth/password/reset/assistance`), which opens a row in `password_assistance_requests`. `/platform/operations` polls `GET /platform/password-assistance` every 30 seconds, shows a pending badge/banner, and issues a one-time code (`POST /platform/password-assistance/:id/code`). Codes are `XXXXX-XXXXX`, stored argon2id-hashed, expire after 30 minutes, are single-use, and invalidate any older outstanding code for the account. Admins can also issue directly by email/phone (`POST /platform/password-reset-codes`).
- **Resolution runbook:**
  1. Open **Operations Centre → Password assistance**; use the pending banner/KPI as the notification.
  2. Verify the request against the school's registered contact (call the school office/number). Never read a code to an unverified address or into a voicemail.
  3. Click **Issue code**, copy the code, and read it to the verified user.
  4. The user opens `/forgot-password` → **Support code**, enters their email/phone, the code, and a new password. The code works once and expires in 30 minutes.
  5. The queue row becomes `RESOLVED` with method `CODE_ISSUED`. Any successful password change also resolves open requests via `trg_users_password_assistance` and the reset handler.
- **Abuse controls:** unknown accounts and accounts without questions return the identical `404 RECOVERY_NOT_SETUP`; five wrong answers/codes per account per 15 minutes return `429 RECOVERY_LOCKED`; every step has per-IP and per-identifier Redis limits. Codes are never logged; answer/code hashes are never returned.
- **Verified locally (2026-11-11):** set questions (IDs 2/5/8) → wrong answers `401` → correct answers `200` → new password login `200`, old password `401`; assistance request → queue pending `1` → admin code → redeem (case-insensitive) `200` → login `200` → queue `RESOLVED`, code reuse `401`. `go build ./...`, `go vet ./...`, `go test ./...`, `npx tsc --noEmit` and `npm run build` pass.

## Before the first paying tenant

1. Point `DOMAIN` at the VPS and run `scripts/deploy.sh`; verify TLS, login, M-Pesa callback, a learner update and a backup/restore drill (Caddy TLS was not exercised locally because it needs a real domain).
2. Configure real Daraja credentials and `MPESA_ALLOWED_IPS` (or `MPESA_WEBHOOK_TOKEN`) in `.env.prod`; without them STK requests are recorded `PENDING` and never pushed.
3. Add monitoring/alerts: Sentry (Go + React), an uptime check on `/health/ready`, and log aggregation.
4. Encrypt off-host backups (`age`/`gpg` pipe before the S3/R2 upload) and schedule them with a dead-man's-switch ping.
5. Add frontend tests (Vitest smoke + one E2E login/route) — there are currently no frontend test files.

## Deferred until after the pilot

PgBouncer, k6 load tests, HTTP ETag/caching, staging environment, PWA/offline sync (`sw.js`/`/sync/*`), report-card PDF generation, year-end rollover, CSV import dry-run UI, feature flags, and the legacy `devops/` stack and product-name cleanup.
