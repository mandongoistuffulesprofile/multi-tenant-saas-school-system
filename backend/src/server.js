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
