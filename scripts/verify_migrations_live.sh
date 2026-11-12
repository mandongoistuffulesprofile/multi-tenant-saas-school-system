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
APP_ROLE="school_admin"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> 1. Starting isolated PostgreSQL"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run --name "$CONTAINER_NAME" \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    -p "${TEST_PORT}:5432" \
    -d postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
    if docker exec "$CONTAINER_NAME" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
docker exec "$CONTAINER_NAME" pg_isready -U postgres -d "$DB_NAME" >/dev/null

ADMIN_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${TEST_PORT}/${DB_NAME}?sslmode=disable"
TEST_URL="postgres://${APP_ROLE}:${POSTGRES_PASSWORD}@127.0.0.1:${TEST_PORT}/${DB_NAME}?sslmode=disable"

echo "==> 2. Applying every root migration (0000 … 0038) as the database owner"
(
    cd "$ROOT_DIR/backend"
    DATABASE_URL="$ADMIN_URL" go run ./cmd/migrate -dir ../migrations
)

echo "==> 3. Creating the non-superuser application role (RLS is bypassed by superusers)"
docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" <<SQL
DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${POSTGRES_PASSWORD}' NOSUPERUSER;
    END IF;
END \$\$;
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${APP_ROLE};
GRANT ALL ON SCHEMA public TO ${APP_ROLE};
GRANT ALL ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
SQL

echo "==> 4. Running DB-dependent Go tests as ${APP_ROLE}"
(
    cd "$ROOT_DIR/backend"
    TEST_DATABASE_URL="$TEST_URL" go test ./...
)

echo "==> 5. Removing the test container"
cleanup
trap - EXIT
echo "==> ALL MIGRATIONS AND TESTS PASSED CLEANLY"
