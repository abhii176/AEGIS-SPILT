const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { releaseMilestone, requireDemoAdmin } = require('../controllers/payoutsController');

const router = express.Router();

/**
 * Hackathon demo trigger: release milestone payout without waiting for AI auditor.
 * Still requires auth + KYC/consent + X-Demo-Admin-Key.
 */
router.post(
  '/milestones/:milestoneId/release',
  requireAuth,
  requireKycAndConsent,
  requireDemoAdmin,
  releaseMilestone
);

module.exports = router;
