# Deployment & Bundling Plan — Shule Yetu (Kenyan Primary School SaaS)

## Project architecture at a glance

| Layer | Tech | Delivery unit |
|-------|------|---------------|
| Backend API | Go 1.26 + Gin | Single static binary (`CGO_ENABLED=0`), distroless/static container image |
| Frontend SPA | React 18 + TypeScript + Vite | Static assets (`dist/`), served by nginx |
| Database | PostgreSQL 18 | `postgres:18-alpine` image, persistent volume |
| Cache / rate limiting | Redis 7 | `redis:7-alpine` image, optional in dev |
| Migration runner | Go binary (`cmd/migrate`) | One-shot container, runs before API starts |
| Reverse proxy / TLS | Caddy 2 | Public entrypoint (ports 80/443), private network for everything else |

## How to install and run

### Option A — One-command local development (recommended)

```bash
./launch_all.sh
```

What it does:
1. Uses local PostgreSQL (5432) and Redis (6379) if running; otherwise starts them via `infrastructure/docker/docker-compose.yml`.
2. Applies migrations (`cmd/migrate`) and optional idempotent demo seed (`SEED=1` default).
3. Creates demo accounts (`admin@demo.test`, `platform@demo.test`) and prints generated passwords once.
4. Builds the Go API (`go build -o /tmp/.../api ./cmd/api`) and starts it on `:8080`.
5. Starts Vite dev server on `:5173` (proxies `/api` to `:8080`).
6. Waits for both health checks, prints URLs and credentials.

Stop: `Ctrl+C`. PostgreSQL and Redis are left running.

Environment knobs: `SEED=0` (skip demo), `RESET_DEMO_PASSWORD=1` (rotate demo passwords), `PORT`, `FRONTEND_PORT`, `DATABASE_URL`, `REDIS_URL`.

### Option B — Manual local (no Docker)

Prerequisites on host: Go 1.26, Node.js 20 + npm, PostgreSQL 18, Redis 7.

```bash
# 1. Databases
# Create role + database:
sudo -u postgres psql -c "CREATE USER school_admin WITH PASSWORD 'dev_secret_password';"
sudo -u postgres psql -c "CREATE DATABASE school_system OWNER school_admin;"

# 2. Backend
cd backend
cp .env.example .env
set -a; . ./.env; set +a
go build ./...
go vet ./...
go run ./cmd/migrate -dir ../migrations -seed
go run ./cmd/api   # :8080

# 3. Frontend (another terminal)
cd frontend
cp .env.example .env   # VITE_API_BASE=/api/v1
npm install
npm run dev            # :5173
```

### Option C — Docker Compose (dev, no host modules)

```bash
cd infrastructure/docker
docker compose up -d --build
```

Services: postgres, redis, migrate (one-shot), backend API. No Go or Node needed on the host — Docker pulls/builds everything.

API: `http://localhost:8080` | PostgreSQL: `localhost:5432` | Redis: `localhost:6379`.

### Option D — Production (single VPS)

```bash
cd infrastructure/docker
cp .env.prod.example .env.prod   # fill every secret: POSTGRES_PASSWORD, JWT_SIGNING_KEY, ENCRYPTION_KEY, MPESA_WEBHOOK_TOKEN, METRICS_TOKEN, DOMAIN
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Stack: postgres, redis, migrate, api, web (frontend), caddy (TLS + reverse proxy). Only Caddy publishes 80/443; everything else is on a private Docker network.

Fresh VPS provisioning:
```bash
sudo bash scripts/provision_production_server.sh schools.example.com
```
Installs Docker, configures UFW, generates `.env.prod`, runs the deploy. Point DNS at the VPS first (health gate uses HTTPS).

## How to run without installing independent modules

Use **Docker** — no Go, Node, PostgreSQL, or Redis needs to be installed on the host machine.

| What | How it's self-contained |
|------|------------------------|
| Backend | `backend/Dockerfile` builds a statically linked Go binary (`CGO_ENABLED=0`) into `gcr.io/distroless/static-debian12:nonroot`. Zero runtime dependencies; ships CA certs (for M-Pesa callbacks) and tzdata (Africa/Nairobi). |
| Frontend | `frontend/Dockerfile` builds Vite assets with Node 20, then copies `dist/` into `nginx:1.27-alpine` with brotli module for precompressed `.br/.gz` serving. |
| DB/Cache | Official `postgres:18-alpine` and `redis:7-alpine` images. |
| Migrations | Same backend image, entrypoint overridden to `/migrate`. Runs once before API starts. |

Only Docker (or Docker Compose) is required on the host. `node_modules` is **not** needed on the host — the frontend `node_modules/` directory in the repo is only for local `npm run dev` without Docker.

## How updates work

### Application code updates
1. `git pull` (or fetch new image tag from registry).
2. Rebuild images: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
3. The `migrate` service runs first (advisory-locked, checksummed, recorded in `schema_migrations`) and applies any new `migrations/*.sql` before the API starts.
4. `scripts/deploy.sh` performs a health-gated rollout with rollback to the previous image tag.

### Database updates (migrations)
- New `.sql` files added to `migrations/` are applied incrementally by `cmd/migrate`.
- Each migration runs inside a transaction with an advisory lock so multiple API replicas never race DDL.
- Migration state is recorded in `schema_migrations` table — re-running is idempotent.
- **Never** apply files under `migrations/archive/` to a new database (they describe contradictory schema generations).

### Rollback
- `scripts/deploy.sh` rolls back to the previous image tag if the health gate (`/health/ready`) fails.
- Database rollbacks are manual: restore from `scripts/backup.sh` (`pg_dump -Fc` + SHA-256) via `scripts/restore.sh` (requires `CONFIRM_RESTORE=yes`).

## Best-fit bundling options

### Backend — single static binary (chosen, already implemented)
- `CGO_ENABLED=0`, `GOOS=linux`, `-trimpath`, `-ldflags="-s -w"`, `-buildvcs=false`.
- Output: one `/api` binary (~15–20 MB), no libc dependency.
- Image: `distroless/static-debian12:nonroot` (non-root user, minimal attack surface, ~12 MB).
- Why: fastest cold start, smallest attack surface, no Alpine package vulnerabilities, no shared-library drift.
- Trade-off: no dynamic linking; if you ever need a C dependency (e.g. a CGO database driver), switch to `distroless/base-debian12` or Alpine.

### Frontend — Vite build → nginx (chosen, already implemented)
- `npm run build` emits `dist/` with hashed asset filenames, precompressed `.br` and `.gz` variants (via `vite-plugin-compression2`).
- Served by `nginx:1.27-alpine` + `nginx-mod-http-brotli`, serving precompressed variants directly (no per-request CPU).
- Why: Vite handles code-splitting, tree-shaking, and HMR in dev; nginx is the cheapest way to serve static assets in prod with TLS termination at Caddy.
- Rollup musl note: the Dockerfile installs `@rollup/rollup-linux-x64-musl` explicitly because the lockfile may carry only `linux-x64-gnu` optional binaries.

### Alternative bundling options (not currently used, evaluate if needed)

| Option | When to consider | Trade-off |
|--------|------------------|-----------|
| **Single combined image** (API + frontend in one container) | Simpler single-container deploys (e.g. Fly.io, Render) | Loses independent scaling; frontend rebuild forces API redeploy |
| **Frontend CDN + S3** | High-traffic public-facing SPA | Requires invalidation on deploy; Caddy still needed for API proxy |
| **Go embed** (`//go:embed frontend/dist`) | Truly single-binary deploy | Increases binary size; frontend changes require full Go rebuild |
| **Multi-stage with BuildKit cache mounts** | Faster CI builds | Already documented as comments in `backend/Dockerfile`; enable `DOCKER_BUILDKIT=1` |

### Recommended production bundle
```
image: skulapp-api:<tag>     (Go static binary + migrate + healthcheck)
image: skulapp-web:<tag>     (Vite static assets in nginx)
image: caddy:2-alpine        (TLS termination, /api proxy, /health, /metrics blocked publicly)
image: postgres:18-alpine    (DB, persistent volume)
image: redis:7-alpine        (cache, optional rate limiting, AOF enabled)
```

Run: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d`.

## Validation checklist before any deploy

- [ ] `go build ./... && go vet ./... && go test -race ./internal/...` (backend)
- [ ] `npm run typecheck && npm run build` (frontend)
- [ ] `.env.prod` has all required secrets (never committed)
- [ ] DNS points at VPS before first prod deploy (health gate uses HTTPS)
- [ ] `scripts/backup.sh` run before applying migrations to production
- [ ] `TEST_DATABASE_URL` set if running tenant-isolation RLS tests
