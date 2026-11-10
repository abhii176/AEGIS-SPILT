const { prisma } = require('../../lib/prisma');

const TYPES = Object.freeze({
  FUNDED: 'FUNDED',
  AUDIT_PASSED: 'AUDIT_PASSED',
  AUDIT_FAILED: 'AUDIT_FAILED',
  PAID: 'PAID',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  CANCEL_ACCEPTED: 'CANCEL_ACCEPTED',
  PROJECT_EXITED: 'PROJECT_EXITED',
  PENALTY_PAID: 'PENALTY_PAID',
  DEPOSIT_HELD: 'DEPOSIT_HELD',
  DEPOSIT_RETURNED: 'DEPOSIT_RETURNED',
  DEPOSIT_FORFEITED: 'DEPOSIT_FORFEITED',
  DISPUTE_OPENED: 'DISPUTE_OPENED',
  DISPUTE_RESOLVED: 'DISPUTE_RESOLVED',
});

function formatUsd(cents) {
  if (cents == null) return '';
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

/**
 * Persist in-app notifications for the active user (X-User-Id).
 * Idempotent via optional dedupeKey unique per user.
 */
function createNotificationService({ db = prisma } = {}) {
  /**
   * @param {{
   *   userId: string,
   *   type: string,
   *   message: string,
   *   projectId?: string|null,
   *   milestoneId?: string|null,
   *   dedupeKey?: string|null,
   * }} input
   */
  async function createNotification(input) {
    const userId = String(input.userId || '');
    const type = String(input.type || '');
    const message = String(input.message || '').trim();
    if (!userId || !type || !message) {
      const err = new Error('userId, type, and message are required');
      err.status = 400;
      err.code = 'invalid_notification';
      throw err;
    }

    const projectId = input.projectId ? String(input.projectId) : null;
    const milestoneId = input.milestoneId ? String(input.milestoneId) : null;
    const dedupeKey = input.dedupeKey != null && input.dedupeKey !== ''
      ? String(input.dedupeKey)
      : null;

    if (dedupeKey) {
      const existing = await db.notification.findFirst({
        where: { userId, dedupeKey },
      });
      if (existing) {
        return { notification: existing, created: false };
      }
    }

    try {
      const notification = await db.notification.create({
        data: {
          userId,
          type,
          message,
          projectId,
          milestoneId,
          dedupeKey,
        },
      });
      return { notification, created: true };
    } catch (err) {
      // Unique race: treat as idempotent hit
      if (err.code === 'P2002' && dedupeKey) {
        const existing = await db.notification.findFirst({
          where: { userId, dedupeKey },
        });
        if (existing) return { notification: existing, created: false };
      }
      throw err;
    }
  }

  async function listForUser({ userId, unreadOnly = false, limit = 50 } = {}) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const where = {
      userId: String(userId),
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const notifications = await db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });
    const unreadCount = await db.notification.count({
      where: { userId: String(userId), readAt: null },
    });
    return { notifications, unreadCount };
  }

  /**
   * Mark one or many notifications read for a user.
   * @param {{ userId: string, notificationIds?: string[]|null, all?: boolean }} input
   */
  async function markRead({ userId, notificationIds = null, all = false } = {}) {
    const uid = String(userId);
    const now = new Date();

    if (all) {
      const result = await db.notification.updateMany({
        where: { userId: uid, readAt: null },
        data: { readAt: now },
      });
      return { updated: result.count, readAt: now };
    }

    const ids = Array.isArray(notificationIds)
      ? notificationIds.map(String).filter(Boolean)
      : [];
    if (!ids.length) {
      const err = new Error('Provide notificationIds or all=true');
      err.status = 400;
      err.code = 'mark_read_ids_required';
      throw err;
    }

    const result = await db.notification.updateMany({
      where: { userId: uid, id: { in: ids }, readAt: null },
      data: { readAt: now },
    });
    return { updated: result.count, readAt: now };
  }

  /** Notify client + freelancer for a project event (idempotent per party). */
  async function notifyProjectParties({
    project,
    type,
    message,
    milestoneId = null,
    dedupePrefix,
  }) {
    if (!project?.clientId || !project?.freelancerId) {
      return { created: [], skipped: [] };
    }
    const parties = [
      { userId: project.clientId, role: 'client' },
      { userId: project.freelancerId, role: 'freelancer' },
    ];
    const created = [];
    const skipped = [];
    const prefix = dedupePrefix || type;
    const scope = milestoneId || project.id;

    for (const party of parties) {
      const result = await createNotification({
        userId: party.userId,
        type,
        message,
        projectId: project.id,
        milestoneId,
        dedupeKey: `${prefix}:${scope}:${party.userId}`,
      });
      if (result.created) created.push(result.notification);
      else skipped.push(result.notification);
    }
    return { created, skipped };
  }

  async function notifyFunded({ project, milestone = null, amountCents = null }) {
    const title = milestone?.title || project.title;
    const amount =
      amountCents != null
        ? `$${(Number(amountCents) / 100).toFixed(2)}`
        : milestone?.amountCents != null
          ? `$${(milestone.amountCents / 100).toFixed(2)}`
          : 'funds';
    return notifyProjectParties({
      project,
      type: TYPES.FUNDED,
      message: `Vault funded: ${amount} locked for “${title}”.`,
      milestoneId: milestone?.id || null,
      dedupePrefix: `FUNDED`,
    });
  }

  async function notifyAudit({ project, milestone, passed, reason = '' }) {
    const type = passed ? TYPES.AUDIT_PASSED : TYPES.AUDIT_FAILED;
    const verb = passed ? 'passed' : 'failed';
    const detail = reason ? ` ${String(reason).slice(0, 160)}` : '';
    return notifyProjectParties({
      project,
      type,
      message: `AI audit ${verb} for “${milestone.title}”.${detail}`.trim(),
      milestoneId: milestone.id,
      dedupePrefix: type,
    });
  }

  async function notifyPaid({ project, milestone, amountCents = null }) {
    const cents = amountCents ?? milestone.amountCents;
    const amount = cents != null ? `$${(Number(cents) / 100).toFixed(2)}` : 'payout';
    return notifyProjectParties({
      project,
      type: TYPES.PAID,
      message: `Paid: ${amount} released for “${milestone.title}”.`,
      milestoneId: milestone.id,
      dedupePrefix: 'PAID',
    });
  }

  async function notifyCancelRequested({ project, cancellationRequest, requestedByUserId }) {
    const who =
      requestedByUserId === project.clientId ? 'Client' : 'Freelancer';
    return notifyProjectParties({
      project,
      type: TYPES.CANCEL_REQUESTED,
      message: `${who} requested mutual cancellation of “${project.title}”.`,
      dedupePrefix: `CANCEL_REQUESTED:${cancellationRequest.id}`,
    });
  }

  async function notifyCancelAccepted({ project, exitEvent }) {
    return notifyProjectParties({
      project,
      type: TYPES.CANCEL_ACCEPTED,
      message: `Mutual cancellation accepted for “${project.title}”. Vault refunded; deposit returned.`,
      dedupePrefix: `CANCEL_ACCEPTED:${exitEvent?.id || project.id}`,
    });
  }

  async function notifyProjectExited({ project, exitPath, plan, exitEvent }) {
    let message = `Project “${project.title}” exited (${exitPath}).`;
    if (exitPath === 'CLIENT_ONESIDED') {
      message = `Client cancelled “${project.title}”. Penalty ${formatUsd(plan.penaltyCents)} to freelancer; ${formatUsd(plan.clientRefundCents)} refunded to client.`;
    } else if (exitPath === 'FREELANCER_WALKAWAY') {
      message = `Freelancer abandoned “${project.title}”. Deposit forfeited; vault refunded to client.`;
    } else if (exitPath === 'MUTUAL') {
      message = `“${project.title}” cancelled by mutual agreement.`;
    }
    return notifyProjectParties({
      project,
      type: TYPES.PROJECT_EXITED,
      message,
      dedupePrefix: `PROJECT_EXITED:${exitEvent?.id || project.id}`,
    });
  }

  async function notifyPenaltyPaid({ project, amountCents, exitEvent }) {
    return notifyProjectParties({
      project,
      type: TYPES.PENALTY_PAID,
      message: `Early-exit penalty paid: ${formatUsd(amountCents)} to freelancer on “${project.title}”.`,
      dedupePrefix: `PENALTY_PAID:${exitEvent?.id || project.id}`,
    });
  }

  async function notifyDepositHeld({ project, amountCents }) {
    return notifyProjectParties({
      project,
      type: TYPES.DEPOSIT_HELD,
      message: `Freelancer security deposit held: ${formatUsd(amountCents)} on “${project.title}”.`,
      dedupePrefix: `DEPOSIT_HELD:${project.id}`,
    });
  }

  async function notifyDepositReturned({ project, amountCents, exitEvent }) {
    return notifyProjectParties({
      project,
      type: TYPES.DEPOSIT_RETURNED,
      message: `Security deposit returned to freelancer: ${formatUsd(amountCents)} on “${project.title}”.`,
      dedupePrefix: `DEPOSIT_RETURNED:${exitEvent?.id || project.id}`,
    });
  }

  async function notifyDisputeOpened({ project, dispute, raisedByUserId }) {
    const who = raisedByUserId === project.clientId ? 'Client' : 'Freelancer';
    return notifyProjectParties({
      project,
      type: TYPES.DISPUTE_OPENED,
      message: `${who} raised a dispute on “${project.title}”. Payout and exit are paused until the counselor decides.`,
      milestoneId: dispute?.milestoneId || null,
      dedupePrefix: `DISPUTE_OPENED:${dispute?.id || project.id}`,
    });
  }

  async function notifyDisputeResolved({ project, dispute, plan }) {
    const decision = plan?.decision || dispute?.decision || 'RESOLVED';
    const freelancer = formatUsd(plan?.freelancerAmountCents ?? dispute?.freelancerAmountCents);
    const client = formatUsd(plan?.clientRefundCents ?? dispute?.clientRefundCents);
    const deposit = plan?.depositDisposition || dispute?.depositDisposition || 'NONE';
    return notifyProjectParties({
      project,
      type: TYPES.DISPUTE_RESOLVED,
      message: `Counselor decided “${project.title}”: ${decision}. Freelancer ${freelancer}, client refund ${client}, deposit ${deposit}.`,
      milestoneId: dispute?.milestoneId || null,
      dedupePrefix: `DISPUTE_RESOLVED:${dispute?.id || project.id}`,
    });
  }

  async function notifyDepositForfeited({ project, amountCents, exitEvent }) {
    return notifyProjectParties({
      project,
      type: TYPES.DEPOSIT_FORFEITED,
      message: `Security deposit forfeited to client: ${formatUsd(amountCents)} on “${project.title}”.`,
      dedupePrefix: `DEPOSIT_FORFEITED:${exitEvent?.id || project.id}`,
    });
  }

  return {
    TYPES,
    createNotification,
    listForUser,
    markRead,
    notifyProjectParties,
    notifyFunded,
    notifyAudit,
    notifyPaid,
    notifyCancelRequested,
    notifyCancelAccepted,
    notifyProjectExited,
    notifyPenaltyPaid,
    notifyDepositHeld,
    notifyDepositReturned,
    notifyDepositForfeited,
    notifyDisputeOpened,
    notifyDisputeResolved,
  };
}

const defaultService = createNotificationService();

module.exports = {
  TYPES,
  createNotificationService,
  createNotification: defaultService.createNotification,
  listForUser: defaultService.listForUser,
  markRead: defaultService.markRead,
  notifyProjectParties: defaultService.notifyProjectParties,
  notifyFunded: defaultService.notifyFunded,
  notifyAudit: defaultService.notifyAudit,
  notifyPaid: defaultService.notifyPaid,
  notifyCancelRequested: defaultService.notifyCancelRequested,
  notifyCancelAccepted: defaultService.notifyCancelAccepted,
  notifyProjectExited: defaultService.notifyProjectExited,
  notifyPenaltyPaid: defaultService.notifyPenaltyPaid,
  notifyDepositHeld: defaultService.notifyDepositHeld,
  notifyDepositReturned: defaultService.notifyDepositReturned,
  notifyDepositForfeited: defaultService.notifyDepositForfeited,
  notifyDisputeOpened: defaultService.notifyDisputeOpened,
  notifyDisputeResolved: defaultService.notifyDisputeResolved,
};
