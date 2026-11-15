#!/usr/bin/env bash
# Seeds the demo tenant, serves the API and the built frontend, then runs the
# screenshot harness over a critical route set: a non-2xx response or missing
# endpoint on those pages fails the run. Assumes frontend dependencies are
# installed, `npm run build` has run, and DATABASE_URL, REDIS_URL,
# JWT_SIGNING_KEY and ENCRYPTION_KEY are set.
#
# Environment overrides: DEMO_EMAIL, DEMO_PASSWORD, DEMO_TENANT, API_PORT,
# PREVIEW_PORT, CHROME, PUPPETEER_ROOT, CAPTURE_ONLY.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="${RUNNER_TEMP:-/tmp}"
API_LOG="$TMP/api.log"
PREVIEW_LOG="$TMP/preview.log"

DEMO_EMAIL="${DEMO_EMAIL:-admin@demo.test}"
DEMO_PASSWORD="${DEMO_PASSWORD:-ShuleYetu2026!Demo}"
DEMO_TENANT="${DEMO_TENANT:-demo-school}"
DEMO_GUARDIAN_PHONE="${DEMO_GUARDIAN_PHONE:-254700000003}"
PLATFORM_TENANT="${PLATFORM_TENANT:-platform-ops}"
API_PORT="${API_PORT:-8080}"
PREVIEW_PORT="${PREVIEW_PORT:-4173}"
PUPPETEER_ROOT="${PUPPETEER_ROOT:-$TMP/shots}"
SHOT_DIR="$TMP/screenshots"

# Public pages plus the admin and parent surfaces that touch the most
# endpoints: money, people, attendance, curriculum, the gate console and every
# parent page. The full sweep below runs the remaining routes.
CAPTURE_ONLY="${CAPTURE_ONLY:-^/login$|^/forgot-password$|^/dashboard$|^/learners$|^/staff$|^/attendance$|^/calendar$|^/finance/invoices$|^/finance/payments$|^/finance/reconciliation$|^/reports$|^/curriculum$|^/gate/admin$|^/parent$|^/parent/fees$|^/parent/attendance$|^/parent/receipts$|^/parent/progress$|^/parent/consents$|^/parent/notices$|^/parent/child$}"

CHROME="${CHROME:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || true)}"

fail() {
  echo "screenshot-smoke: $*" >&2
  exit 1
}

[ -n "$CHROME" ] || fail "no Chrome found; set CHROME or install google-chrome"

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# A listener we did not start answers / with a 200 just as convincingly as ours,
# which once let a run capture screenshots of an unrelated server. Refuse to
# start rather than test against whatever already holds the port.
for port in "$API_PORT" "$PREVIEW_PORT"; do
  port_busy "$port" && fail "port $port is already in use; stop that process first"
done

API_PID=""
PREVIEW_PID=""

# Gin's debug dump drowns a stack trace; show the rest.
log_tail() {
  local file=$1 lines=$2
  [ -f "$file" ] || return 0
  grep -v '^\[GIN-debug\]' "$file" | tail -"$lines" || true
}

cleanup() {
  local status=$?
  for pid in "$PREVIEW_PID" "$API_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  if [ "$status" -ne 0 ]; then
    echo "--- api.log (tail) ---" >&2
    log_tail "$API_LOG" 30 >&2
    echo "--- preview.log (tail) ---" >&2
    log_tail "$PREVIEW_LOG" 10 >&2
  fi
}
trap cleanup EXIT

# Polls until the URL answers, but gives up immediately if the process behind
# it has already exited — otherwise a server that failed to bind reports as a
# minute of timeouts, and a stale listener on that port can look healthy.
wait_for() {
  local url=$1 label=$2 pid=$3 log=$4
  for _ in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "--- $log (tail) ---" >&2
      log_tail "$log" 20 >&2
      fail "$label exited before answering at $url"
    fi
    curl -fsS -o /dev/null "$url" 2>/dev/null && return 0
    sleep 1
  done
  fail "$label did not answer at $url"
}

echo "== migrating and seeding the demo tenant"
# -seed also applies migrations/seed/*.sql, which creates demo-school and one
# learner. It deliberately seeds no users, so the account below is created here
# with a fixed password instead of whatever devuser would generate.
(cd "$ROOT/backend" && go run ./cmd/migrate -dir ../migrations -seed)

echo "== creating demo personas"
# One account per persona in routes.mjs. The parent account is linked to the
# seeded guardian so /parent, /me/linked-learners and the fee pages have rows.
create_user() {
  local email=$1 phone=$2 role=$3 tenant=$4 guardian_phone=${5:-}
  (cd "$ROOT/backend" && \
    DEV_EMAIL="$email" DEV_PHONE="$phone" DEV_ROLE="$role" DEV_TENANT="$tenant" \
    DEV_PASSWORD="$DEMO_PASSWORD" DEV_GUARDIAN_PHONE="$guardian_phone" \
    go run ./cmd/devuser)
}
create_user "$DEMO_EMAIL" 254700000001 SCHOOL_ADMIN "$DEMO_TENANT"
create_user "teacher@demo.test" 254700000002 TEACHER "$DEMO_TENANT"
create_user "parent@demo.test" "$DEMO_GUARDIAN_PHONE" PARENT "$DEMO_TENANT" "$DEMO_GUARDIAN_PHONE"
create_user "platform@demo.test" 254700000009 SAAS_ADMIN "$PLATFORM_TENANT"

echo "== building and starting the API"
(cd "$ROOT/backend" && go build -o "$TMP/api" ./cmd/api)
PORT="$API_PORT" "$TMP/api" >"$API_LOG" 2>&1 &
API_PID=$!
wait_for "http://127.0.0.1:$API_PORT/health/ready" "API" "$API_PID" "$API_LOG"
echo "   API ready on :$API_PORT (pid $API_PID)"

echo "== starting the frontend build on :$PREVIEW_PORT"
# exec so the recorded PID is vite itself: killing a wrapper subshell would
# leave the server holding the port and poison the next run.
(cd "$ROOT/frontend" && exec ./node_modules/.bin/vite preview --port "$PREVIEW_PORT" --strictPort --host 127.0.0.1 >"$PREVIEW_LOG" 2>&1) &
PREVIEW_PID=$!
wait_for "http://127.0.0.1:$PREVIEW_PORT/" "frontend preview" "$PREVIEW_PID" "$PREVIEW_LOG"

# The browser talks to the preview origin, which proxies /api to the API. Prove
# that path works before spending time on screenshots. The response body holds
# a real access token, so only selected fields reach the artifact and the body
# is deleted.
echo "== checking login through the preview proxy"
login_status=$(curl -sS -D "$TMP/login.headers" -o "$TMP/login.json" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PREVIEW_PORT/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}" || true)
if grep -qi 'set-cookie: access_token=' "$TMP/login.headers" 2>/dev/null; then
  cookie_state="set"
else
  cookie_state="MISSING"
fi
{
  echo "login as $DEMO_EMAIL via the preview proxy: HTTP ${login_status:-no response}"
  echo "access_token cookie: $cookie_state"
  grep -o '"tenant_id":"[^"]*"' "$TMP/login.json" 2>/dev/null || true
  grep -o '"roles":\[[^]]*\]' "$TMP/login.json" 2>/dev/null || true
} >"$TMP/login-summary.txt" 2>&1
rm -f "$TMP/login.json" "$TMP/login.headers"

if [ "$login_status" != "200" ]; then
  cat "$TMP/login-summary.txt" >&2
  fail "login through the preview proxy returned HTTP ${login_status:-none}"
fi
# The harness authenticates with this cookie, so a 200 without it would only
# surface later as every route rendering the login page.
[ "$cookie_state" = "set" ] || {
  cat "$TMP/login-summary.txt" >&2
  fail "login returned 200 but set no access_token cookie"
}
echo "   login works"

rm -rf "$SHOT_DIR"
echo "== capturing critical routes"
node "$ROOT/scripts/ui-screenshots/capture.mjs" \
  --base-url "http://127.0.0.1:$PREVIEW_PORT" \
  --api-url "http://127.0.0.1:$API_PORT" \
  --out "$SHOT_DIR" \
  --only "$CAPTURE_ONLY" \
  --chrome "$CHROME" \
  --puppeteer-root "$PUPPETEER_ROOT"

echo "== screenshots and capture-report.json are in $SHOT_DIR"

# The focused capture above is the review artefact. This pass visits every
# route in the manifest, including the teacher and platform personas, and fails
# on a document error, an API 5xx, an uncaught page error or a blank shell.
# It caught GET /attendance/registers scanning a NULL marked_by as a string.
echo "== sweeping every route"
rm -rf "$TMP/sweep"
node "$ROOT/scripts/ui-screenshots/capture.mjs" \
  --base-url "http://127.0.0.1:$PREVIEW_PORT" \
  --api-url "http://127.0.0.1:$API_PORT" \
  --out "$TMP/sweep" \
  --sweep \
  --chrome "$CHROME" \
  --puppeteer-root "$PUPPETEER_ROOT"
