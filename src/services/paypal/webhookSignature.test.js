const assert = require('assert');
const {
  verifyPaypalWebhookSignature,
  paypalWebhookHeadersFromReq,
} = require('./webhookSignature');

function mockHeaders(overrides = {}) {
  return {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test',
    'paypal-transmission-id': 'tx-test-1',
    'paypal-transmission-sig': 'MOCK-SIG',
    'paypal-transmission-time': '2024-05-16T05:19:23Z',
    ...overrides,
  };
}

async function testMissingWebhookId() {
  const result = await verifyPaypalWebhookSignature({
    headers: mockHeaders(),
    webhookEvent: { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    webhookId: '',
    client: { isMock: () => true, request: async () => ({}) },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'webhook_id_missing');
}

async function testMissingHeaders() {
  const result = await verifyPaypalWebhookSignature({
    headers: { 'paypal-auth-algo': 'SHA256withRSA' },
    webhookEvent: { id: 'WH-1' },
    webhookId: 'WHID123',
    client: { isMock: () => false, request: async () => ({}) },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'missing_paypal_headers');
}

async function testSuccessViaFetchImpl() {
  const client = {
    isMock: () => false,
    request: async (method, path, { body }) => {
      assert.strictEqual(method, 'POST');
      assert.strictEqual(path, '/v1/notifications/verify-webhook-signature');
      assert.strictEqual(body.webhook_id, '0NH55953DH663215D');
      assert.strictEqual(body.transmission_id, 'tx-test-1');
      assert.ok(body.webhook_event);
      return { verification_status: 'SUCCESS' };
    },
  };

  const result = await verifyPaypalWebhookSignature({
    headers: mockHeaders({ 'paypal-transmission-sig': 'real-looking-sig' }),
    webhookEvent: { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    webhookId: '0NH55953DH663215D',
    client,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 'SUCCESS');
}

async function testFailureStatus() {
  const client = {
    isMock: () => false,
    request: async () => ({ verification_status: 'FAILURE' }),
  };
  const result = await verifyPaypalWebhookSignature({
    headers: mockHeaders({ 'paypal-transmission-sig': 'bad' }),
    webhookEvent: { id: 'WH-1' },
    webhookId: '0NH55953DH663215D',
    client,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'verification_failed');
}

async function testMockClientAcceptsMockSig() {
  const client = {
    isMock: () => true,
    request: async () => ({ mock: true }),
  };
  const result = await verifyPaypalWebhookSignature({
    headers: mockHeaders(),
    webhookEvent: { id: 'WH-1' },
    webhookId: 'WEBHOOK_ID',
    client,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
}

function testHeadersFromReq() {
  const req = {
    get(name) {
      const map = {
        'paypal-transmission-id': 'abc',
        'paypal-auth-algo': 'SHA256withRSA',
      };
      return map[name.toLowerCase()];
    },
    headers: {},
  };
  const h = paypalWebhookHeadersFromReq(req);
  assert.strictEqual(h['paypal-transmission-id'], 'abc');
}

async function run() {
  await testMissingWebhookId();
  await testMissingHeaders();
  await testSuccessViaFetchImpl();
  await testFailureStatus();
  await testMockClientAcceptsMockSig();
  testHeadersFromReq();
  console.log('paypal webhook signature tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
