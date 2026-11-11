# Deploy Today — Single Neon DB, Multi-Tenant (2–5 Schools)

## Architecture (confirmed)
- **One Postgres database (Neon) for all schools.** Do **not** create a database per school.
- Tenancy: shared schema, `schools(tenant_id)` root, `users` + `tenant_memberships`, `tenant_id` on domain rows, RLS policies + tenant-scoped transactions/filters.
- M-Pesa channels/shortcodes are configured per school inside the same DB.

## 1) Pre-deploy config (must be set)
- `APP_ENV=production`
- `DATABASE_URL=<Neon pooled connection string, sslmode=require>` (use pooler endpoint for API/workers)
- `REDIS_URL=<redis>` (required for OTP/rate-limit paths)
- `JWT_SIGNING_KEY=<strong secret>` (rotation logs users out)
- `ENCRYPTION_KEY=<strong secret>` (do not rotate without re-encryption plan)
- `MPESA_WEBHOOK_TOKEN=<secret>` and/or `MPESA_ALLOWED_IPS=<safaricom IPs>` (**required**; callbacks fail closed if neither set)
- `METRICS_TOKEN=<secret>` (metrics rejected/hidden in prod without proper auth; Caddy blocks `/metrics` publicly)
- `CORS`/allowed origins and public `DOMAIN` configured
- Ensure demo seed is **not** applied: `migrate -seed` is refused when `APP_ENV=production`

## 2) Migrations (single job per deploy)
```bash
cd backend
DATABASE_URL="$DATABASE_URL" APP_ENV=production go run ./cmd/migrate -dir ../migrations
# dry-run check: ... -dry-run
```
- Verify applied set includes `0023_schema_integrity_hardening.sql` and later migrations. Take a backup **before** applying new migrations.

## 3) Backups to Cloudflare R2 (S3-compatible) — do before onboarding
`scripts/backup.sh` supports S3-compatible upload (`aws s3 cp`) and writes `.sha256`.

Example (configure AWS CLI for R2):
```bash
export DATABASE_URL="$DATABASE_URL"
export BACKUP_DIR=/var/backups/skulapp
export RETENTION_DAYS=14
export BACKUP_S3=s3://<r2-bucket>/skulapp
export AWS_ACCESS_KEY_ID=<r2-access-key-id>
export AWS_SECRET_ACCESS_KEY=<r2-secret-access-key>
export AWS_DEFAULT_REGION=auto
export AWS_ENDPOINT_URL=https://<accountid>.r2.cloudflarestorage.com
./scripts/backup.sh
```
- Schedule nightly (cron/systemd). **A backup never restored is unverified.**
- Restore drill (disposable DB): `DATABASE_URL=<admin-url-to-postgres-db> ./scripts/verify_backup.sh <backup.dump>` (script checks table/RLS counts). Perform on a prod-shaped copy/Neon branch before go-live.

## 4) Deploy & runtime checks
```bash
cd infrastructure/docker
# .env.prod filled with secrets above
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
- Health: `GET /health` and `GET /health/ready` (DB + Redis). Caddy serves SPA and proxies `/api`, `/webhooks`, `/health`; `/metrics` not public.
- Confirm outbox/M-Pesa/inbound workers running (API logs); M-Pesa callbacks must persist to inbox (5xx only on persistence failure so Safaricom retries).
- One migration runner at a time (advisory lock in migrator).

## 5) Smoke tests per onboarded school (must pass)
1. Admin login/logout, session/CSRF on mutations, tenant switch (if applicable).
2. Create/verify academic year/term/class/learners; attendance mark + sync.
3. Assessment capture + sync; conflict appears/resolves in Sync Centre if induced.
4. Fee/invoice create; record payment/allocation; balances correct.
5. M-Pesa STK/callback (sandbox or controlled): inbox row created, idempotent on retry, allocation/receipt/outbound message queued & dispatched (respect opt-outs).
6. Parent comms/notifications delivered or visibly queued with status.
7. Reports/exports basic views load with tenant-scoped data.

## 6) Capacity notes (2–5 schools)
- Single shared Neon DB is appropriate. Use pooled connections, modest pool sizes, and indexes (present). Monitor connections, slow queries, and lock waits after first live school.
- **File/object storage:** current app stores file references (no R2/S3 blob upload abstraction implemented). Use R2 for **DB backups now**; add storage driver + presigned uploads before enabling user file uploads/evidence blobs.

## 7) Known residual risks (manage explicitly)
- Money values are largely DB `numeric` and critical allocations use SQL/locking, but some API/struct paths still use `float64` — avoid manual fractional edge cases, rely on KES whole amounts where possible, and complete minor-unit refactor post-deploy.
- Full browser/offline E2E and load tests not automated here; perform manual smoke on real devices for the first school.
- `FORCE ROW LEVEL SECURITY` is opt-in in dev defaults; isolation proven by tests and tenant-scoped transactions—do not enable FORCE globally until handlers fully covered.
- Keep `.env.prod`/secrets out of git; rotate compromised keys with planned procedure.

## 8) Rollback
- `scripts/deploy.sh` records previous image tag and can roll back on failed health check. DB migrations are forward-only—restore from verified backup if a migration causes issues.

## 9) UI/ops notes
- Demo/self-contained routes (`/cbc-assessment`, `/bom-oversight`) are dev-only; `/saas-admin` redirects to `/platform/operations`.
- Parent/guardian report card and comment reads are allowed only for linked learners (server-enforced) and audited on card view.
- Report printing is browser Print/Save PDF; durable `pdf_ref` generation requires a storage/export pipeline (R2/S3 blob uploads not yet implemented).
