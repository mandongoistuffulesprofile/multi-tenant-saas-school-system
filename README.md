# Shule Yetu — Kenyan Primary School Management SaaS

Multi-tenant school management system: **Go + Gin + PostgreSQL (row-level security) + Redis** API and a **React + TypeScript + Vite** frontend.

## Repository layout

| Path | Purpose |
| --- | --- |
| `backend/` | Go API. Entrypoint `cmd/api` (`main.go` → `server.go`). Domain packages live in `internal/<domain>/` (`service.go` reads, `write.go` mutations). |
| `frontend/` | React/Vite app. Entry `index.html` → `src/main.tsx` → `src/App.tsx`; pages in `src/pages/`. |
| `migrations/` | Ordered SQL slices (`slice0` … `slice8`). Applied automatically on first container start. |
| `infrastructure/docker/` | Docker Compose for Postgres, Redis and the API. |
| `docs/`, `design/`, `DBA_DESIGN.md` | Product and database design notes. |
| `src/` + root `package.json` | Legacy standalone Node auth prototype. Not part of the running system. |

## Quick start (Docker)

```bash
cd infrastructure/docker
docker compose up -d --build
```

- API: http://localhost:8080 (`/health`, `/health/ready`)
- PostgreSQL: `localhost:5432` (`school_admin` / `dev_secret_password` / `school_system`)
- Redis: `localhost:6379`

Migrations are applied in filename order by `infrastructure/docker/initdb/00_migrations.sh` and recorded in `schema_migrations`.

## Local development

### Backend

```bash
cd backend
cp .env.example .env       # DATABASE_URL, REDIS_URL, JWT_SIGNING_KEY, ENCRYPTION_KEY
go mod download
go run ./cmd/api
```

Requires Go 1.25+ (the dependency set targets current Gin). Run `go build ./...` before committing.

Apply migrations against a fresh local database (the Docker setup does this automatically):

```bash
for f in $(find ../migrations -type f -name '*.sql' | sort); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

### Frontend

```bash
cd frontend
cp .env.example .env       # VITE_API_BASE=/api/v1
npm install
npm run dev                # http://localhost:5173, proxies /api to :8080
```

`npm run build` performs a production build. Type-check with `npx tsc --noEmit`.

## Architecture notes

- **Multi-tenancy:** shared PostgreSQL with `FORCE ROW LEVEL SECURITY`; every service transaction calls `BeginTenantTx`/`BeginReadTx` so `app.current_tenant_id` is set with `SET LOCAL`.
- **Auth:** JWT access + refresh tokens (`internal/auth`), Redis-backed rate limiting, argon2id password hashing. `middleware.TenantContextMiddleware` verifies the bearer token once per request.
- **Money:** invoice → payment → allocation model, M-Pesa (Daraja) with transaction-id idempotency.
- **CBC:** assessment events + result history rather than overwriting rows.
- **Offline:** PWA service worker and queued sync (`/sync/push`, `/sync/pull`).
- **i18n:** English and Kiswahili.

## Known constraint

The migration history contains two schema generations (`users.id` + `tenants` in `slice0` versus `users.user_id` + `schools`/`tenant_memberships` referenced by later slices). Code and API build cleanly, but a fresh database should be validated before production use; consolidating those two generations into one migration baseline is the next database task.
