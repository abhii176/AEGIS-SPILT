const { createEscrowService } = require('../services/paypal/escrow');
const { env } = require('../config/env');
const { validateReleaseMilestoneBody } = require('../lib/requestValidation');

const escrow = createEscrowService();

/**
 * Release milestone escrow to freelancer PayPal email.
 * Hook for AI auditor after PASS; also used by project + admin/demo routes.
 */
async function releaseMilestone(req, res, next) {
  try {
    const validation = validateReleaseMilestoneBody(req.body || {}, req.params || {});
    if (!validation.ok) {
      return res.status(400).json({ error: validation.errors[0] });
    }

    const result = await escrow.releaseMilestone({
      milestoneId: String(validation.milestoneId),
      recipientEmail: validation.recipientEmail,
      actorUserId: req.user?.id || null,
      allowDemoBypass: Boolean(req.demoAdmin),
    });

    return res.status(200).json({
      milestone: result.milestone,
      paypal: result.paypal,
      note: 'Milestone released via PayPal Payouts; status set to PAID.',
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Middleware: require X-Demo-Admin-Key matching DEMO_ADMIN_KEY for hackathon triggers.
 */
function requireDemoAdmin(req, res, next) {
  const key = req.header('x-demo-admin-key') || req.body?.demoAdminKey;
  if (!key || key !== env.demoAdminKey) {
    return res.status(403).json({
      error: 'demo_admin_forbidden',
      message: 'Provide X-Demo-Admin-Key matching DEMO_ADMIN_KEY for hackathon demo triggers.',
    });
  }
  req.demoAdmin = true;
  return next();
}

module.exports = { releaseMilestone, requireDemoAdmin, escrow };
