const assert = require('assert');
const { view } = require('../../public/depositPanel');

const SARAH = 'user-sarah';
const ROHAN = 'user-rohan';

function project(overrides = {}) {
  return {
    id: 'proj-1',
    clientId: SARAH,
    freelancerId: ROHAN,
    freelancer: { id: ROHAN, name: 'Rohan Mehta' },
    depositStatus: 'PENDING',
    freelancerDepositAmountCents: null,
    effectiveDepositAmountCents: 2500,
    milestoneTotalCents: 25000,
    ...overrides,
  };
}

function testClientSeesStatusNotButtons() {
  const panel = view({
    userId: SARAH,
    userRole: 'CLIENT',
    project: project(),
    freelancerName: 'Rohan Mehta',
    depositApprovalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER',
  });

  assert.strictEqual(panel.showActions, false);
  assert.strictEqual(panel.showApprove, false);
  assert.strictEqual(panel.approveUrl, '');
  assert.strictEqual(panel.showHint, true);
  assert.strictEqual(panel.statusText, 'Freelancer deposit: $25 - pending');
  assert.strictEqual(panel.hintText, 'Switch to Rohan (freelancer) to pay the deposit');
}

function testFreelancerSeesButtonsAndApproveLink() {
  const panel = view({
    userId: ROHAN,
    userRole: 'FREELANCER',
    project: project(),
    freelancerName: 'Rohan Mehta',
    depositApprovalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER',
  });

  assert.strictEqual(panel.showActions, true);
  assert.strictEqual(panel.showHint, false);
  assert.strictEqual(panel.showApprove, true);
  assert.strictEqual(
    panel.approveUrl,
    'https://www.sandbox.paypal.com/checkoutnow?token=ORDER'
  );
  assert.strictEqual(panel.statusText, 'Freelancer deposit: $25 - pending');
}

function testPaidDepositDropsApproveLink() {
  const panel = view({
    userId: ROHAN,
    userRole: 'FREELANCER',
    project: project({ depositStatus: 'HELD' }),
    depositApprovalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER',
  });

  assert.strictEqual(panel.showActions, true);
  assert.strictEqual(panel.showApprove, false);
  assert.strictEqual(panel.statusText, 'Freelancer deposit: $25 - paid');

  const returned = view({
    userId: SARAH,
    userRole: 'CLIENT',
    project: project({ depositStatus: 'RETURNED', effectiveDepositAmountCents: 2500 }),
  });
  assert.strictEqual(returned.statusText, 'Freelancer deposit: $25 - returned');
  assert.strictEqual(returned.showActions, false);
  assert.strictEqual(returned.showHint, false);

  const forfeited = view({
    userId: SARAH,
    userRole: 'CLIENT',
    project: project({ depositStatus: 'FORFEITED' }),
  });
  assert.strictEqual(forfeited.statusText, 'Freelancer deposit: $25 - forfeited');
}

function testStaleCreateSnapshotUsesKnownMilestone() {
  const panel = view({
    userId: SARAH,
    userRole: 'CLIENT',
    project: project({
      effectiveDepositAmountCents: 0,
      freelancerDepositAmountCents: null,
      milestoneTotalCents: 0,
      milestones: [],
    }),
    milestoneTotalCents: 25000,
  });
  assert.strictEqual(panel.statusText, 'Freelancer deposit: $25 - pending');
}

function testExplicitDepositWinsOverMilestoneTotal() {
  const panel = view({
    userId: ROHAN,
    userRole: 'FREELANCER',
    project: project({
      freelancerDepositAmountCents: 4000,
      effectiveDepositAmountCents: 4000,
      milestoneTotalCents: 25000,
    }),
  });
  assert.strictEqual(panel.statusText, 'Freelancer deposit: $40 - pending');
  assert.strictEqual(panel.showActions, true);
}

function testDefaultTenPercentWithoutExplicitAmount() {
  const panel = view({
    userId: SARAH,
    userRole: 'CLIENT',
    project: project({
      effectiveDepositAmountCents: undefined,
      freelancerDepositAmountCents: null,
      milestoneTotalCents: undefined,
      milestones: [{ amountCents: 25000 }],
    }),
  });
  assert.strictEqual(panel.statusText, 'Freelancer deposit: $25 - pending');
}

function testRoleBeforeProjectExists() {
  const client = view({ userId: SARAH, userRole: 'CLIENT', project: null });
  assert.strictEqual(client.showActions, false);
  assert.strictEqual(client.showHint, true);
  assert.strictEqual(client.statusText, 'Freelancer deposit: —');
  assert.strictEqual(client.hintText, 'Switch to Rohan (freelancer) to pay the deposit');

  const freelancer = view({ userId: ROHAN, userRole: 'FREELANCER', project: null });
  assert.strictEqual(freelancer.showActions, true);
  assert.strictEqual(freelancer.showHint, false);
}

function testStrangerIsNotTheProjectFreelancer() {
  const panel = view({
    userId: 'user-other',
    userRole: 'FREELANCER',
    project: project(),
  });
  assert.strictEqual(panel.showActions, false);
  assert.strictEqual(panel.showHint, true);
}

function run() {
  testClientSeesStatusNotButtons();
  testFreelancerSeesButtonsAndApproveLink();
  testPaidDepositDropsApproveLink();
  testStaleCreateSnapshotUsesKnownMilestone();
  testExplicitDepositWinsOverMilestoneTotal();
  testDefaultTenPercentWithoutExplicitAmount();
  testRoleBeforeProjectExists();
  testStrangerIsNotTheProjectFreelancer();
  console.log('deposit panel view tests passed');
}

run();
