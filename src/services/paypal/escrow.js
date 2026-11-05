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

  async function markFundCaptured({ fund, orderId, captureId }) {
    const updatedFund = await db.vaultFund.update({
      where: { id: fund.id },
      data: {
        status: 'CAPTURED',
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
      },
    });

    if (fund.projectId) {
      await db.project.update({
        where: { id: fund.projectId },
        data: {
          paypalOrderId: orderId,
          paypalCaptureId: captureId,
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

    return updatedFund;
  }

  /**
   * Create PayPal order to lock funds for a project or milestone.
   * Default: create order + return approvalUrl; capture only after buyer approves (return callback).
   * Opt-in autoCapture (env / body) is for mock/local demos only — live sandbox needs approve first.
   */
  async function fundProjectVault({
    userId,
    projectId,
    milestoneId = null,
    amountCents = null,
    currency,
    autoCapture = env.paypal.autoCapture,
    returnUrl = env.paypal.returnUrl,
    cancelUrl = env.paypal.cancelUrl,
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
        returnUrl,
        cancelUrl,
        autoCapture: Boolean(autoCapture),
      },
    };
  }

  async function findVaultFund({ vaultFundId, orderId }) {
    if (vaultFundId) {
      return db.vaultFund.findUnique({ where: { id: String(vaultFundId) } });
    }
    if (orderId) {
      return db.vaultFund.findFirst({
        where: { paypalOrderId: String(orderId) },
        orderBy: { createdAt: 'desc' },
      });
    }
    return null;
  }

  /**
   * Capture a previously created order after buyer approval.
   * Verifies PayPal order status is APPROVED (or COMPLETED) before calling capture.
   */
  async function captureVaultOrder({ userId = null, vaultFundId, orderId, requireApproved = true }) {
    const fund = await findVaultFund({ vaultFundId, orderId });

    if (!fund) {
      const err = new Error('Vault fund not found');
      err.status = 404;
      err.code = 'vault_fund_not_found';
      throw err;
    }
    if (userId && fund.userId !== userId) {
      const err = new Error('Forbidden');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
    if (fund.status === 'CAPTURED') {
      return { vaultFund: fund, alreadyCaptured: true };
    }
    if (fund.status === 'CANCELLED') {
      const err = new Error('Vault fund was cancelled');
      err.status = 409;
      err.code = 'vault_fund_cancelled';
      throw err;
    }

    const targetOrderId = orderId || fund.paypalOrderId;
    if (!targetOrderId) {
      const err = new Error('PayPal order id missing on vault fund');
      err.status = 400;
      err.code = 'missing_order_id';
      throw err;
    }

    if (requireApproved && typeof paypal.getOrder === 'function') {
      const existing = await paypal.getOrder(targetOrderId);
      const status = String(existing.status || '').toUpperCase();
      if (status === 'COMPLETED') {
        const captureId =
          existing.raw?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
          fund.paypalCaptureId ||
          existing.id;
        const updatedFund = await markFundCaptured({ fund, orderId: targetOrderId, captureId });
        return {
          vaultFund: updatedFund,
          alreadyCaptured: true,
          paypal: { id: targetOrderId, status, captureId },
        };
      }
      if (status !== 'APPROVED') {
        const err = new Error(
          `PayPal order is ${status || 'unknown'}; payer must approve before capture`
        );
        err.status = 422;
        err.code = 'order_not_approved';
        err.details = { orderId: targetOrderId, orderStatus: status, approvalUrl: fund.approvalUrl };
        throw err;
      }
    }

    const captured = await paypal.captureOrder(targetOrderId);
    const updatedFund = await markFundCaptured({
      fund,
      orderId: targetOrderId,
      captureId: captured.captureId,
    });

    return { vaultFund: updatedFund, alreadyCaptured: false, paypal: captured };
  }

  /**
   * PayPal return callback: token=ORDER_ID → verify APPROVED → capture → update vault/project/milestone.
   */
  async function completeVaultAfterApproval({ orderId }) {
    if (!orderId) {
      const err = new Error('PayPal token (order id) is required');
      err.status = 400;
      err.code = 'token_required';
      throw err;
    }
    return captureVaultOrder({ orderId: String(orderId), requireApproved: true });
  }

  /**
   * PayPal cancel callback: mark ORDER_CREATED / PENDING fund as CANCELLED.
   */
  async function cancelVaultFund({ orderId, vaultFundId }) {
    const fund = await findVaultFund({ vaultFundId, orderId });
    if (!fund) {
      const err = new Error('Vault fund not found');
      err.status = 404;
      err.code = 'vault_fund_not_found';
      throw err;
    }
    if (fund.status === 'CAPTURED') {
      const err = new Error('Cannot cancel a captured vault fund');
      err.status = 409;
      err.code = 'vault_fund_already_captured';
      throw err;
    }
    if (fund.status === 'CANCELLED') {
      return { vaultFund: fund, alreadyCancelled: true };
    }

    const updatedFund = await db.vaultFund.update({
      where: { id: fund.id },
      data: { status: 'CANCELLED' },
    });

    return { vaultFund: updatedFund, alreadyCancelled: false };
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
      env.paypal.payoutEmail ||
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
    completeVaultAfterApproval,
    cancelVaultFund,
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
