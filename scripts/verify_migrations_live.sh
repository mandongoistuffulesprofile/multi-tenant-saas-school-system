#!/usr/bin/env bash
# Verify that the full migration chain applies to a clean PostgreSQL, that the
# DB-dependent Go tests pass as a role that does not bypass RLS, and that
# cmd/rlscheck finds no isolation gaps on the result.
#
# The application role is skulapp_app because 0031 grants EXECUTE on
# auth_lookup_credentials to that name and revokes it from PUBLIC; a role called
# anything else fails TestCreateTenantStoresLoginLookupFields with "permission
# denied for function", which is a broken harness rather than a broken schema.
#
# Requires Docker. Usage: scripts/verify_migrations_live.sh
set -euo pipefail

CONTAINER_NAME="shule_migration_test_pg"
TEST_PORT="${TEST_PORT:-5433}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-testpassword}"
DB_NAME="school_system_test"
APP_ROLE="skulapp_app"
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

# initdb runs a temporary server on the socket and shuts it down, so pg_isready
# inside the container reports ready before the real server listens on TCP and
# the first migration dies with "read: connection reset by peer". Wait for a
# query that actually reaches the database from the host instead.
for _ in $(seq 1 90); do
    if PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$TEST_PORT" \
        -U postgres -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$TEST_PORT" \
    -U postgres -d "$DB_NAME" -tAc 'select 1' >/dev/null

ADMIN_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${TEST_PORT}/${DB_NAME}?sslmode=disable"
TEST_URL="postgres://${APP_ROLE}:${POSTGRES_PASSWORD}@127.0.0.1:${TEST_PORT}/${DB_NAME}?sslmode=disable"

echo "==> 2. Applying every root migration as the database owner"
(
    cd "$ROOT_DIR/backend"
    DATABASE_URL="$ADMIN_URL" go run ./cmd/migrate -dir ../migrations
)

echo "==> 3. Creating the non-superuser application role (RLS is bypassed by superusers)"
docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" <<SQL
DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${POSTGRES_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
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

echo "==> 5. Checking tenant isolation as ${APP_ROLE}"
(
    cd "$ROOT_DIR/backend"
    DATABASE_URL="$TEST_URL" go run ./cmd/rlscheck
)

echo "==> 6. Removing the test container"
cleanup
trap - EXIT
echo "==> ALL MIGRATIONS, TESTS AND ISOLATION CHECKS PASSED CLEANLY"