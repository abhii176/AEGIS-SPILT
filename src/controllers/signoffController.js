const { prisma } = require('../lib/prisma');
const { createEscrowService } = require('../services/paypal/escrow');
const { assertProjectNotCancelled } = require('../lib/projectStatus');
const { assertClientCanSignOff } = require('../lib/clientSignoff');

const escrow = createEscrowService();

/**
 * POST /api/projects/:projectId/milestones/:milestoneId/signoff
 * Client approves subjective work after an AI pass, then PayPal pays the freelancer.
 * Milestones without requiresManualSignoff keep the automatic payout path.
 */
async function clientSignoff(req, res, next) {
  try {
    const milestone = await prisma.milestone.findUnique({
      where: { id: String(req.params.milestoneId) },
      include: { project: true },
    });

    if (!milestone || milestone.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'milestone_not_found' });
    }

    assertProjectNotCancelled(milestone.project, 'client sign-off');
    const decision = assertClientCanSignOff({ milestone, userId: req.user.id });

    if (decision.alreadyPaid) {
      return res.status(200).json({
        milestone,
        alreadyPaid: true,
        note: 'Milestone already paid.',
      });
    }

    if (!decision.alreadySigned) {
      await prisma.milestone.update({
        where: { id: milestone.id },
        data: {
          manualSignedOffAt: new Date(),
          manualSignedOffByUserId: req.user.id,
        },
      });
    }

    const result = await escrow.releaseMilestone({
      milestoneId: milestone.id,
      actorUserId: req.user.id,
    });

    return res.status(200).json({
      milestone: result.milestone,
      paypal: result.paypal,
      alreadyPaid: false,
      note: 'Client signed off. Milestone paid via PayPal Payouts. Platform fee is 0%.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { clientSignoff };
