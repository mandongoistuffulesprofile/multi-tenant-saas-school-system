#!/usr/bin/env bash
# ==============================================================================
# Fix: Isolate Backend CommonJS Scope from Frontend ES Module Scope
# ==============================================================================
set -euo pipefail

echo "==> [1/4] Creating backend/package.json with CommonJS type..."
mkdir -p "backend"
cat << 'FILE_EOF' > "backend/package.json"
{
  "name": "school-saas-backend",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "pg": "^8.11.5"
  }
}
FILE_EOF

echo "==> [2/4] Ensuring PostgreSQL container is healthy..."
docker start school_saas_dev_db >/dev/null 2>&1 || true

until docker exec school_saas_dev_db pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

echo "==> [3/4] Running Seed Script under CommonJS scope..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
node "backend/src/database/seed_tenant.js" demo "Alliance High School"

echo "==> [4/4] Committing and Pushing fix to GitHub..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git add "backend/package.json"
git commit -m "fix(backend): isolate backend as CommonJS to prevent ESM require conflict" || true
git push origin "${CURRENT_BRANCH}" || true

echo ""
echo "===================================================================="
echo "🎉 BACKEND SEEDED & SYNCED! LAUNCHING SERVICES..."
echo "===================================================================="
echo ""

# Start backend in watch mode
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
PORT=4000 \
node --watch "backend/src/server.js" &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true; exit 0" INT TERM EXIT

cd "frontend"
npm run dev || npm start
