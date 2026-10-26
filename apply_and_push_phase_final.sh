#!/usr/bin/env bash
# ==============================================================================
# Script: apply_and_push_phase_final.sh
# Purpose: Deploys server.js entrypoint, Daraja STK push engine, and production
#          host provisioning scripts, then commits and pushes to GitHub.
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " Launching Final Production Deployment Pipeline"
echo "=========================================================="

if [ ! -d ".git" ]; then
  echo "[-] ERROR: Must be run from the root of your git repository."
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "[+] Target branch: ${CURRENT_BRANCH}"

mkdir -p backend/src/services
mkdir -p backend/src/controllers
mkdir -p scripts

# ------------------------------------------------------------------------------
# 1. Backend Server Entrypoint (backend/src/server.js)
# ------------------------------------------------------------------------------
echo "[+] Writing backend/src/server.js..."
cat << 'FILE_EOF' > backend/src/server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 4000;

// Security and utility middleware
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// PostgreSQL Connection Pool with keepalive
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/school_saas_production',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle database client:', err);
});

// Middleware & Routes
const tenantMiddleware = require('./middleware/tenantContext')(pool);
const apiRoutes = require('./routes/apiRoutes')(pool, tenantMiddleware);

// Mount API routes
app.use('/api/v1', apiRoutes);

// Root & Health Endpoints
app.get('/', (req, res) => {
  res.status(200).json({ service: 'School SaaS Multi-Tenant Core', status: 'operational' });
});

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'healthy', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: err.message });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`[HTTP] Production SaaS backend listening on port ${PORT}`);
});

// Graceful Termination
const handleShutdown = (signal) => {
  console.log(`[Shutdown] Received ${signal}. Closing HTTP server and DB pools...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log('[Shutdown] Database pool closed. Exiting process.');
      process.exit(0);
    } catch (err) {
      console.error('[Shutdown Error]', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
FILE_EOF

# ------------------------------------------------------------------------------
# 2. Outbound Daraja STK Push Service (backend/src/services/darajaService.js)
# ------------------------------------------------------------------------------
echo "[+] Writing backend/src/services/darajaService.js..."
cat << 'FILE_EOF' > backend/src/services/darajaService.js
const https = require('https');

class DarajaService {
  constructor() {
    this.env = process.env.DARAJA_ENVIRONMENT || 'production';
    this.consumerKey = process.env.DARAJA_CONSUMER_KEY || '';
    this.consumerSecret = process.env.DARAJA_CONSUMER_SECRET || '';
    this.shortcode = process.env.DARAJA_BUSINESS_SHORTCODE || '';
    this.passkey = process.env.DARAJA_PASSKEY || '';
    this.callbackUrl = process.env.DARAJA_CALLBACK_URL || '';
    
    this.baseURL = this.env === 'sandbox' 
      ? 'https://sandbox.safaricom.co.ke' 
      : 'https://api.safaricom.co.ke';
  }

  // Generates OAuth token from Safaricom Daraja
  async getOAuthToken() {
    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      const url = `${this.baseURL}/oauth/v1/generate?grant_type=client_credentials`;

      const req = https.get(url, { headers: { Authorization: `Basic ${auth}` } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.access_token) {
              resolve(parsed.access_token);
            } else {
              reject(new Error(`Daraja Auth Failed: ${data}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
    });
  }

  // Triggers Lipa Na M-Pesa Online STK Push to parent phone
  async initiateSTKPush({ phoneNumber, amount, accountReference, tenantId }) {
    const token = await this.getOAuthToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString('base64');

    // Standardize phone format (e.g. 0712345678 -> 254712345678)
    let formattedPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = `254${formattedPhone.slice(1)}`;
    if (formattedPhone.startsWith('+')) formattedPhone = formattedPhone.slice(1);

    const payload = JSON.stringify({
      BusinessShortCode: this.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: this.shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: `${this.callbackUrl}?tenant_id=${tenantId}`,
      AccountReference: accountReference,
      TransactionDesc: `School Fees Adm:${accountReference}`
    });

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(`${this.baseURL}/mpesa/stkpush/v1/processrequest`);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseData));
          } catch (e) {
            reject(new Error(`Failed to parse Daraja response: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = new DarajaService();
FILE_EOF

# ------------------------------------------------------------------------------
# 3. STK Push Controller (backend/src/controllers/stkController.js)
# ------------------------------------------------------------------------------
echo "[+] Writing backend/src/controllers/stkController.js..."
cat << 'FILE_EOF' > backend/src/controllers/stkController.js
const darajaService = require('../services/darajaService');

exports.triggerSTKPush = async (req, res) => {
  const { phoneNumber, amount, admissionNumber } = req.body;
  const tenantId = req.tenantId;

  if (!phoneNumber || !amount || !admissionNumber) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: phoneNumber, amount, or admissionNumber.'
    });
  }

  try {
    const result = await darajaService.initiateSTKPush({
      phoneNumber,
      amount: Number(amount),
      accountReference: admissionNumber,
      tenantId
    });

    if (result.ResponseCode === '0') {
      return res.status(200).json({
        success: true,
        message: 'STK push prompt dispatched to parent phone.',
        checkoutRequestID: result.CheckoutRequestID,
        merchantRequestID: result.MerchantRequestID
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.ResponseDescription || 'Safaricom STK Push rejected request.'
      });
    }
  } catch (error) {
    console.error('[Daraja STK Push Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate M-Pesa STK push.'
    });
  }
};
FILE_EOF

# ------------------------------------------------------------------------------
# 4. Mount STK Push in backend/src/routes/apiRoutes.js
# ------------------------------------------------------------------------------
echo "[+] Updating backend/src/routes/apiRoutes.js with STK trigger route..."
cat << 'FILE_EOF' > backend/src/routes/apiRoutes.js
const express = require('express');
const router = express.Router();
const assessmentController = require('../controllers/assessmentController');
const darajaController = require('../controllers/darajaController');
const stkController = require('../controllers/stkController');

module.exports = (dbPool, tenantMiddleware) => {
  // Liveness Probe
  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', uptime: process.uptime() });
  });

  // Offline CBC Rubric Bulk-Sync
  router.post(
    '/assessments/cbc/bulk-sync',
    tenantMiddleware,
    assessmentController.bulkSyncAssessments
  );

  // Outbound M-Pesa STK Push (Parent initiates payment)
  router.post(
    '/payments/daraja/stk-push',
    tenantMiddleware,
    stkController.triggerSTKPush
  );

  // Inbound Daraja Webhook IPN Callback (Secured by Nginx IP Whitelist)
  router.post('/payments/daraja/callback', (req, res) => {
    darajaController.handleDarajaCallback(req, res, dbPool);
  });

  return router;
};
FILE_EOF

# ------------------------------------------------------------------------------
# 5. One-Click Host Provisioning Script (scripts/provision_production_server.sh)
# ------------------------------------------------------------------------------
echo "[+] Writing scripts/provision_production_server.sh..."
cat << 'FILE_EOF' > scripts/provision_production_server.sh
#!/usr/bin/env bash
# ==============================================================================
# One-Click Production Provisioner for Ubuntu/Debian Cloud VPS
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " Provisioning Production Multi-Tenant School SaaS Host"
echo "=========================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root (sudo bash provision_production_server.sh)"
  exit 1
fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "[-] Usage: sudo bash provision_production_server.sh <yourdomain.co.ke>"
  exit 1
fi

echo "[1/5] Installing Docker, Docker Compose, and Nginx..."
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx curl ufw git

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm get-docker.sh
fi

echo "[2/5] Configuring Host Firewall (UFW)..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "[3/5] Setting up Nginx Wildcard Configuration for ${DOMAIN}..."
sed -i "s/schoolsaas\.co\.ke/${DOMAIN}/g" devops/nginx/school_saas.conf
cp devops/nginx/school_saas.conf /etc/nginx/sites-available/${DOMAIN}.conf
ln -sf /etc/nginx/sites-available/${DOMAIN}.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo "[4/5] Installing Automated Database Backup Cron Job..."
BACKUP_SCRIPT_PATH="$(pwd)/scripts/backup_db.sh"
chmod +x "${BACKUP_SCRIPT_PATH}"
CRON_JOB="0 2 * * * /bin/bash ${BACKUP_SCRIPT_PATH} >> /var/log/school_saas_backup.log 2>&1"
(crontab -l 2>/dev/null | grep -Fv "${BACKUP_SCRIPT_PATH}" ; echo "${CRON_JOB}") | crontab -

echo "[5/5] Booting Production Containers..."
if [ -f ".env.production" ]; then
  docker compose -f devops/docker/docker-compose.prod.yml --env-file .env.production up -d --build
else
  echo "[!] NOTICE: .env.production not found. Copying template..."
  cp .env.production.example .env.production
  echo "[!] Edit .env.production with live credentials, then run:"
  echo "    docker compose -f devops/docker/docker-compose.prod.yml --env-file .env.production up -d --build"
fi

nginx -t && systemctl reload nginx

echo "=========================================================="
echo " Host Provisioning Completed!"
echo " Next step: Generate Wildcard SSL using Certbot DNS plugin:"
echo " certbot certonly --manual --preferred-challenges=dns -d '*.${DOMAIN}' -d '${DOMAIN}'"
echo "=========================================================="
FILE_EOF

chmod +x scripts/provision_production_server.sh

# ------------------------------------------------------------------------------
# 6. Commit and Push Everything to Remote
# ------------------------------------------------------------------------------
echo "[+] Staging changes in git..."
git add backend/src/server.js
git add backend/src/services/darajaService.js
git add backend/src/controllers/stkController.js
git add backend/src/routes/apiRoutes.js
git add scripts/provision_production_server.sh

echo "[+] Staged status:"
git status --short

echo "[+] Committing changes..."
git commit -m "feat(prod-final): server entrypoint, Daraja STK push service, and one-click host provisioner" || {
  echo "[!] Nothing new to commit."
}

echo "[+] Pushing to branch: ${CURRENT_BRANCH}..."
git push origin "${CURRENT_BRANCH}"

echo "=========================================================="
echo " All final components committed and pushed successfully!"
echo " Remote: https://github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system.git"
echo "=========================================================="
