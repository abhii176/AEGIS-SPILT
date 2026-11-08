const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { vaultLimiter } = require('../middleware/rateLimit');
const {
  fundVault,
  captureVault,
  paypalReturn,
  paypalCancel,
} = require('../controllers/vaultController');

const router = express.Router();

/** Funding a vault requires gov_id_verified AND monitoring_consent_granted */
router.post('/fund', vaultLimiter, requireAuth, requireKycAndConsent, fundVault);

/** Capture a pending PayPal order after buyer approval (authenticated) */
router.post('/capture', vaultLimiter, requireAuth, requireKycAndConsent, captureVault);

/**
 * PayPal browser redirects — no auth (PayPal cannot send X-User-Id).
 * token=ORDER_ID from PayPal Orders application_context return/cancel URLs.
 */
router.get('/paypal/return', paypalReturn);
router.post('/paypal/return', paypalReturn);
router.get('/paypal/cancel', paypalCancel);
router.post('/paypal/cancel', paypalCancel);

module.exports = router;
