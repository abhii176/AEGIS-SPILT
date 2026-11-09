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
      const approveHref = `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`;
      return {
        id: orderId,
        status: 'CREATED',
        approvalUrl: approveHref,
        links: [
          { rel: 'approve', href: approveHref },
          ...(returnUrl ? [{ rel: 'return', href: returnUrl }] : []),
          ...(cancelUrl ? [{ rel: 'cancel', href: cancelUrl }] : []),
        ],
        raw: {
          mock: true,
          amount: { currency_code: currencyCode, value },
          application_context: { return_url: returnUrl, cancel_url: cancelUrl },
        },
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
        brand_name: 'Aegis-Split',
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
      links: order.links || [],
      raw: order,
    };
  }

  async function getOrder(orderId) {
    if (!orderId) {
      const err = new Error('orderId is required');
      err.status = 400;
      err.code = 'invalid_order_id';
      throw err;
    }

    if (client.isMock()) {
      return {
        id: orderId,
        status: 'APPROVED',
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
        raw: { mock: true, id: orderId, status: 'APPROVED' },
      };
    }

    const order = await client.request('GET', `/v2/checkout/orders/${orderId}`);
    return {
      id: order.id,
      status: order.status,
      approvalUrl: pickApprovalUrl(order),
      links: order.links || [],
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

  /**
   * Refund a prior capture (partial or full). Used to return unspent vault to the client.
   * Sandbox note: only captures that PayPal still allows refunding will succeed;
   * mock mode always succeeds.
   */
  async function refundCapture({
    captureId,
    amountCents = null,
    currency = 'USD',
    note = 'Aegis-Split vault refund',
  }) {
    if (!captureId) {
      const err = new Error('captureId is required');
      err.status = 400;
      err.code = 'invalid_capture_id';
      throw err;
    }

    const currencyCode = String(currency || 'USD').toUpperCase();
    let body = { note_to_payer: String(note).slice(0, 255) };
    if (amountCents != null) {
      body.amount = {
        value: centsToAmountValue(amountCents),
        currency_code: currencyCode,
      };
    }

    if (client.isMock()) {
      return {
        refundId: `MOCK-REFUND-${captureId}-${amountCents ?? 'full'}`,
        status: 'COMPLETED',
        amountCents: amountCents,
        raw: { mock: true, captureId, ...body },
      };
    }

    const refund = await client.request('POST', `/v2/payments/captures/${captureId}/refund`, {
      body,
      idempotencyKey: `refund-${captureId}-${amountCents ?? 'full'}`,
    });

    return {
      refundId: refund.id || null,
      status: refund.status || null,
      amountCents,
      raw: refund,
    };
  }

  return {
    createOrder,
    getOrder,
    captureOrder,
    refundCapture,
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
