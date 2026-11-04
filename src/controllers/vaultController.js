const { createEscrowService } = require('../services/paypal/escrow');

const escrow = createEscrowService();

/** POST /api/vault/fund — gated by requireKycAndConsent */
async function fundVault(req, res, next) {
  try {
    const projectId = req.body?.projectId || req.body?.project_id;
    if (!projectId) {
      return res.status(400).json({
        error: 'project_id_required',
        message: 'projectId is required to lock escrow funds.',
      });
    }

    const milestoneId = req.body?.milestoneId || req.body?.milestone_id || null;
    const amountCentsRaw = req.body?.amountCents ?? req.body?.amount_cents;
    const amountCents = amountCentsRaw != null ? Number(amountCentsRaw) : null;
    const currency = req.body?.currency ? String(req.body.currency).toUpperCase() : undefined;

    const autoCapture =
      req.body?.capture != null
        ? Boolean(req.body.capture)
        : req.body?.autoCapture != null
          ? Boolean(req.body.autoCapture)
          : undefined;

    const result = await escrow.fundProjectVault({
      userId: req.user.id,
      projectId: String(projectId),
      milestoneId: milestoneId ? String(milestoneId) : null,
      amountCents,
      currency,
      autoCapture,
    });

    return res.status(201).json({
      vaultFund: result.vaultFund,
      project: result.project,
      paypal: result.paypal,
      note: result.paypal.autoCapture
        ? 'PayPal order created and captured — funds locked in escrow vault.'
        : 'PayPal order created — open approvalUrl, then POST /api/vault/capture.',
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/vault/capture — gated by requireKycAndConsent */
async function captureVault(req, res, next) {
  try {
    const vaultFundId = req.body?.vaultFundId || req.body?.vault_fund_id || null;
    const orderId = req.body?.orderId || req.body?.order_id || req.body?.token || null;

    if (!vaultFundId && !orderId) {
      return res.status(400).json({
        error: 'order_or_fund_required',
        message: 'Provide vaultFundId or orderId (PayPal token).',
      });
    }

    const result = await escrow.captureVaultOrder({
      userId: req.user.id,
      vaultFundId,
      orderId,
    });

    return res.status(200).json({
      vaultFund: result.vaultFund,
      alreadyCaptured: result.alreadyCaptured,
      paypal: result.paypal || null,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { fundVault, captureVault, escrow };
