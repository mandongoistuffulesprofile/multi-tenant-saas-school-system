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

## Quick start (local, one command)

```bash
./launch_all.sh
```

- Uses the local PostgreSQL/Redis if they are already running; otherwise starts
  them with `infrastructure/docker/docker-compose.yml`.
- Applies migrations and the idempotent demo seed, then creates
  `admin@demo.test` (`SCHOOL_ADMIN`, school code `demo-school`) and
  `platform@demo.test` (`SAAS_ADMIN`, school code `platform-ops`) if they do
  not exist. Generated passwords are printed once.
- Serves the SPA at <http://127.0.0.1:5173> and the API at
  <http://127.0.0.1:8080>.
- Rerun with `RESET_DEMO_PASSWORD=1 ./launch_all.sh` to rotate and reprint the
  demo passwords; use `SEED=0 ./launch_all.sh` to skip the demo tenant.
- `python3 dev.py` is a compatibility alias for the same launcher.

The launcher exports its own local `DATABASE_URL`, so a stale `backend/.env`
cannot silently point the API at a remote database. It never kills whatever is
already listening on 5432/6379.

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
cp .env.example .env       # local PostgreSQL/Redis defaults
set -a; . ./.env; set +a   # export the variables; Go does not read .env itself
go build ./...
go run ./cmd/migrate -dir ../migrations -seed
go run ./cmd/api
```

Or let `./launch_all.sh` do all of the above (including migrations and demo
accounts). The script is the recommended path because it also verifies the
database connection and waits for `/health`.

Demo seed (only when `-seed` is passed) creates the `demo-school` tenant, learner `DEMO-001` and a guardian — no credentials. Create the admin with `go run ./cmd/devuser`, which prints a generated password once.

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

# First login (fresh databases have no users). Creates the platform owner,
# prints the generated password once. Re-running resets that password.
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm bootstrap
```

Then sign in at `https://$DOMAIN`, open **SaaS → Onboard tenant**, and the new
school walks through profile → calendar → structure → finance → seeds →
hand-off. M-Pesa, SMTP and SMS credentials are optional; without them the API
logs outbound messages and keeps STK pushes disabled.

Only Caddy publishes ports 80/443. PostgreSQL, Redis and the API stay on the private Docker network. Caddy terminates TLS, serves the SPA and proxies `/api`, `/webhooks` and `/health` to the API; `/metrics` is blocked publicly. Use `scripts/deploy.sh` for a health-gated rollout with rollback to the previous image tag.

On a fresh Ubuntu/Debian VPS, `sudo bash scripts/provision_production_server.sh schools.example.com` installs Docker, configures UFW, generates `.env.prod` with fresh secrets and runs the deploy. Point the DNS record at the VPS first; the health gate uses HTTPS.

Secrets (`POSTGRES_PASSWORD`, `JWT_SIGNING_KEY`, `ENCRYPTION_KEY`, `MPESA_WEBHOOK_TOKEN`, `METRICS_TOKEN`) must come from the environment or a secret manager. Never commit `.env.prod`.

## Architecture notes

- **Tenancy:** `schools(tenant_id)` is the tenant root; `users` is global; authorization lives in `tenant_memberships`. Domain rows carry `tenant_id VARCHAR(50)`.
- **RLS:** `migrations/0009_force_rls.sql` enables and **forces** RLS on every table with a `tenant_id`, so even the owner is subject to policies. `TenantTxMiddleware` sets `app.current_tenant_id` (and `app.current_user_role` for platform admins) transaction-locally; `0028_platform_admin_rls.sql` and `0030_rls_remaining_tables.sql` add the cross-tenant `platform_admin_bypass` policies. Handlers still keep explicit `WHERE tenant_id = $n` predicates as defence in depth. Backups must use an admin/superuser URL (`ADMIN_DATABASE_URL`) because FORCE RLS blocks `pg_dump` for the owner.
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
