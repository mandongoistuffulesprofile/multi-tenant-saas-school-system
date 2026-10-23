#!/usr/bin/env bash
# One-time role provisioning. Run as a superuser (not as the application role).
#
#   ADMIN_DATABASE_URL=postgres://postgres@localhost:5432/skulapp \
#   APP_DB_PASSWORD=... ./scripts/provision_roles.sh
#
# The application keeps using the owner role for now because handlers set the
# tenant filter explicitly; a non-owner role would additionally require
# request-scoped tenant transactions. These roles prepare that step.
set -euo pipefail

: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_app') THEN
    CREATE ROLE skulapp_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_reader') THEN
    CREATE ROLE skulapp_reader NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_writer') THEN
    CREATE ROLE skulapp_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skulapp_migrator') THEN
    CREATE ROLE skulapp_migrator NOLOGIN;
  END IF;
END
\$\$;

ALTER ROLE skulapp_app PASSWORD '$APP_DB_PASSWORD';
GRANT skulapp_reader TO skulapp_app;
GRANT skulapp_writer TO skulapp_app;

GRANT CONNECT ON DATABASE skulapp TO skulapp_app, skulapp_reader, skulapp_writer, skulapp_migrator;
GRANT USAGE ON SCHEMA public TO skulapp_app, skulapp_reader, skulapp_writer, skulapp_migrator;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO skulapp_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skulapp_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skulapp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO skulapp_writer, skulapp_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO skulapp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skulapp_writer, skulapp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO skulapp_writer, skulapp_app;
SQL

echo "roles provisioned; set APP_DB_PASSWORD in the secret store"
