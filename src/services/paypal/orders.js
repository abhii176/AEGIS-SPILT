const { createPaypalClient } = require('./client');

/**
 * Convert integer cents → PayPal amount string (e.g. 25000 → "250.00").
 */
function centsToAmountValue(amountCents) {
  const cents = Number(amountCents);
  if (!Number.isInteger(cents) || cents <= 0) {
    const err = new Error('amountCents must be a positive integer');
    err.status = 400;
    err.code = 'invalid_amount';
    throw err;
  }
  return (cents / 100).toFixed(2);
}

function pickApprovalUrl(order) {
  const links = order?.links || [];
  const approve = links.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  return approve?.href || null;
}

function pickCaptureId(captureResponse) {
  const units = captureResponse?.purchase_units || [];
  for (const unit of units) {
    const captures = unit?.payments?.captures || [];
    if (captures[0]?.id) return captures[0].id;
  }
  return captureResponse?.id || null;
}

/**
 * PayPal Orders v2 — create + capture helpers for vault lock.
 */
function createOrdersService(client = createPaypalClient()) {
  async function createOrder({
    amountCents,
    currency = 'USD',
    referenceId,
    description,
    returnUrl,
    cancelUrl,
  }) {
    const value = centsToAmountValue(amountCents);
    const currencyCode = String(currency || 'USD').toUpperCase();

    if (client.isMock()) {
      const orderId = `MOCK-ORDER-${referenceId || Date.now()}`;
      return {
        id: orderId,
        status: 'CREATED',
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
        raw: { mock: true, amount: { currency_code: currencyCode, value } },
      };
    }

    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: referenceId ? String(referenceId).slice(0, 256) : undefined,
          description: description ? String(description).slice(0, 127) : 'Aegis-Split escrow lock',
          amount: {
            currency_code: currencyCode,
            value,
          },
        },
      ],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    };

    const order = await client.request('POST', '/v2/checkout/orders', { body });
    return {
      id: order.id,
      status: order.status,
      approvalUrl: pickApprovalUrl(order),
      raw: order,
    };
  }

  async function captureOrder(orderId) {
    if (!orderId) {
      const err = new Error('orderId is required');
      err.status = 400;
      err.code = 'invalid_order_id';
      throw err;
    }

    if (client.isMock()) {
      return {
        id: orderId,
        status: 'COMPLETED',
        captureId: `MOCK-CAPTURE-${orderId}`,
        raw: { mock: true, id: orderId, status: 'COMPLETED' },
      };
    }

    const captured = await client.request('POST', `/v2/checkout/orders/${orderId}/capture`, {
      body: {},
    });
    return {
      id: captured.id,
      status: captured.status,
      captureId: pickCaptureId(captured),
      raw: captured,
    };
  }

  return {
    createOrder,
    captureOrder,
    centsToAmountValue,
    pickApprovalUrl,
    pickCaptureId,
  };
}

module.exports = {
  createOrdersService,
  centsToAmountValue,
  pickApprovalUrl,
  pickCaptureId,
};
