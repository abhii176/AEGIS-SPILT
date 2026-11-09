const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const {
  recordMonitoringConsent,
  getConsentAgreement,
} = require('../controllers/consentController');

const router = express.Router();

/** GET /api/consent/agreement — full User Consent Agreement markdown */
router.get('/agreement', getConsentAgreement);

/** POST /api/consent/monitoring — writes ConsentLogs + sets monitoring_consent_granted */
router.post('/monitoring', requireAuth, recordMonitoringConsent);

module.exports = router;
