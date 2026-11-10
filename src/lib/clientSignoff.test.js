const assert = require('assert');
const {
  releaseBlockedAwaitingClientSignoff,
  assertClientCanSignOff,
} = require('./clientSignoff');

const project = { id: 'p1', clientId: 'client-1', freelancerId: 'free-1', status: 'ACTIVE' };

function testAutoMilestoneNeverBlocksRelease() {
  assert.strictEqual(
    releaseBlockedAwaitingClientSignoff({ requiresManualSignoff: false, status: 'PASSED' }),
    false
  );
  assert.strictEqual(releaseBlockedAwaitingClientSignoff({ status: 'FUNDED' }), false);
}

function testManualMilestoneBlocksUntilClientSigns() {
  const waiting = { requiresManualSignoff: true, manualSignedOffAt: null, status: 'PASSED' };
  assert.strictEqual(releaseBlockedAwaitingClientSignoff(waiting), true);
  assert.strictEqual(
    releaseBlockedAwaitingClientSignoff(waiting, { allowDemoBypass: true }),
    false
  );
  assert.strictEqual(
    releaseBlockedAwaitingClientSignoff({
      ...waiting,
      manualSignedOffAt: new Date(),
    }),
    false
  );
}

function testOnlyClientCanSignOffAfterPass() {
  const milestone = {
    status: 'PASSED',
    auditPassed: true,
    requiresManualSignoff: true,
    manualSignedOffAt: null,
    project,
  };

  const ok = assertClientCanSignOff({ milestone, userId: 'client-1' });
  assert.strictEqual(ok.alreadyPaid, false);
  assert.strictEqual(ok.alreadySigned, false);

  assert.throws(
    () => assertClientCanSignOff({ milestone, userId: 'free-1' }),
    (err) => err.code === 'client_signoff_only' && err.status === 403
  );

  assert.throws(
    () =>
      assertClientCanSignOff({
        milestone: { ...milestone, requiresManualSignoff: false },
        userId: 'client-1',
      }),
    (err) => err.code === 'signoff_not_required'
  );

  assert.throws(
    () =>
      assertClientCanSignOff({
        milestone: { ...milestone, status: 'FAILED', auditPassed: false },
        userId: 'client-1',
      }),
    (err) => err.code === 'audit_not_passed'
  );

  const paid = assertClientCanSignOff({
    milestone: { ...milestone, status: 'PAID' },
    userId: 'client-1',
  });
  assert.strictEqual(paid.alreadyPaid, true);
}

testAutoMilestoneNeverBlocksRelease();
testManualMilestoneBlocksUntilClientSigns();
testOnlyClientCanSignOffAfterPass();
console.log('client sign-off tests passed');
