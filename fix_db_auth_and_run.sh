#!/usr/bin/env bash
set -euo pipefail

echo "==> [1/4] Stopping stale containers and resolving port 5432..."
# Stop existing container if present
docker rm -f school_saas_dev_db >/dev/null 2>&1 || true

# Check if native host postgresql is running and stop it to avoid port collision
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl stop postgresql 2>/dev/null || true
fi

echo "==> [2/4] Initializing clean PostgreSQL container with password 'postgres'..."
docker run --name school_saas_dev_db \
  -e POSTGRES_DB=school_saas_production \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres:15-alpine

echo "Waiting for PostgreSQL engine to accept connections..."
until docker exec school_saas_dev_db pg_isready -U postgres -d school_saas_production >/dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL container is online and verified."

echo "==> [3/4] Applying SQL Schema..."
docker exec -i school_saas_dev_db psql -U postgres -d school_saas_production \
  < "backend/src/database/migrations/001_core_saas_schema.sql"

echo "==> [4/4] Executing Seeder with verified credentials..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
node "backend/src/database/seed_tenant.js" demo "Alliance High School"

echo ""
echo "===================================================================="
echo " Starting Backend API and Frontend..."
echo "===================================================================="
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
PORT=4000 \
node --watch "backend/src/server.js" &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true; exit 0" INT TERM EXIT

cd "frontend"
npm run dev || npm start
