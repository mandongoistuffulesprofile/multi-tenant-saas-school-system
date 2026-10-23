# Service levels

| Indicator | Target | Measurement |
| --- | --- | --- |
| API availability | 99.5% monthly | `/health/ready` probes every minute |
| Read latency | p95 < 500 ms | request logs / `/metrics` |
| Write latency | p95 < 800 ms | request logs |
| M-Pesa callback persistence | 100% of accepted callbacks | inbox row exists for every 200 |
| Backup success | 1 per 24 h | backup heartbeat |
| Restore drill | monthly | `scripts/verify_backup.sh` record |

Error budget: 0.5% of minutes per month (~3.6 h). Exhausting it freezes feature deploys until the cause is fixed.

Out of scope until a second instance: multi-region failover, zero-downtime migrations, 99.9% commitments.
