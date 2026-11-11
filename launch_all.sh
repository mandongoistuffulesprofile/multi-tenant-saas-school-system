#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# Ensure Postgres role/db exist (requires an interactive sudo session once).
if ! PGPASSWORD=dev_secret_password psql "postgres://school_admin:dev_secret_password@localhost:5432/school_system" -c "SELECT 1" >/dev/null 2>&1; then
  echo "Postgres role/db missing. Create them as a superuser, then re-run:" >&2
  echo "  sudo -u postgres psql -c \"CREATE USER school_admin WITH PASSWORD 'dev_secret_password';\"" >&2
  echo "  sudo -u postgres psql -c \"CREATE DATABASE school_system OWNER school_admin;\"" >&2
  exit 1
fi

# Backend
gnome-terminal -- bash -c "cd '$BACKEND' && set -a && . ./.env && set +a && go run ./cmd/api; exec bash" 2>/dev/null || \
xterm -e "cd '$BACKEND' && set -a && . ./.env && set +a && go run ./cmd/api" 2>/dev/null || \
konsole -e bash -c "cd '$BACKEND' && set -a && . ./.env && set +a && go run ./cmd/api; exec bash" 2>/dev/null || \
( cd "$BACKEND" && set -a && . ./.env && set +a && go run ./cmd/api & )

# Frontend
gnome-terminal -- bash -c "cd '$FRONTEND' && npm run dev; exec bash" 2>/dev/null || \
xterm -e "cd '$FRONTEND' && npm run dev" 2>/dev/null || \
konsole -e bash -c "cd '$FRONTEND' && npm run dev; exec bash" 2>/dev/null || \
( cd "$FRONTEND" && npm run dev & )

echo "Backend: http://127.0.0.1:8080  Frontend: http://127.0.0.1:5173"
