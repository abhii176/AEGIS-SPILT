const { prisma } = require('../../lib/prisma');
const { env } = require('../../config/env');
const { createPaypalService } = require('./index');

const RELEASABLE_STATUSES = new Set(['FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'AUDITING', 'PASSED']);

/**
 * Escrow orchestration: lock funds (Orders) + release milestone (Payouts).
 * Controllers call these; AI auditor can call releaseMilestone later.
 */
function createEscrowService({
  paypal = createPaypalService(),
  db = prisma,
} = {}) {
  async function resolveFundAmount({ project, milestoneId, amountCents }) {
    if (milestoneId) {
      const milestone = await db.milestone.findFirst({
        where: { id: String(milestoneId), projectId: project.id },
      });
      if (!milestone) {
        const err = new Error('Milestone not found on this project');
        err.status = 404;
        err.code = 'milestone_not_found';
        throw err;
      }
      if (['FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'AUDITING', 'PASSED', 'RELEASED', 'PAID'].includes(milestone.status)) {
        const err = new Error('Milestone is already funded or past funding');
        err.status = 409;
        err.code = 'milestone_already_funded';
        throw err;
      }
      return {
        amountCents: milestone.amountCents,
        currency: milestone.currency,
        milestone,
        scope: 'milestone',
      };
    }

    if (amountCents != null) {
      const cents = Number(amountCents);
      if (!Number.isInteger(cents) || cents <= 0) {
        const err = new Error('amountCents must be a positive integer (cents)');
        err.status = 400;
        err.code = 'invalid_amount';
        throw err;
      }
      return {
        amountCents: cents,
        currency: env.defaultMilestoneCurrency || 'USD',
        milestone: null,
        scope: 'custom',
      };
    }

    const pending = await db.milestone.findMany({
      where: { projectId: project.id, status: 'PENDING' },
      orderBy: { sequence: 'asc' },
    });
    if (!pending.length) {
      const err = new Error('No PENDING milestones to fund; pass amountCents or milestoneId');
      err.status = 400;
      err.code = 'nothing_to_fund';
      throw err;
    }
    const total = pending.reduce((sum, m) => sum + m.amountCents, 0);
    const currency = pending[0].currency || env.defaultMilestoneCurrency || 'USD';
    return {
      amountCents: total,
      currency,
      milestone: null,
      milestones: pending,
      scope: 'project',
    };
  }

  async function refreshProjectFundedStatus(projectId) {
    const milestones = await db.milestone.findMany({
      where: { projectId },
      select: { status: true },
    });
    if (!milestones.length) {
      return db.project.update({
        where: { id: projectId },
        data: { fundedStatus: 'UNFUNDED' },
      });
    }
    const fundedLike = milestones.filter((m) =>
      ['FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'AUDITING', 'PASSED', 'RELEASED', 'PAID'].includes(m.status)
    );
    let fundedStatus = 'UNFUNDED';
    if (fundedLike.length === milestones.length) fundedStatus = 'FUNDED';
    else if (fundedLike.length > 0) fundedStatus = 'PARTIAL';

    return db.project.update({
      where: { id: projectId },
      data: { fundedStatus },
    });
  }

  /**
   * Create PayPal order to lock funds for a project or milestone.
   * When autoCapture is true (sandbox demo default), captures immediately after create.
   */
  async function fundProjectVault({
    userId,
    projectId,
    milestoneId = null,
    amountCents = null,
    currency,
    autoCapture = env.paypal.autoCapture,
    returnUrl = `${env.appBaseUrl}/api/vault/return`,
    cancelUrl = `${env.appBaseUrl}/api/vault/cancel`,
  }) {
    const project = await db.project.findUnique({
      where: { id: String(projectId) },
      include: { freelancer: true },
    });
    if (!project) {
      const err = new Error('Project not found');
      err.status = 404;
      err.code = 'project_not_found';
      throw err;
    }
    if (project.clientId !== userId) {
      const err = new Error('Only the project client can fund the vault');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }

    const resolved = await resolveFundAmount({ project, milestoneId, amountCents });
    const payCurrency = String(currency || resolved.currency || 'USD').toUpperCase();

    const vaultFund = await db.vaultFund.create({
      data: {
        userId,
        projectId: project.id,
        milestoneId: resolved.milestone?.id || null,
        amountCents: resolved.amountCents,
        currency: payCurrency,
        status: 'PENDING',
      },
    });

    const order = await paypal.createOrder({
      amountCents: resolved.amountCents,
      currency: payCurrency,
      referenceId: vaultFund.id,
      description: `Aegis escrow: ${project.title}`.slice(0, 127),
      returnUrl,
      cancelUrl,
    });

    let captureId = null;
    let status = 'ORDER_CREATED';
    let orderStatus = order.status;

    if (autoCapture) {
      const captured = await paypal.captureOrder(order.id);
      captureId = captured.captureId;
      status = 'CAPTURED';
      orderStatus = captured.status;
    }

    const updatedFund = await db.vaultFund.update({
      where: { id: vaultFund.id },
      data: {
        status,
        paypalOrderId: order.id,
        paypalCaptureId: captureId,
        approvalUrl: order.approvalUrl,
      },
    });

    await db.project.update({
      where: { id: project.id },
      data: {
        paypalOrderId: order.id,
        paypalCaptureId: captureId || undefined,
        status: project.status === 'DRAFT' ? 'ACTIVE' : project.status,
      },
    });

    if (status === 'CAPTURED') {
      if (resolved.milestone) {
        await db.milestone.update({
          where: { id: resolved.milestone.id },
          data: { status: 'FUNDED' },
        });
      } else if (resolved.scope === 'project' && resolved.milestones?.length) {
        await db.milestone.updateMany({
          where: { id: { in: resolved.milestones.map((m) => m.id) } },
          data: { status: 'FUNDED' },
        });
      }
      await refreshProjectFundedStatus(project.id);
    }

    const projectAfter = await db.project.findUnique({ where: { id: project.id } });

    return {
      vaultFund: updatedFund,
      project: projectAfter,
      paypal: {
        mode: env.paypal.mode,
        mock: paypal.isMock(),
        orderId: order.id,
        captureId,
        orderStatus,
        approvalUrl: order.approvalUrl,
        autoCapture: Boolean(autoCapture),
      },
    };
  }

  /**
   * Capture a previously created order (when autoCapture was false).
   */
  async function captureVaultOrder({ userId, vaultFundId, orderId }) {
    const fund = vaultFundId
      ? await db.vaultFund.findUnique({ where: { id: String(vaultFundId) } })
      : await db.vaultFund.findFirst({
          where: { paypalOrderId: String(orderId) },
          orderBy: { createdAt: 'desc' },
        });

    if (!fund) {
      const err = new Error('Vault fund not found');
      err.status = 404;
      err.code = 'vault_fund_not_found';
      throw err;
    }
    if (fund.userId !== userId) {
      const err = new Error('Forbidden');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
    if (fund.status === 'CAPTURED') {
      return { vaultFund: fund, alreadyCaptured: true };
    }

    const targetOrderId = orderId || fund.paypalOrderId;
    const captured = await paypal.captureOrder(targetOrderId);

    const updatedFund = await db.vaultFund.update({
      where: { id: fund.id },
      data: {
        status: 'CAPTURED',
        paypalOrderId: targetOrderId,
        paypalCaptureId: captured.captureId,
      },
    });

    if (fund.projectId) {
      await db.project.update({
        where: { id: fund.projectId },
        data: {
          paypalOrderId: targetOrderId,
          paypalCaptureId: captured.captureId,
        },
      });

      if (fund.milestoneId) {
        await db.milestone.update({
          where: { id: fund.milestoneId },
          data: { status: 'FUNDED' },
        });
      } else {
        await db.milestone.updateMany({
          where: { projectId: fund.projectId, status: 'PENDING' },
          data: { status: 'FUNDED' },
        });
      }
      await refreshProjectFundedStatus(fund.projectId);
    }

    return { vaultFund: updatedFund, alreadyCaptured: false, paypal: captured };
  }

  /**
   * Release a milestone payout to the freelancer PayPal email.
   * Intended hook for the AI auditor after PASS; also used by admin/demo trigger.
   */
  async function releaseMilestone({
    milestoneId,
    recipientEmail,
    actorUserId = null,
    allowDemoBypass = false,
  }) {
    const milestone = await db.milestone.findUnique({
      where: { id: String(milestoneId) },
      include: {
        project: {
          include: { freelancer: true, client: true },
        },
      },
    });

    if (!milestone) {
      const err = new Error('Milestone not found');
      err.status = 404;
      err.code = 'milestone_not_found';
      throw err;
    }

    if (['RELEASED', 'PAID'].includes(milestone.status)) {
      const err = new Error('Milestone already released/paid');
      err.status = 409;
      err.code = 'already_released';
      throw err;
    }

    if (!RELEASABLE_STATUSES.has(milestone.status) && !(allowDemoBypass && milestone.status === 'PENDING')) {
      const err = new Error(
        `Milestone status ${milestone.status} is not releasable (need FUNDED…PASSED, or demo bypass)`
      );
      err.status = 409;
      err.code = 'milestone_not_releasable';
      throw err;
    }

    if (actorUserId && !allowDemoBypass) {
      const { project } = milestone;
      if (project.clientId !== actorUserId && project.freelancerId !== actorUserId) {
        const err = new Error('Forbidden');
        err.status = 403;
        err.code = 'forbidden';
        throw err;
      }
    }

    const email =
      String(recipientEmail || '').trim() ||
      milestone.project.freelancer.paypalEmail ||
      milestone.project.freelancer.email;

    const payout = await paypal.createPayout({
      amountCents: milestone.amountCents,
      currency: milestone.currency,
      receiverEmail: email,
      senderBatchId: `milestone-${milestone.id}-${Date.now()}`,
      senderItemId: milestone.id,
      note: `Aegis-Split release: ${milestone.title}`,
    });

    const updated = await db.milestone.update({
      where: { id: milestone.id },
      data: {
        status: 'RELEASED',
        paypalPayoutBatchId: payout.payoutBatchId,
        paypalPayoutItemId: payout.payoutItemId,
        payoutEmail: email,
        releasedAt: new Date(),
      },
    });

    // Hackathon happy path: mark PAID once payout batch is accepted by PayPal
    const paid = await db.milestone.update({
      where: { id: milestone.id },
      data: { status: 'PAID' },
    });

    return {
      milestone: paid,
      previousStatus: milestone.status,
      released: updated,
      paypal: {
        mode: env.paypal.mode,
        mock: paypal.isMock(),
        payoutBatchId: payout.payoutBatchId,
        payoutItemId: payout.payoutItemId,
        batchStatus: payout.batchStatus,
        receiverEmail: email,
      },
    };
  }

  return {
    fundProjectVault,
    captureVaultOrder,
    releaseMilestone,
    refreshProjectFundedStatus,
    resolveFundAmount,
    RELEASABLE_STATUSES,
  };
}

module.exports = {
  createEscrowService,
  RELEASABLE_STATUSES,
};
