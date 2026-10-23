# Infrastructure

Single VPS, Docker Compose, Caddy automatic TLS (D8). No Kubernetes before 50+ schools.

## Host

- Ubuntu 24.04 LTS, 4 vCPU / 8 GB RAM minimum for the API, Postgres and Redis.
- 100 GB SSD; Postgres data and backups on the same volume is acceptable only with off-host copies.
- Docker Engine 26+ with Compose v2.
- UFW: allow 22 (restricted), 80, 443. Close 5432, 6379 and 8080.
- Create a non-root deploy user in the `docker` group. Do not run the stack as root except through Docker.

## DNS and TLS

Point an A/AAAA record at the VPS. Caddy obtains and renews certificates automatically; ports 80/443 must be reachable. HSTS is set by Caddy. Renewal failures appear in `docker compose logs caddy`.

## Layout

`infrastructure/docker/docker-compose.prod.yml` runs:

| Service | Exposure |
| --- | --- |
| `postgres` | private network only; named volume `pgdata` |
| `redis` | private network only; AOF enabled |
| `migrate` | one-shot, exits before the API starts |
| `api` | private; `/health/ready` healthcheck |
| `web` | private nginx serving the built SPA |
| `caddy` | public 80/443 |

Only Caddy has a `ports:` mapping.

## Secrets

`infrastructure/docker/.env.prod` is 0600 and never committed. Required: `POSTGRES_PASSWORD`, `JWT_SIGNING_KEY`, `ENCRYPTION_KEY`, `MPESA_WEBHOOK_TOKEN`, `METRICS_TOKEN`, `DOMAIN`. Rotate JWT by restarting; see the runbook for the encryption key caveat.

## Pool math

API default: `max_open=20`, `max_idle=8` per instance. One instance plus the migrator stays below Postgres `max_connections=100`, leaving headroom for psql and backups. If a second API instance is added, keep `max_open × instances + 20 < 100`, or introduce PgBouncer in transaction mode. Do not enable transaction pooling with session-level `SET`; the code uses transaction-local `set_config`, which is compatible.

## Postgres tuning

- `shared_buffers` 25% of RAM, `effective_cache_size` 60–70%.
- `log_min_duration_statement=500ms`; review slow queries weekly.
- `pg_stat_statements` enabled.
- Backups: nightly `pg_dump -Fc`, checksum, off-host copy (`BACKUP_S3`), 14-day retention. Test a restore monthly.
- The baseline requires PostgreSQL 18 (named `NOT NULL` constraints).

## Monitoring

- Uptime check on `https://<domain>/health` and `/health/ready`.
- Scrape `/metrics` privately with `Authorization: Bearer $METRICS_TOKEN` (Caddy blocks the public path).
- Alert on: readiness failing 2 min, 5xx rate >2% for 5 min, backup heartbeat missing 26 h, M-Pesa pending >15 min, outbox backlog >1000.
- Ship container logs to the host journal or a log shipper; keep 14 days.

## Disaster recovery

RTO 4 hours, RPO 24 hours. Restore drill: `scripts/verify_backup.sh` restores into a scratch database, checks ≥100 tables and ≥50 policies, then drops it. Record the date and duration in the ops log.

## Capacity triggers

- Add a read replica when reporting CPU stays above 60% or an export blocks interactive p95.
- Add PgBouncer before a second API instance.
- Move object storage (report cards, exports) off the VPS when exports exceed 10 GB.
