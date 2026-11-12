#!/usr/bin/env bash
set -euo pipefail

# Provision dedicated bypass role for automated pg_dump operations
# This resolves the backup failure where FORCE ROW LEVEL SECURITY produces
# empty table dumps when executed by the table owner.

# Usage: BACKUP_ROLE_PASSWORD=<password> ./provision_backup_role.sh

if [ -z "${BACKUP_ROLE_PASSWORD:-}" ]; then
    echo "ERROR: BACKUP_ROLE_PASSWORD environment variable must be set"
    exit 1
fi

if [ -z "${DATABASE_URL:-}" ] && [ -z "${POSTGRES_DB:-}" ]; then
    echo "ERROR: DATABASE_URL or POSTGRES_DB environment variable must be set"
    exit 1
fi

# Parse DATABASE_URL if provided, otherwise use individual PG* vars
if [ -n "${DATABASE_URL:-}" ]; then
    # Extract components from DATABASE_URL
    # postgres://user:pass@host:port/dbname
    PGPASSWORD="${BACKUP_ROLE_PASSWORD}" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<-EOSQL
EOSQL
else
    PGPASSWORD="${BACKUP_ROLE_PASSWORD}" psql \
        -h "${PGHOST:-localhost}" \
        -p "${PGPORT:-5432}" \
        -U "${PGUSER:-postgres}" \
        -d "${POSTGRES_DB}" \
        -v ON_ERROR_STOP=1 <<-EOSQL
EOSQL
fi

# The actual SQL commands
PGPASSWORD="${BACKUP_ROLE_PASSWORD}" psql \
    ${DATABASE_URL:+$DATABASE_URL} \
    ${PGHOST:+-h $PGHOST} \
    ${PGPORT:+-p $PGPORT} \
    ${PGUSER:+-U $PGUSER} \
    ${POSTGRES_DB:+-d $POSTGRES_DB} \
    -v ON_ERROR_STOP=1 <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'shule_backup') THEN
            CREATE ROLE shule_backup WITH LOGIN PASSWORD '${BACKUP_ROLE_PASSWORD}';
        ELSE
            ALTER ROLE shule_backup WITH PASSWORD '${BACKUP_ROLE_PASSWORD}';
        END IF;
    END
    \$\$;

    ALTER ROLE shule_backup BYPASSRLS;
    GRANT CONNECT ON DATABASE ${POSTGRES_DB:-school_system} TO shule_backup;
    GRANT USAGE ON SCHEMA public TO shule_backup;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO shule_backup;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO shule_backup;

    -- Verify the role was created correctly
    SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'shule_backup';
EOSQL

echo "Backup role 'shule_backup' provisioned successfully with BYPASSRLS"
echo "Use this role for pg_dump operations:"
echo "  pg_dump -U shule_backup -h <host> -d <db> > backup.sql"