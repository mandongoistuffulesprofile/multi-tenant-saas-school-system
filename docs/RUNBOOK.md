# Operations runbook

## Quick reference

| Item | Command / location |
| --- | --- |
| Liveness | `GET /health` (no dependencies) |
| Readiness | `GET /health/ready` (Postgres + Redis) |
| Metrics | `GET /metrics` (Bearer `METRICS_TOKEN`; blocked at Caddy) |
| API logs | `docker compose -f infrastructure/docker/docker-compose.prod.yml logs -f api` |
| Caddy logs | `... logs -f caddy` |
| Migrations | `docker compose ... run --rm migrate` |
| Deploy | `APP_VERSION=<tag> DOMAIN=<domain> ./scripts/deploy.sh` |
| Backup | `DATABASE_URL=... ./scripts/backup.sh` |
| Restore drill | `./scripts/verify_backup.sh <dump>` |

Never paste `DATABASE_URL`, JWT keys or M-Pesa secrets into tickets or chat. Logs include request IDs and tenant IDs, not tokens.

## Deploy and rollback

1. `git fetch && git checkout <tag>`.
2. `APP_VERSION=<tag> DOMAIN=<domain> ./scripts/deploy.sh`.
3. The script builds, runs migrations, starts containers and polls `https://<domain>/health/ready`.
4. On failure it prints the last 100 API log lines and restarts the previous `APP_VERSION` recorded in `infrastructure/docker/.deployed_version`.
5. If rollback is impossible, keep the old containers running and fix forward; do not delete the database volume.

Migrations are forward-only. Take a backup before any deploy that adds a migration.

## Database down

Symptoms: `/health/ready` returns 503 with `"dependency":"database"`; API logs show `pq:` errors.

1. `docker compose ... ps postgres`; check `pg_isready`.
2. `docker compose ... logs --tail=200 postgres`.
3. Disk full is the most common cause on a single VPS: `df -h`, `docker system df`.
4. Restart only after the disk has space: `docker compose ... restart postgres api`.
5. If the volume is corrupt, restore the latest dump (below) and accept RPO.

## Redis down

Symptoms: readiness 503 `"dependency":"redis"`; login and rate-limited routes fail closed.

1. `docker compose ... logs --tail=100 redis`.
2. `docker compose ... restart redis api`.
3. Redis holds rate-limit counters and short-lived OTP state only; it is safe to lose. Refresh tokens and outbox state are in Postgres.

## M-Pesa callback failing

1. Check `mpesa_raw_inbox` for rows with `processing_status` `PENDING`, `FAILED` or `MANUAL_REVIEW` and `error_log`.
2. A callback is acknowledged only after the inbox insert commits. If Safaricom shows a non-2xx, the payment was not persisted; replay the callback.
3. Verify the shortcode is active in `school_payment_channels` and unique (`uq_payment_channel_active_shortcode`).
4. Check that the header token matches `MPESA_WEBHOOK_TOKEN`; in production the API refuses to boot without it.
5. The worker runs every 15 s with `FOR UPDATE SKIP LOCKED`. Restarting the API is safe; idempotency is `(tenant_id, trans_id)`.
6. For a stuck row, inspect it manually and set `processing_status='PENDING'` only after fixing the cause.

## Outbox backlog

```sql
SELECT status, count(*) FROM outbox GROUP BY status;
SELECT event_type, count(*) FROM outbox WHERE status='PENDING' GROUP BY 1;
```

The drainer logs `outbox_drained` and retries with exponential backoff. Rows become `FAILED` after 8 attempts; inspect `last_error`, fix the consumer, then set them back to `PENDING` with `next_attempt_at = now()`.

## Rotate JWT signing key

Rotating the key logs every user out. Set the new `JWT_SIGNING_KEY` in `.env.prod`, then `docker compose ... up -d api`. Refresh tokens signed with the old key stop working; users sign in again. This is expected.

## Encryption key

`ENCRYPTION_KEY` protects encrypted learner/guardian fields. Changing it without re-encrypting data makes those fields unreadable. There is no automated rotation yet: take a backup, write a re-encryption migration, test on a scratch restore, then deploy. Do not rotate casually.

## Backup and restore

```bash
DATABASE_URL=... BACKUP_DIR=/var/backups/skulapp ./scripts/backup.sh
./scripts/verify_backup.sh /var/backups/skulapp/<file>.dump
CONFIRM_RESTORE=yes DATABASE_URL=... ./scripts/restore.sh <file>.dump
```

Stop the API before a destructive restore. Restore is `pg_restore --clean --if-exists --single-transaction`; a checksum file is verified first. After restore, run `/health/ready`, log in to the demo tenant (if present) and check one learner/invoice.

## RLS and ownership

The application role owns tables in the development stack, so RLS is bypassed for it. Tenant isolation therefore depends on explicit `WHERE tenant_id = $n` filters and on `db.WithTenant` for critical writes. Do **not** apply `migrations/optional/0005_force_rls.sql` until every handler uses request-scoped tenant transactions; doing so will make unfiltered reads return zero rows. Backups also fail against FORCE RLS when the dumping role is the owner.

## Logs and correlation

Every response carries `X-Request-ID`. Request logs are JSON with `request_id`, `tenant_id`, route, status and latency. Search by request ID first; if absent, search by tenant and time window.
