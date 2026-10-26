# Plan: Per-Request Tenant Transaction Middleware (RLS Enforcement)

Goal: make RLS actually enforce tenant isolation by opening one tenant-scoped transaction per request and passing it to handlers, replacing 380+ hand-written `WHERE tenant_id` predicates.

## Phase 0: Preconditions (already done)
- `0009_force_rls.sql` exists (FORCE RLS on tenant tables).
- `scripts/provision_roles.sh` creates `skulapp_app` NOSUPERUSER NOBYPASSRLS.
- `db.Connect` sets session guards per connection.

## Phase 1: Middleware + context helper (1-2 days)
1. Add `middleware.TenantTxMiddleware(db)` that:
   - Reads `tenant_id` from context (set by TenantContextMiddleware).
   - Begins a tx, runs `SELECT set_config('app.current_tenant_id', $1, true)`.
   - Stores `*sql.Tx` in context under key `tx`.
   - Commits on 2xx, rolls back otherwise.
2. Add helper `db.TxFromContext(ctx) *sql.Tx` returning nil if absent (handlers fall back to db for public routes).
3. Register middleware globally after TenantContextMiddleware in server.go.
4. Add unit test: missing tenant → 401 before handler runs.

## Phase 2: Handler conversion, package by package (2-3 weeks)
Order by risk: auth → staff → finance → assessment → attendance → comms → reports → others.
For each package:
- Replace `h.database.Query/Exec` with `tx := db.TxFromContext(c.Request.Context())`.
- Remove redundant `WHERE tenant_id = $n` only where RLS now guarantees it; keep for queries that cross tenants (platform admin).
- Keep `platform/*` routes using a BYPASSRLS role or a separate connection, since they legitimately span tenants.
- Run `go build ./...` + targeted handler tests after each package.

## Phase 3: Platform admin separation
- Platform routes (`/platform/*`) must NOT use tenant tx; use a separate DB connection/role with BYPASSRLS.
- Impersonation: mint a token with `imp:true` claim; middleware sets tenant from token but marks session read-only.

## Phase 4: Role switch + force RLS (1 day)
- Switch docker-compose.prod.yml DATABASE_URL to `skulapp_app`.
- Run migrations as the owner role (migrator), app as `skulapp_app`.
- Apply `0009_force_rls.sql`.
- Verify `TestTenantRLS` runs as `skulapp_app` and passes.

## Phase 5: CI + tests
- Add a table-driven test: for every authenticated route, call as tenant A with tenant B's resource ID → expect 403/404.
- Run CI as `skulapp_app` (not superuser).
- Add govulncheck, gosec, npm audit.

## Validation gates
- `go build ./...`, `go vet ./...`, `go test -race ./...`.
- RLS isolation test green as app role.
- No 5xx increase in staging after each package.

## Rollback
- Each phase is a separate commit; revert phase if tests fail.
- Keep `WHERE tenant_id` filters during transition (defense in depth) until Phase 4 completes.
