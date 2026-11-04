const { createPaypalClient } = require('./client');
const { centsToAmountValue } = require('./orders');

/**
 * PayPal Payouts v1 scaffold — release milestone amount to freelancer email.
 */
function createPayoutsService(client = createPaypalClient()) {
  async function createPayout({
    amountCents,
    currency = 'USD',
    receiverEmail,
    senderBatchId,
    senderItemId,
    note,
    emailSubject = 'Aegis-Split milestone payout',
  }) {
    const email = String(receiverEmail || '').trim();
    if (!email || !email.includes('@')) {
      const err = new Error('Valid PayPal receiver email is required');
      err.status = 400;
      err.code = 'invalid_payout_email';
      throw err;
    }

    const value = centsToAmountValue(amountCents);
    const currencyCode = String(currency || 'USD').toUpperCase();
    const batchId = senderBatchId || `aegis-${Date.now()}`;
    const itemId = senderItemId || `item-${Date.now()}`;

    if (client.isMock()) {
      return {
        payoutBatchId: `MOCK-BATCH-${batchId}`,
        payoutItemId: `MOCK-ITEM-${itemId}`,
        batchStatus: 'PENDING',
        raw: {
          mock: true,
          sender_batch_header: { sender_batch_id: batchId },
          items: [{ receiver: email, amount: { value, currency: currencyCode } }],
        },
      };
    }

    const body = {
      sender_batch_header: {
        sender_batch_id: String(batchId).slice(0, 256),
        email_subject: String(emailSubject).slice(0, 255),
        email_message: note ? String(note).slice(0, 1000) : undefined,
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value, currency: currencyCode },
          receiver: email,
          note: note ? String(note).slice(0, 1000) : 'Milestone release from Aegis-Split',
          sender_item_id: String(itemId).slice(0, 127),
        },
      ],
    };

    const payout = await client.request('POST', '/v1/payments/payouts', {
      body,
      idempotencyKey: batchId,
    });

    const batchHeader = payout.batch_header || {};
    const firstItem = (payout.items && payout.items[0]) || {};

    return {
      payoutBatchId: batchHeader.payout_batch_id || null,
      payoutItemId: firstItem.payout_item_id || null,
      batchStatus: batchHeader.batch_status || null,
      raw: payout,
    };
  }

  return { createPayout };
}

module.exports = { createPayoutsService };
