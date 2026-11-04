const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { mergeCode } = require('../controllers/mergeController');

const router = express.Router();

/** Merging code requires gov_id_verified AND monitoring_consent_granted */
router.post('/', requireAuth, requireKycAndConsent, mergeCode);

module.exports = router;
