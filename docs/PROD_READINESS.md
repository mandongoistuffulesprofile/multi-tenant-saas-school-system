# Production readiness — verified 2026-11-11

This is the evidence-backed status, not a feature wish list.

## Verified now

| Check | Result |
| --- | --- |
| `go build ./...`, `go vet ./...` | Pass |
| `go test ./... -count=1` with `TEST_DATABASE_URL` (migrated database) | Pass: RLS, finance/mpesa/outbox isolation + concurrency, reports |
| Frontend `npx tsc --noEmit` | Pass |
| Frontend `npm run build` | Pass (lockfile committed; `npm ci` reproducible) |
| Frontend `npm test` (Vitest) | Pass: 8 tests covering cached-session restore/expiry and the session bootstrap (expired access cookie, offline, explicit refresh rejection); run in CI after the build and type check |
| `GET /reports/cards/:card_id/pdf` | Pass: server-side PDF from the stored card, role-gated and audited (see *Report card PDFs*) |
| SPA auth | HttpOnly cookies (`withCredentials`), CSRF double-submit header on unsafe methods, single-flight refresh; no token persisted to localStorage |
| Offline-first auth | Non-sensitive identity/roles cached (never tokens) so an offline reload still renders the app and can flush the sync queue; explicit 401/403 clears it |
| Credential lifecycle | No passwords in seeds or docs; `cmd/devuser`/`cmd/setpassword` generate 24-char unambiguous passwords (argon2id, unique per-user salt) and print them once; passwords persist and are reusable for normal logins (no rotation per sign-in). Login lockout + tenant membership resolution tested under FORCE RLS; email reset token is hashed, one-shot, policy-checked, and revokes sessions/refresh tokens. UI covers email link (`/auth/reset?token=…`), security questions, and platform-issued support codes (`/forgot-password`); SMS is not used for password recovery. |
| Password recovery | Free self-service via three security questions (argon2id-hashed answers) plus a SaaS-admin last-resort queue with one-time codes. Flow, controls and runbook below. |
| Docker images | `skulapp-api:latest` and `skulapp-web:latest` build from the committed Dockerfiles |
| Compose stack (`infrastructure/docker/docker-compose.prod.yml`) on a fresh PostgreSQL 18 volume | Previously verified with 24 migrations, 127 tables, 107 policies. Migrations 0026–0027 (password recovery) also apply cleanly with `cmd/migrate`; a full fresh-volume re-run is pending. |
| `GET /health` / `GET /health/ready` inside the stack | `{"status":"healthy"}` / `{"status":"ready"}` |
| Web container | Serves the built SPA (`index.html`) |
| FORCE RLS | `relrowsecurity=true` and `relforcerowsecurity=true` on every tenant table, including the five enrolled by `0030_rls_remaining_tables.sql`; `0028`/`0030` add platform-admin bypass policies |
| `TestTenantRLS` | Pass: no-context reads return 0 rows; cross-tenant update affects 0 rows |
| M-Pesa inbox / outbox workers | Started by the API (`mpesa.StartWorker`, `outbox.StartWorker`) |
| CI (`.github/workflows/ci.yml`) | Postgres 18 + Redis services; build, vet, migrations (twice), full test suite; frontend `npm ci`, build, blocking type check and `npm test` |
| Monitoring (optional profile) | `uptime-kuma` in `infrastructure/docker/docker-compose.prod.yml`; runbook in `docs/MONITORING.md` |

### Deployment fixes verified in this pass

- Postgres 18 requires the data volume at `/var/lib/postgresql` (not `.../data`); the prod compose file now uses the correct path.
- The baseline dump references `extensions.uuid_generate_v4()`. `cmd/migrate` now bootstraps `CREATE SCHEMA IF NOT EXISTS extensions` and `uuid-ossp` before applying migrations, so a brand-new database migrates unattended.
- FORCE RLS hid `tenant_memberships` during login, so every sign-in failed on an RLS-enforced database. Migration `0025_tenant_membership_self_access.sql` adds a self-select policy; login now reads memberships in a transaction scoped by `app.current_user_id`, and `TestTenantRLS` covers it.
- The ETag middleware buffered every response but flushed only GET bodies, so login and reset calls returned `200` with `Content-Length: 0`; the SPA could not read `token_pair` or reset confirmations. Only GET responses are buffered now, and `middleware/cache_test.go` covers write bodies, ETags, and 304s.

### Password recovery (free, no SMS)

- **User path:** `POST /api/v1/auth/password/reset/questions` returns the account's three configured questions. `POST /api/v1/auth/password/reset/answers` verifies all three answers and sets a policy-checked password. Answers are normalised (trim, lowercase, collapse whitespace) and stored as argon2id hashes; the API never returns them. A successful reset revokes sessions and refresh tokens.
- **Setup:** Profile → *Account recovery* (or the dismissible banner in the app shell). Requires the current password and exactly three distinct questions from `security_questions`; re-saving replaces the set.
- **Last resort (SaaS admin):** a user who cannot answer their questions presses *Ask a platform administrator* (`POST /auth/password/reset/assistance`), which opens a row in `password_assistance_requests`. `/platform/operations` polls `GET /platform/password-assistance` every 30 seconds, shows a pending badge/banner, and issues a one-time code (`POST /platform/password-assistance/:id/code`). Codes are `XXXXX-XXXXX`, stored argon2id-hashed, expire after 30 minutes, are single-use, invalidate any older outstanding code for the account, and are invalidated by any password change. Admins can also issue directly by email/phone (`POST /platform/password-reset-codes`).
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
3. Start the self-hosted monitoring profile (`docs/MONITORING.md`): Uptime Kuma watches `https://$DOMAIN/health/ready` and the SPA, with email/push alerts; optionally add Sentry (Go + React) and log aggregation.
4. Encrypt off-host backups (`age`/`gpg` pipe before the S3/R2 upload) and schedule them with a dead-man's-switch ping.
5. Extend the frontend test suite beyond the auth/session unit tests (one E2E login + route check once an E2E runner is chosen).

## Deferred until after the pilot

PgBouncer, k6 load tests, HTTP ETag/caching, staging environment, PWA/offline sync (`sw.js`/`/sync/*`), feature flags, and product-name cleanup.

## Report card PDFs

`GET /api/v1/reports/cards/:card_id/pdf` returns the stored report card as a
real PDF (`application/pdf`, inline filename `report-card-<card_number>.pdf`,
`Cache-Control: private, no-store`). It is generated server-side by
`internal/reports` from the `report_cards` row with a standard-library writer,
so the distroless API image needs no fonts, browser or PDF toolchain.

- **Who can call it:** `SCHOOL_ADMIN`/academic staff, parents and guardians
  (the same role gate as `GET /reports/cards/:card_id`). A parent or guardian
  may download only cards for learners linked to their account; any other
  card, unknown `card_id`, or another tenant's card returns `404` without
  disclosing whether it exists. Parent/guardian downloads are audited as
  `REPORT_CARD_PDF_DOWNLOAD`; card views remain `REPORT_CARD_VIEW`.
- **What it returns:** a one-page A4 document with school name, learner name,
admission number, grade, term and year, overall grade, total/max score,
percentage, class position, class-teacher and head-teacher remarks, the
status, and a generation timestamp plus signature/stamp lines. It is rendered
from the stored card, including cards that are still `DRAFT` (the school sees
what it will publish).
- **Difference from the print page:** `/reports/cards/:card_id/print` is the
  SPA's browser review surface. It has no authoritative content of its own;
  the "Download PDF" action calls this endpoint. A screenshot or browser print
  of that page is not the issued document and may omit server-side fields.

## Year-end rollover and learner import

- `POST /api/v1/academic/rollover` previews (`dry_run: true`, the default) or
  applies promotion of active enrolments from one academic year to the next.
  The plan maps the Kenyan ladder (PP1 → PP2 → Grade 1 … → Grade 9), reports
  per-grade learner and stream counts, and treats Grade 9 as graduation:
  those enrolments are marked `COMPLETED`, not deleted. Apply creates missing
  class groups in the target year and moves each learner's active enrolment.
- `POST /api/v1/imports/learners` takes `{csv, dry_run}` and classifies every
  row as `IMPORTABLE`, `DUPLICATE` (admission number already exists or repeats
  in the file) or `INVALID` (missing names/admission number or unknown grade).
  Duplicates and invalid rows are reported with reasons and never inserted;
  applying inserts only importable rows and enrols them when a matching class
  group exists. The SPA screen is `/imports/learners` (school administrators),
  linked from the learners directory.
- Both routes require `SCHOOL_ADMIN` (or another `RoleSchoolAdministrators`
  member) and a tenant-scoped transaction, so RLS applies to every read and
  write.
