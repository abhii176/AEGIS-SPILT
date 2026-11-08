const { createPaypalClient } = require('./client');
const { env } = require('../../config/env');

/**
 * Verify PayPal webhook via REST postback:
 * POST /v1/notifications/verify-webhook-signature
 *
 * @param {object} opts
 * @param {object} opts.headers - request headers (paypal-transmission-* etc.)
 * @param {object} opts.webhookEvent - parsed JSON body from PayPal
 * @param {string} [opts.webhookId] - PAYPAL_WEBHOOK_ID
 * @param {ReturnType<typeof createPaypalClient>} [opts.client]
 * @returns {Promise<{ ok: boolean, status?: string, skipped?: boolean, reason?: string }>}
 */
async function verifyPaypalWebhookSignature({
  headers = {},
  webhookEvent,
  webhookId = env.paypal.webhookId,
  client = createPaypalClient(),
} = {}) {
  const id = String(webhookId || '').trim();
  if (!id || id.toLowerCase().startsWith('your_') || id.includes('placeholder')) {
    return { ok: false, reason: 'webhook_id_missing' };
  }

  const h = normalizeHeaders(headers);
  const authAlgo = h['paypal-auth-algo'];
  const certUrl = h['paypal-cert-url'];
  const transmissionId = h['paypal-transmission-id'];
  const transmissionSig = h['paypal-transmission-sig'];
  const transmissionTime = h['paypal-transmission-time'];

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return { ok: false, reason: 'missing_paypal_headers' };
  }

  if (!webhookEvent || typeof webhookEvent !== 'object') {
    return { ok: false, reason: 'missing_webhook_event' };
  }

  // Mock PayPal client: accept only when headers look like a test transmission
  if (client.isMock()) {
    if (String(transmissionSig).startsWith('MOCK-') || id === 'WEBHOOK_ID') {
      return { ok: true, status: 'SUCCESS', skipped: true };
    }
    // Still post through mock request path for unit tests that inject fetchImpl
  }

  const result = await client.request('POST', '/v1/notifications/verify-webhook-signature', {
    body: {
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: id,
      webhook_event: webhookEvent,
    },
  });

  if (result?.mock === true) {
    // createPaypalClient mock short-circuits request() — treat as verified only with mock sig
    if (String(transmissionSig).startsWith('MOCK-') || id === 'WEBHOOK_ID') {
      return { ok: true, status: 'SUCCESS', skipped: true };
    }
    return { ok: false, reason: 'mock_unverified', status: 'FAILURE' };
  }

  const status = String(result?.verification_status || '').toUpperCase();
  return { ok: status === 'SUCCESS', status, reason: status === 'SUCCESS' ? undefined : 'verification_failed' };
}

function normalizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    out[String(key).toLowerCase()] = value;
  }
  // Express lowercases headers already; also accept nested get()
  return out;
}

/**
 * Extract PayPal verification headers from an Express request.
 */
function paypalWebhookHeadersFromReq(req) {
  const get = (name) => req.get?.(name) || req.headers?.[name] || req.headers?.[name.toLowerCase()];
  return {
    'paypal-auth-algo': get('paypal-auth-algo'),
    'paypal-cert-url': get('paypal-cert-url'),
    'paypal-transmission-id': get('paypal-transmission-id'),
    'paypal-transmission-sig': get('paypal-transmission-sig'),
    'paypal-transmission-time': get('paypal-transmission-time'),
  };
}

module.exports = {
  verifyPaypalWebhookSignature,
  paypalWebhookHeadersFromReq,
};
