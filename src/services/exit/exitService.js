const { prisma } = require('../../lib/prisma');
const { env } = require('../../config/env');
const { createPaypalService } = require('../paypal');
const { createNotificationService } = require('../notifications');
const {
  resolveDepositAmountCents,
  remainingVaultCents,
  buildExitMoneyPlan,
  isCancelledStatus,
  sumMilestoneTotalCents,
  sumPaidOutCents,
  sumCapturedVaultCents,
} = require('../../lib/exitMath');

/**
 * Exit / cancellation orchestration — mutual, client one-sided, freelancer walk-away.
 * Idempotent via ExitEvent.idempotencyKey = `exit:${projectId}`.
 */
function createExitService({
  paypal = createPaypalService(),
  db = prisma,
  notifications = createNotificationService({ db }),
} = {}) {
  async function loadProjectBundle(projectId) {
    const project = await db.project.findUnique({
      where: { id: String(projectId) },
      include: {
        client: true,
        freelancer: true,
        milestones: { orderBy: { sequence: 'asc' } },
        vaultFunds: true,
        freelancerDeposits: { orderBy: { createdAt: 'desc' } },
        cancellationRequests: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        },
        exitEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
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

  function assertParticipant(userId, project) {
    if (project.clientId !== userId && project.freelancerId !== userId) {
      const err = new Error('Forbidden');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
  }

  function depositAmountFor(project) {
    return resolveDepositAmountCents({
      freelancerDepositAmountCents: project.freelancerDepositAmountCents,
      milestoneTotalCents: sumMilestoneTotalCents(project.milestones),
    });
  }

  function vaultSnapshot(project) {
    const captured = sumCapturedVaultCents(project.vaultFunds);
    const paid = sumPaidOutCents(project.milestones);
    return {
      capturedVaultCents: captured,
      paidOutCents: paid,
      remainingVaultCents: remainingVaultCents({
        capturedVaultCents: captured,
        paidOutCents: paid,
      }),
    };
  }

  function previewForPath(project, exitPath) {
    const snap = vaultSnapshot(project);
    const depositCents =
      project.depositStatus === 'HELD'
        ? project.freelancerDeposits.find((d) => d.status === 'CAPTURED')?.amountCents ||
          depositAmountFor(project)
        : 0;

    const plan = buildExitMoneyPlan({
      exitPath,
      remainingVaultCents: snap.remainingVaultCents,
      earlyExitPenaltyPercent: project.earlyExitPenaltyPercent,
      depositCents,
      depositStatus: project.depositStatus,
    });

    return {
      projectId: project.id,
      title: project.title,
      status: project.status,
      earlyExitPenaltyPercent: project.earlyExitPenaltyPercent,
      depositStatus: project.depositStatus,
      depositAmountCents: depositAmountFor(project),
      vault: snap,
      plan,
      lines: describePlanLines(plan),
    };
  }

  function describePlanLines(plan) {
    const lines = [];
    if (plan.clientRefundCents > 0) {
      lines.push({
        to: 'client',
        label: 'Refund unspent vault to client',
        amountCents: plan.clientRefundCents,
      });
    }
    if (plan.freelancerPayoutCents > 0) {
      lines.push({
        to: 'freelancer',
        label: `Early-exit penalty (${plan.penaltyCents}¢ of remaining vault)`,
        amountCents: plan.freelancerPayoutCents,
      });
    }
    if (plan.depositDisposition === 'RETURNED' && plan.depositCents > 0) {
      lines.push({
        to: 'freelancer',
        label: 'Return security deposit to freelancer',
        amountCents: plan.depositCents,
      });
    }
    if (plan.depositDisposition === 'FORFEITED' && plan.depositCents > 0) {
      lines.push({
        to: 'client',
        label: 'Forfeit security deposit to client',
        amountCents: plan.depositCents,
      });
    }
    if (!lines.length) {
      lines.push({ to: 'none', label: 'No funds to move', amountCents: 0 });
    }
    return lines;
  }

  async function getExitPreview({ projectId, userId, exitPath }) {
    const project = await loadProjectBundle(projectId);
    assertParticipant(userId, project);
    if (isCancelledStatus(project.status)) {
      return {
        alreadyExited: true,
        project,
        preview: previewForPath(project, exitPath || 'MUTUAL'),
        exitEvent: project.exitEvents[0] || null,
      };
    }
    const path = String(exitPath || 'MUTUAL').toUpperCase();
    if (!['MUTUAL', 'CLIENT_ONESIDED', 'FREELANCER_WALKAWAY'].includes(path)) {
      const err = new Error('exitPath must be MUTUAL, CLIENT_ONESIDED, or FREELANCER_WALKAWAY');
      err.status = 400;
      err.code = 'invalid_exit_path';
      throw err;
    }
    return { alreadyExited: false, preview: previewForPath(project, path), project };
  }

  /**
   * Refund remaining vault to client across CAPTURED funds (oldest first).
   * Tracks refundedCents on each VaultFund for idempotency.
   */
  async function refundVaultToClient({ project, amountCents }) {
    let left = Math.max(0, Number(amountCents) || 0);
    const refunds = [];
    if (left <= 0) return refunds;

    const funds = (project.vaultFunds || [])
      .filter((f) => f.status === 'CAPTURED' && f.paypalCaptureId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    for (const fund of funds) {
      if (left <= 0) break;
      const already = Number(fund.refundedCents) || 0;
      const available = Math.max(0, fund.amountCents - already);
      if (available <= 0) continue;
      const slice = Math.min(available, left);
      const currency = fund.currency || 'USD';

      const result = await paypal.refundCapture({
        captureId: fund.paypalCaptureId,
        amountCents: slice,
        currency,
        note: `Aegis-Split exit refund: ${project.title}`.slice(0, 255),
      });

      const refundIds = Array.isArray(fund.paypalRefundIds) ? [...fund.paypalRefundIds] : [];
      if (result.refundId) refundIds.push(result.refundId);

      await db.vaultFund.update({
        where: { id: fund.id },
        data: {
          refundedCents: already + slice,
          paypalRefundIds: refundIds,
        },
      });

      refunds.push({
        vaultFundId: fund.id,
        captureId: fund.paypalCaptureId,
        refundId: result.refundId,
        amountCents: slice,
        mock: paypal.isMock(),
      });
      left -= slice;
    }

    if (left > 0 && !paypal.isMock()) {
      // Not enough refundable capture balance — record shortfall for ops.
      refunds.push({ shortfallCents: left, note: 'capture_refund_shortfall' });
    } else if (left > 0 && paypal.isMock()) {
      // Mock: still account for planned refund even if capture rows missing
      refunds.push({
        refundId: `MOCK-REFUND-SHORTFALL-${project.id}`,
        amountCents: left,
        mock: true,
        note: 'mock_ledger_only',
      });
    }

    return refunds;
  }

  async function payoutAmount({ email, amountCents, currency, senderBatchId, senderItemId, note }) {
    if (!amountCents || amountCents <= 0) return null;
    const receiver = String(email || '').trim();
    if (!receiver) {
      const err = new Error('Payout receiver email missing');
      err.status = 400;
      err.code = 'payout_email_missing';
      throw err;
    }
    return paypal.createPayout({
      amountCents,
      currency: currency || env.defaultMilestoneCurrency || 'USD',
      receiverEmail: receiver,
      senderBatchId,
      senderItemId,
      note,
      emailSubject: 'Aegis-Split exit transfer',
    });
  }

  async function settleDeposit({ project, plan }) {
    if (plan.depositDisposition === 'NONE' || plan.depositCents <= 0) {
      return { depositStatus: project.depositStatus, payout: null };
    }

    const deposit =
      project.freelancerDeposits.find((d) => d.status === 'CAPTURED') ||
      project.freelancerDeposits[0] ||
      null;

    if (plan.depositDisposition === 'RETURNED') {
      const email =
        project.freelancer.paypalEmail ||
        env.paypal.payoutEmail ||
        project.freelancer.email;
      const payout = await payoutAmount({
        email,
        amountCents: plan.depositCents,
        currency: deposit?.currency,
        senderBatchId: `deposit-return-${project.id}`,
        senderItemId: `dep-ret-${project.id}`,
        note: `Return security deposit: ${project.title}`,
      });
      if (deposit) {
        await db.freelancerDeposit.update({
          where: { id: deposit.id },
          data: {
            dispositionBatchId: payout?.payoutBatchId || null,
            dispositionItemId: payout?.payoutItemId || null,
          },
        });
      }
      await db.project.update({
        where: { id: project.id },
        data: { depositStatus: 'RETURNED' },
      });
      return { depositStatus: 'RETURNED', payout };
    }

    if (plan.depositDisposition === 'FORFEITED') {
      const email =
        project.client.paypalEmail || env.paypal.payoutEmail || project.client.email;
      const payout = await payoutAmount({
        email,
        amountCents: plan.depositCents,
        currency: deposit?.currency,
        senderBatchId: `deposit-forfeit-${project.id}`,
        senderItemId: `dep-for-${project.id}`,
        note: `Forfeited security deposit: ${project.title}`,
      });
      if (deposit) {
        await db.freelancerDeposit.update({
          where: { id: deposit.id },
          data: {
            dispositionBatchId: payout?.payoutBatchId || null,
            dispositionItemId: payout?.payoutItemId || null,
          },
        });
      }
      await db.project.update({
        where: { id: project.id },
        data: { depositStatus: 'FORFEITED' },
      });
      return { depositStatus: 'FORFEITED', payout };
    }

    return { depositStatus: project.depositStatus, payout: null };
  }

  async function executeExit({
    projectId,
    userId,
    exitPath,
    reason = null,
    cancellationRequestId = null,
  }) {
    const project = await loadProjectBundle(projectId);
    assertParticipant(userId, project);

    const idempotencyKey = `exit:${project.id}`;
    const existing = await db.exitEvent.findUnique({ where: { idempotencyKey } });
    if (existing || isCancelledStatus(project.status)) {
      return {
        alreadyExited: true,
        exitEvent: existing || project.exitEvents[0] || null,
        project,
      };
    }

    const path = String(exitPath).toUpperCase();
    if (path === 'CLIENT_ONESIDED' && userId !== project.clientId) {
      const err = new Error('Only the client can one-sided cancel');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
    if (path === 'FREELANCER_WALKAWAY' && userId !== project.freelancerId) {
      const err = new Error('Only the freelancer can walk away');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
    if (path === 'MUTUAL') {
      // Mutual must be via acceptCancellation; allow only when a PENDING request exists
      // and the actor is the non-requester (or caller already validated).
      if (!cancellationRequestId) {
        const err = new Error('Mutual exit requires an accepted cancellation request');
        err.status = 400;
        err.code = 'cancellation_request_required';
        throw err;
      }
    }

    const preview = previewForPath(project, path);
    const plan = preview.plan;

    // 1) Penalty payout to freelancer (client one-sided)
    let penaltyPayout = null;
    if (plan.freelancerPayoutCents > 0) {
      const email =
        project.freelancer.paypalEmail ||
        env.paypal.payoutEmail ||
        project.freelancer.email;
      penaltyPayout = await payoutAmount({
        email,
        amountCents: plan.freelancerPayoutCents,
        currency: env.defaultMilestoneCurrency || 'USD',
        senderBatchId: `penalty-${project.id}`,
        senderItemId: `pen-${project.id}`,
        note: `Early-exit penalty: ${project.title}`,
      });
    }

    // 2) Refund remaining vault (minus penalty already paid out) to client
    const vaultRefunds = await refundVaultToClient({
      project,
      amountCents: plan.clientRefundCents,
    });

    // 3) Deposit return / forfeit
    const depositResult = await settleDeposit({ project, plan });

    // 4) Mark milestones cancelled if still open
    await db.milestone.updateMany({
      where: {
        projectId: project.id,
        status: {
          notIn: ['PAID', 'RELEASED', 'CANCELLED'],
        },
      },
      data: { status: 'CANCELLED' },
    });

    // 5) Persist exit event + project status (unique key → idempotent under race)
    let exitEvent;
    try {
      exitEvent = await db.exitEvent.create({
        data: {
          projectId: project.id,
          exitPath: path,
          initiatedByUserId: userId,
          reason: reason ? String(reason).slice(0, 2000) : null,
          remainingVaultCents: plan.remainingVaultCents,
          penaltyCents: plan.penaltyCents,
          clientRefundCents: plan.clientRefundCents,
          freelancerPayoutCents: plan.freelancerPayoutCents,
          depositCents: plan.depositCents,
          depositDisposition: plan.depositDisposition,
          idempotencyKey,
          transferIds: {
            penaltyPayoutBatchId: penaltyPayout?.payoutBatchId || null,
            penaltyPayoutItemId: penaltyPayout?.payoutItemId || null,
            vaultRefunds,
            depositBatchId: depositResult.payout?.payoutBatchId || null,
            depositItemId: depositResult.payout?.payoutItemId || null,
            mock: paypal.isMock(),
          },
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        const raced = await db.exitEvent.findUnique({ where: { idempotencyKey } });
        return { alreadyExited: true, exitEvent: raced, project };
      }
      throw err;
    }

    if (cancellationRequestId) {
      await db.cancellationRequest.update({
        where: { id: cancellationRequestId },
        data: {
          status: 'ACCEPTED',
          respondedByUserId: userId,
          respondedAt: new Date(),
        },
      });
      await db.cancellationRequest.updateMany({
        where: {
          projectId: project.id,
          status: 'PENDING',
          id: { not: cancellationRequestId },
        },
        data: { status: 'SUPERSEDED' },
      });
    } else {
      await db.cancellationRequest.updateMany({
        where: { projectId: project.id, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });
    }

    const updatedProject = await db.project.update({
      where: { id: project.id },
      data: { status: plan.projectStatus },
      include: {
        milestones: { orderBy: { sequence: 'asc' } },
        client: { select: { id: true, email: true, name: true, role: true } },
        freelancer: { select: { id: true, email: true, name: true, role: true } },
        exitEvents: true,
        cancellationRequests: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    await emitExitNotifications({
      project: updatedProject,
      exitPath: path,
      plan,
      exitEvent,
    });

    return {
      alreadyExited: false,
      exitEvent,
      project: updatedProject,
      plan,
      lines: preview.lines,
      transfers: {
        penaltyPayout,
        vaultRefunds,
        deposit: depositResult,
      },
    };
  }

  async function emitExitNotifications({ project, exitPath, plan, exitEvent }) {
    if (typeof notifications.notifyCancelAccepted === 'function' && exitPath === 'MUTUAL') {
      await notifications.notifyCancelAccepted({ project, exitEvent });
    }
    if (typeof notifications.notifyPenaltyPaid === 'function' && plan.penaltyCents > 0) {
      await notifications.notifyPenaltyPaid({
        project,
        amountCents: plan.penaltyCents,
        exitEvent,
      });
    }
    if (
      typeof notifications.notifyDepositReturned === 'function' &&
      plan.depositDisposition === 'RETURNED'
    ) {
      await notifications.notifyDepositReturned({
        project,
        amountCents: plan.depositCents,
        exitEvent,
      });
    }
    if (
      typeof notifications.notifyDepositForfeited === 'function' &&
      plan.depositDisposition === 'FORFEITED'
    ) {
      await notifications.notifyDepositForfeited({
        project,
        amountCents: plan.depositCents,
        exitEvent,
      });
    }
    if (typeof notifications.notifyProjectExited === 'function') {
      await notifications.notifyProjectExited({ project, exitPath, plan, exitEvent });
    }
  }

  async function requestCancellation({ projectId, userId, reason = null }) {
    const project = await loadProjectBundle(projectId);
    assertParticipant(userId, project);
    if (isCancelledStatus(project.status)) {
      const err = new Error('Project already cancelled');
      err.status = 409;
      err.code = 'project_cancelled';
      throw err;
    }
    if (project.status === 'COMPLETED') {
      const err = new Error('Completed projects cannot be cancelled');
      err.status = 409;
      err.code = 'project_completed';
      throw err;
    }

    const existingPending = project.cancellationRequests[0];
    if (existingPending) {
      if (existingPending.requestedByUserId === userId) {
        return { cancellationRequest: existingPending, created: false, preview: previewForPath(project, 'MUTUAL') };
      }
      const err = new Error('A cancellation request is already pending from the other party — accept or wait');
      err.status = 409;
      err.code = 'cancellation_pending';
      err.details = { cancellationRequestId: existingPending.id };
      throw err;
    }

    const cancellationRequest = await db.cancellationRequest.create({
      data: {
        projectId: project.id,
        requestedByUserId: userId,
        reason: reason ? String(reason).slice(0, 2000) : null,
        status: 'PENDING',
      },
    });

    if (typeof notifications.notifyCancelRequested === 'function') {
      await notifications.notifyCancelRequested({
        project,
        cancellationRequest,
        requestedByUserId: userId,
      });
    }

    return {
      cancellationRequest,
      created: true,
      preview: previewForPath(project, 'MUTUAL'),
    };
  }

  async function acceptCancellation({ projectId, userId, cancellationRequestId = null, reason = null }) {
    const project = await loadProjectBundle(projectId);
    assertParticipant(userId, project);

    const pending =
      (cancellationRequestId
        ? await db.cancellationRequest.findFirst({
            where: { id: String(cancellationRequestId), projectId: project.id, status: 'PENDING' },
          })
        : project.cancellationRequests[0]) || null;

    if (!pending) {
      const err = new Error('No pending cancellation request to accept');
      err.status = 404;
      err.code = 'cancellation_not_found';
      throw err;
    }
    if (pending.requestedByUserId === userId) {
      const err = new Error('The other party must accept your cancellation request');
      err.status = 403;
      err.code = 'cannot_self_accept';
      throw err;
    }

    return executeExit({
      projectId: project.id,
      userId,
      exitPath: 'MUTUAL',
      reason: reason || pending.reason,
      cancellationRequestId: pending.id,
    });
  }

  async function clientOnesidedCancel({ projectId, userId, reason = null }) {
    return executeExit({
      projectId,
      userId,
      exitPath: 'CLIENT_ONESIDED',
      reason,
    });
  }

  async function freelancerWalkAway({ projectId, userId, reason = null }) {
    return executeExit({
      projectId,
      userId,
      exitPath: 'FREELANCER_WALKAWAY',
      reason,
    });
  }

  /**
   * Return held deposit after successful project completion (all milestones paid).
   * Idempotent if deposit already RETURNED/FORFEITED.
   */
  async function returnDepositOnCompletion({ projectId }) {
    const project = await loadProjectBundle(projectId);
    if (project.depositStatus !== 'HELD') {
      return { skipped: true, depositStatus: project.depositStatus };
    }
    const open = project.milestones.filter(
      (m) => !['PAID', 'RELEASED', 'CANCELLED'].includes(m.status)
    );
    if (open.length) {
      return { skipped: true, reason: 'milestones_open', depositStatus: 'HELD' };
    }

    const plan = buildExitMoneyPlan({
      exitPath: 'MUTUAL',
      remainingVaultCents: 0,
      depositCents:
        project.freelancerDeposits.find((d) => d.status === 'CAPTURED')?.amountCents ||
        depositAmountFor(project),
      depositStatus: 'HELD',
    });
    // Force return-only settlement
    plan.clientRefundCents = 0;
    plan.freelancerPayoutCents = 0;
    plan.penaltyCents = 0;

    const depositResult = await settleDeposit({ project, plan });
    if (typeof notifications.notifyDepositReturned === 'function') {
      await notifications.notifyDepositReturned({
        project,
        amountCents: plan.depositCents,
        exitEvent: null,
      });
    }
    return { skipped: false, depositStatus: depositResult.depositStatus, payout: depositResult.payout };
  }

  return {
    loadProjectBundle,
    depositAmountFor,
    vaultSnapshot,
    previewForPath,
    getExitPreview,
    requestCancellation,
    acceptCancellation,
    clientOnesidedCancel,
    freelancerWalkAway,
    executeExit,
    returnDepositOnCompletion,
    refundVaultToClient,
  };
}

module.exports = { createExitService };
