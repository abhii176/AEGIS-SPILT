const assert = require('assert');
const {
  resolveDepositAmountCents,
  remainingVaultCents,
  computeClientOnesidedSplit,
  buildExitMoneyPlan,
  sumMilestoneTotalCents,
  sumPaidOutCents,
  sumCapturedVaultCents,
  isCancelledStatus,
} = require('./exitMath');

function testDepositDefaultTenPercentFloor() {
  // 10% of $250.00 = $25.00
  assert.strictEqual(
    resolveDepositAmountCents({ milestoneTotalCents: 25000 }),
    2500
  );
  // Floor: 10% of 999 cents = 99
  assert.strictEqual(
    resolveDepositAmountCents({ milestoneTotalCents: 999 }),
    99
  );
  // Explicit override wins
  assert.strictEqual(
    resolveDepositAmountCents({
      freelancerDepositAmountCents: 4000,
      milestoneTotalCents: 25000,
    }),
    4000
  );
  assert.strictEqual(resolveDepositAmountCents({ milestoneTotalCents: 0 }), 0);
}

function testRemainingVault() {
  assert.strictEqual(
    remainingVaultCents({ capturedVaultCents: 50000, paidOutCents: 25000 }),
    25000
  );
  assert.strictEqual(
    remainingVaultCents({ capturedVaultCents: 1000, paidOutCents: 5000 }),
    0
  );
}

function testClientOnesidedRounding() {
  // Default 50% of 10000 = 5000 exact
  assert.deepStrictEqual(
    computeClientOnesidedSplit({
      remainingVaultCents: 10000,
    }),
    {
      remainingVaultCents: 10000,
      penaltyCents: 5000,
      clientRefundCents: 5000,
      freelancerPayoutCents: 5000,
    }
  );
  // Explicit 20% still supported
  assert.deepStrictEqual(
    computeClientOnesidedSplit({
      remainingVaultCents: 10000,
      earlyExitPenaltyPercent: 20,
    }),
    {
      remainingVaultCents: 10000,
      penaltyCents: 2000,
      clientRefundCents: 8000,
      freelancerPayoutCents: 2000,
    }
  );
  // Floor: 50% of 1001 = floor(500.5) = 500; client gets 501
  assert.deepStrictEqual(
    computeClientOnesidedSplit({
      remainingVaultCents: 1001,
      earlyExitPenaltyPercent: 50,
    }),
    {
      remainingVaultCents: 1001,
      penaltyCents: 500,
      clientRefundCents: 501,
      freelancerPayoutCents: 500,
    }
  );
  // 0% → full refund to client
  assert.strictEqual(
    computeClientOnesidedSplit({
      remainingVaultCents: 5000,
      earlyExitPenaltyPercent: 0,
    }).clientRefundCents,
    5000
  );
}

function testMutualExitPlan() {
  const plan = buildExitMoneyPlan({
    exitPath: 'MUTUAL',
    remainingVaultCents: 25000,
    depositCents: 2500,
    depositStatus: 'HELD',
  });
  assert.strictEqual(plan.projectStatus, 'CANCELLED_MUTUAL');
  assert.strictEqual(plan.penaltyCents, 0);
  assert.strictEqual(plan.clientRefundCents, 25000);
  assert.strictEqual(plan.freelancerPayoutCents, 0);
  assert.strictEqual(plan.depositDisposition, 'RETURNED');
  assert.strictEqual(plan.depositPayoutTo, 'freelancer');
}

function testClientOnesidedExitPlan() {
  const plan = buildExitMoneyPlan({
    exitPath: 'CLIENT_ONESIDED',
    remainingVaultCents: 25000,
    depositCents: 2500,
    depositStatus: 'HELD',
  });
  assert.strictEqual(plan.projectStatus, 'CANCELLED_BY_CLIENT');
  assert.strictEqual(plan.penaltyCents, 12500);
  assert.strictEqual(plan.clientRefundCents, 12500);
  assert.strictEqual(plan.freelancerPayoutCents, 12500);
  assert.strictEqual(plan.depositDisposition, 'RETURNED');
}

function testFreelancerWalkAwayPlan() {
  const plan = buildExitMoneyPlan({
    exitPath: 'FREELANCER_WALKAWAY',
    remainingVaultCents: 25000,
    depositCents: 2500,
    depositStatus: 'HELD',
  });
  assert.strictEqual(plan.projectStatus, 'ABANDONED_BY_FREELANCER');
  assert.strictEqual(plan.penaltyCents, 0);
  assert.strictEqual(plan.clientRefundCents, 25000);
  assert.strictEqual(plan.depositDisposition, 'FORFEITED');
  assert.strictEqual(plan.depositPayoutTo, 'client');
}

function testNoDepositHeldMeansNoneDisposition() {
  const plan = buildExitMoneyPlan({
    exitPath: 'MUTUAL',
    remainingVaultCents: 1000,
    depositCents: 2500,
    depositStatus: 'PENDING',
  });
  assert.strictEqual(plan.depositDisposition, 'NONE');
  assert.strictEqual(plan.depositCents, 0);
}

function testSumsAndCancelled() {
  assert.strictEqual(
    sumMilestoneTotalCents([{ amountCents: 100 }, { amountCents: 250 }]),
    350
  );
  assert.strictEqual(
    sumPaidOutCents([
      { amountCents: 100, status: 'PAID' },
      { amountCents: 200, status: 'FUNDED' },
      { amountCents: 50, status: 'RELEASED' },
    ]),
    150
  );
  assert.strictEqual(
    sumCapturedVaultCents([
      { status: 'CAPTURED', amountCents: 1000, refundedCents: 200 },
      { status: 'PENDING', amountCents: 500 },
    ]),
    800
  );
  assert.strictEqual(isCancelledStatus('CANCELLED_MUTUAL'), true);
  assert.strictEqual(isCancelledStatus('ACTIVE'), false);
}

function testThreePathsMoneyConservation() {
  const remaining = 12345;
  const deposit = 1234;
  for (const path of ['MUTUAL', 'CLIENT_ONESIDED', 'FREELANCER_WALKAWAY']) {
    const plan = buildExitMoneyPlan({
      exitPath: path,
      remainingVaultCents: remaining,
      earlyExitPenaltyPercent: 50,
      depositCents: deposit,
      depositStatus: 'HELD',
    });
    assert.strictEqual(
      plan.clientRefundCents + plan.freelancerPayoutCents,
      remaining,
      `${path} vault split must conserve remaining`
    );
    assert.ok(plan.depositCents === deposit);
  }
}

testDepositDefaultTenPercentFloor();
testRemainingVault();
testClientOnesidedRounding();
testMutualExitPlan();
testClientOnesidedExitPlan();
testFreelancerWalkAwayPlan();
testNoDepositHeldMeansNoneDisposition();
testSumsAndCancelled();
testThreePathsMoneyConservation();
console.log('exit math / three-path money tests passed');
