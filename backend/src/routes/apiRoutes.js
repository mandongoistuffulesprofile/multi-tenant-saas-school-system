const express = require('express');
const router = express.Router();
const assessmentController = require('../controllers/assessmentController');
const darajaController = require('../controllers/darajaController');

module.exports = (dbPool, tenantMiddleware) => {
  // Liveness probe
  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', uptime: process.uptime() });
  });

  // Offline CBC Bulk Sync endpoint
  router.post(
    '/assessments/cbc/bulk-sync',
    tenantMiddleware,
    assessmentController.bulkSyncAssessments
  );

  // Daraja Webhook (Nginx secures IPs; no tenant header required from Safaricom)
  router.post('/payments/daraja/callback', (req, res) => {
    darajaController.handleDarajaCallback(req, res, dbPool);
  });

  return router;
};
