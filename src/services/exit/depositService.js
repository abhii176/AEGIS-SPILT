const { prisma } = require('../../lib/prisma');
const { env } = require('../../config/env');
const { createPaypalService } = require('../paypal');
const { createNotificationService } = require('../notifications');
const {
  resolveDepositAmountCents,
  sumMilestoneTotalCents,
  isCancelledStatus,
} = require('../../lib/exitMath');
const { assertProjectNotCancelled } = require('../../lib/projectStatus');

/**
 * Freelancer security deposit — PayPal Orders approve → capture (mirrors vault escrow).
 */
function createDepositService({
  paypal = createPaypalService(),
  db = prisma,
  notifications = createNotificationService({ db }),
} = {}) {
  async function loadProject(projectId) {
    const project = await db.project.findUnique({
      where: { id: String(projectId) },
      include: {
        milestones: true,
        freelancerDeposits: { orderBy: { createdAt: 'desc' } },
        freelancer: true,
        client: true,
      },
    });
    if (!project) {
      const err = new Error('Project not found');
      err.status = 404;
      err.code = 'project_not_found';
      throw err;
    }
    return project;
  }

  function resolveAmount(project) {
    const amount = resolveDepositAmountCents({
      freelancerDepositAmountCents: project.freelancerDepositAmountCents,
      milestoneTotalCents: sumMilestoneTotalCents(project.milestones),
    });
    if (amount <= 0) {
      const err = new Error(
        'Deposit amount is 0 — add milestones or set freelancerDepositAmountCents on the project'
      );
      err.status = 400;
      err.code = 'deposit_amount_zero';
      throw err;
    }
    return amount;
  }

  async function fundDeposit({
    userId,
    projectId,
    autoCapture = env.paypal.autoCapture,
    returnUrl = env.paypal.returnUrl,
    cancelUrl = env.paypal.cancelUrl,
  }) {
    const project = await loadProject(projectId);
    assertProjectNotCancelled(project, 'funding a deposit');

    if (project.freelancerId !== userId) {
      const err = new Error('Only the project freelancer can fund the security deposit');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
    if (project.depositStatus === 'HELD' || project.depositStatus === 'RETURNED') {
      const err = new Error(`Deposit already ${project.depositStatus}`);
      err.status = 409;
      err.code = 'deposit_already_settled';
      throw err;
    }

    const open = project.freelancerDeposits.find((d) =>
      ['PENDING', 'ORDER_CREATED'].includes(d.status)
    );
    if (open?.approvalUrl && open.status === 'ORDER_CREATED') {
      return {
        deposit: open,
        project,
        paypal: {
          mode: env.paypal.mode,
          mock: paypal.isMock(),
          orderId: open.paypalOrderId,
          approvalUrl: open.approvalUrl,
          autoCapture: false,
          reused: true,
        },
      };
    }

    const amountCents = resolveAmount(project);
    const currency = env.defaultMilestoneCurrency || 'USD';

    // Lock explicit deposit amount on project when funding starts
    if (
      project.freelancerDepositAmountCents == null ||
      project.freelancerDepositAmountCents !== amountCents
    ) {
      await db.project.update({
        where: { id: project.id },
        data: { freelancerDepositAmountCents: amountCents },
      });
    }

    const deposit = await db.freelancerDeposit.create({
      data: {
        userId,
        projectId: project.id,
        amountCents,
        currency,
        status: 'PENDING',
      },
    });

    const order = await paypal.createOrder({
      amountCents,
      currency,
      referenceId: `deposit-${deposit.id}`,
      description: `Aegis deposit: ${project.title}`.slice(0, 127),
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

    const updated = await db.freelancerDeposit.update({
      where: { id: deposit.id },
      data: {
        status,
        paypalOrderId: order.id,
        paypalCaptureId: captureId,
        approvalUrl: order.approvalUrl,
      },
    });

    if (status === 'CAPTURED') {
      await db.project.update({
        where: { id: project.id },
        data: {
          depositStatus: 'HELD',
          freelancerDepositAmountCents: amountCents,
          status: project.status === 'DRAFT' ? 'ACTIVE' : project.status,
        },
      });
      if (typeof notifications.notifyDepositHeld === 'function') {
        await notifications.notifyDepositHeld({
          project,
          amountCents,
        });
      }
    }

    const projectAfter = await db.project.findUnique({ where: { id: project.id } });

    return {
      deposit: updated,
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

  async function findDeposit({ depositId, orderId }) {
    if (depositId) {
      return db.freelancerDeposit.findUnique({ where: { id: String(depositId) } });
    }
    if (orderId) {
      return db.freelancerDeposit.findFirst({
        where: { paypalOrderId: String(orderId) },
        orderBy: { createdAt: 'desc' },
      });
    }
    return null;
  }

  async function markDepositCaptured({ deposit, orderId, captureId }) {
    const updated = await db.freelancerDeposit.update({
      where: { id: deposit.id },
      data: {
        status: 'CAPTURED',
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
      },
    });
    await db.project.update({
      where: { id: deposit.projectId },
      data: {
        depositStatus: 'HELD',
        freelancerDepositAmountCents: deposit.amountCents,
      },
    });
    const project = await db.project.findUnique({ where: { id: deposit.projectId } });
    if (project && typeof notifications.notifyDepositHeld === 'function') {
      try {
        await notifications.notifyDepositHeld({
          project,
          amountCents: deposit.amountCents,
        });
      } catch {
        /* non-fatal */
      }
    }
    return updated;
  }

  async function captureDeposit({ userId = null, depositId, orderId, requireApproved = true }) {
    const deposit = await findDeposit({ depositId, orderId });
    if (!deposit) {
      const err = new Error('Freelancer deposit not found');
      err.status = 404;
      err.code = 'deposit_not_found';
      throw err;
    }
    if (userId && deposit.userId !== userId) {
      const err = new Error('Forbidden');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
    if (deposit.status === 'CAPTURED') {
      return { deposit, alreadyCaptured: true };
    }
    if (deposit.status === 'CANCELLED') {
      const err = new Error('Deposit funding was cancelled');
      err.status = 409;
      err.code = 'deposit_cancelled';
      throw err;
    }

    const project = await db.project.findUnique({ where: { id: deposit.projectId } });
    if (project && isCancelledStatus(project.status)) {
      const err = new Error('Project is cancelled; cannot capture deposit');
      err.status = 409;
      err.code = 'project_cancelled';
      throw err;
    }

    const targetOrderId = orderId || deposit.paypalOrderId;
    if (!targetOrderId) {
      const err = new Error('PayPal order id missing on deposit');
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
          deposit.paypalCaptureId ||
          existing.id;
        const updated = await markDepositCaptured({
          deposit,
          orderId: targetOrderId,
          captureId,
        });
        return { deposit: updated, alreadyCaptured: true, paypal: { id: targetOrderId, status, captureId } };
      }
      if (status !== 'APPROVED') {
        const err = new Error(
          `PayPal order is ${status || 'unknown'}; payer must approve before capture`
        );
        err.status = 422;
        err.code = 'order_not_approved';
        err.details = { orderId: targetOrderId, orderStatus: status, approvalUrl: deposit.approvalUrl };
        throw err;
      }
    }

    const captured = await paypal.captureOrder(targetOrderId);
    const updated = await markDepositCaptured({
      deposit,
      orderId: targetOrderId,
      captureId: captured.captureId,
    });
    return { deposit: updated, alreadyCaptured: false, paypal: captured };
  }

  async function cancelDeposit({ orderId, depositId }) {
    const deposit = await findDeposit({ depositId, orderId });
    if (!deposit) {
      const err = new Error('Freelancer deposit not found');
      err.status = 404;
      err.code = 'deposit_not_found';
      throw err;
    }
    if (deposit.status === 'CAPTURED') {
      const err = new Error('Cannot cancel a captured deposit');
      err.status = 409;
      err.code = 'deposit_already_captured';
      throw err;
    }
    if (deposit.status === 'CANCELLED') {
      return { deposit, alreadyCancelled: true };
    }
    const updated = await db.freelancerDeposit.update({
      where: { id: deposit.id },
      data: { status: 'CANCELLED' },
    });
    return { deposit: updated, alreadyCancelled: false };
  }

  /**
   * After PayPal return: try vault capture first, then deposit capture.
   */
  async function completeAfterApproval({ orderId, vaultCapture, depositCapture }) {
    if (!orderId) {
      const err = new Error('PayPal token (order id) is required');
      err.status = 400;
      err.code = 'token_required';
      throw err;
    }
    // Prefer vault if order belongs to a vault fund
    if (typeof vaultCapture === 'function') {
      try {
        const vault = await vaultCapture({ orderId: String(orderId), requireApproved: true });
        if (vault?.vaultFund) {
          return { kind: 'vault', ...vault };
        }
      } catch (err) {
        if (err.code !== 'vault_fund_not_found') throw err;
      }
    }
    if (typeof depositCapture === 'function') {
      return {
        kind: 'deposit',
        ...(await depositCapture({ orderId: String(orderId), requireApproved: true })),
      };
    }
    return captureDeposit({ orderId: String(orderId), requireApproved: true }).then((r) => ({
      kind: 'deposit',
      ...r,
    }));
  }

  return {
    fundDeposit,
    captureDeposit,
    cancelDeposit,
    findDeposit,
    completeAfterApproval,
    resolveAmount,
    loadProject,
  };
}

module.exports = { createDepositService };
