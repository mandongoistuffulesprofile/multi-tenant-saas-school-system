#!/usr/bin/env bash
# Seeds the demo tenant, serves the API and the built frontend, then runs the
# screenshot harness over a critical route set. A non-2xx response or a missing
# endpoint on any of those pages fails the run, which is the point: the
# frontend and backend have to agree over HTTP, not just compile.
#
# Assumes frontend dependencies are installed and `npm run build` has run, and
# that DATABASE_URL, REDIS_URL, JWT_SIGNING_KEY and ENCRYPTION_KEY are set.
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
API_PORT="${API_PORT:-8080}"
PREVIEW_PORT="${PREVIEW_PORT:-4173}"
CHROME="${CHROME:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || true)}"
PUPPETEER_ROOT="${PUPPETEER_ROOT:-$TMP/shots}"
SHOT_DIR="$TMP/screenshots"

# Public pages plus the admin surfaces that touch the most endpoints: money,
# people, attendance, curriculum and the gate console.
CAPTURE_ONLY="${CAPTURE_ONLY:-^/login$|^/forgot-password$|^/dashboard$|^/learners$|^/staff$|^/attendance$|^/calendar$|^/finance/invoices$|^/finance/payments$|^/finance/reconciliation$|^/reports$|^/curriculum$|^/gate/admin$}"

API_PID=""
PREVIEW_PID=""

cleanup() {
  local status=$?
  for pid in "$PREVIEW_PID" "$API_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  if [ "$status" -ne 0 ]; then
    echo "--- api log (tail) ---" >&2
    tail -40 "$API_LOG" 2>/dev/null || true
    echo "--- preview log (tail) ---" >&2
    tail -20 "$PREVIEW_LOG" 2>/dev/null || true
  fi
}
trap cleanup EXIT

fail() {
  echo "screenshot-smoke: $*" >&2
  exit 1
}

wait_for() {
  local url=$1 label=$2 attempts=${3:-60}
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "$label did not answer at $url"
}

echo "== migrating and seeding the demo tenant"
# -seed also applies migrations/seed/*.sql, which creates demo-school and one
# learner. It deliberately seeds no users, so the accounts below are created
# here with a fixed password instead of whatever devuser would generate.
(cd "$ROOT/backend" && go run ./cmd/migrate -dir ../migrations -seed)

echo "== creating $DEMO_EMAIL"
(cd "$ROOT/backend" && \
  DEV_EMAIL="$DEMO_EMAIL" DEV_PHONE="254700000001" DEV_ROLE="SCHOOL_ADMIN" \
  DEV_TENANT="$DEMO_TENANT" DEV_PASSWORD="$DEMO_PASSWORD" \
  go run ./cmd/devuser)

echo "== building and starting the API"
(cd "$ROOT/backend" && go build -o "$TMP/api" ./cmd/api)
PORT="$API_PORT" "$TMP/api" >"$API_LOG" 2>&1 &
API_PID=$!
wait_for "http://127.0.0.1:$API_PORT/health/ready" "API"
echo "   API ready on :$API_PORT (pid $API_PID)"

echo "== starting the production frontend build on :$PREVIEW_PORT"
# exec so the recorded PID is vite itself: killing a wrapper subshell would
# leave the server holding the port and poison the next run.
(cd "$ROOT/frontend" && exec ./node_modules/.bin/vite preview --port "$PREVIEW_PORT" --strictPort --host 127.0.0.1 >"$PREVIEW_LOG" 2>&1) &
PREVIEW_PID=$!
wait_for "http://127.0.0.1:$PREVIEW_PORT/" "frontend preview"

# The browser talks to the preview origin, which proxies /api to the API. Prove
# that path works before spending time on screenshots.
login_status=$(curl -sS -D "$TMP/login.headers" -o "$TMP/login.json" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PREVIEW_PORT/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}")

# Summarise the probe for the uploaded artifact. The response body carries a
# real access token, so the token itself never leaves this directory.
{
  echo "login as $DEMO_EMAIL via the preview proxy"
  echo "status: $login_status"
  if grep -qi 'set-cookie: access_token=' "$TMP/login.headers"; then
    echo "access_token cookie: set"
  else
    echo "access_token cookie: MISSING"
  fi
  node -e '
    const fs = require("node:fs");
    try {
      const b = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (b.tenant_id) console.log("tenant_id:", b.tenant_id);
      if (Array.isArray(b.roles)) console.log("roles:", b.roles.join(","));
      if (b.error) console.log("error:", b.error);
    } catch { /* non-JSON body: status line above is enough */ }
  ' "$TMP/login.json"
} > "$TMP/login-summary.txt" 2>&1 || true
rm -f "$TMP/login.json" "$TMP/login.headers"

if [ "$login_status" != "200" ]; then
  cat "$TMP/login-summary.txt" >&2 || true
  fail "login through the preview proxy returned HTTP $login_status"
fi
echo "   login through the preview proxy works"

[ -n "$CHROME" ] || fail "no Chrome found; set CHROME or install google-chrome"

echo "== capturing $(echo "$CAPTURE_ONLY" | tr '|' '\n' | wc -l) critical route(s)"
node "$ROOT/scripts/ui-screenshots/capture.mjs" \
  --base-url "http://127.0.0.1:$PREVIEW_PORT" \
  --api-url "http://127.0.0.1:$API_PORT" \
  --out "$SHOT_DIR" \
  --only "$CAPTURE_ONLY" \
  --chrome "$CHROME" \
  --puppeteer-root "$PUPPETEER_ROOT"

echo "== captured screenshots are in $SHOT_DIR"
