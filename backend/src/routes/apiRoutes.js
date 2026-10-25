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
