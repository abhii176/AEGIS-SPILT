const { createNotificationService } = require('../services/notifications');

const notifications = createNotificationService();

/** GET /api/notifications — list for current X-User-Id */
async function listNotifications(req, res, next) {
  try {
    const unreadOnly =
      req.query?.unread === '1' ||
      req.query?.unread === 'true' ||
      req.query?.unreadOnly === 'true';
    const limit = req.query?.limit != null ? Number(req.query.limit) : 50;

    const result = await notifications.listForUser({
      userId: req.user.id,
      unreadOnly,
      limit,
    });

    return res.status(200).json({
      notifications: result.notifications,
      unreadCount: result.unreadCount,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/notifications/mark-read
 * Body: { notificationIds?: string[], all?: boolean }
 */
async function markNotificationsRead(req, res, next) {
  try {
    const all = Boolean(req.body?.all);
    const notificationIds =
      req.body?.notificationIds ||
      req.body?.notification_ids ||
      (req.body?.notificationId ? [req.body.notificationId] : null);

    const result = await notifications.markRead({
      userId: req.user.id,
      notificationIds,
      all,
    });

    return res.status(200).json({
      updated: result.updated,
      readAt: result.readAt,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listNotifications,
  markNotificationsRead,
  notifications,
};
