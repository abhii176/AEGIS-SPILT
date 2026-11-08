const { env } = require('../config/env');
const {
  verifyPaypalWebhookSignature,
  paypalWebhookHeadersFromReq,
} = require('../services/paypal/webhookSignature');
const { createEscrowService } = require('../services/paypal/escrow');

const escrow = createEscrowService();

/**
 * POST /api/webhooks/paypal
 * Verifies PayPal webhook signature (REST verify API), then acks / optionally
 * completes vault capture for capture/order events. Does not replace the
 * browser approve → return → capture flow.
 */
async function paypalWebhook(req, res, next) {
  try {
    const webhookId = env.paypal.webhookId;
    if (
      !webhookId ||
      String(webhookId).toLowerCase().startsWith('your_') ||
      String(webhookId).includes('placeholder')
    ) {
      return res.status(503).json({
        error: 'webhook_id_missing',
        message: 'Set PAYPAL_WEBHOOK_ID to accept PayPal webhooks.',
      });
    }

    const headers = paypalWebhookHeadersFromReq(req);
    const verification = await verifyPaypalWebhookSignature({
      headers,
      webhookEvent: req.body,
      webhookId,
    });

    if (!verification.ok) {
      return res.status(401).json({
        error: 'invalid_signature',
        message: 'PayPal webhook signature verification failed.',
        reason: verification.reason || verification.status || 'verification_failed',
      });
    }

    const eventType = String(req.body?.event_type || '');
    const resource = req.body?.resource || {};

    // Optional backup capture path — primary path remains /api/vault/paypal/return
    const orderId =
      resource?.supplementary_data?.related_ids?.order_id ||
      resource?.id ||
      null;

    let capture = null;
    if (
      (eventType === 'PAYMENT.CAPTURE.COMPLETED' ||
        eventType === 'CHECKOUT.ORDER.APPROVED' ||
        eventType === 'CHECKOUT.ORDER.COMPLETED') &&
      orderId
    ) {
      try {
        // For CAPTURE.COMPLETED, resource.id is the capture id — prefer related order id
        const vaultOrderId =
          resource?.supplementary_data?.related_ids?.order_id ||
          (eventType.startsWith('CHECKOUT.ORDER') ? resource.id : null);
        if (vaultOrderId) {
          capture = await escrow.completeVaultAfterApproval({ orderId: String(vaultOrderId) });
        }
      } catch (err) {
        // Ack business misses with 200 so PayPal does not retry forever
        if (
          err.code === 'vault_fund_not_found' ||
          err.code === 'order_not_found' ||
          err.code === 'order_not_approved' ||
          err.status === 404
        ) {
          return res.status(200).json({
            ok: true,
            verified: true,
            event_type: eventType,
            handled: false,
            reason: err.code || 'not_applicable',
          });
        }
        throw err;
      }
    }

    return res.status(200).json({
      ok: true,
      verified: true,
      event_type: eventType,
      handled: Boolean(capture),
      vaultFund: capture?.vaultFund
        ? { id: capture.vaultFund.id, status: capture.vaultFund.status }
        : null,
      alreadyCaptured: Boolean(capture?.alreadyCaptured),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { paypalWebhook };
