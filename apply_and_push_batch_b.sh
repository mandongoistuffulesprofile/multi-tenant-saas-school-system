#!/usr/bin/env bash
# ==============================================================================
# Script: apply_and_push_batch_b.sh
# Purpose: Automatically injects Batch B changes (CBC Rubric + IndexedDB,
#          Nginx Daraja IP & Wildcard Rules, and DB Backup Script) and pushes to GitHub.
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " Starting Batch B Deployment: Frontend & DevOps Updates"
echo "=========================================================="

# 1. Ensure we are in a Git repository
if [ ! -d ".git" ]; then
  echo "[-] ERROR: This script must be run from the root of your git repository."
  exit 1
fi

# Detect current Git branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "[+] Detected active branch: ${CURRENT_BRANCH}"

# 2. Create required directories
echo "[+] Creating directory structure..."
mkdir -p frontend/src/services
mkdir -p frontend/src/components
mkdir -p devops/nginx
mkdir -p scripts

# ------------------------------------------------------------------------------
# 3. Create: frontend/src/services/assessmentDb.js
# ------------------------------------------------------------------------------
echo "[+] Writing frontend/src/services/assessmentDb.js..."
cat << 'FILE_EOF' > frontend/src/services/assessmentDb.js
// Native IndexedDB helper with zero external dependencies
const DB_NAME = 'SchoolCBC_DB';
const DB_VERSION = 1;
const STORE_NAME = 'rubric_assessments';

export const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('tenantId', 'tenantId', { unique: false });
        store.createIndex('syncStatus', 'syncStatus', { unique: false });
        store.createIndex('learnerSubstrand', ['studentId', 'subStrandId'], { unique: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveAssessmentOffline = async (assessment) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record = {
      ...assessment,
      id: `${assessment.tenantId}_${assessment.studentId}_${assessment.subStrandId}`,
      syncStatus: 'pending',
      updatedAt: new Date().toISOString()
    };

    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
};

export const getPendingAssessments = async (tenantId) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const pending = request.result.filter(
        (r) => r.tenantId === tenantId && r.syncStatus === 'pending'
      );
      resolve(pending);
    };
    request.onerror = () => reject(request.error);
  });
};

export const markAssessmentsSynced = async (ids) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    ids.forEach((id) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const updated = { ...getReq.result, syncStatus: 'synced' };
          store.put(updated);
        }
      };
    });

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
};
FILE_EOF

# ------------------------------------------------------------------------------
# 4. Create: frontend/src/components/CBCRubricAssessment.jsx
# ------------------------------------------------------------------------------
echo "[+] Writing frontend/src/components/CBCRubricAssessment.jsx..."
cat << 'FILE_EOF' > frontend/src/components/CBCRubricAssessment.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { saveAssessmentOffline, getPendingAssessments, markAssessmentsSynced } from '../services/assessmentDb';

const CBC_LEVELS = [
  { code: 'EE', label: 'Exceeding Expectations', score: 4, color: '#16a34a' },
  { code: 'ME', label: 'Meeting Expectations', score: 3, color: '#2563eb' },
  { code: 'AE', label: 'Approaching Expectations', score: 2, color: '#d97706' },
  { code: 'BE', label: 'Below Expectations', score: 1, color: '#dc2626' }
];

export default function CBCRubricAssessment({ tenantId, subStrand, learners = [] }) {
  const [assessments, setAssessments] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await getPendingAssessments(tenantId);
      setPendingCount(pending.length);
    } catch (err) {
      console.error('Error fetching pending counts:', err);
    }
  }, [tenantId]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    refreshPendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshPendingCount]);

  const handleScoreChange = async (studentId, level) => {
    const entry = {
      tenantId,
      studentId,
      subStrandId: subStrand?.id || 'default_substrand',
      score: level.score,
      ratingCode: level.code
    };

    setAssessments((prev) => ({
      ...prev,
      [studentId]: level.code
    }));

    await saveAssessmentOffline(entry);
    await refreshPendingCount();

    if (navigator.onLine) {
      triggerSync();
    }
  };

  const triggerSync = async () => {
    if (syncing || !navigator.onLine) return;
    setSyncing(true);

    try {
      const pending = await getPendingAssessments(tenantId);
      if (pending.length === 0) {
        setSyncing(false);
        return;
      }

      const res = await fetch('/api/v1/assessments/cbc/bulk-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({ assessments: pending })
      });

      if (res.ok) {
        await markAssessmentsSynced(pending.map((p) => p.id));
        await refreshPendingCount();
      }
    } catch (err) {
      console.warn('Sync delayed, data safely stored in IndexedDB:', err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '16px', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2>CBC 4-Level Assessment Screen</h2>
          <p style={{ color: '#4b5563', margin: 0 }}>
            Sub-Strand: <strong>{subStrand?.name || 'General Competency'}</strong>
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: 600,
            background: isOnline ? '#dcfce7' : '#fee2e2',
            color: isOnline ? '#15803d' : '#b91c1c'
          }}>
            {isOnline ? 'Online' : 'Offline Mode'}
          </span>
          <div style={{ fontSize: '13px', marginTop: '6px' }}>
            {pendingCount > 0 ? (
              <button 
                onClick={triggerSync} 
                disabled={syncing || !isOnline}
                style={{ cursor: isOnline ? 'pointer' : 'not-allowed', padding: '4px 8px' }}
              >
                {syncing ? 'Syncing...' : `Sync ${pendingCount} Local Changes`}
              </button>
            ) : (
              <span style={{ color: '#16a34a' }}>All changes saved</span>
            )}
          </div>
        </div>
      </header>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb' }}>
        <thead>
          <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
            <th style={{ padding: '12px', borderBottom: '1px solid #e5e7eb' }}>Admission / Student</th>
            {CBC_LEVELS.map((lvl) => (
              <th key={lvl.code} style={{ padding: '12px', borderBottom: '1px solid #e5e7eb', textAlign: 'center' }}>
                {lvl.code}
                <div style={{ fontSize: '11px', fontWeight: 'normal', color: '#6b7280' }}>({lvl.score})</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {learners.map((learner) => {
            const currentSelected = assessments[learner.id] || learner.initialScoreCode;
            return (
              <tr key={learner.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '12px' }}>
                  <strong>{learner.name}</strong>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Adm: {learner.admissionNumber}</div>
                </td>
                {CBC_LEVELS.map((lvl) => {
                  const isChecked = currentSelected === lvl.code;
                  return (
                    <td key={lvl.code} style={{ textAlign: 'center', padding: '12px' }}>
                      <button
                        type="button"
                        onClick={() => handleScoreChange(learner.id, lvl)}
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '8px',
                          border: isChecked ? `2px solid ${lvl.color}` : '1px solid #d1d5db',
                          background: isChecked ? lvl.color : '#fff',
                          color: isChecked ? '#fff' : '#374151',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        {lvl.code}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
FILE_EOF

# ------------------------------------------------------------------------------
# 5. Create: devops/nginx/school_saas.conf
# ------------------------------------------------------------------------------
echo "[+] Writing devops/nginx/school_saas.conf..."
cat << 'FILE_EOF' > devops/nginx/school_saas.conf
# Upstream Application Cluster
upstream saas_backend {
    server 127.0.0.1:4000;
    keepalive 32;
}

# HTTP: Redirect all subdomains to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name .schoolsaas.co.ke;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS: Wildcard Subdomain Routing & Daraja Security
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ~^(?<subdomain>.+)\.schoolsaas\.co\.ke$;

    ssl_certificate /etc/letsencrypt/live/schoolsaas.co.ke/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/schoolsaas.co.ke/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # SaaS Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Forward tenant context
    proxy_set_header Host $host;
    proxy_set_header X-Tenant-Subdomain $subdomain;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # -------------------------------------------------------------------------
    # Daraja M-Pesa IPN Webhook Whitelist
    # -------------------------------------------------------------------------
    location ~ ^/api/v[0-9]+/payments/daraja/callback {
        allow 196.201.214.0/24;
        allow 196.201.213.0/24;
        allow 196.201.212.0/24;

        allow 196.201.214.200;
        allow 196.201.214.206;
        allow 196.201.213.114;
        allow 196.201.214.207;
        allow 196.201.214.208;
        allow 196.201.213.44;
        allow 196.201.212.127;
        allow 196.201.212.138;
        allow 196.201.212.129;
        allow 196.201.212.136;
        allow 196.201.212.74;
        allow 196.201.212.69;

        allow 127.0.0.1;

        deny all;

        proxy_pass http://saas_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # General API & UI proxy
    location / {
        proxy_pass http://saas_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
FILE_EOF

# ------------------------------------------------------------------------------
# 6. Create: scripts/backup_db.sh
# ------------------------------------------------------------------------------
echo "[+] Writing scripts/backup_db.sh..."
cat << 'FILE_EOF' > scripts/backup_db.sh
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
FILE_EOF

# Set permissions
chmod +x scripts/backup_db.sh

# ------------------------------------------------------------------------------
# 7. Git Add, Commit, and Push
# ------------------------------------------------------------------------------
echo "[+] Staging files into Git..."
git add frontend/src/services/assessmentDb.js
git add frontend/src/components/CBCRubricAssessment.jsx
git add devops/nginx/school_saas.conf
git add scripts/backup_db.sh

echo "[+] Staged status:"
git status --short

echo "[+] Committing changes..."
git commit -m "feat(batch-b): CBC 4-level rubric with IndexedDB, Nginx Daraja IP rules, and automated backup script" || {
  echo "[!] Nothing to commit or already committed."
}

echo "[+] Pushing changes to remote branch: ${CURRENT_BRANCH}..."
git push origin "${CURRENT_BRANCH}"

echo "=========================================================="
echo " Batch B has been applied, committed, and pushed to GitHub!"
echo " Repository URL: https://github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system.git"
echo "=========================================================="
