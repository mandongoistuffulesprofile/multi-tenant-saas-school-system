# Monitoring runbook

Free, self-hosted uptime monitoring for the production stack: **Uptime Kuma**
polls the API readiness endpoint and the SPA, and alerts the operator when
either stops answering. The `/metrics` counter endpoint is covered too, through
the private Docker network and its `METRICS_TOKEN`.

## Start Uptime Kuma

The service lives behind the `monitoring` Compose profile, so a normal
`up -d` does not start it. On the VPS, from `infrastructure/docker`:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  --profile monitoring up -d uptime-kuma
```

- The UI listens on `127.0.0.1:3001` only. Override with
  `UPTIME_KUMA_BIND` / `UPTIME_KUMA_PORT` in `.env.prod` if needed.
- Reach it through an SSH tunnel, never by publishing it publicly:

  ```bash
  ssh -L 3001:127.0.0.1:3001 deploy@schools.example.com
  # then open http://127.0.0.1:3001
  ```

- Create the administrator account on first visit. Uptime Kuma is self-hosted,
  so that account is the only access control; use a unique password in the
  operator's password manager.
- State (users, monitors, history, notifications) is kept in the
  `uptimekuma` Docker volume. Include it in the backup rotation:

  ```bash
  docker run --rm -v skulapp_uptimekuma:/data -v "$PWD":/backup alpine \
    tar czf /backup/uptime-kuma-$(date +%F).tgz -C /data .
  ```

## Monitors to add

Add these two monitors first; both are public endpoints already served by
Caddy.

| Monitor | Type | URL | Interval | Expected |
| --- | --- | --- | --- | --- |
| API readiness | HTTP(s) – Keyword | `https://$DOMAIN/health/ready` | 60s | status `200`, body contains `"status":"ready"` |
| SPA | HTTP(s) – Keyword | `https://$DOMAIN/` | 60s | status `200`, body contains `id="root"` |

Settings that matter:

- **Retries:** 2 (a single blip should not page anyone) and **timeout:** 10s.
- **Accepted status codes:** `200-299`.
- **Certificate expiry notification:** enabled, 14 days.
- Enable **Resend Notification if Down** every 30 minutes so an unresolved
  outage is not forgotten.
- Do not monitor `/metrics` from the public URL: Caddy returns `404` for it by
  design. Use the private-network monitor below instead.

### `/metrics` (token-protected)

The API exposes Prometheus-format request counters at `/metrics`. In
production `METRICS_TOKEN` is required by the Compose file, and Caddy blocks
the path publicly:

```
# infrastructure/docker/Caddyfile
handle /metrics {
    respond "Not found" 404
}
```

Uptime Kuma runs on the same private Docker network as the API, so add a third
monitor that reads the endpoint directly and supplies the token as a header:

| Field | Value |
| --- | --- |
| Type | HTTP(s) – Keyword |
| URL | `http://api:8080/metrics` |
| Headers | `Authorization: Bearer <METRICS_TOKEN from .env.prod>` |
| Keyword | `app_http_requests_total` |
| Interval | 300s |

The monitor should expect `200`. A `401` means the token header is missing or
wrong; a `404` means it was sent through Caddy instead of the internal
network. The token is a secret: keep it in `.env.prod` and in the monitor's
header field, never in a URL or a committed file.

To check the endpoint by hand without exposing it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec \
  uptime-kuma sh -c 'wget -qO- --header="Authorization: Bearer $METRICS_TOKEN" http://api:8080/metrics' \
  | head
```

If the monitoring profile is not running, run a throwaway container on the
stack network instead:

```bash
docker run --rm --network docker_internal curlimages/curl -fsS \
  -H "Authorization: Bearer $METRICS_TOKEN" http://api:8080/metrics | head
```

Counters are labelled by method, route and status, e.g.
`app_http_requests_total{method="GET",route="/health/ready",status="200"} 42`.
They reset when the API restarts; alert on the readiness monitor, not on a
counter being absent.

## Alert setup

1. **Notification channel.** Uptime Kuma → *Settings → Notifications → Setup
   Notification*:
   - **Email (SMTP):** the same SMTP credentials as the API
     (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`), delivered to the
     on-call mailbox.
   - or **ntfy / Telegram / Slack** for push. ntfy is the cheapest: run the
     public `ntfy.sh` topic or self-host it, subscribe on the phone.
2. **Assign it.** Set the notification as the **default** for all monitors, or
   attach it to each monitor explicitly.
3. **Test it.** Use *Test* on the notification and then hit *Pause/Resume* on
   one monitor to confirm a down and a recovery message both arrive.
4. **Status page (optional).** Create a public status page with the two public
   monitors if parents or staff need visibility. Never add the `/metrics`
   monitor to a public page.

## When an alert fires

1. `docker compose -f docker-compose.prod.yml ps` — is `api`, `web` or `caddy`
   restarting, unhealthy, or absent?
2. `docker compose -f docker-compose.prod.yml logs --tail=200 api` — look for
   database/Redis connection errors or a failed migration at startup.
3. `curl -fsS https://$DOMAIN/health/ready` from the VPS. `503` names the
   failing dependency (`database` or `redis`).
4. If the API is healthy but the SPA monitor is red, check `web` and the Caddy
   access log for 5xx responses.
5. If a deploy caused it, roll back with `scripts/deploy.sh` (it keeps the
   previous image tag) and record the incident.
