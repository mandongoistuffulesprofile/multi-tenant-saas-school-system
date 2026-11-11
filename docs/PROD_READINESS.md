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
| Docker images | `skulapp-api:latest` and `skulapp-web:latest` build from the committed Dockerfiles |
| Compose stack (`infrastructure/docker/docker-compose.prod.yml`) on a fresh PostgreSQL 18 volume | 24 migrations applied, 127 tables, 107 policies |
| `GET /health` / `GET /health/ready` inside the stack | `{"status":"healthy"}` / `{"status":"ready"}` |
| Web container | Serves the built SPA (`index.html`) |
| FORCE RLS | `relrowsecurity=true` and `relforcerowsecurity=true` on `schools`, `learners`, `payments`, `invoices` on the fresh database (`migrations/0009_force_rls.sql`) |
| `TestTenantRLS` | Pass: no-context reads return 0 rows; cross-tenant update affects 0 rows |
| M-Pesa inbox / outbox workers | Started by the API (`mpesa.StartWorker`, `outbox.StartWorker`) |
| CI (`.github/workflows/ci.yml`) | Postgres 18 + Redis services; build, vet, migrations (twice), full test suite; frontend `npm ci`, build, blocking type check |

### Deployment fixes verified in this pass

- Postgres 18 requires the data volume at `/var/lib/postgresql` (not `.../data`); the prod compose file now uses the correct path.
- The baseline dump references `extensions.uuid_generate_v4()`. `cmd/migrate` now bootstraps `CREATE SCHEMA IF NOT EXISTS extensions` and `uuid-ossp` before applying migrations, so a brand-new database migrates unattended.

## Before the first paying tenant

1. Point `DOMAIN` at the VPS and run `scripts/deploy.sh`; verify TLS, login, M-Pesa callback, a learner update and a backup/restore drill (Caddy TLS was not exercised locally because it needs a real domain).
2. Configure real Daraja credentials and `MPESA_ALLOWED_IPS` (or `MPESA_WEBHOOK_TOKEN`) in `.env.prod`; without them STK requests are recorded `PENDING` and never pushed.
3. Add monitoring/alerts: Sentry (Go + React), an uptime check on `/health/ready`, and log aggregation.
4. Encrypt off-host backups (`age`/`gpg` pipe before the S3/R2 upload) and schedule them with a dead-man's-switch ping.
5. Add frontend tests (Vitest smoke + one E2E login/route) — there are currently no frontend test files.

## Deferred until after the pilot

PgBouncer, k6 load tests, HTTP ETag/caching, staging environment, PWA/offline sync (`sw.js`/`/sync/*`), report-card PDF generation, year-end rollover, CSV import dry-run UI, feature flags, and the legacy `devops/` stack and product-name cleanup.
