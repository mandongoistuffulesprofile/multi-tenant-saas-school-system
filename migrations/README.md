# Database Migration Guide

## Slice 0 - Foundation (Current)

### Migration: `migrations/slice0/001_foundation.sql`

Creates:
- `uuid-ossp` extension
- `schools` table (global, no tenant_id) - SaaS tenant root
- `users` table (global, no tenant_id) - Global identity
- `tenant_memberships` table (tenant-scoped) - User-school-role links
- `refresh_tokens`, `devices`, `otp_challenges`, `guardian_claim_codes` tables
- RLS policies on all tables
- `audit_events` table (partitioned by tenant)
- `outbox` table for domain events
- Helper functions: `current_tenant_id()`, `current_user_id()`

### RLS Model

Every tenant table has:
1. Non-nullable indexed `tenant_id` foreign key
2. RLS ENABLED and FORCED
3. Policy: `USING (tenant_id = current_setting('app.current_tenant_id', true))`

Tenant context is set per transaction via:
```sql
SET LOCAL app.current_tenant_id = '<tenant_id>';
```

### Connection Pooling

Use PgBouncer in production. Each connection checkout must set `app.current_tenant_id` before any DML.
