const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { fundVault } = require('../controllers/vaultController');

const router = express.Router();

/** Funding a vault requires gov_id_verified AND monitoring_consent_granted */
router.post('/fund', requireAuth, requireKycAndConsent, fundVault);

module.exports = router;
