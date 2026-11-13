#!/usr/bin/env bash
#
# One-command local development launcher.
#
#   ./launch_all.sh              # Vite dev server (no service worker)
#   PWA=1 ./launch_all.sh        # production build + preview (offline-capable)
#
# What it does:
#   1. Uses the local PostgreSQL/Redis if they are already running.
#      If they are missing it starts them with the dev Docker Compose stack.
#   2. Applies migrations (and the idempotent demo seed).
#   3. Creates dev demo accounts if they do not exist and prints their
#      generated passwords once. Set RESET_DEMO_PASSWORD=1 to rotate them.
#   4. Starts the Go API on :8080 and Vite on :5173, waits for both health
#      checks, then prints the URLs and credentials.
#
# PWA=1 builds the frontend and serves dist via `vite preview`. The service
# worker only registers in a production build, so this is the mode to use for
# offline testing. It needs port 5173 free: a Vite dev server has no worker.
#
# It never kills whatever is already listening on 5432/6379, and it reuses a
# healthy API/frontend on 8080/5173 instead of starting duplicates.
#
# Stop with Ctrl+C. PostgreSQL and Redis are left running.

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOG_DIR="$ROOT/logs"
COMPOSE_FILE="$ROOT/infrastructure/docker/docker-compose.yml"

DB_URL="${DATABASE_URL:-postgres://school_admin:dev_secret_password@127.0.0.1:5432/school_system?sslmode=disable}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
API_PORT="${PORT:-8080}"
WEB_PORT="${FRONTEND_PORT:-5173}"
SEED="${SEED:-1}"
PWA="${PWA:-0}"
RESET_DEMO_PASSWORD="${RESET_DEMO_PASSWORD:-0}"

JWT_SIGNING_KEY="${JWT_SIGNING_KEY:-dev-signing-key-change-in-production-min-32-chars}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-dev-encryption-key-32-chars-long}"

API_PID=""
WEB_PID=""
BIN_DIR=""
DEMO_LINES=()

mkdir -p "$LOG_DIR"

say()  { printf '\033[1;36m[start]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok  ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail ]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  trap - EXIT INT TERM
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [ -n "$WEB_PID" ] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [ -n "$BIN_DIR" ]; then
    rm -rf "$BIN_DIR"
  fi
  wait 2>/dev/null || true
  printf '\n'
  say "Local API/frontend stopped. PostgreSQL and Redis were left running."
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

api_healthy() {
  curl -fsS --max-time 2 "http://127.0.0.1:${API_PORT}/health" 2>/dev/null \
    | grep -q '"status":"healthy"'
}

web_healthy() {
  curl -fsS --max-time 2 "http://127.0.0.1:${WEB_PORT}/" 2>/dev/null \
    | grep -qi 'id="root"'
}

wait_for() { # wait_for <seconds> <function>
  local seconds="$1" fn="$2" i=0
  until "$fn"; do
    i=$((i + 1))
    [ "$i" -ge "$seconds" ] && return 1
    sleep 1
  done
  return 0
}

pg_ready() {
  pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

COMPOSE_CMD=()
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
  fi
fi

compose() {
  [ "${#COMPOSE_CMD[@]}" -gt 0 ] || return 1
  "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" "$@"
}

db_query() {
  psql "$DB_URL" -tAc "$1" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 1. PostgreSQL
# ---------------------------------------------------------------------------
if pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
  ok "PostgreSQL is already running on 127.0.0.1:5432."
elif port_open 5432; then
  die "Port 5432 is occupied but PostgreSQL is not accepting connections. Fix that service first."
elif docker_ready; then
  say "PostgreSQL is not running; starting it with Docker Compose..."
  compose up -d postgres >/dev/null
  wait_for 60 pg_ready \
    || die "PostgreSQL did not become ready within 60s."
  ok "PostgreSQL started with Docker."
else
  die "PostgreSQL is not running and Docker is unavailable. Start PostgreSQL, then re-run."
fi

if ! db_query 'SELECT 1' >/dev/null; then
  cat >&2 <<EOF

[fail] PostgreSQL is up, but this connection string is not usable:
       $DB_URL

Create the development role and database once (as a Postgres superuser):

  sudo -u postgres psql -c "CREATE USER school_admin WITH PASSWORD 'dev_secret_password';"
  sudo -u postgres psql -c "CREATE DATABASE school_system OWNER school_admin;"

EOF
  exit 1
fi
ok "Database connection works."

# ---------------------------------------------------------------------------
# 2. Redis (optional, but rate limiting is degraded without it)
# ---------------------------------------------------------------------------
if redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; then
  ok "Redis is already running on 127.0.0.1:6379."
elif ! port_open 6379 && docker_ready; then
  say "Redis is not running; starting it with Docker Compose..."
  compose up -d redis >/dev/null
  for _ in $(seq 1 30); do
    if redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; then
      break
    fi
    sleep 1
  done
  if redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; then
    ok "Redis started with Docker."
  else
    warn "Redis did not start; continuing without it (rate limits fall back)."
  fi
else
  warn "Redis is not reachable on 127.0.0.1:6379; continuing without it."
fi

# ---------------------------------------------------------------------------
# 3. Migrations + demo seed
# ---------------------------------------------------------------------------
say "Applying migrations$([ "$SEED" = "1" ] && echo " and demo seed")..."
MIGRATE_ARGS=(-dir ../migrations)
[ "$SEED" = "1" ] && MIGRATE_ARGS+=(-seed)
if ! ( cd "$BACKEND" && DATABASE_URL="$DB_URL" APP_ENV=development \
       go run ./cmd/migrate "${MIGRATE_ARGS[@]}" ); then
  die "Migrations failed. Fix the error above and re-run."
fi
ok "Schema is up to date."

# ---------------------------------------------------------------------------
# 4. Demo accounts. Passwords are generated and printed once; nothing is
#    stored in the repository. Existing accounts are left alone unless
#    RESET_DEMO_PASSWORD=1 is set.
# ---------------------------------------------------------------------------
ensure_demo_user() {
  local label="$1" email="$2" phone="$3" role="$4" tenant="$5"

  if [ "$(db_query "SELECT 1 FROM users WHERE lower(email) = lower('$email') LIMIT 1")" = "1" ] \
     && [ "$RESET_DEMO_PASSWORD" != "1" ]; then
    DEMO_LINES+=("$label: $email (existing account; run RESET_DEMO_PASSWORD=1 ./launch_all.sh to rotate)")
    return
  fi

  local out password
  if ! out=$( cd "$BACKEND" && \
      DATABASE_URL="$DB_URL" \
      DEV_EMAIL="$email" DEV_PHONE="$phone" DEV_ROLE="$role" DEV_TENANT="$tenant" \
      go run ./cmd/devuser 2>&1 ); then
    warn "Could not create $email:"
    printf '%s\n' "$out" | tail -n 5
    return
  fi
  password=$(printf '%s\n' "$out" | sed -n 's/^Generated password (shown once): //p' | tail -n 1)
  if [ -z "$password" ]; then
    warn "Created $email but could not read the generated password."
    return
  fi
  DEMO_LINES+=("$label: $email / $password   (school code: $tenant)")
}

say "Preparing demo accounts..."
ensure_demo_user "School admin" "admin@demo.test"    "254700000001" "SCHOOL_ADMIN" "demo-school"
ensure_demo_user "SaaS admin"   "platform@demo.test" "254700000009" "SAAS_ADMIN"   "platform-ops"
ok "Demo accounts ready."

# ---------------------------------------------------------------------------
# 5. Backend
# ---------------------------------------------------------------------------
if api_healthy; then
  ok "API is already running on http://127.0.0.1:${API_PORT}."
elif port_open "$API_PORT"; then
  die "Port ${API_PORT} is in use by a process that is not our API. Stop it and re-run."
else
  BIN_DIR="$(mktemp -d)"
  say "Building the API..."
  ( cd "$BACKEND" && go build -o "$BIN_DIR/api" ./cmd/api )
  say "Starting the API on :${API_PORT}..."
  (
    cd "$BACKEND"
    DATABASE_URL="$DB_URL" \
    REDIS_URL="$REDIS_URL" \
    PORT="$API_PORT" \
    APP_ENV=development \
    JWT_SIGNING_KEY="$JWT_SIGNING_KEY" \
    ENCRYPTION_KEY="$ENCRYPTION_KEY" \
    CORS_ALLOWED_ORIGIN="http://127.0.0.1:${WEB_PORT}" \
    "$BIN_DIR/api"
  ) >"$LOG_DIR/backend.log" 2>&1 &
  API_PID=$!
  if ! wait_for 60 api_healthy; then
    tail -n 40 "$LOG_DIR/backend.log" >&2 || true
    die "API did not become healthy. See $LOG_DIR/backend.log."
  fi
  ok "API is healthy."
fi

# ---------------------------------------------------------------------------
# 6. Frontend
# ---------------------------------------------------------------------------
if web_healthy; then
  if [ "$PWA" = "1" ] && ! curl -fsS "http://127.0.0.1:${WEB_PORT}/sw.js" 2>/dev/null | grep -q "BUILD_REVISION = '"; then
    die "Port ${WEB_PORT} is serving a Vite dev build (no service worker). Stop it and re-run with PWA=1."
  fi
  ok "Frontend is already running on http://127.0.0.1:${WEB_PORT}."
elif port_open "$WEB_PORT"; then
  die "Port ${WEB_PORT} is in use by a process that is not our frontend. Stop it and re-run."
else
  if [ ! -d "$FRONTEND/node_modules" ]; then
    say "Installing frontend dependencies (first run only)..."
    ( cd "$FRONTEND" && npm ci )
  fi
  if [ "$PWA" = "1" ]; then
    say "Building the frontend (PWA mode)..."
    ( cd "$FRONTEND" && npm run build )
    say "Starting the production frontend on :${WEB_PORT}..."
    (
      cd "$FRONTEND"
      exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port "$WEB_PORT" --strictPort
    ) >"$LOG_DIR/frontend.log" 2>&1 &
  else
    say "Starting the frontend on :${WEB_PORT}..."
    (
      cd "$FRONTEND"
      exec ./node_modules/.bin/vite --host 127.0.0.1 --port "$WEB_PORT" --strictPort
    ) >"$LOG_DIR/frontend.log" 2>&1 &
  fi
  WEB_PID=$!
  if ! wait_for 60 web_healthy; then
    tail -n 40 "$LOG_DIR/frontend.log" >&2 || true
    die "Frontend did not become ready. See $LOG_DIR/frontend.log."
  fi
  ok "Frontend is ready."
fi

# ---------------------------------------------------------------------------
# 7. Summary
# ---------------------------------------------------------------------------
printf '\n\033[1;32m============================================================\033[0m\n'
printf '\033[1;32m  SkulApp is running\033[0m\n'
printf '\033[1;32m============================================================\033[0m\n'
printf '  Frontend : http://127.0.0.1:%s\n' "$WEB_PORT"
if [ "$PWA" = "1" ]; then
  printf '  Mode     : PWA production build (service worker enabled)\n'
else
  printf '  Mode     : Vite dev (no service worker; not offline-capable)\n'
fi
printf '  API      : http://127.0.0.1:%s/health\n' "$API_PORT"
printf '  Logs     : %s/backend.log , %s/frontend.log\n' "$LOG_DIR" "$LOG_DIR"
printf '\n'
printf '  Login credentials (development only):\n'
if [ "${#DEMO_LINES[@]}" -eq 0 ]; then
  printf '    (no demo accounts were prepared)\n'
else
  for line in "${DEMO_LINES[@]}"; do
    printf '    %s\n' "$line"
  done
fi
printf '\n'
printf '  Passwords are shown once. To rotate them:\n'
printf '    RESET_DEMO_PASSWORD=1 ./launch_all.sh\n'
printf '  Run without demo data:\n'
printf '    SEED=0 ./launch_all.sh\n'
printf '  Offline-capable PWA (service worker):\n'
printf '    PWA=1 ./launch_all.sh\n'
printf '  Stop: Ctrl+C\n'
printf '\033[1;32m============================================================\033[0m\n\n'

while :; do
  if [ -n "$API_PID" ] && ! kill -0 "$API_PID" 2>/dev/null; then
    tail -n 20 "$LOG_DIR/backend.log" >&2 || true
    die "API stopped unexpectedly."
  fi
  if [ -n "$WEB_PID" ] && ! kill -0 "$WEB_PID" 2>/dev/null; then
    tail -n 20 "$LOG_DIR/frontend.log" >&2 || true
    die "Frontend stopped unexpectedly."
  fi
  sleep 2
done
