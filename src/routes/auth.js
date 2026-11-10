const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { publicUser } = require('../controllers/demoUsersController');
const { authLimiter } = require('../middleware/rateLimit');
const {
  startVerifyIdentity,
  digilockerCallback,
  stripeIdentityCallback,
} = require('../controllers/verifyIdentityController');
const {
  getSandboxHint,
  emailStart,
  emailConfirm,
  phoneStart,
  phoneConfirm,
  digilockerStart,
  digilockerConfirm,
  quickVerify,
} = require('../controllers/kycSandboxController');

const router = express.Router();

router.use(authLimiter);

/** GET /api/auth/me — current stub user (X-User-Id) for the demo UI */
router.get('/me', requireAuth, (req, res) => {
  res.status(200).json({ user: publicUser(req.user) });
});

/**
 * POST /api/auth/verify-identity
 * Dynamically routes DigiLocker (IN) vs Stripe Identity / regional (intl).
 */
router.post('/verify-identity', requireAuth, startVerifyIdentity);

/**
 * DigiLocker-style sandbox (demo). Validates each step, then sets gov ID.
 * Stores a mask and last 4 only. Does not send email, SMS, or call a government API.
 */
router.get('/kyc/sandbox', requireAuth, getSandboxHint);
router.post('/kyc/sandbox/email/start', requireAuth, emailStart);
router.post('/kyc/sandbox/email/confirm', requireAuth, emailConfirm);
router.post('/kyc/sandbox/phone/start', requireAuth, phoneStart);
router.post('/kyc/sandbox/phone/confirm', requireAuth, phoneConfirm);
router.post('/kyc/sandbox/digilocker/start', requireAuth, digilockerStart);
router.post('/kyc/sandbox/digilocker/confirm', requireAuth, digilockerConfirm);
router.post('/kyc/sandbox/quick', requireAuth, quickVerify);

/** OAuth / hosted-verification callbacks (no auth header — state/session carries user id) */
router.get('/verify-identity/callback/digilocker', digilockerCallback);
router.get('/verify-identity/callback/stripe', stripeIdentityCallback);

module.exports = router;
