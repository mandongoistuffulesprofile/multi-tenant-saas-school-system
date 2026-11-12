#!/usr/bin/env bash
# Provision a fresh Ubuntu/Debian VPS for the canonical single-VPS stack.
#
#   sudo bash scripts/provision_production_server.sh schools.example.com
#
# This installs Docker + the Compose plugin, opens only SSH/80/443, generates
# infrastructure/docker/.env.prod with fresh secrets, and runs scripts/deploy.sh.
# Point the domain's A/AAAA record at this host first: the deploy script gates
# on https://<domain>/health/ready, so TLS must be able to complete.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="$ROOT/infrastructure/docker"
ENV_FILE="$DOCKER_DIR/.env.prod"

if [[ "${EUID}" -ne 0 ]]; then
  echo "please run as root (sudo bash scripts/provision_production_server.sh <domain>)" >&2
  exit 1
fi

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "usage: sudo bash scripts/provision_production_server.sh <domain>" >&2
  exit 1
fi

echo "[1/4] Installing Docker, the Compose plugin and host tools..."
apt-get update -y
apt-get install -y ca-certificates curl git openssl ufw

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-plugin
fi
systemctl enable --now docker

echo "[2/4] Configuring the host firewall (UFW)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if systemctl is-active --quiet nginx; then
  echo "WARNING: nginx is still running; stop and disable it so Caddy can bind 80/443." >&2
fi

echo "[3/4] Preparing $ENV_FILE..."
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat >"$ENV_FILE" <<EOF
DOMAIN=$DOMAIN
APP_VERSION=$(date -u +%Y%m%d%H%M%S)

POSTGRES_USER=skulapp_app
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=skulapp

# Rotating either key invalidates sessions or encrypted learner fields.
JWT_SIGNING_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Set this same value in the Daraja portal callback header.
MPESA_WEBHOOK_TOKEN=$(openssl rand -hex 32)
MPESA_ALLOWED_IPS=

# Required by /metrics; Caddy blocks /metrics publicly.
METRICS_TOKEN=$(openssl rand -hex 32)
EOF
  chmod 600 "$ENV_FILE"
  echo "generated $ENV_FILE with fresh secrets (mode 0600)"
else
  echo "keeping existing $ENV_FILE; review its DOMAIN and secrets"
fi

echo "[4/4] Building and deploying..."
APP_VERSION="${APP_VERSION:-$(date -u +%Y%m%d%H%M%S)}" DOMAIN="$DOMAIN" \
  "$ROOT/scripts/deploy.sh"

echo "done. Next: point Daraja at https://$DOMAIN/webhooks/mpesa/c2b and review docs/RUNBOOK.md."
