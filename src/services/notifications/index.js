const { prisma } = require('../../lib/prisma');

const TYPES = Object.freeze({
  FUNDED: 'FUNDED',
  AUDIT_PASSED: 'AUDIT_PASSED',
  AUDIT_FAILED: 'AUDIT_FAILED',
  PAID: 'PAID',
});

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

  return {
    TYPES,
    createNotification,
    listForUser,
    markRead,
    notifyProjectParties,
    notifyFunded,
    notifyAudit,
    notifyPaid,
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
};
