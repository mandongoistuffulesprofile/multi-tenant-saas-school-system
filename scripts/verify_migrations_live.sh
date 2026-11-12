#!/usr/bin/env bash
# Verify that the full migration chain applies to a clean PostgreSQL and that
# the DB-dependent isolation/report/finance tests pass against it.
#
# Requires Docker. Usage: scripts/verify_migrations_live.sh
set -euo pipefail

CONTAINER_NAME="shule_migration_test_pg"
TEST_PORT="${TEST_PORT:-5433}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-testpassword}"
DB_NAME="school_system_test"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> 1. Starting isolated PostgreSQL"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run --name "$CONTAINER_NAME" \
    -e POSTGRES_USER=school_admin \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    -p "${TEST_PORT}:5432" \
    -d postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
    if docker exec "$CONTAINER_NAME" pg_isready -U school_admin -d "$DB_NAME" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
docker exec "$CONTAINER_NAME" pg_isready -U school_admin -d "$DB_NAME" >/dev/null

export DATABASE_URL="postgres://school_admin:${POSTGRES_PASSWORD}@127.0.0.1:${TEST_PORT}/${DB_NAME}?sslmode=disable"
export TEST_DATABASE_URL="$DATABASE_URL"

echo "==> 2. Applying every root migration (0000 … 0038)"
(
    cd "$ROOT_DIR/backend"
    go run ./cmd/migrate -dir ../migrations
)

echo "==> 3. Running DB-dependent Go tests"
(
    cd "$ROOT_DIR/backend"
    go test ./...
)

echo "==> 4. Removing the test container"
cleanup
trap - EXIT
echo "==> ALL MIGRATIONS AND TESTS PASSED CLEANLY"
