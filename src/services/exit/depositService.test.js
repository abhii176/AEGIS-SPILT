const assert = require('assert');
const { createDepositService } = require('./depositService');

function makeDb(project) {
  const deposits = [];
  let seq = 0;
  const projects = new Map([[project.id, { ...project }]]);

  return {
    deposits,
    project: {
      async findUnique({ where }) {
        const row = projects.get(where.id);
        if (!row) return null;
        return {
          ...row,
          milestones: row.milestones || [],
          freelancerDeposits: deposits
            .filter((d) => d.projectId === row.id)
            .sort((a, b) => b.createdAt - a.createdAt),
          freelancer: row.freelancer || { id: row.freelancerId, name: 'Rohan Mehta' },
          client: row.client || { id: row.clientId, name: 'Sarah Chen' },
        };
      },
      async update({ where, data }) {
        const row = projects.get(where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    freelancerDeposit: {
      async create({ data }) {
        const row = {
          id: `dep-${++seq}`,
          createdAt: Date.now() + seq,
          approvalUrl: null,
          paypalOrderId: null,
          paypalCaptureId: null,
          ...data,
        };
        deposits.push(row);
        return { ...row };
      },
      async update({ where, data }) {
        const row = deposits.find((d) => d.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
      async findUnique({ where }) {
        const row = deposits.find((d) => d.id === where.id);
        return row ? { ...row } : null;
      },
      async findFirst({ where }) {
        const matches = deposits.filter((d) => {
          if (where.paypalOrderId && d.paypalOrderId !== where.paypalOrderId) return false;
          return true;
        });
        return matches.length ? { ...matches[matches.length - 1] } : null;
      },
    },
  };
}

function baseProject() {
  return {
    id: 'proj-1',
    title: 'Auth service MVP',
    status: 'ACTIVE',
    clientId: 'user-sarah',
    freelancerId: 'user-rohan',
    freelancerDepositAmountCents: null,
    depositStatus: 'PENDING',
    milestones: [{ id: 'ms-1', amountCents: 25000 }],
  };
}

function paypalStub() {
  const calls = { createOrder: 0, captureOrder: 0, getOrder: 0 };
  return {
    calls,
    isMock: () => true,
    async createOrder() {
      calls.createOrder += 1;
      return {
        id: 'ORDER-DEP-1',
        status: 'CREATED',
        approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-DEP-1',
      };
    },
    async getOrder() {
      calls.getOrder += 1;
      return { id: 'ORDER-DEP-1', status: 'APPROVED' };
    },
    async captureOrder() {
      calls.captureOrder += 1;
      return { id: 'ORDER-DEP-1', status: 'COMPLETED', captureId: 'CAP-DEP-1' };
    },
  };
}

async function testClientCannotFundDeposit() {
  const db = makeDb(baseProject());
  const paypal = paypalStub();
  const deposits = createDepositService({
    db,
    paypal,
    notifications: { notifyDepositHeld: async () => {} },
  });

  await assert.rejects(
    () => deposits.fundDeposit({ userId: 'user-sarah', projectId: 'proj-1', autoCapture: false }),
    (err) =>
      err.status === 403 &&
      err.code === 'forbidden' &&
      err.message === 'Only the project freelancer can fund the security deposit'
  );
  assert.strictEqual(db.deposits.length, 0);
  assert.strictEqual(paypal.calls.createOrder, 0);

  await assert.rejects(
    () => deposits.fundDeposit({ userId: 'user-other', projectId: 'proj-1', autoCapture: false }),
    (err) => err.status === 403 && err.code === 'forbidden'
  );
  assert.strictEqual(paypal.calls.createOrder, 0);
}

async function testFreelancerCanCreateDepositOrder() {
  const db = makeDb(baseProject());
  const paypal = paypalStub();
  const deposits = createDepositService({
    db,
    paypal,
    notifications: { notifyDepositHeld: async () => {} },
  });

  const result = await deposits.fundDeposit({
    userId: 'user-rohan',
    projectId: 'proj-1',
    autoCapture: false,
  });

  assert.strictEqual(result.deposit.status, 'ORDER_CREATED');
  assert.strictEqual(result.deposit.userId, 'user-rohan');
  assert.strictEqual(result.deposit.amountCents, 2500);
  assert.strictEqual(
    result.paypal.approvalUrl,
    'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-DEP-1'
  );
  assert.strictEqual(result.project.depositStatus, 'PENDING');
  assert.strictEqual(paypal.calls.createOrder, 1);
  assert.strictEqual(paypal.calls.captureOrder, 0);
}

async function testReturnCaptureDoesNotRequireAUser() {
  const db = makeDb(baseProject());
  const paypal = paypalStub();
  const notifications = { held: 0, async notifyDepositHeld() { this.held += 1; } };
  const deposits = createDepositService({ db, paypal, notifications });

  await deposits.fundDeposit({
    userId: 'user-rohan',
    projectId: 'proj-1',
    autoCapture: false,
  });

  const captured = await deposits.captureDeposit({
    orderId: 'ORDER-DEP-1',
    requireApproved: true,
  });

  assert.strictEqual(captured.deposit.status, 'CAPTURED');
  assert.strictEqual(captured.deposit.paypalCaptureId, 'CAP-DEP-1');
  const project = await db.project.findUnique({ where: { id: 'proj-1' } });
  assert.strictEqual(project.depositStatus, 'HELD');
  assert.strictEqual(notifications.held, 1);

  await assert.rejects(
    () =>
      deposits.captureDeposit({
        userId: 'user-sarah',
        orderId: 'ORDER-DEP-1',
        requireApproved: true,
      }),
    (err) => err.status === 403 && err.code === 'forbidden'
  );
}

async function run() {
  await testClientCannotFundDeposit();
  await testFreelancerCanCreateDepositOrder();
  await testReturnCaptureDoesNotRequireAUser();
  console.log('deposit service tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
