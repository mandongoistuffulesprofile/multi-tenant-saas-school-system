# Production readiness — verified 2026-10-23

This is the evidence-backed status, not a feature wish list.

## Verified now

| Check | Result |
| --- | --- |
| `go build ./...` (readonly, offline) | Pass |
| `go vet ./...` | Pass |
| `go test ./...` with a disposable migrated DB and `TEST_DATABASE_URL` | Pass, including `TestTenantRLS` |
| Fresh database, all 8 migrations | Pass |
| Existing `skulapp` database adopted with `-baseline`, migrations 0002–0008 | Pass; 8 recorded, 104 tables, 86 policies |
| Login → cookie-only `/api/v1/school` | 200 |
| Bearer access token `/api/v1/school` | 200 |
| Cookie logout without CSRF | 403 |
| Cookie logout with CSRF | 200 |
| Refresh with cookie, twice (rotation persisted) | 200, 200 |
| Access token presented as refresh token | 401 |
| Audit endpoint with admin cookie | 200 |
| M-Pesa C2B callback with test channel | 200 → inbox `PROCESSED` → payment `COMPLETED` → invoice paid/outstanding updated |
| Outbox worker | test event `PENDING → PUBLISHED` |
| Backup/restore drill | 104 tables / 86 policies restored |

## Hard blockers to calling the whole product production-ready

1. **Frontend build is unverified.** npm cannot reach `registry.npmjs.org` or `registry.npmmirror.com` from this host (8 s timeouts), and `frontend/node_modules` contains only `axios` and `i18next`. `npm run build` and `tsc --noEmit` have not run against the current source. The checked-in `dist/` is from 2026-10-22 and must not be trusted as current.
2. **No lockfile.** `frontend/package-lock.json` is deleted, so `npm install` is not reproducible. Generate and commit a lockfile before a production build.
3. **SPA still uses bearer tokens in localStorage.** The API now sets HttpOnly cookies and enforces CSRF, but the SPA has not been migrated to `withCredentials` + `X-CSRF-Token`. Until it is, XSS can still read the access token and cookie-only mode is not enforced.
4. **Docker was not executed here.** The daemon is unavailable. Compose, Caddy and Dockerfiles were reviewed and fixed (notably the `migrate` entrypoint), but no image/container smoke test has run on this host.
5. **RLS is not FORCE-enforced for the app role.** The app role owns tables, so policies are bypassed for direct pool queries. Handlers rely on explicit `WHERE tenant_id` filters; critical paths use `db.WithTenant`. `migrations/optional/0005_force_rls.sql` is opt-in until the handler refactor is complete.

## What must happen before first paying tenant

1. On a networked machine: `cd frontend && npm install && npm run build && npx tsc --noEmit`; commit `package-lock.json`; then `docker compose -f infrastructure/docker/docker-compose.prod.yml --env-file .env.prod build`.
2. Migrate the SPA to cookie auth; remove token/refresh-token localStorage writes.
3. Run `scripts/deploy.sh` against staging, verify TLS, login, M-Pesa callback, a learner update and a backup/restore.
4. Replace every `.env.prod` placeholder with real secrets and confirm `APP_ENV=production` startup validation.
5. Complete the request-scoped tenant transaction refactor, then apply `migrations/optional/0005_force_rls.sql` with a non-owner role and re-run `TestTenantRLS`.
