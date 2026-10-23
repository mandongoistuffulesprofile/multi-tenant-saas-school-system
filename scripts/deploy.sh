#!/usr/bin/env bash
# Health-gated deployment for the single-VPS Compose stack.
#
#   APP_VERSION=2026.10.23 DOMAIN=schools.example.com ./scripts/deploy.sh
#
# Requires infrastructure/docker/.env.prod (0600) and Docker Compose v2.
# The previous image tag is recorded so a failed health gate can roll back.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="$ROOT/infrastructure/docker"
ENV_FILE="${ENV_FILE:-$DOCKER_DIR/.env.prod}"
COMPOSE=(docker compose -f "$DOCKER_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")
STATE_FILE="$DOCKER_DIR/.deployed_version"

: "${APP_VERSION:?APP_VERSION is required, e.g. a git SHA or date tag}"
: "${DOMAIN:?DOMAIN is required}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE; copy .env.prod.example and fill secrets" >&2
  exit 1
fi

previous=""
if [[ -f "$STATE_FILE" ]]; then
  previous="$(cat "$STATE_FILE")"
fi

echo "==> building $APP_VERSION"
APP_VERSION="$APP_VERSION" "${COMPOSE[@]}" build --pull

echo "==> running migrations"
APP_VERSION="$APP_VERSION" "${COMPOSE[@]}" run --rm migrate

echo "==> starting stack"
APP_VERSION="$APP_VERSION" "${COMPOSE[@]}" up -d --remove-orphans

echo "==> health gate"
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/health/ready" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" -eq 1 ]]; then
  echo "$APP_VERSION" > "$STATE_FILE"
  echo "deployed $APP_VERSION"
  exit 0
fi

echo "health gate failed for $APP_VERSION" >&2
"${COMPOSE[@]}" logs --tail=100 api >&2 || true

if [[ -n "$previous" ]]; then
  echo "rolling back to $previous" >&2
  APP_VERSION="$previous" "${COMPOSE[@]}" up -d --remove-orphans
fi

exit 1
