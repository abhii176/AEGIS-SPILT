const { env } = require('../config/env');
const { createEscrowService } = require('../services/paypal/escrow');
const {
  validateFundVaultBody,
  validateCaptureVaultBody,
} = require('../lib/requestValidation');

const escrow = createEscrowService();

function wantsJson(req) {
  const accept = String(req.headers.accept || '');
  return (
    req.query?.format === 'json' ||
    accept.includes('application/json') ||
    String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest'
  );
}

/** POST /api/vault/fund — gated by requireKycAndConsent */
async function fundVault(req, res, next) {
  try {
    const validation = validateFundVaultBody(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.errors[0],
        message:
          validation.errors[0] === 'project_id_required'
            ? 'projectId is required to lock escrow funds.'
            : `Invalid fund request (${validation.errors[0]}).`,
      });
    }

    const { projectId, milestoneId, amountCents, currency } = validation;

    // Default: no auto-capture. Opt-in only via body or PAYPAL_AUTO_CAPTURE=true.
    let autoCapture = env.paypal.autoCapture;
    const parseBool = (v) => v === true || v === 'true' || v === 1 || v === '1';
    if (req.body?.capture != null) autoCapture = parseBool(req.body.capture);
    else if (req.body?.autoCapture != null) autoCapture = parseBool(req.body.autoCapture);

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
      approveUrl: result.paypal.approvalUrl,
      note: result.paypal.autoCapture
        ? 'PayPal order created and captured — funds locked in escrow vault.'
        : 'PayPal order created — redirect buyer to approvalUrl (or approveUrl), then capture runs on return.',
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/vault/capture — gated by requireKycAndConsent */
async function captureVault(req, res, next) {
  try {
    const validation = validateCaptureVaultBody(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.errors[0],
        message:
          validation.errors[0] === 'order_or_fund_required'
            ? 'Provide vaultFundId or orderId (PayPal token).'
            : `Invalid capture request (${validation.errors[0]}).`,
      });
    }

    const result = await escrow.captureVaultOrder({
      userId: req.user.id,
      vaultFundId: validation.vaultFundId,
      orderId: validation.orderId,
      requireApproved: true,
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

/**
 * GET/POST /api/vault/paypal/return?token=ORDER_ID
 * PayPal browser redirect after buyer approves — no auth header available.
 */
async function paypalReturn(req, res, next) {
  try {
    const orderId =
      req.query?.token ||
      req.query?.orderId ||
      req.body?.token ||
      req.body?.orderId ||
      null;

    const result = await escrow.completeVaultAfterApproval({ orderId });

    if (wantsJson(req)) {
      return res.status(200).json({
        ok: true,
        vaultFund: result.vaultFund,
        alreadyCaptured: result.alreadyCaptured,
        paypal: result.paypal || null,
        note: 'PayPal order captured after approval — funds locked in escrow vault.',
      });
    }

    const fundId = result.vaultFund?.id || '';
    const captureId = result.vaultFund?.paypalCaptureId || result.paypal?.captureId || '';
    return res
      .status(200)
      .type('html')
      .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Aegis-Split — Funded</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
.ok{color:#0a7a3e;font-weight:600}</style></head>
<body>
  <p class="ok">Payment approved and captured.</p>
  <p>Escrow funds are locked in the Aegis-Split vault.</p>
  <ul>
    <li>Order: <code>${String(orderId || '').replace(/[<>&]/g, '')}</code></li>
    <li>Vault fund: <code>${String(fundId).replace(/[<>&]/g, '')}</code></li>
    <li>Capture: <code>${String(captureId).replace(/[<>&]/g, '')}</code></li>
  </ul>
  <p><a href="${env.appBaseUrl}/">Continue</a></p>
</body></html>`);
  } catch (err) {
    if (wantsJson(req)) return next(err);
    const status = err.status || err.statusCode || 500;
    const message = String(err.message || 'Unexpected error').replace(/[<>&]/g, '');
    const code = String(err.code || 'internal_error').replace(/[<>&]/g, '');
    return res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Aegis-Split — Capture failed</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
.err{color:#a11}</style></head>
<body>
  <p class="err">Could not capture PayPal payment (${code}).</p>
  <p>${message}</p>
  <p><a href="${env.appBaseUrl}/">Back</a></p>
</body></html>`);
  }
}

/**
 * GET/POST /api/vault/paypal/cancel?token=ORDER_ID
 * Buyer cancelled on PayPal — mark vault fund CANCELLED.
 */
async function paypalCancel(req, res, next) {
  try {
    const orderId =
      req.query?.token ||
      req.query?.orderId ||
      req.body?.token ||
      req.body?.orderId ||
      null;
    const vaultFundId = req.query?.vaultFundId || req.body?.vaultFundId || null;

    if (!orderId && !vaultFundId) {
      const err = new Error('Provide token (order id) or vaultFundId to cancel funding');
      err.status = 400;
      err.code = 'token_required';
      throw err;
    }

    const result = await escrow.cancelVaultFund({ orderId, vaultFundId });

    if (wantsJson(req)) {
      return res.status(200).json({
        ok: true,
        vaultFund: result.vaultFund,
        alreadyCancelled: result.alreadyCancelled,
        note: 'Funding cancelled — no funds captured.',
      });
    }

    return res
      .status(200)
      .type('html')
      .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Aegis-Split — Cancelled</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}</style></head>
<body>
  <p>PayPal checkout cancelled. No funds were captured.</p>
  <p>Vault fund status: <code>${String(result.vaultFund?.status || '').replace(/[<>&]/g, '')}</code></p>
  <p><a href="${env.appBaseUrl}/">Back</a></p>
</body></html>`);
  } catch (err) {
    if (wantsJson(req)) return next(err);
    const status = err.status || err.statusCode || 500;
    const message = String(err.message || 'Unexpected error').replace(/[<>&]/g, '');
    return res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Aegis-Split — Cancel error</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}</style></head>
<body><p>${message}</p><p><a href="${env.appBaseUrl}/">Back</a></p></body></html>`);
  }
}

module.exports = {
  fundVault,
  captureVault,
  paypalReturn,
  paypalCancel,
  escrow,
};
