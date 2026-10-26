# Dev Orchestrator (dev.py) — Reconciliation Plan

**Source material:** user-pasted planning draft (dev.py master orchestrator + jargon demystification + best-fit strategy + AI context prompt).
**Status:** not final; planning only. This plan reconciles the draft against the *actual* repo state and produces an implementation-ready task list.
**Plan file:** `.kilo/plans/1793100000000-dev-orchestrator-reconciliation.md`

---

## 1. Goal

Deliver a `dev.py` at the repo root that spins up the SkulApp dev stack (PostgreSQL + Redis + Go backend + Vite frontend) in one command, with port hygiene, Docker-daemon checks, colored multiplexed logs, graceful shutdown, and DB readiness + migration verification — grounded in the actual codebase, not the draft's assumptions.

## 2. Cross-check: proposal vs actual repo (contradictions to resolve)

| Draft claim | Actual repo state | Resolution |
|---|---|---|
| Compose service named `db`; `docker compose ps -q db` | Service is `postgres` (in `infrastructure/docker/docker-compose.yml`) | Use `postgres`; parameterize ports via env |
| `pg_isready -U skulapp -d skulapp` | Compose defaults: `POSTGRES_USER=school_admin`, `POSTGRES_PASSWORD=dev_secret_password`, `POSTGRES_DB=school_system` | Use compose env defaults; read from `.env`/environment |
| Apply `migrations/slice0/001_foundation.sql` via `psql -f` | Flat `migrations/0001_baseline.sql`…`0008_payment_channel_unique.sql`, seed in `migrations/seed/0001_demo.sql`; Go runner `backend/cmd/migrate/main.go` (checksummed, advisory-locked, `schema_migrations`) | Use existing `cmd/migrate` (with `-seed`) — do not introduce Goose/Atlas now |
| Backend entrypoint `/backend/cmd/api/main.go` using Gin | `cmd/api/main.go` is a slim `net/http` mux; the full Gin server is `cmd/api/server.go` (with `Run()`); `internal/db`, `internal/config`, `internal/middleware`, Gin router, `/health`, `/health/ready`, `/metrics` | Run `go run ./cmd/api` pointing at server.go (verify Dockerfile build target); keep `main.go` out of the dev loop unless it's the intended entrypoint |
| Propose Goose/Atlas + PgBouncer + distroless/scratch containers | `infrastructure/docker/pgbouncer.ini` + `userlist.txt` exist but no pgbouncer compose service; no distroless Dockerfile; migrations already Go-based | Mark PgBouncer/distroless/Goose as **future considerations**, out of scope for dev.py v1 |
| Context prompt: Lucide icons, sidebar mapping, empty-state refactor, red→slate buttons | Frontend is Vite+React+TS+Tailwind (`vite.config.ts` proxies `/api` → `localhost:8080`, port 5173) | UI refactor is a **separate initiative**, not part of dev.py; note it in open questions |

## 3. Locked decisions

- **Orchestrator language:** Python 3 (`dev.py` at repo root), stdlib only where possible.
- **Infra:** use the existing `infrastructure/docker/docker-compose.yml` as-is (postgres:18-alpine, redis, migrate, backend). Do not rewrite compose for dev.py v1.
- **Ports:** 5432 (Postgres), 6379 (Redis), 8080 (API), 5173 (Vite). dev.py frees orphans on 8080/5173 before starting.
- **Migrations:** reuse `backend/cmd/migrate` with `-dir` pointing at the mounted migrations and `-seed` for demo data. Do not add Goose/Atlas.
- **Backend run:** `go run ./cmd/api` in `backend/`, with `air` hot-reload if installed, else plain `go run`.
- **Frontend run:** `npm install` (if `node_modules` missing) then `npm run dev` in `frontend/`.
- **Log multiplexing:** color-prefixed threads (`[API-8080]`, `[VITE-5173]`, `[INFRA]`, `[DB]`, `[MIGRATION]`).
- **Signals:** trap SIGINT/SIGTERM, terminate child process group, exit cleanly.
- **Demo credentials:** documented in `DEMO_LOGINS.txt` (already created at repo root). Primary login: `admin@demo.test` / `DemoPass123!` (tenant `demo-school`).

## 4. Task list (implementation-ready, sequential)

1. **Verify build targets.** Confirm which of `cmd/api/main.go` vs `cmd/api/server.go` the Dockerfile / CI builds; ensure `go run ./cmd/api` starts the Gin server on port 8080 with `DATABASE_URL`/`REDIS_URL`/`PORT` from env. Record the correct entrypoint in the plan.
2. **Scaffold dev.py** with: prerequisite checks (docker, go, node, npm), port-collision detection + orphan kill for 8080/5173, Docker daemon check (`docker info`), compose up (`docker compose -f infrastructure/docker/docker-compose.yml up -d`), DB readiness poll (`pg_isready` using compose creds), migration run (`go run ./cmd/migrate -dir ../migrations -seed` from backend), backend + frontend launch, colored log multiplexing, signal handling, health polling loop.
3. **Wire env files.** Ensure `backend/.env` and `frontend/.env` exist (copy from `.example` if missing) so compose/backend/frontend agree on `DATABASE_URL`, `VITE_API_BASE`, etc.
4. **Demo-data verification.** After migrate + seed, confirm `admin@demo.test` exists in `users` + `tenant_memberships` for `demo-school`. Print the demo login line to stdout on startup.
5. **Validation script (ad-hoc).** `curl http://localhost:8080/health/ready` and `curl http://localhost:5173` return 200; open `http://localhost:5173` in browser.
6. **Documentation.** Add a short `DEV_MODE.md` (or section in README) describing `python dev.py`, the four URLs, and the demo credentials pointer to `DEMO_LOGINS.txt`.

## 5. Out of scope (explicit)

- Goose/Atlas migration migration.
- PgBouncer compose service + distroless/scratch production containers.
- Frontend UI refactor (Lucide icons, sidebar, empty states, button colors) — separate initiative per the pasted context prompt.
- GitHub Actions CI, `make verify`, Agent Manager worktrees (those belong to the existing parallel-lanes plan).

## 6. Validation

- `python dev.py` starts all four services without manual `psql -f`.
- `GET /health/ready` → 200 once compose + migrations complete.
- Frontend reachable at `http://localhost:5173`; proxy to `/api/v1/auth/login` reaches `:8080`.
- `Ctrl+C` terminates backend, frontend, and stops compose services.
- Demo login `admin@demo.test` / `DemoPass123!` is present in `DEMO_LOGINS.txt` and can be attempted against the running API.

## 7. Open questions (to resolve before implementation)

1. Confirm the intended backend entrypoint: `cmd/api/main.go` (slim net/http) or `cmd/api/server.go` (full Gin)? dev.py must run the correct one.
2. Should dev.py stop/remove existing compose containers on start (`down`) or reuse (`up -d`)? Recommendation: `up -d` (reuse volumes), with an optional `--reset` flag.
3. Does the pasted UI context prompt get a separate plan/issue? Recommendation: yes — file it as a distinct frontend design initiative, not blocked on dev.py.

---

**Next step:** an implementation-capable agent can take this plan and write `dev.py`. Switch out of plan mode to implement.