const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { adminDemoLimiter, payoutLimiter } = require('../middleware/rateLimit');
const { releaseMilestone, requireDemoAdmin } = require('../controllers/payoutsController');
const { simulateMerge } = require('../controllers/githubWebhookController');
const {
  seedDemoUsers,
  listDemoUsers,
  requireDemoAdminKey,
} = require('../controllers/demoUsersController');
const {
  getAgencyPreview,
  seedAgencyPreview,
} = require('../controllers/agencyDemoController');

const router = express.Router();

router.use(adminDemoLimiter);

/**
 * Seed / list Sarah + Rohan (no X-User-Id yet — demo key only).
 */
router.post('/users/seed', requireDemoAdminKey, seedDemoUsers);
router.get('/users', requireDemoAdminKey, listDemoUsers);

/**
 * Agency dashboard preview. Read-only totals plus an idempotent sample seed.
 * Demo key only — does not fund, release, or refund.
 */
router.get('/agency', requireDemoAdminKey, getAgencyPreview);
router.post('/agency/seed', requireDemoAdminKey, seedAgencyPreview);

/**
 * Hackathon demo trigger: release milestone payout without waiting for AI auditor.
 * Still requires auth + KYC/consent + X-Demo-Admin-Key.
 */
router.post(
  '/milestones/:milestoneId/release',
  payoutLimiter,
  requireAuth,
  requireKycAndConsent,
  requireDemoAdmin,
  releaseMilestone
);

/**
 * Simulate a GitHub PR merge → AI audit → PayPal release without a public webhook URL.
 */
router.post(
  '/milestones/:milestoneId/simulate-merge',
  requireAuth,
  requireKycAndConsent,
  requireDemoAdmin,
  simulateMerge
);

module.exports = router;
