const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const {
  startVerifyIdentity,
  digilockerCallback,
  stripeIdentityCallback,
} = require('../controllers/verifyIdentityController');

const router = express.Router();

/**
 * POST /api/auth/verify-identity
 * Dynamically routes DigiLocker (IN) vs Stripe Identity / regional (intl).
 */
router.post('/verify-identity', requireAuth, startVerifyIdentity);

/** OAuth / hosted-verification callbacks (no auth header — state/session carries user id) */
router.get('/verify-identity/callback/digilocker', digilockerCallback);
router.get('/verify-identity/callback/stripe', stripeIdentityCallback);

module.exports = router;
