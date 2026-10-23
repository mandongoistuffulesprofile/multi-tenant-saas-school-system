#!/usr/bin/env bash
# Restore a dump into a scratch database and prove it contains the baseline.
#
#   DATABASE_URL=postgres://... ./scripts/verify_backup.sh /var/backups/skulapp/x.dump
#
# Requires CREATEDB. The scratch database is dropped afterwards.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
[[ $# -eq 1 ]] || { echo "usage: $0 <backup.dump>" >&2; exit 1; }
file="$1"
[[ -f "$file" ]] || { echo "no such file: $file" >&2; exit 1; }

scratch="skulapp_restore_$(date +%s)"
base="${DATABASE_URL%/*}"
query="${DATABASE_URL#*\?}"
scratch_url="$base/$scratch"
[[ "$query" != "$DATABASE_URL" ]] && scratch_url="$scratch_url?$query"

cleanup() {
  psql "$DATABASE_URL" -q -c "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql "$DATABASE_URL" -q -c "CREATE DATABASE \"$scratch\""
pg_restore --dbname="$scratch_url" --no-owner --no-privileges --exit-on-error "$file"

tables="$(psql "$scratch_url" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
migrations="$(psql "$scratch_url" -tAc "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo 0)"

echo "restored tables=$tables migrations=$migrations"
[[ "$tables" -ge 100 ]] || { echo "restore check failed: expected >=100 tables" >&2; exit 1; }

# The tenant isolation policy must exist after a restore.
policies="$(psql "$scratch_url" -tAc "SELECT count(*) FROM pg_policies WHERE schemaname='public'")"
echo "policies=$policies"
[[ "$policies" -ge 50 ]] || { echo "restore check failed: RLS policies missing" >&2; exit 1; }

echo "backup verified"
