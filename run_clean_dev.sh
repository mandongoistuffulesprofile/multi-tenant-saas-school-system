#!/usr/bin/env bash
# ==============================================================================
# Deterministic Dev Launcher: Port 5433 (No sudo, No Docker init race condition)
# ==============================================================================
set -euo pipefail

DB_CONTAINER="school_saas_dev_db"
DB_PORT="5433"
DB_NAME="school_saas_production"
DB_USER="postgres"
DB_PASS="postgres"
DB_URL="postgres://${DB_USER}:${DB_PASS}@127.0.0.1:${DB_PORT}/${DB_NAME}"

echo "==> [1/4] Starting isolated PostgreSQL container on port ${DB_PORT}..."
docker rm -f "${DB_CONTAINER}" >/dev/null 2>&1 || true

docker run --name "${DB_CONTAINER}" \
  -e POSTGRES_DB="${DB_NAME}" \
  -e POSTGRES_USER="${DB_USER}" \
  -e POSTGRES_PASSWORD="${DB_PASS}" \
  -p "${DB_PORT}:5432" \
  -d postgres:15-alpine >/dev/null

echo "Waiting for PostgreSQL bootstrap to finish..."
# Wait for the entrypoint to finish its temporary shutdown and execute permanent startup
until docker logs "${DB_CONTAINER}" 2>&1 | grep -q "PostgreSQL init process complete; ready for start up."; do
  sleep 1
done

# Wait for permanent server to accept queries
until docker exec "${DB_CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL permanent engine is online."

echo "==> [2/4] Applying SQL Schema Migration..."
docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
  < "backend/src/database/migrations/001_core_saas_schema.sql"

echo "==> [3/4] Seeding School & Role-Based Accounts..."
DATABASE_URL="${DB_URL}" node "backend/src/database/seed_tenant.js" demo "Alliance High School"

echo "==> [4/4] Starting Backend API (Port 4000) & Frontend UI (Port 5173)..."
DATABASE_URL="${DB_URL}" \
PORT=4000 \
node --watch "backend/src/server.js" &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true; exit 0" INT TERM EXIT

echo ""
echo "===================================================================="
echo "🎉 ENVIRONMENT IS FULLY OPERATIONAL!"
echo "   URL: http://localhost:5173"
echo "===================================================================="
echo ""

cd "frontend"
npm run dev || npm start
