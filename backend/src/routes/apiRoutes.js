const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const assessmentController = require('../controllers/assessmentController');
const darajaController = require('../controllers/darajaController');
const stkController = require('../controllers/stkController');

module.exports = (dbPool, tenantMiddleware) => {
  // Liveness
  router.get('/health', (req, res) => res.json({ status: 'healthy', uptime: process.uptime() }));

  // Public Auth
  router.post('/auth/login', (req, res) => authController.login(req, res, dbPool));

  // CBC Bulk Sync
  router.post('/assessments/cbc/bulk-sync', tenantMiddleware, assessmentController.bulkSyncAssessments);

  // Daraja STK Push Outbound
  router.post('/payments/daraja/stk-push', tenantMiddleware, stkController.triggerSTKPush);

  // Daraja Inbound IPN Callback
  router.post('/payments/daraja/callback', (req, res) => darajaController.handleDarajaCallback(req, res, dbPool));

  return router;
};
