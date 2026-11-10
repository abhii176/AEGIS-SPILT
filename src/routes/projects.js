const express = require('express');
const { requireAuth } = require('../middleware/authStub');
const { requireKycAndConsent } = require('../middleware/requireKycAndConsent');
const { payoutLimiter, vaultLimiter } = require('../middleware/rateLimit');
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
const {
  previewExit,
  requestCancel,
  acceptCancel,
  clientExit,
  freelancerAbandon,
  fundDeposit,
  captureDeposit,
} = require('../controllers/exitController');
const { listMessages, postMessage } = require('../controllers/chatController');
const { clientSignoff } = require('../controllers/signoffController');
const { getProjectEvidence } = require('../controllers/evidenceController');

const router = express.Router();

/** Creating a project requires gov_id_verified AND monitoring_consent_granted */
router.post('/', requireAuth, requireKycAndConsent, createProject);

/** List / get require auth + membership (checked in controller) */
router.get('/', requireAuth, listProjects);
router.get('/:projectId', requireAuth, getProject);

/**
 * Project text chat (client ↔ freelancer). Allowed after cancel for disputes.
 * No WebSockets — clients may poll GET.
 */
router.get('/:projectId/messages', requireAuth, listMessages);
router.post('/:projectId/messages', requireAuth, postMessage);

/** Chat, audit text, and stored diff preview for the parties (no counselor login). */
router.get('/:projectId/evidence', requireAuth, getProjectEvidence);

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

/**
 * Client sign-off for milestones that opted into manual approval.
 * Default milestones still pay automatically on AI pass.
 */
router.post(
  '/:projectId/milestones/:milestoneId/signoff',
  payoutLimiter,
  requireAuth,
  requireKycAndConsent,
  clientSignoff
);

/** Exit / cancel / deposit */
router.get('/:projectId/exit/preview', requireAuth, requireKycAndConsent, previewExit);
router.post('/:projectId/cancel/request', requireAuth, requireKycAndConsent, requestCancel);
router.post('/:projectId/cancel/accept', requireAuth, requireKycAndConsent, acceptCancel);
router.post('/:projectId/exit/client', requireAuth, requireKycAndConsent, clientExit);
router.post('/:projectId/exit/abandon', requireAuth, requireKycAndConsent, freelancerAbandon);
router.post(
  '/:projectId/deposit/fund',
  vaultLimiter,
  requireAuth,
  requireKycAndConsent,
  fundDeposit
);
router.post(
  '/:projectId/deposit/capture',
  vaultLimiter,
  requireAuth,
  requireKycAndConsent,
  captureDeposit
);

module.exports = router;
