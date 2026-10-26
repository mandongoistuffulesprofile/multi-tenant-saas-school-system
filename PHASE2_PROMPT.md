# Prompt for new session: Phase 2 — Handler conversion to request-scoped tenant transactions

You are working in `/home/yna/Desktop/New Folder` (Go backend + React frontend). Phase 1 is complete: `middleware.TenantTxMiddleware` opens a per-request transaction, sets `app.current_tenant_id`, commits on success, rolls back on error; helpers `middleware.TxFromContext` / `middleware.TxFromGin` exist.

## Objective
Convert every handler package under `backend/internal/*` to use the request-scoped transaction instead of `h.database` directly, so RLS is actually enforced. Remove redundant hand-written `WHERE tenant_id = $n` where RLS now guarantees isolation (keep for cross-tenant/platform queries).

## Rules
- One package per commit. Run `go build ./...` and `go test ./...` after each.
- Never break the public/platform routes (`/platform/*`, `/health`, `/webhooks/*`): they must keep working when no tenant tx is present (fall back to `h.database`).
- Use `tx := middleware.TxFromGin(c); if tx == nil { tx = h.database }` pattern? No — if tx is nil on an authenticated route, that's a bug. Prefer: `tx, ok := ...; if !ok { abort 500 }`.
- Keep `WHERE tenant_id` during transition for defense in depth until Phase 4 (role switch) is done; only remove where clearly redundant and tested.
- Preserve all existing behavior; this is a refactor, not a feature change.
- Do not touch frontend.

## Order (by risk)
1. auth, staff, school (small, high-risk tenancy)
2. finance, assessment, attendance (money/grades)
3. comms, reports, learner, curriculum
4. platform (must stay cross-tenant — use a separate BYPASSRLS connection)
5. remaining packages

## Per-package steps
1. `grep -rn "h.database\.\(Query\|Exec\|QueryRow\|Select\|Get\|Begin\)" backend/internal/<pkg>/`
2. Replace with `tx := middleware.TxFromGin(c)` then `tx.Query...`.
3. Handle the nil-tx case with 500 + log.
4. Build + vet + test.
5. Commit: `refactor(<pkg>): use request-scoped tenant tx`.

## Validation
- `go build ./...`
- `go vet ./...`
- `go test -race ./...`
- Add at least one test per package asserting tenant isolation (query as tenant A with tenant B's ID → 403/404/empty).

## Do NOT
- Change SQL semantics beyond tx swap.
- Touch migrations or frontend.
- Remove `WHERE tenant_id` until Phase 4.

## Deliverable
All packages converted, tests green, committed per package, pushed to main.
