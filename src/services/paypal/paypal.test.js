const assert = require('assert');
const { createPaypalClient } = require('./client');
const { createOrdersService, centsToAmountValue, pickCaptureId } = require('./orders');
const { createPayoutsService } = require('./payouts');
const { createPaypalService } = require('./index');
const { RELEASABLE_STATUSES } = require('./escrow');

function testCentsToAmount() {
  assert.strictEqual(centsToAmountValue(25000), '250.00');
  assert.strictEqual(centsToAmountValue(1), '0.01');
  assert.throws(() => centsToAmountValue(0), /positive integer/);
  assert.throws(() => centsToAmountValue(1.5), /positive integer/);
}

function testPickCaptureId() {
  const id = pickCaptureId({
    purchase_units: [{ payments: { captures: [{ id: 'CAP-123' }] } }],
  });
  assert.strictEqual(id, 'CAP-123');
}

async function testMockOrdersAndPayouts() {
  const paypal = createPaypalService({ mock: true, clientId: '', clientSecret: '' });
  assert.strictEqual(paypal.isMock(), true);

  const order = await paypal.createOrder({
    amountCents: 25000,
    currency: 'USD',
    referenceId: 'vault-1',
  });
  assert.ok(order.id.startsWith('MOCK-ORDER-'));
  assert.ok(order.approvalUrl);

  const captured = await paypal.captureOrder(order.id);
  assert.strictEqual(captured.status, 'COMPLETED');
  assert.ok(captured.captureId.startsWith('MOCK-CAPTURE-'));

  const payout = await paypal.createPayout({
    amountCents: 25000,
    currency: 'USD',
    receiverEmail: 'rohan@example.com',
    senderBatchId: 'batch-1',
    senderItemId: 'ms-1',
  });
  assert.ok(payout.payoutBatchId.startsWith('MOCK-BATCH-'));
  assert.ok(payout.payoutItemId.startsWith('MOCK-ITEM-'));
}

async function testHttpOrdersWithFetchMock() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body });
    if (String(url).endsWith('/v1/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok-test', expires_in: 3600 }),
      };
    }
    if (String(url).includes('/v2/checkout/orders') && options.method === 'POST' && !String(url).includes('/capture')) {
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            id: 'ORDER-HTTP-1',
            status: 'CREATED',
            links: [{ rel: 'approve', href: 'https://sandbox.paypal.com/approve/ORDER-HTTP-1' }],
          }),
      };
    }
    if (String(url).includes('/capture')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'ORDER-HTTP-1',
            status: 'COMPLETED',
            purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-HTTP-1' }] } }],
          }),
      };
    }
    if (String(url).includes('/v1/payments/payouts')) {
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            batch_header: { payout_batch_id: 'BATCH-HTTP-1', batch_status: 'PENDING' },
            items: [{ payout_item_id: 'ITEM-HTTP-1' }],
          }),
      };
    }
    return { ok: false, status: 404, text: async () => '{}' };
  };

  const client = createPaypalClient({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    mode: 'sandbox',
    mock: false,
    fetchImpl,
  });
  const orders = createOrdersService(client);
  const payouts = createPayoutsService(client);

  const order = await orders.createOrder({ amountCents: 1000, currency: 'USD', referenceId: 'ref' });
  assert.strictEqual(order.id, 'ORDER-HTTP-1');
  assert.strictEqual(order.approvalUrl, 'https://sandbox.paypal.com/approve/ORDER-HTTP-1');

  const captured = await orders.captureOrder('ORDER-HTTP-1');
  assert.strictEqual(captured.captureId, 'CAPTURE-HTTP-1');

  const payout = await payouts.createPayout({
    amountCents: 1000,
    receiverEmail: 'sarah-freelancer@example.com',
    senderBatchId: 'demo-batch',
  });
  assert.strictEqual(payout.payoutBatchId, 'BATCH-HTTP-1');
  assert.strictEqual(payout.payoutItemId, 'ITEM-HTTP-1');

  assert.ok(calls.some((c) => String(c.url).includes('/oauth2/token')));
  assert.ok(calls.some((c) => String(c.url).includes('/v2/checkout/orders')));
  assert.ok(calls.some((c) => String(c.url).includes('/v1/payments/payouts')));
}

function testReleasableStatuses() {
  assert.ok(RELEASABLE_STATUSES.has('FUNDED'));
  assert.ok(RELEASABLE_STATUSES.has('PASSED'));
  assert.ok(!RELEASABLE_STATUSES.has('PAID'));
  assert.ok(!RELEASABLE_STATUSES.has('CANCELLED'));
}

async function run() {
  testCentsToAmount();
  testPickCaptureId();
  testReleasableStatuses();
  await testMockOrdersAndPayouts();
  await testHttpOrdersWithFetchMock();
  console.log('paypal service smoke tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
