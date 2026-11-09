const assert = require('assert');
const { createPaypalClient } = require('./client');
const { createOrdersService, centsToAmountValue, pickCaptureId, pickApprovalUrl } = require('./orders');
const { createPayoutsService } = require('./payouts');
const { createPaypalService } = require('./index');
const { createEscrowService, RELEASABLE_STATUSES } = require('./escrow');

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

async function testExplicitMockFalseNeverSilentMocks() {
  // PAYPAL_MOCK=false must not return MOCK-ORDER just because secrets are missing
  const off = createPaypalClient({ mock: false, clientId: '', clientSecret: '' });
  assert.strictEqual(off.isMock(), false);

  const offPlaceholders = createPaypalClient({
    mock: false,
    clientId: 'your_paypal_sandbox_client_id',
    clientSecret: 'your_paypal_sandbox_client_secret',
  });
  assert.strictEqual(offPlaceholders.isMock(), false);

  // Unset mock + empty/placeholder creds → still mock (local boot without secrets)
  const unset = createPaypalClient({ mock: null, clientId: '', clientSecret: '' });
  assert.strictEqual(unset.isMock(), true);

  const on = createPaypalClient({ mock: true, clientId: 'real-id', clientSecret: 'real-secret' });
  assert.strictEqual(on.isMock(), true);

  // createOrder with mock:false + empty secrets must fail loudly (not MOCK-ORDER)
  const orders = createOrdersService(off);
  await assert.rejects(
    () =>
      orders.createOrder({
        amountCents: 1000,
        currency: 'USD',
        referenceId: 'should-not-mock',
        returnUrl: 'http://localhost/return',
        cancelUrl: 'http://localhost/cancel',
      }),
    (err) => err && err.code === 'paypal_config_missing'
  );
}

async function testMockOrdersAndPayouts() {
  const paypal = createPaypalService({ mock: true, clientId: '', clientSecret: '' });
  assert.strictEqual(paypal.isMock(), true);

  const order = await paypal.createOrder({
    amountCents: 25000,
    currency: 'USD',
    referenceId: 'vault-1',
    returnUrl: 'http://localhost:3000/api/vault/paypal/return',
    cancelUrl: 'http://localhost:3000/api/vault/paypal/cancel',
  });
  assert.ok(order.id.startsWith('MOCK-ORDER-'));
  assert.ok(order.approvalUrl);
  assert.ok(order.links.some((l) => l.rel === 'approve'));

  const existing = await paypal.getOrder(order.id);
  assert.strictEqual(existing.status, 'APPROVED');

  const captured = await paypal.captureOrder(order.id);
  assert.strictEqual(captured.status, 'COMPLETED');
  assert.ok(captured.captureId.startsWith('MOCK-CAPTURE-'));

  const refund = await paypal.refundCapture({
    captureId: captured.captureId,
    amountCents: 1000,
    currency: 'USD',
  });
  assert.ok(refund.refundId.startsWith('MOCK-REFUND-'));
  assert.strictEqual(refund.status, 'COMPLETED');

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

async function testHttpCreateWithApproveLinkAndReturnUrls() {
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
      const parsed = JSON.parse(options.body);
      assert.strictEqual(parsed.application_context.return_url, 'http://app.test/api/vault/paypal/return');
      assert.strictEqual(parsed.application_context.cancel_url, 'http://app.test/api/vault/paypal/cancel');
      assert.strictEqual(parsed.intent, 'CAPTURE');
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

  const order = await orders.createOrder({
    amountCents: 1000,
    currency: 'USD',
    referenceId: 'ref',
    returnUrl: 'http://app.test/api/vault/paypal/return',
    cancelUrl: 'http://app.test/api/vault/paypal/cancel',
  });
  assert.strictEqual(order.id, 'ORDER-HTTP-1');
  assert.strictEqual(order.approvalUrl, 'https://sandbox.paypal.com/approve/ORDER-HTTP-1');
  assert.strictEqual(pickApprovalUrl(order), 'https://sandbox.paypal.com/approve/ORDER-HTTP-1');
  assert.ok(calls.some((c) => String(c.url).includes('/v2/checkout/orders')));
}

async function testHttpCaptureAfterApprovedOnly() {
  let orderStatus = 'CREATED';
  let captured = false;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok-test', expires_in: 3600 }),
      };
    }
    if (String(url).includes('/v2/checkout/orders/ORDER-HTTP-2') && options.method === 'GET') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'ORDER-HTTP-2', status: orderStatus }),
      };
    }
    if (String(url).includes('/capture')) {
      captured = true;
      if (orderStatus !== 'APPROVED') {
        return {
          ok: false,
          status: 422,
          text: async () =>
            JSON.stringify({
              name: 'UNPROCESSABLE_ENTITY',
              details: [{ issue: 'ORDER_NOT_APPROVED' }],
              message: 'Payer has not yet approved the Order',
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'ORDER-HTTP-2',
            status: 'COMPLETED',
            purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-HTTP-2' }] } }],
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

  const before = await orders.getOrder('ORDER-HTTP-2');
  assert.strictEqual(before.status, 'CREATED');

  // Simulate buyer approval, then capture
  orderStatus = 'APPROVED';
  const after = await orders.getOrder('ORDER-HTTP-2');
  assert.strictEqual(after.status, 'APPROVED');

  const result = await orders.captureOrder('ORDER-HTTP-2');
  assert.strictEqual(result.captureId, 'CAPTURE-HTTP-2');
  assert.ok(captured);
}

function makeEscrowDbMock() {
  const funds = new Map();
  const projects = new Map();
  const milestones = new Map();
  const notifications = [];

  const project = {
    id: 'proj-1',
    title: 'Demo Auth Service',
    clientId: 'user-sarah',
    freelancerId: 'user-rohan',
    status: 'ACTIVE',
    fundedStatus: 'UNFUNDED',
    freelancer: { id: 'user-rohan', email: 'rohan@example.com', paypalEmail: 'rohan-pp@example.com' },
  };
  projects.set(project.id, project);

  const milestone = {
    id: 'ms-1',
    projectId: 'proj-1',
    title: 'M1',
    amountCents: 25000,
    currency: 'USD',
    status: 'PENDING',
    sequence: 1,
  };
  milestones.set(milestone.id, milestone);

  return {
    project: {
      findUnique: async ({ where }) => {
        const p = projects.get(where.id);
        if (!p) return null;
        return { ...p, freelancer: project.freelancer };
      },
      update: async ({ where, data }) => {
        const p = projects.get(where.id);
        Object.assign(p, data);
        return p;
      },
    },
    milestone: {
      findFirst: async ({ where }) => {
        for (const m of milestones.values()) {
          if (where.id && m.id !== where.id) continue;
          if (where.projectId && m.projectId !== where.projectId) continue;
          return { ...m };
        }
        return null;
      },
      findMany: async ({ where }) =>
        [...milestones.values()].filter((m) => {
          if (where.projectId && m.projectId !== where.projectId) return false;
          if (where.status && m.status !== where.status) return false;
          return true;
        }),
      findUnique: async ({ where, include }) => {
        const m = milestones.get(where.id);
        if (!m) return null;
        if (include?.project) {
          return {
            ...m,
            project: {
              ...projects.get(m.projectId),
              freelancer: project.freelancer,
              client: { id: 'user-sarah' },
            },
          };
        }
        return { ...m };
      },
      update: async ({ where, data }) => {
        const m = milestones.get(where.id);
        Object.assign(m, data);
        return { ...m };
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const m of milestones.values()) {
          if (where.projectId && m.projectId !== where.projectId) continue;
          if (where.status && m.status !== where.status) continue;
          if (where.id?.in && !where.id.in.includes(m.id)) continue;
          Object.assign(m, data);
          count += 1;
        }
        return { count };
      },
    },
    vaultFund: {
      create: async ({ data }) => {
        const fund = {
          id: `vf-${funds.size + 1}`,
          ...data,
          paypalOrderId: null,
          paypalCaptureId: null,
          approvalUrl: null,
          createdAt: new Date(),
        };
        funds.set(fund.id, fund);
        return { ...fund };
      },
      findUnique: async ({ where }) => {
        const f = funds.get(where.id);
        return f ? { ...f } : null;
      },
      findFirst: async ({ where }) => {
        const list = [...funds.values()].sort((a, b) => b.createdAt - a.createdAt);
        for (const f of list) {
          if (where.paypalOrderId && f.paypalOrderId !== where.paypalOrderId) continue;
          return { ...f };
        }
        return null;
      },
      update: async ({ where, data }) => {
        const f = funds.get(where.id);
        Object.assign(f, data);
        return { ...f };
      },
    },
    notification: {
      findFirst: async ({ where }) =>
        notifications.find(
          (n) =>
            (!where.userId || n.userId === where.userId) &&
            (where.dedupeKey == null || n.dedupeKey === where.dedupeKey)
        ) || null,
      create: async ({ data }) => {
        const row = { id: `n-${notifications.length + 1}`, readAt: null, createdAt: new Date(), ...data };
        notifications.push(row);
        return { ...row };
      },
      findMany: async () => [...notifications],
      count: async () => notifications.length,
      updateMany: async () => ({ count: 0 }),
    },
    _funds: funds,
    _milestones: milestones,
    _projects: projects,
    _notifications: notifications,
  };
}

async function testEscrowCreateApproveLinkNoAutoCapture() {
  const db = makeEscrowDbMock();
  let capturedCalls = 0;
  const paypal = {
    isMock: () => true,
    createOrder: async ({ returnUrl, cancelUrl, referenceId }) => {
      assert.ok(returnUrl.includes('/api/vault/paypal/return'));
      assert.ok(cancelUrl.includes('/api/vault/paypal/cancel'));
      return {
        id: 'ORDER-ESCROW-1',
        status: 'CREATED',
        approvalUrl: 'https://sandbox.paypal.com/approve/ORDER-ESCROW-1',
      };
    },
    getOrder: async () => ({ id: 'ORDER-ESCROW-1', status: 'CREATED' }),
    captureOrder: async () => {
      capturedCalls += 1;
      return { id: 'ORDER-ESCROW-1', status: 'COMPLETED', captureId: 'CAP-ESCROW-1' };
    },
    createPayout: async () => ({ payoutBatchId: 'B1', payoutItemId: 'I1', batchStatus: 'PENDING' }),
  };

  const escrow = createEscrowService({ paypal, db });
  const funded = await escrow.fundProjectVault({
    userId: 'user-sarah',
    projectId: 'proj-1',
    milestoneId: 'ms-1',
    autoCapture: false,
    returnUrl: 'http://localhost:3000/api/vault/paypal/return',
    cancelUrl: 'http://localhost:3000/api/vault/paypal/cancel',
  });

  assert.strictEqual(funded.vaultFund.status, 'ORDER_CREATED');
  assert.strictEqual(funded.paypal.approvalUrl, 'https://sandbox.paypal.com/approve/ORDER-ESCROW-1');
  assert.strictEqual(funded.paypal.autoCapture, false);
  assert.strictEqual(capturedCalls, 0);
  assert.strictEqual(db._milestones.get('ms-1').status, 'PENDING');

  // Capture before approve → reject
  await assert.rejects(
    () => escrow.completeVaultAfterApproval({ orderId: 'ORDER-ESCROW-1' }),
    (err) => err.code === 'order_not_approved'
  );
  assert.strictEqual(capturedCalls, 0);

  paypal.getOrder = async () => ({ id: 'ORDER-ESCROW-1', status: 'APPROVED' });
  const completed = await escrow.completeVaultAfterApproval({ orderId: 'ORDER-ESCROW-1' });
  assert.strictEqual(completed.vaultFund.status, 'CAPTURED');
  assert.strictEqual(completed.vaultFund.paypalCaptureId, 'CAP-ESCROW-1');
  assert.strictEqual(capturedCalls, 1);
  assert.strictEqual(db._milestones.get('ms-1').status, 'FUNDED');
  assert.ok(db._notifications.some((n) => n.type === 'FUNDED'));
  assert.strictEqual(db._notifications.filter((n) => n.type === 'FUNDED').length, 2);

  const cancelledDb = makeEscrowDbMock();
  const cancelPaypal = {
    isMock: () => true,
    createOrder: async () => ({
      id: 'ORDER-CANCEL-1',
      status: 'CREATED',
      approvalUrl: 'https://sandbox.paypal.com/approve/ORDER-CANCEL-1',
    }),
    getOrder: async () => ({ id: 'ORDER-CANCEL-1', status: 'CREATED' }),
    captureOrder: async () => {
      throw new Error('should not capture');
    },
  };
  const cancelEscrow = createEscrowService({ paypal: cancelPaypal, db: cancelledDb });
  await cancelEscrow.fundProjectVault({
    userId: 'user-sarah',
    projectId: 'proj-1',
    milestoneId: 'ms-1',
    autoCapture: false,
  });
  const cancelled = await cancelEscrow.cancelVaultFund({ orderId: 'ORDER-CANCEL-1' });
  assert.strictEqual(cancelled.vaultFund.status, 'CANCELLED');
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
  await testExplicitMockFalseNeverSilentMocks();
  await testMockOrdersAndPayouts();
  await testHttpOrdersWithFetchMock();
  await testHttpCreateWithApproveLinkAndReturnUrls();
  await testHttpCaptureAfterApprovedOnly();
  await testEscrowCreateApproveLinkNoAutoCapture();
  console.log('paypal service smoke tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
