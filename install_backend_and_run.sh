#!/usr/bin/env bash
set -euo pipefail

echo "==> [1/3] Installing backend dependencies (pg, express, cors, helmet)..."
cd "backend"
npm install --silent
cd ..

echo "==> [2/3] Running Seeder with installed pg driver..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
node "backend/src/database/seed_tenant.js" demo "Alliance High School"

echo "==> [3/3] Booting Backend API & Frontend UI..."
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
PORT=4000 \
node --watch "backend/src/server.js" &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true; exit 0" INT TERM EXIT

echo ""
echo "===================================================================="
echo "🎉 SERVICES ARE LIVE!"
echo "   Backend:  http://localhost:4000/health"
echo "   Frontend: http://localhost:5173"
echo "===================================================================="
echo ""

cd "frontend"
npm run dev || npm start
