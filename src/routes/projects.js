const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { payoutLimiter } = require('../middleware/rateLimit');
const {
  createProject,
  listProjects,
  getProject,
} = require('../controllers/projectsController');
const {
  addMilestone,
  listMilestones,
} = require('../controllers/milestonesController');
const { releaseMilestone } = require('../controllers/payoutsController');
const { linkGithubToMilestone } = require('../controllers/githubLinkController');

const router = express.Router();

/** Creating a project requires gov_id_verified AND monitoring_consent_granted */
router.post('/', requireAuth, requireKycAndConsent, createProject);

/** List / get require auth + membership (checked in controller) */
router.get('/', requireAuth, listProjects);
router.get('/:projectId', requireAuth, getProject);

/**
 * Milestones under a project.
 * Add is gated like create-project so parties are KYC+consent verified before agreeing on money.
 */
router.post(
  '/:projectId/milestones',
  requireAuth,
  requireKycAndConsent,
  addMilestone
);
router.get('/:projectId/milestones', requireAuth, listMilestones);

/**
 * Link GitHub repo (+ optional PR) to a milestone — gated (code merge path).
 */
router.post(
  '/:projectId/milestones/:milestoneId/github',
  requireAuth,
  requireKycAndConsent,
  linkGithubToMilestone
);

/**
 * Release milestone payout (PayPal Payouts).
 * Callable by AI auditor later; parties with KYC+consent can trigger for demo.
 */
router.post(
  '/:projectId/milestones/:milestoneId/release',
  payoutLimiter,
  requireAuth,
  requireKycAndConsent,
  releaseMilestone
);

module.exports = router;
