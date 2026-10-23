# Shule Yetu — Kenyan Primary School Management SaaS

Multi-tenant school management system: **Go + Gin + PostgreSQL 18 + Redis** API and a **React + TypeScript + Vite** frontend.

## Repository layout

| Path | Purpose |
| --- | --- |
| `backend/` | Go API. Entrypoint `cmd/api`; domain packages in `internal/<domain>/`; migration runner in `cmd/migrate`. |
| `frontend/` | React/Vite SPA. Entry `index.html` → `src/main.tsx` → `src/App.tsx`; pages in `src/pages/`. |
| `migrations/` | Canonical schema: `0001_baseline.sql` plus incremental hardening. Legacy slices live under `migrations/archive/`. |
| `infrastructure/docker/` | Dev Compose, production Compose, Caddyfile and environment templates. |
| `scripts/` | Backup, restore, verification, role provisioning and deployment helpers. |
| `docs/` | Fix plan, operations runbook and architecture notes. |
| `src/` + root `package.json` | Legacy standalone Node auth prototype. Not part of the running system. |

## Quick start (Docker)

```bash
cd infrastructure/docker
docker compose up -d --build
```

- API: <http://localhost:8080> (`/health`, `/health/ready`, `/metrics`)
- PostgreSQL: `localhost:5432` (`school_admin` / `dev_secret_password` / `school_system`)
- Redis: `localhost:6379`

PostgreSQL is pinned to **18** because the baseline uses named `NOT NULL` constraints. A one-shot `migrate` service applies `migrations/*.sql` through `cmd/migrate` (checksummed, advisory-locked, recorded in `schema_migrations`) before the API starts.

## Local development

### Backend

```bash
cd backend
cp .env.example .env       # DATABASE_URL, REDIS_URL, JWT_SIGNING_KEY, ENCRYPTION_KEY
go build ./...
go run ./cmd/migrate -dir ../migrations -seed
go run ./cmd/api
```

Demo seed (only when `-seed` is passed): `admin@demo.test` / `DemoPass123!`, tenant `demo-school`, learner `DEMO-001`.

Run the checks before committing:

```bash
cd backend
go build ./... && go vet ./... && go test ./...
```

The tenant-isolation test runs only when `TEST_DATABASE_URL` points at a disposable migrated database:

```bash
TEST_DATABASE_URL="$DATABASE_URL" go test ./internal/db -run TestTenantRLS -v
```

### Frontend

```bash
cd frontend
cp .env.example .env       # VITE_API_BASE=/api/v1
npm install
npm run dev                # http://localhost:5173, proxies /api to :8080
npm run build
```

## Production (single VPS)

```bash
cd infrastructure/docker
cp .env.prod.example .env.prod          # fill every secret
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Only Caddy publishes ports 80/443. PostgreSQL, Redis and the API stay on the private Docker network. Caddy terminates TLS, serves the SPA and proxies `/api`, `/webhooks` and `/health` to the API; `/metrics` is blocked publicly. Use `scripts/deploy.sh` for a health-gated rollout with rollback to the previous image tag.

Secrets (`POSTGRES_PASSWORD`, `JWT_SIGNING_KEY`, `ENCRYPTION_KEY`, `MPESA_WEBHOOK_TOKEN`, `METRICS_TOKEN`) must come from the environment or a secret manager. Never commit `.env.prod`.

## Architecture notes

- **Tenancy:** `schools(tenant_id)` is the tenant root; `users` is global; authorization lives in `tenant_memberships`. Domain rows carry `tenant_id VARCHAR(50)`.
- **RLS:** policies are installed on tenant tables, but `FORCE ROW LEVEL SECURITY` is **opt-in** (`migrations/optional/0005_force_rls.sql`). The default app role owns tables in development, so handlers still rely on explicit `WHERE tenant_id = $n` filters. Critical write paths (M-Pesa inbox/worker, outbox drainer, finance) use `db.WithTenant` / `db.BeginTenantTx`, which set `app.current_tenant_id` with `set_config(..., true)`.
- **Auth:** Argon2id passwords, HS256 JWTs with issuer/audience validation, refresh-token rotation persisted in `refresh_tokens`. Login also sets HttpOnly `access_token`/`refresh_token` cookies and a readable `csrf_token`; cookie-authenticated mutations require `X-CSRF-Token` (double submit). The SPA still uses bearer tokens, so cookie-only mode is a follow-up.
- **Money:** invoice → payment → allocation model. M-Pesa C2B callbacks write to a durable inbox and a worker allocates idempotently on `(tenant_id, trans_id)`.
- **Async:** correlation outbox with `FOR UPDATE SKIP LOCKED`, attempt tracking and retry backoff; M-Pesa has its own worker.
- **Observability:** structured JSON request logs, request IDs, `/metrics` counters, DB + Redis readiness, graceful SIGTERM shutdown.
- **CBC:** assessment events + result history rather than overwriting rows.
- **Offline:** PWA service worker and queued sync (`/sync/push`, `/sync/pull`).
- **i18n:** English and Kiswahili.

## Database baseline

`migrations/0001_baseline.sql` is the single source of truth for the schema. It was dumped from the working PostgreSQL 18 database and reviewed. Incremental migrations add RLS hardening, the M-Pesa inbox, runtime tables, user profile names, outbox retry scheduling, audit request IDs and payment-channel uniqueness. The earlier `slice0`–`slice8` files are archived because they described contradictory generations of the schema (UUID `tenants`/`users.id` versus `VARCHAR` `schools`/`users.user_id`). Do not apply the archive to a new database.

## Operations

- Backups: `scripts/backup.sh` (`pg_dump -Fc` + SHA-256, optional `BACKUP_S3`).
- Restore: `scripts/restore.sh` (destructive, requires `CONFIRM_RESTORE=yes`).
- Restore drill: `scripts/verify_backup.sh` restores into a scratch database and checks table/RLS counts.
- Runbook: `docs/RUNBOOK.md`.
- Rollout: `scripts/deploy.sh`.
