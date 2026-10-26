#!/usr/bin/env bash
# ==============================================================================
# Master Restoration & Dev Runner
# 1. Restores original UI/UX by removing shadowing .jsx files
# 2. Fixes package.json typos (rate-limit-redis & compression)
# 3. Runs Postgres on 5433 (no sudo, wait for permanent daemon)
# 4. Runs Backend on 8080 (aligning with Vite proxy)
# ==============================================================================
set -euo pipefail

echo "==> [1/5] Restoring original UI/UX (Removing shadowing entrypoint files)..."
rm -f "frontend/src/App.jsx"
rm -f "frontend/src/main.jsx"

# If index.html was altered, restore it from Git
if git status --porcelain | grep -q "frontend/index.html"; then
  git checkout HEAD -- "frontend/index.html" 2>/dev/null || true
fi

echo "==> [2/5] Fixing package.json dependency typos..."
# Fix package typos across all project package.json files
find . -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" -exec sed -i \
  -e 's/"rate-limiter-redis": "[^"]*"/"rate-limit-redis": "^4.2.0"/g' \
  -e 's/"compression": "[^"]*"/"compression": "^1.7.4"/g' {} +

# Clear any corrupted lockfiles
rm -f package-lock.json frontend/package-lock.json backend/package-lock.json

echo "==> [3/5] Starting PostgreSQL container on port 5433..."
docker rm -f school_saas_dev_db >/dev/null 2>&1 || true

docker run --name school_saas_dev_db \
  -e POSTGRES_DB=school_saas_production \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 \
  -d postgres:15-alpine >/dev/null

echo "Waiting for PostgreSQL initialization to fully complete..."
# Wait for the entrypoint to finish its temporary shutdown and execute permanent startup
until docker logs school_saas_dev_db 2>&1 | grep -q "PostgreSQL init process complete; ready for start up."; do
  sleep 1
done

# Wait for permanent server to accept queries
until docker exec school_saas_dev_db pg_isready -U postgres -d school_saas_production >/dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL permanent engine is online."

echo "==> Applying database schema migrations..."
docker exec -i school_saas_dev_db psql -U postgres -d school_saas_production \
  < "backend/src/database/migrations/001_core_saas_schema.sql"

echo "==> Running tenant & student seeder..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/school_saas_production" \
node "backend/src/database/seed_tenant.js" demo "Alliance High School"

echo "==> [4/5] Booting Backend API on Port 8080..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/school_saas_production" \
PORT=8080 \
node --watch "backend/src/server.js" &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true; exit 0" INT TERM EXIT

# Give backend a moment to bind port 8080
sleep 2

echo "==> [5/5] Launching Frontend with original design & workflows..."
echo ""
echo "===================================================================="
echo "🎉 SYSTEM RESTORED & ONLINE!"
echo "   Backend:  http://localhost:8080/health"
echo "   Frontend: http://localhost:5173"
echo "===================================================================="
echo ""

cd "frontend"
npm run dev || npm start
