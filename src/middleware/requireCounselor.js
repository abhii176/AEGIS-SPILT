const { prisma } = require('../lib/prisma');
const { env } = require('../config/env');

/**
 * Counselor (demo) access: a user with role COUNSELOR, or the hackathon admin key.
 * The admin key is the same DEMO_ADMIN_KEY already used to seed Sarah and Rohan.
 */
async function requireCounselor(req, res, next) {
  try {
    const key = req.header('x-demo-admin-key') || req.body?.demoAdminKey;
    const adminOk = Boolean(key) && key === env.demoAdminKey;
    const userId = req.header('x-user-id');
    let user = null;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: String(userId) } });
    }

    if (user && user.role === 'COUNSELOR') {
      req.user = user;
      req.counselor = {
        via: 'counselor_user',
        userId: user.id,
        label: user.name || user.email,
      };
      return next();
    }

    if (adminOk) {
      req.user = user;
      req.counselor = {
        via: 'admin_key',
        userId: null,
        label: 'demo-admin-key',
      };
      return next();
    }

    return res.status(403).json({
      error: 'counselor_forbidden',
      message:
        'Switch to the counselor user or send X-Demo-Admin-Key (DEMO_ADMIN_KEY) to open the counselor panel.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireCounselor };
