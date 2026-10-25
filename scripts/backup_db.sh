#!/usr/bin/env bash
# ==============================================================================
# Multi-Tenant School SaaS: Automated Database Backup & Retention Script
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/school_saas}"
DATE_STAMP=$(date +"%Y%m%d_%H%M%S")
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-school_saas_production}"
DB_USER="${DB_USER:-postgres}"
RETENTION_DAYS=7
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE_STAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

S3_BUCKET="${S3_BACKUP_BUCKET:-}"

mkdir -p "${BACKUP_DIR}"
touch "${LOG_FILE}"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

log "INFO: Starting backup for database: ${DB_NAME} on ${DB_HOST}:${DB_PORT}..."

if PGPASSWORD="${DB_PASSWORD:-}" pg_dump \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -F p \
    --no-owner \
    --clean \
    "${DB_NAME}" | gzip -9 > "${BACKUP_FILE}"; then

    chmod 600 "${BACKUP_FILE}"
    FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    log "SUCCESS: Backup created at ${BACKUP_FILE} (Size: ${FILE_SIZE})"
else
    log "ERROR: Database backup failed!"
    exit 1
fi

if [[ -n "${S3_BUCKET}" ]]; then
    log "INFO: Syncing ${BACKUP_FILE} to s3://${S3_BUCKET}/ ..."
    if aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/backups/${DB_NAME}_${DATE_STAMP}.sql.gz"; then
        log "SUCCESS: Uploaded backup to S3."
    else
        log "WARNING: S3 upload failed. Local copy remains intact."
    fi
fi

log "INFO: Pruning backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR}..."
DELETED_COUNT=$(find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -type f -mtime +"${RETENTION_DAYS}" -print -delete | wc -l)
log "INFO: Pruned ${DELETED_COUNT} outdated backup archive(s)."

log "INFO: Backup process completed successfully."
exit 0
