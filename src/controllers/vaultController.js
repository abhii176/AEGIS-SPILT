const { prisma } = require('../lib/prisma');
const { isProjectParticipant } = require('./projectsController');

/** POST /api/vault/fund — gated by requireKycAndConsent */
async function fundVault(req, res, next) {
  try {
    const amountCents = Number(req.body?.amountCents ?? req.body?.amount_cents);
    const currency = String(req.body?.currency || 'USD').toUpperCase();
    const projectId = req.body?.projectId || req.body?.project_id || null;

    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({
        error: 'invalid_amount',
        message: 'amountCents must be a positive integer (cents).',
      });
    }

    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: String(projectId) } });
      if (!project) {
        return res.status(404).json({ error: 'project_not_found' });
      }
      if (!isProjectParticipant(req.user.id, project)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const fund = await prisma.vaultFund.create({
      data: {
        userId: req.user.id,
        projectId: projectId ? String(projectId) : null,
        amountCents,
        currency,
      },
    });

    return res.status(201).json({
      vaultFund: fund,
      note: 'PayPal Orders lock not wired yet — scaffold record only.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { fundVault };
