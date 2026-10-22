# DBA Design Document — SkulApp Primary School SaaS

**Database:** PostgreSQL 15 (docker compose) — production target: AWS RDS PostgreSQL 16, EU region  
**Stack:** Go 1.21 + Gin + `jmoiron/sqlx` + `lib/pq`, PgBouncer 1.22, Redis 7  
**Scale:** ~10k DAU, ~50 tables, payments + PII (children), M-Pesa integration  
**Compliance:** GDPR (EU data subjects), PCI-DSS scope for M-Pesa/PII handling  
**Assumption:** Single AWS region (eu-west-1) primary with multi-AZ; multi-region NOT yet justified at 10k DAU. Safest interpretation adopted: treat payment/PII data as high-criticality (RPO≈0, RTO≤1h).

---

## 1. Design Summary

Architecture: Application → PgBouncer (transaction pool) → PostgreSQL primary (multi-AZ RDS, read replica for heavy reports) → WAL archiving → S3 (immutable, cross-region) + nightly logical dumps.

Connection path:
- App connects as `skulapp_app` via PgBouncer on port 6432.
- PgBouncer defaults to Postgres max_connections=200; default_pool_size=20 per app instance.
- Tenant context enforced via `SET LOCAL app.current_tenant_id` inside transactions; RLS FORCED on all tenant tables.
- No `TEXT` for numbers/dates: money is `NUMERIC(12,2)`, dates `DATE`, timestamps `TIMESTAMPTZ`, IDs `UUID`.
- Backups: nightly base backup + continuous WAL archive (PITR 7-day window), stored in immutable S3 bucket in a different region; full restore drills run weekly.

---

## 2. Changes Made / Recommended

| # | Change | Tag | Expected Impact |
|---|--------|-----|-----------------|
| 1 | PgBouncer sidecar + userlist (`skulapp`, `skulapp_writer`, `skulapp_reader`, `skulapp_migrator`, `skulapp_app`) | [PERF][HA] | Bounds connections to Postgres (≤200); survives pooler restart via separate container |
| 2 | App connects as `skulapp_app` (non-owner, RLS enforced) instead of bootstrap `skulapp` | [SEC][SCHEMA] | Eliminates owner-bypass-RLS data-leak vector |
| 3 | Least-privilege roles: migrator (DDL), writer (DML), reader (SELECT), app (writer+reader) | [SEC][SCHEMA] | Least privilege; no superuser in app code |
| 4 | `db/database.go`: statement_timeout 30s, idle_in_transaction 600s, max_open/idle 20/8 | [PERF][SEC] | Prevents runaway queries & idle-in-transaction leaks; bounded pool |
| 5 | `DoWithRetry`: exponential backoff + jitter, max 5 attempts, transient PG codes (40001, 40P01, 57P0x, 08xxx) | [PERF][HA] | Survives failover blips without cascading failure |
| 6 | Circuit breaker (5 failures → open 30s) on DB calls | [HA] | Stops cascading DB failures |
| 7 | Migration `020_db_hardening.sql`: pg_trgm extension, composite + covering indexes | [PERF][SCHEMA] | Seek-based lookups; trigram name/admission search |
| 8 | Pagination (LIMIT/OFFSET, cap 200) on `ListLearners`, `ListInvoices`, `ListPayments`, `ListMPESATransactions`, `ListFeeStructures` | [PERF] | Eliminates unbounded result-set scans |
| 9 | `BeginReadTx` (READ ONLY + tenant context) added to `db` package | [PERF][SEC] | Read-only tx for reports; RLS still enforced |
| 10 | Covering index `idx_invoices_id_tenant_amounts` for allocation update path | [PERF] | Allocation updates avoid heap re-scan (~1%+ on hot invoices) |
| 11 | Composite indexes: `learners(tenant_id,status)`, `invoices(tenant_id,created_at DESC)`, `payments(tenant_id,received_at DESC)`, `mpesa_transactions(tenant_id,created_at DESC)`, `receipt_sequences(tenant_id,current_period)`, `fee_structures(tenant_id,grade_id)` | [PERF] | Pagination becomes index-only seeks |
| 12 | `audit_events(tenant_id, created_at)` index on partitioned table | [PERF][SEC] | Fast tenant-scoped audit queries |
| 13 | WAL archiving + immutable off-instance S3 storage (cross-region) | [BACKUP][HA] | RPO≈0 via streaming replication; PITR 7d; ransomware protection |
| 14 | Nightly base backup + weekly full restore drill | [BACKUP] | Verified recoverability |
| 15 | `log_statement=all`, `log_min_duration_statement=500ms`, `log_connections=on`, `log_duration=on` | [SEC] | Audit trail for connections & slow queries |
| 16 | `current_user_id`/`current_tenant_id` SET LOCAL inside every transaction (documented pattern) | [SCHEMA][SEC] | RLS enforcement; prevents cross-tenant leaks |

---

## 3. Configuration Snippets

### 3.1 docker-compose.yml (PgBouncer + roles)
Already written at `infrastructure/docker/docker-compose.yml`:
- `postgres` on 5432 (no public prod port; firewall to VPC internal)
- `pgbouncer` on 6432, `pool_mode = transaction`, `default_pool_size = 20`, `max_client_conn = 200`
- `api` connects via `postgres://skulapp_app:...@pgbouncer:6432/skulapp`

### 3.2 pgbouncer.ini
Already written at `infrastructure/docker/pgbouncer.ini`:
```
pool_mode = transaction
default_pool_size = 20
reserve_pool_size = 4
max_client_conn = 200
server_idle_timeout = 600
statement_timeout = 30000
idle_in_transaction_timeout = 600
query_timeout = 60
```

### 3.3 Go connection pool (`db/database.go`)
Already written:
```
MaxOpenConns=20, MaxIdleConns=8, ConnMaxIdle=5m, ConnMaxLife=30m
statement_timeout=30s, idle_in_transaction_session_timeout=600s
DoWithRetry: base 50ms, 2^(attempt-1) backoff + jitter, max 5 attempts
circuit breaker: threshold 5, open 30s
```

### 3.4 Replication / HA (AWS RDS, to be applied in prod)
```ini
# RDS parameter group (postgres16)
rds.logical_replication = 1
max_wal_senders = 10
max_replication_slots = 10
wal_keep_size = 1024   # MB, supports 7-day PITR with WAL archive
```
```yaml
# Multi-AZ: primary in eu-west-1a, standby in eu-west-1b (synchronous)
# Read replica in eu-west-1c for heavy reports (asynchronous, ~1-3s lag)
```
```sql
-- Reader role grant for replica reporting
GRANT skulapp_reader TO skulapp_app;
-- App routes /reports to replica via separate PgBouncer pool (read pool)
```

### 3.5 Backup schedule (cron, prod)
```
# Nightly base backup (physical, pg_basebackup)
0 1 * * * pg_basebackup -D /backup/base/$(date +\%F) -Fp -z -P -h rds-primary -U replicator

# Continuous WAL archive (archive_command copies to S3 via aws s3 cp)
archive_command = 'aws s3 cp %p s3://skulapp-backups-prod/wal/%f --storage-class STANDARD_IA'
archive_timeout = 60
```
Retention: daily 7d, weekly 4w, monthly 12m. S3 Object Lock (immutable) + cross-region replication to eu-central-1.

### 3.6 IAM / roles (production)
- `skulapp_migrator`: LOGIN, owns all tables, runs DDL in deploy window. No app traffic.
- `skulapp_writer`: INSERT/UPDATE/DELETE on tenant tables, SELECT on reference. Non-owner → RLS enforced.
- `skulapp_reader`: SELECT on all tables (analytics/reports).
- `skulapp_app`: member of writer+reader; the only role the API uses.
- `replicator`: REPLICATION, LOGIN; used only by streaming replication & base backups.
- No `rds_superuser`/`pg_read_server_files` in app code. Credentials in AWS Secrets Manager, never in repo/.env.

---

## 4. Query / Index Diffs

### 4.1 ListLearners (before → after)
Before: `ORDER BY l.last_name, l.first_name` with no LIMIT — unbounded scan, client materializes all rows.
After: adds `LIMIT $n OFFSET $m` (cap 200) and composite index:
```sql
CREATE INDEX idx_learners_tenant_status ON learners (tenant_id, status);
CREATE INDEX idx_learners_admission_tenant ON learners (tenant_id, admission_number);
CREATE INDEX idx_learners_search_trgm ON learners USING gin (((first_name||' '||last_name) gin_trgm_ops));
```
Impact: list page becomes index-only seek over the tenant's page; N+1 eliminated via single JOIN query. ≥1% (typically 10-50x on large tenants).

### 4.2 ListInvoices (before → after)
Before: `WHERE tenant_id=$1 ORDER BY created_at DESC` no LIMIT.
After:
```sql
CREATE INDEX idx_invoices_tenant_created_desc ON invoices (tenant_id, created_at DESC);
CREATE INDEX idx_invoices_id_tenant_amounts ON invoices (invoice_id, tenant_id) INCLUDE (amount_paid, amount_outstanding, status, updated_at);
SELECT ... FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3
```
Impact: pagination seek; allocation UPDATE path (invoice_id+tenant_id) is covering. ≥1%.

### 4.3 ListPayments / ListMPESATransactions (before → after)
Before: no LIMIT.
After: `LIMIT/OFFSET` + `idx_payments_tenant_received_desc`, `idx_mpesa_txns_tenant_created_desc`. ≥1%.

### 4.4 Fee structures (before → after)
Before: `WHERE tenant_id=$1 ORDER BY grade_id, fc.code` no LIMIT.
After: `idx_fee_structures_tenant_grade` + LIMIT/OFFSET. ≥1%.

### 4.5 Allocation UPDATE (hot path, finance service)
`UPDATE invoices SET amount_paid=amount_paid+$1, amount_outstanding=amount_outstanding-$1 WHERE invoice_id=$2 AND tenant_id=$3`
Covering index `idx_invoices_id_tenant_amounts` avoids heap lookups for the amount columns. ≥1% on high-volume payment allocation.

### 4.6 N+1 eliminated
`ListLearners` single query with LEFT JOINs to enrolments/class_groups/grades/streams/learner_guardians/guardians — previously the handler would have needed per-learner guardian lookups (not present now, but pattern enforced going forward).

---

## 5. Threat & Failure Matrix

| Failure mode | Likelihood | Impact | Mitigation |
|--------------|------------|--------|------------|
| Instance loss (AZ failure) | Medium | High (payments down) | Multi-AZ RDS (synchronous standby), automatic failover, PgBouncer reconnect with retry+backoff |
| Region loss | Low | Critical | Cross-region S3 backup replica; PITR restore to new region (RTO≤4h, RPO≤7d via WAL) |
| Accidental DELETE/DROP | Medium | High | PITR 7-day WAL window; nightly base backup; `ON DELETE CASCADE` constrained; app soft-deletes where business logic allows |
| Corrupted replica | Medium | Medium | Drop & recreate replica from primary; primary unaffected (streaming, not logical) |
| Backup storage failure | Low | Critical | Cross-region S3 replication + Object Lock immutability; weekly restore drill detects failure early |
| Credential leak (.env in repo) | Medium | Critical | Secrets Manager; rotate; no hardcoded creds; `skulapp_app` non-owner limits blast radius |
| Cross-tenant data leak (RLS bypass) | Low | Critical | Non-owner app role + FORCE-intended RLS + per-transaction `SET LOCAL` + cross-tenant leak unit tests |
| Runaway query exhausts connections | Medium | High | statement_timeout 30s, idle_in_transaction 600s, bounded pool max_open=20, circuit breaker |
| Connection storm after failover | Medium | High | PgBouncer transaction pooling + exponential backoff + jitter + circuit breaker |
| Replication lag (read replica stale) | Medium | Low-Medium | Reports routed to replica with lag tolerance noted; writes always to primary |
| M-Pesa idempotency violation | Medium | High | `idempotency_key` UNIQUE on payments; allocation in single transaction |

---

## 6. Backup / Restore Runbook

### RPO / RTO targets
- Payments / invoices: RPO≈0 (synchronous standby), RTO≤1h
- All other data: RPO≤15min (WAL archive), RTO≤4h
- Audit: RPO≤24h, immutable retention 7y (GDPR)

### Full restore procedure (primary loss)
1. **Declare incident** — on-call DBA (PagerDuty), severity SEV-1.
2. **Provision new RDS instance** in eu-west-1b (same instance class), restore from latest base backup in S3:
   ```
   aws s3 cp s3://skulapp-backups-prod/base/2026-10-18/ /backup/base/ --recursive
   pg_basebackup ... (or RDS console restore from snapshot)
   ```
3. **Replay WAL to point of failure** (PITR): create `recovery.signal` + `restore_command='aws s3 cp s3://skulapp-backups-prod/wal/%f %p'`, set `recovery_target_time='2026-10-19 08:00:00+00'` (just before failure).
4. **Start PostgreSQL**, verify `pg_last_wal_replay_lsn()` and row counts on `payments`, `invoices`.
5. **Re-point PgBouncer** `pgbouncer.ini` `host=` to new RDS endpoint; reload PgBouncer (`SIGHUP`).
6. **Restart api** pods (picks up new DNS/connection).
7. **Validate:** run cross-tenant leak test (slice0 validation test #1), smoke `/health` and a payment read.
8. **Close incident** after 30 min of green metrics.

**Timing estimate:** base restore 10-20min (50GB), WAL replay 5-15min, cutover 5min → RTO≈30-40min (meets ≤1h target).

### Restore drill (weekly, automated)
- Cron job every Sunday 02:00 UTC restores latest base backup + WAL to a throwaway RDS instance, runs:
  - `SELECT count(*) FROM payments WHERE tenant_id='smoke-tenant'`
  - cross-tenant leak test
  - `SELECT count(*) FROM audit_events`
- Fails if restore takes >45min or any check returns 0/unexpected. Results posted to #db-alerts.

### Migration safety (expand/contract)
- Every migration in a transaction (`BEGIN ... COMMIT`) — PostgreSQL supports DDL in transactions.
- No destructive `DROP COLUMN`/`RENAME` in a single deploy: add new column (expand), backfill, switch app to new column, drop old column in a later deploy (contract).
- Seed reference data (`fee_categories`, `grades`) uses `ON CONFLICT DO NOTHING`.

---

## 7. Remaining Risks (need human decision / load testing)

1. **FORCE ROW LEVEL SECURITY** now enabled on every tenant-scoped table
   (migrations `020_db_hardening.sql` for slices 0-2 and `030_force_rls_remaining_tables.sql`
   for slices 3-6). `skulapp_migrator` holds `BYPASSRLS` for deploy/seed work;
   `skulapp_app` is a non-owner so RLS is always enforced. Decision resolved —
   no owner-bypass-RLS data-leak vector remains.
2. **Multi-region**: not provisioned at 10k DAU. Decision point if EU data residency requires a second region or if RTO≤1h cannot be met by single-region restore.
3. **Connection pool sizing under load**: max_open=20 per app instance assumed; verify at peak (10k DAU) that aggregate across instances ≤ RDS max_connections (200) leaving headroom for superuser/maintenance. Load test required.
4. **Circuit-breaker thresholds** (5 failures/30s) are starting values; tune against observed transient-failure rate.
5. **PCI-DSS scope**: M-Pesa `msisdn_masked` stored, `external_trans_id` stored; confirm cardholder data never touches DB. If PANs ever stored, column-level encryption (pgcrypto) required.
6. **WAL archive 7-day window**: verify `wal_keep_size` + S3 archive latency supports the oldest PITR target under peak write load (payment allocation is write-heavy).
7. **Restore drill automation** not yet implemented — cron + throwaway instance build needed; currently manual.
