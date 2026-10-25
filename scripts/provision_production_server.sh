#!/usr/bin/env bash
# ==============================================================================
# One-Click Production Provisioner for Ubuntu/Debian Cloud VPS
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " Provisioning Production Multi-Tenant School SaaS Host"
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root (sudo bash provision_production_server.sh)"
  exit 1
fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "[-] Usage: sudo bash provision_production_server.sh <yourdomain.co.ke>"
  exit 1
fi

echo "[1/5] Installing Docker, Docker Compose, and Nginx..."
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx curl ufw git

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm get-docker.sh
fi

echo "[2/5] Configuring Host Firewall (UFW)..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "[3/5] Setting up Nginx Wildcard Configuration for ${DOMAIN}..."
sed -i "s/schoolsaas\.co\.ke/${DOMAIN}/g" devops/nginx/school_saas.conf
cp devops/nginx/school_saas.conf /etc/nginx/sites-available/${DOMAIN}.conf
ln -sf /etc/nginx/sites-available/${DOMAIN}.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo "[4/5] Installing Automated Database Backup Cron Job..."
BACKUP_SCRIPT_PATH="$(pwd)/scripts/backup_db.sh"
chmod +x "${BACKUP_SCRIPT_PATH}"
CRON_JOB="0 2 * * * /bin/bash ${BACKUP_SCRIPT_PATH} >> /var/log/school_saas_backup.log 2>&1"
(crontab -l 2>/dev/null | grep -Fv "${BACKUP_SCRIPT_PATH}" ; echo "${CRON_JOB}") | crontab -

echo "[5/5] Booting Production Containers..."
if [ -f ".env.production" ]; then
  docker compose -f devops/docker/docker-compose.prod.yml --env-file .env.production up -d --build
else
  echo "[!] NOTICE: .env.production not found. Copying template..."
  cp .env.production.example .env.production
  echo "[!] Edit .env.production with live credentials, then run:"
  echo "    docker compose -f devops/docker/docker-compose.prod.yml --env-file .env.production up -d --build"
fi

nginx -t && systemctl reload nginx

echo "=========================================================="
echo " Host Provisioning Completed!"
echo " Next step: Generate Wildcard SSL using Certbot DNS plugin:"
echo " certbot certonly --manual --preferred-challenges=dns -d '*.${DOMAIN}' -d '${DOMAIN}'"
echo "=========================================================="
