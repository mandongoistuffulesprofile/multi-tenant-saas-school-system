#!/usr/bin/env bash
set -euo pipefail

echo "==> [1/3] Fixing 'compression' version in all package.json files..."
# Replace invalid version "7.1.0" with the valid "^1.7.4"
find . -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" \
  -exec sed -i 's/"compression": "[^"]*"/"compression": "^1.7.4"/g' {} +

# Remove any lockfile referencing the invalid version
rm -f package-lock.json frontend/package-lock.json backend/package-lock.json

echo "==> [2/3] Installing dependencies..."
if [ -f "package.json" ]; then
  npm install --no-audit --legacy-peer-deps || true
fi

if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then
  cd frontend
  npm install --no-audit --legacy-peer-deps || true
  cd ..
fi

echo "==> [3/3] Launching Backend and Frontend..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
PORT=4000 \
node --watch "backend/src/server.js" &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true; exit 0" INT TERM EXIT

echo ""
echo "===================================================================="
echo "🎉 SERVICES ARE RUNNING!"
echo "   Backend API:  http://localhost:4000"
echo "   Frontend Web: http://localhost:5173/?tenant=demo  (or :3000)"
echo "===================================================================="
echo ""

if [ -d "frontend" ]; then
  cd frontend
  npm run dev || npm start
else
  wait $BACKEND_PID
fi
