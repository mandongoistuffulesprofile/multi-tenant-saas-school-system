#!/usr/bin/env bash
# Destructive restore. Stop the API first so no writes race the restore.
#
#   CONFIRM_RESTORE=yes DATABASE_URL=postgres://... ./scripts/restore.sh backup.dump
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${CONFIRM_RESTORE:?Set CONFIRM_RESTORE=yes to acknowledge this overwrites the database}"
[[ "$CONFIRM_RESTORE" == "yes" ]] || { echo "refusing to restore" >&2; exit 1; }
[[ $# -eq 1 ]] || { echo "usage: $0 <backup.dump>" >&2; exit 1; }

file="$1"
[[ -f "$file" ]] || { echo "no such file: $file" >&2; exit 1; }

if [[ -f "$file.sha256" ]]; then
  echo "verifying checksum"
  sha256sum --check "$file.sha256"
fi

echo "restoring $file"
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --single-transaction \
  "$file"

echo "restore complete; run /health/ready and a tenant smoke check next"
