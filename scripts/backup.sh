#!/usr/bin/env bash
# Nightly logical backup with integrity check and retention.
#
#   DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/skulapp ./scripts/backup.sh
#
# For RLS-enforced databases, pg_dump must run as a superuser (or a role with
# pg_read_all_rows). Set ADMIN_DATABASE_URL to that connection; otherwise it
# falls back to DATABASE_URL. ADMIN_DATABASE_URL is also used by verify_backup.sh
# so the restore drill can create/drop scratch databases.
#
# Schedule with cron (02:15 UTC) or a systemd timer. Restore drills are in
# scripts/verify_backup.sh; a backup that has never been restored is a guess.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
# pg_dump needs to bypass RLS. Use an admin/superuser URL when available.
DUMP_URL="${ADMIN_DATABASE_URL:-$DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/skulapp}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
umask 077

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/skulapp-$timestamp.dump"

echo "backing up to $file"
pg_dump "$DUMP_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$file"

sha256sum "$file" > "$file.sha256"

# Optional off-host copy. Set BACKUP_S3=s3://bucket/prefix and install awscli.
# Cloudflare R2 is S3-compatible: configure the AWS CLI with R2 credentials and
#   AWS_ENDPOINT_URL=https://<accountid>.r2.cloudflarestorage.com
if [[ -n "${BACKUP_S3:-}" ]]; then
  command -v aws >/dev/null || { echo "BACKUP_S3 set but aws CLI is missing" >&2; exit 1; }
  aws s3 cp "$file" "$BACKUP_S3/" --only-show-errors
  aws s3 cp "$file.sha256" "$BACKUP_S3/" --only-show-errors
fi

find "$BACKUP_DIR" -maxdepth 1 -name 'skulapp-*.dump' -mtime "+$RETENTION_DAYS" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'skulapp-*.dump.sha256' -mtime "+$RETENTION_DAYS" -print -delete

echo "backup complete: $(du -h "$file" | cut -f1)"