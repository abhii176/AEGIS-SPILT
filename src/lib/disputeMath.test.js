const assert = require('assert');
const {
  raiseDisputeTransition,
  assertPayoutAllowed,
  assertExitAllowed,
  buildDisputeMoneyPlan,
  describeDisputeLines,
  decisionTransition,
  normalizeFreelancerPercent,
} = require('./disputeMath');

const funded = [{ id: 'ms-1', status: 'FUNDED', amountCents: 25000 }];

function testRaiseRequiresFundedMilestone() {
  const pending = raiseDisputeTransition({
    projectStatus: 'ACTIVE',
    milestones: [{ id: 'ms-1', status: 'PENDING' }],
  });
  assert.strictEqual(pending.ok, false);
  assert.strictEqual(pending.code, 'nothing_funded');

  const named = raiseDisputeTransition({
    projectStatus: 'ACTIVE',
    milestones: [{ id: 'ms-1', status: 'PENDING' }],
    milestoneId: 'ms-1',
  });
  assert.strictEqual(named.code, 'milestone_not_funded');

  const missing = raiseDisputeTransition({
    projectStatus: 'ACTIVE',
    milestones: funded,
    milestoneId: 'nope',
  });
  assert.strictEqual(missing.code, 'milestone_not_found');
  assert.strictEqual(missing.status, 404);
}

function testRaiseMovesProjectToDisputed() {
  const opened = raiseDisputeTransition({
    projectStatus: 'ACTIVE',
    milestones: funded,
    milestoneId: 'ms-1',
  });
  assert.deepStrictEqual(opened, {
    ok: true,
    projectStatus: 'DISPUTED',
    disputeStatus: 'OPEN',
  });

  const again = raiseDisputeTransition({
    projectStatus: 'DISPUTED',
    milestones: funded,
    hasOpenDispute: true,
  });
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.code, 'dispute_exists');
}

function testRaiseBlockedAfterTerminalStatus() {
  for (const projectStatus of [
    'CANCELLED',
    'CANCELLED_MUTUAL',
    'CANCELLED_BY_CLIENT',
    'ABANDONED_BY_FREELANCER',
    'COMPLETED',
  ]) {
    const result = raiseDisputeTransition({
      projectStatus,
      milestones: funded,
    });
    assert.strictEqual(result.ok, false, projectStatus);
    assert.strictEqual(result.code, 'project_not_disputable');
  }
}

function testPayoutAndExitPauseWhileDisputed() {
  const project = { status: 'DISPUTED' };
  assert.throws(
    () => assertPayoutAllowed(project),
    (err) => err.code === 'dispute_open' && err.status === 409
  );
  assert.throws(
    () => assertExitAllowed(project, 'exits'),
    (err) => err.code === 'dispute_open' && /paused/.test(err.message)
  );
  assert.strictEqual(assertPayoutAllowed({ status: 'ACTIVE' }).status, 'ACTIVE');
  assert.strictEqual(assertExitAllowed({ status: 'ACTIVE' }).status, 'ACTIVE');
}

function testSplitMath() {
  const release = buildDisputeMoneyPlan({
    decision: 'RELEASE_TO_FREELANCER',
    remainingVaultCents: 25000,
    depositCents: 2500,
    depositHeld: true,
  });
  assert.strictEqual(release.freelancerPercent, 100);
  assert.strictEqual(release.freelancerAmountCents, 25000);
  assert.strictEqual(release.clientRefundCents, 0);
  assert.strictEqual(release.depositDisposition, 'RETURNED');
  assert.strictEqual(release.projectStatus, 'COMPLETED');
  assert.strictEqual(release.milestoneStatus, 'PAID');

  const refund = buildDisputeMoneyPlan({
    decision: 'REFUND_CLIENT',
    remainingVaultCents: 25000,
    depositCents: 2500,
    depositHeld: true,
    freelancerAtFault: true,
  });
  assert.strictEqual(refund.freelancerPercent, 0);
  assert.strictEqual(refund.freelancerAmountCents, 0);
  assert.strictEqual(refund.clientRefundCents, 25000);
  assert.strictEqual(refund.depositDisposition, 'FORFEITED');
  assert.strictEqual(refund.depositPayoutTo, 'client');
  assert.strictEqual(refund.projectStatus, 'CANCELLED');
  assert.strictEqual(refund.milestoneStatus, 'CANCELLED');

  const split = buildDisputeMoneyPlan({
    decision: 'SPLIT',
    remainingVaultCents: 25000,
    depositCents: 2500,
    depositHeld: true,
  });
  assert.strictEqual(split.freelancerPercent, 50);
  assert.strictEqual(split.freelancerAmountCents, 12500);
  assert.strictEqual(split.clientRefundCents, 12500);
  assert.strictEqual(split.depositDisposition, 'RETURNED');
  assert.strictEqual(split.projectStatus, 'COMPLETED');
  assert.strictEqual(split.milestoneStatus, 'CANCELLED');

  // Floor: 50% of 1001 = 500 to freelancer, 501 remainder to client.
  const odd = buildDisputeMoneyPlan({
    decision: 'split',
    freelancerPercent: 50,
    remainingVaultCents: 1001,
  });
  assert.strictEqual(odd.freelancerAmountCents, 500);
  assert.strictEqual(odd.clientRefundCents, 501);
  assert.strictEqual(odd.freelancerAmountCents + odd.clientRefundCents, 1001);

  const custom = buildDisputeMoneyPlan({
    decision: 'SPLIT',
    freelancerPercent: 30,
    remainingVaultCents: 10000,
    depositCents: 1000,
    depositHeld: false,
  });
  assert.strictEqual(custom.freelancerAmountCents, 3000);
  assert.strictEqual(custom.clientRefundCents, 7000);
  assert.strictEqual(custom.depositDisposition, 'NONE');
  assert.strictEqual(custom.depositCents, 0);

  assert.throws(
    () => normalizeFreelancerPercent('SPLIT', 50.5),
    (err) => err.code === 'invalid_split_percent'
  );
  assert.throws(
    () => buildDisputeMoneyPlan({ decision: 'KEEP', remainingVaultCents: 100 }),
    (err) => err.code === 'invalid_decision' && err.status === 400
  );
}

function testDecisionTransitionAndLines() {
  const plan = buildDisputeMoneyPlan({
    decision: 'SPLIT',
    freelancerPercent: 40,
    remainingVaultCents: 10000,
    depositCents: 1000,
    depositHeld: true,
    freelancerAtFault: true,
  });
  assert.strictEqual(plan.freelancerAmountCents, 4000);
  assert.strictEqual(plan.clientRefundCents, 6000);
  const lines = describeDisputeLines(plan);
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0].to, 'freelancer');
  assert.strictEqual(lines[1].amountCents, 6000);
  assert.strictEqual(lines[2].to, 'client');

  const next = decisionTransition({
    projectStatus: 'DISPUTED',
    disputeStatus: 'OPEN',
    plan,
  });
  assert.deepStrictEqual(next, {
    projectStatus: 'COMPLETED',
    disputeStatus: 'RESOLVED',
    milestoneStatus: 'CANCELLED',
  });

  assert.throws(
    () =>
      decisionTransition({
        projectStatus: 'ACTIVE',
        disputeStatus: 'OPEN',
        plan,
      }),
    (err) => err.code === 'dispute_not_open'
  );
  assert.throws(
    () =>
      decisionTransition({
        projectStatus: 'DISPUTED',
        disputeStatus: 'RESOLVED',
        plan,
      }),
    (err) => err.code === 'dispute_already_resolved'
  );
}

function testZeroVaultStillSettlesDeposit() {
  const plan = buildDisputeMoneyPlan({
    decision: 'REFUND_CLIENT',
    remainingVaultCents: 0,
    depositCents: 2500,
    depositHeld: true,
  });
  assert.strictEqual(plan.freelancerAmountCents, 0);
  assert.strictEqual(plan.clientRefundCents, 0);
  assert.strictEqual(plan.depositDisposition, 'RETURNED');
  const lines = describeDisputeLines(plan);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].label.includes('Return security deposit'), true);
}

function run() {
  testRaiseRequiresFundedMilestone();
  testRaiseMovesProjectToDisputed();
  testRaiseBlockedAfterTerminalStatus();
  testPayoutAndExitPauseWhileDisputed();
  testSplitMath();
  testDecisionTransitionAndLines();
  testZeroVaultStillSettlesDeposit();
  console.log('dispute state machine + split math tests passed');
}

run();
