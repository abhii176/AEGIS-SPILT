const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { recordMonitoringConsent } = require('../controllers/consentController');

const router = express.Router();

/** POST /api/consent/monitoring — writes ConsentLogs + sets monitoring_consent_granted */
router.post('/monitoring', requireAuth, recordMonitoringConsent);

module.exports = router;
