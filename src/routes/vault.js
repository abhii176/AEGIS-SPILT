const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { fundVault, captureVault } = require('../controllers/vaultController');

const router = express.Router();

/** Funding a vault requires gov_id_verified AND monitoring_consent_granted */
router.post('/fund', requireAuth, requireKycAndConsent, fundVault);

/** Capture a pending PayPal order (when auto-capture was disabled) */
router.post('/capture', requireAuth, requireKycAndConsent, captureVault);

module.exports = router;
