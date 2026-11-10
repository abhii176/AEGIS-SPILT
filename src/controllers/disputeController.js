const { createDisputeService } = require('../services/disputes/disputeService');

const disputes = createDisputeService();

/** POST /api/projects/:projectId/disputes  { reason, milestoneId? } */
async function raiseDispute(req, res, next) {
  try {
    const result = await disputes.raiseDispute({
      projectId: req.params.projectId,
      userId: req.user.id,
      reason: req.body?.reason,
      milestoneId: req.body?.milestoneId || req.params.milestoneId || null,
    });
    return res.status(201).json({
      ...result,
      note: 'Dispute opened. Auto-payout and exits are paused until the counselor decides.',
    });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/projects/:projectId/disputes — outcome for the two parties */
async function getProjectDispute(req, res, next) {
  try {
    const result = await disputes.getProjectDispute({
      projectId: req.params.projectId,
      userId: req.user.id,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/** GET /api/disputes?status=OPEN|RESOLVED|ALL */
async function listDisputes(req, res, next) {
  try {
    const result = await disputes.listDisputes({ status: req.query.status || 'OPEN' });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/** POST /api/disputes/:disputeId/preview */
async function previewDecision(req, res, next) {
  try {
    const result = await disputes.previewDecision({
      disputeId: req.params.disputeId,
      decision: req.body?.decision,
      freelancerPercent: req.body?.freelancerPercent,
      freelancerAtFault: Boolean(req.body?.freelancerAtFault),
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/** POST /api/disputes/:disputeId/decide */
async function decideDispute(req, res, next) {
  try {
    const counselor = req.counselor || {};
    const result = await disputes.decideDispute({
      disputeId: req.params.disputeId,
      decision: req.body?.decision,
      freelancerPercent: req.body?.freelancerPercent,
      freelancerAtFault: Boolean(req.body?.freelancerAtFault),
      note: req.body?.note,
      decidedByUserId: counselor.userId || null,
      decidedByLabel: counselor.label || 'demo-admin-key',
    });
    return res.status(200).json({
      ...result,
      note: result.alreadyResolved
        ? 'Decision already recorded (idempotent).'
        : 'Counselor decision recorded. Vault and deposit moved through PayPal.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  raiseDispute,
  getProjectDispute,
  listDisputes,
  previewDecision,
  decideDispute,
};
