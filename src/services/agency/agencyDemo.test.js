const assert = require('assert');
const { seedAgencyDemo, loadAgencyDashboard } = require('./agencyDemo');

function createMemoryDb() {
  const users = [];
  const projects = [];
  const milestones = [];
  const vaults = [];
  const deposits = [];
  const disputes = [];
  let seq = 1;
  const nextId = () => `mem-${seq++}`;

  function attach(project) {
    return {
      ...project,
      client: users.find((user) => user.id === project.clientId) || null,
      freelancer: users.find((user) => user.id === project.freelancerId) || null,
      milestones: milestones.filter((row) => row.projectId === project.id),
      vaultFunds: vaults.filter((row) => row.projectId === project.id),
      freelancerDeposits: deposits.filter((row) => row.projectId === project.id),
      disputes: disputes.filter((row) => row.projectId === project.id),
      exitEvents: [],
    };
  }

  const db = {
    user: {
      findUnique: async ({ where }) =>
        users.find((user) => user.email === where.email || user.id === where.id) || null,
      findMany: async ({ where } = {}) => {
        const emails = where?.email?.in;
        if (!emails) return users.map((user) => ({ ...user }));
        return users.filter((user) => emails.includes(user.email)).map((user) => ({ ...user }));
      },
      create: async ({ data }) => {
        const row = { id: nextId(), govIdVerified: false, ...data };
        users.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = users.find((user) => user.email === where.email || user.id === where.id);
        if (!row) throw new Error('user missing');
        Object.assign(row, data);
        return { ...row };
      },
    },
    project: {
      findFirst: async ({ where }) => {
        const needle = where?.description?.contains;
        const found = projects.find(
          (project) => needle && String(project.description || '').includes(needle)
        );
        return found ? { ...found } : null;
      },
      findMany: async () => projects.map((project) => attach(project)),
      create: async ({ data }) => {
        const row = { id: nextId(), updatedAt: data.createdAt || new Date(), ...data };
        projects.push(row);
        return { ...row };
      },
    },
    milestone: {
      create: async ({ data }) => {
        const row = { id: nextId(), ...data };
        milestones.push(row);
        return { ...row };
      },
    },
    vaultFund: {
      create: async ({ data }) => {
        const row = { id: nextId(), paypalOrderId: data.paypalOrderId || null, paypalCaptureId: data.paypalCaptureId || null, ...data };
        vaults.push(row);
        return { ...row };
      },
    },
    freelancerDeposit: {
      create: async ({ data }) => {
        const row = {
          id: nextId(),
          paypalOrderId: data.paypalOrderId || null,
          paypalCaptureId: data.paypalCaptureId || null,
          ...data,
        };
        deposits.push(row);
        return { ...row };
      },
    },
    dispute: {
      create: async ({ data }) => {
        const row = { id: nextId(), ...data };
        disputes.push(row);
        return { ...row };
      },
    },
    $transaction: async (fn) => fn(db),
  };

  return { db, users, projects, milestones, vaults, deposits, disputes };
}

async function testSeedIsIdempotentAndMixesLiveProjects() {
  const mem = createMemoryDb();
  const rohan = await mem.db.user.create({
    data: {
      email: 'rohan.freelancer@aegis-split.demo',
      name: 'Rohan Mehta',
      role: 'FREELANCER',
      paypalEmail: 'custom-rohan@example.com',
      govIdVerified: true,
      monitoringConsentGranted: true,
    },
  });
  const sarah = await mem.db.user.create({
    data: {
      email: 'sarah.client@aegis-split.demo',
      name: 'Sarah Chen',
      role: 'CLIENT',
      govIdVerified: true,
    },
  });
  const live = await mem.db.project.create({
    data: {
      clientId: sarah.id,
      freelancerId: rohan.id,
      title: 'Auth service MVP',
      description: 'Real walkthrough project',
      status: 'ACTIVE',
      fundedStatus: 'FUNDED',
      depositStatus: 'HELD',
      freelancerDepositAmountCents: 2500,
      createdAt: new Date('2026-11-09T00:00:00Z'),
    },
  });
  await mem.db.milestone.create({
    data: {
      projectId: live.id,
      sequence: 1,
      title: 'Login',
      taskDescription: 'Ship login',
      acceptanceCriteria: 'login form',
      amountCents: 25000,
      currency: 'USD',
      status: 'FUNDED',
    },
  });
  await mem.db.vaultFund.create({
    data: {
      userId: sarah.id,
      projectId: live.id,
      amountCents: 25000,
      currency: 'USD',
      status: 'CAPTURED',
      refundedCents: 0,
      paypalCaptureId: 'CAP-LIVE',
      createdAt: new Date('2026-11-09T01:00:00Z'),
    },
  });

  const now = new Date('2026-11-10T12:00:00Z');
  const first = await seedAgencyDemo(mem.db, { now });
  assert.strictEqual(first.createdProjects, 4);
  assert.strictEqual(first.existingProjects, 0);

  const second = await seedAgencyDemo(mem.db, { now });
  assert.strictEqual(second.createdProjects, 0);
  assert.strictEqual(second.existingProjects, 4);
  assert.deepStrictEqual(
    second.projects.map((row) => row.projectId),
    first.projects.map((row) => row.projectId)
  );
  assert.strictEqual(mem.projects.length, 5);

  const rohanAfter = await mem.db.user.findUnique({
    where: { email: 'rohan.freelancer@aegis-split.demo' },
  });
  assert.strictEqual(rohanAfter.paypalEmail, 'custom-rohan@example.com');
  assert.strictEqual(rohanAfter.govIdVerified, true);
  assert.strictEqual(rohanAfter.monitoringConsentGranted, true);

  const sampleVaults = mem.vaults.filter((row) => row.projectId !== live.id);
  assert.ok(sampleVaults.length >= 4);
  assert.ok(sampleVaults.every((row) => !row.paypalOrderId && !row.paypalCaptureId));
  assert.strictEqual(mem.disputes.length, 1);
  assert.ok(String(mem.disputes[0].reason).includes('Sample dispute'));

  const dashboard = await loadAgencyDashboard(mem.db);
  assert.strictEqual(dashboard.totals.projectCount, 5);
  assert.strictEqual(dashboard.totals.live.heldCents, 25000);
  assert.strictEqual(dashboard.totals.live.releasedCents, 0);
  assert.strictEqual(dashboard.totals.live.pendingCents, 0);
  assert.strictEqual(dashboard.totals.live.depositsAtRiskCents, 2500);
  assert.strictEqual(dashboard.totals.live.openDisputes, 0);
  assert.strictEqual(dashboard.totals.live.activeProjectCount, 1);
  assert.strictEqual(dashboard.totals.sample.heldCents, 400000);
  assert.strictEqual(dashboard.totals.sample.releasedCents, 175000);
  assert.strictEqual(dashboard.totals.sample.pendingCents, 40000);
  assert.strictEqual(dashboard.totals.sample.depositsAtRiskCents, 53500);
  assert.strictEqual(dashboard.totals.sample.openDisputes, 1);
  assert.strictEqual(dashboard.totals.sample.activeProjectCount, 3);

  const byTitle = new Map(dashboard.projects.map((row) => [row.title, row]));
  assert.strictEqual(byTitle.get('Auth service MVP').sample, false);
  assert.strictEqual(byTitle.get('Auth service MVP').escrowLabel, 'Held in escrow');
  assert.strictEqual(byTitle.get('Tournament overlay pack').sample, true);
  assert.strictEqual(byTitle.get('Tournament overlay pack').escrowLabel, 'Held in escrow');
  assert.strictEqual(byTitle.get('VOD recap series').escrowLabel, 'Part released, part pending');
  assert.strictEqual(byTitle.get('Caster lower-thirds').escrowState, 'IN_DISPUTE');
  assert.strictEqual(byTitle.get('Season bumper stings').escrowState, 'COMPLETED');
  assert.strictEqual(byTitle.get('Season bumper stings').depositAtRiskCents, 0);
  assert.strictEqual(dashboard.projects[0].sample, false);

  const rohanSeat = dashboard.members.find((member) => member.key === 'rohan');
  assert.strictEqual(rohanSeat.payoutsCents, 80000);
  assert.strictEqual(rohanSeat.activeProjects, 1);
  assert.strictEqual(rohanSeat.heldCents, 25000);
  assert.strictEqual(rohanSeat.depositsAtRiskCents, 2500);
  assert.strictEqual(rohanSeat.openDisputes, 0);

  assert.strictEqual(dashboard.openDisputes.length, 1);
  assert.strictEqual(dashboard.openDisputes[0].sample, true);
  assert.strictEqual(dashboard.openDisputes[0].counselorVisible, false);
  assert.strictEqual(dashboard.depositsAtRisk.length, 4);

  assert.strictEqual(dashboard.activity.length, 12);
  assert.strictEqual(dashboard.activity[0].kind, 'DISPUTE_OPENED');
  assert.strictEqual(dashboard.activity[0].sample, true);
  assert.ok(dashboard.activity.some((event) => event.sample === false));
}

async function run() {
  await testSeedIsIdempotentAndMixesLiveProjects();
  console.log('agency demo seed tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
