const { prisma } = require('../lib/prisma');

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
