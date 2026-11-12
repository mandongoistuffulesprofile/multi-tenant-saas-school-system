# Database migrations

`cmd/migrate` applies every `*.sql` file directly inside this directory in lexical order. Each file runs inside a transaction and is recorded with its SHA-256 checksum in `schema_migrations`; editing an applied file aborts the run. A PostgreSQL advisory lock prevents concurrent migrators.

```bash
cd backend
go run ./cmd/migrate -dir ../migrations            # apply
go run ./cmd/migrate -dir ../migrations -dry-run   # list pending
go run ./cmd/migrate -dir ../migrations -seed      # also apply seed/*.sql
go run ./cmd/migrate -dir ../migrations -baseline 0001_baseline.sql
```

`-baseline` records `0001_baseline.sql` as already applied **without running it**. Use it only when adopting a database that was created from the same baseline before the checksummed runner existed (the working `skulapp` database). It refuses to run unless `schema_migrations` is empty. Fresh databases must not use it.

## Canonical files

| File | Purpose |
| --- | --- |
| `0001_baseline.sql` | Complete schema dumped from the working PostgreSQL 18 database (tables, indexes, RLS policies, helper functions). |
| `0002_rls_hardening.sql` | RLS for `outbox`, global `fee_categories`, audit partitions and hot-path indexes. |
| `0003_mpesa_inbox.sql` | Append-only M-Pesa webhook inbox and idempotency constraints. |
| `0004_runtime_tables.sql` | Runtime/support tables added after the baseline dump. |
| `0005_user_profile.sql` | Global `users.first_name` / `last_name`. |
| `0006_outbox_retry.sql` | Outbox `next_attempt_at`, `last_error` and drain index. |
| `0007_audit_request_id.sql` | Audit request correlation and tenant/time index. |
| `0008_payment_channel_unique.sql` | One active paybill/till belongs to one school. |

`migrations/seed/0001_demo.sql` is applied only with `-seed`. It creates the `demo-school` tenant, a learner and a guardian. No users or passwords are seeded; create the admin with `cmd/devuser`, which prints a generated password once.

`migrations/optional/` holds historical opt-in hardening. `0005_force_rls.sql` is now redundant with the default `0009_force_rls.sql`; it remains only for manual use on a database that has not applied 0009.

## Archived history

`migrations/archive/` contains the original `slice0`–`slice8` files and two early top-level migrations. They are kept for audit only: they describe contradictory schema generations (`tenants`/`users.id` versus `schools`/`users.user_id`). **Never apply the archive to a new database.**

## RLS model

Tenant tables have `ENABLE ROW LEVEL SECURITY`, an `<table>_isolation` policy comparing `tenant_id` with `current_tenant_id()`, and (since `0009_force_rls.sql`) `FORCE ROW LEVEL SECURITY` so the table owner is subject to the same policies. Policies are strict: a session with no `app.current_tenant_id` sees no rows.

`0028_platform_admin_rls.sql` and `0030_rls_remaining_tables.sql` add `platform_admin_bypass` policies keyed on `app.current_user_role IN ('SAAS_ADMIN','SUPER_ADMIN')`. `TenantTxMiddleware` sets both GUCs transaction-locally from the validated JWT, and platform handlers read through the request transaction. `0030` also enrolls the last five tenant tables (`delegated_entry_tokens`, `export_audit_logs`, `mpesa_holding_tank`, `password_assistance_requests`, `platform_tenant_onboarding`).

Handlers still keep explicit `WHERE tenant_id = $n` predicates as defence in depth. Use `db.WithTenant` / `db.BeginTenantTx` / `db.BeginReadTx` for new write paths; those helpers set `app.current_tenant_id` with `set_config('app.current_tenant_id', $1, true)`, not `SET LOCAL ... = $1` (PostgreSQL does not accept bind parameters in `SET`).

`pg_dump` fails against a FORCE-RLS database when the dumping role is the table owner; run backups through `ADMIN_DATABASE_URL` as a superuser or a role with `BYPASSRLS`.
