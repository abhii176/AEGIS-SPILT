const assert = require('assert');
const { createDisputeService } = require('./disputeService');
const { createExitService } = require('../exit/exitService');
const { createPaypalService } = require('../paypal');
const { ESCROW_NEVER_FUNDED_MESSAGE } = require('../paypal/captureIds');

function makeHarness({ paypal = null } = {}) {
  const state = {
    project: {
      id: 'proj-1',
      status: 'ACTIVE',
      title: 'Auth service MVP',
      clientId: 'sarah',
      freelancerId: 'rohan',
      depositStatus: 'HELD',
      freelancerDepositAmountCents: 2500,
      client: {
        id: 'sarah',
        name: 'Sarah Chen',
        email: 'sarah@example.com',
        role: 'CLIENT',
        paypalEmail: 'sarah@example.com',
      },
      freelancer: {
        id: 'rohan',
        name: 'Rohan Mehta',
        email: 'rohan@example.com',
        role: 'FREELANCER',
        paypalEmail: 'rohan@example.com',
      },
      milestones: [
        {
          id: 'ms-1',
          projectId: 'proj-1',
          status: 'FUNDED',
          sequence: 1,
          title: 'Login',
          taskDescription: 'Ship login',
          acceptanceCriteria: 'login form; session cookie',
          amountCents: 25000,
          currency: 'USD',
          auditPassed: true,
          auditReport: 'PASS — login form and session cookie found',
          auditCheckedAt: new Date('2026-11-10T00:00:00Z'),
        },
      ],
      vaultFunds: [
        {
          id: 'vf-1',
          status: 'CAPTURED',
          amountCents: 25000,
          refundedCents: 0,
          currency: 'USD',
          paypalCaptureId: 'CAP-1',
          createdAt: new Date('2026-11-09T00:00:00Z'),
        },
      ],
      freelancerDeposits: [
        { id: 'dep-1', status: 'CAPTURED', amountCents: 2500, currency: 'USD' },
      ],
    },
    dispute: null,
    messages: [
      {
        id: 'msg-1',
        body: 'The login form is up',
        createdAt: new Date('2026-11-10T01:00:00Z'),
        senderUserId: 'rohan',
        sender: { id: 'rohan', name: 'Rohan Mehta', role: 'FREELANCER' },
      },
    ],
    merges: [
      {
        id: 'me-1',
        milestoneId: 'ms-1',
        repoFullName: 'acme/auth',
        prNumber: 4,
        mergeSha: 'abc',
        source: 'demo',
        createdAt: new Date('2026-11-10T02:00:00Z'),
        metadata: { diffPreview: '+ login form\n+ session cookie' },
      },
    ],
    consents: [
      {
        userId: 'sarah',
        consentType: 'MONITORING',
        consentVersion: '2.0.0',
        agreedAt: new Date('2026-11-08T00:00:00Z'),
      },
      {
        userId: 'rohan',
        consentType: 'MONITORING',
        consentVersion: '2.0.0',
        agreedAt: new Date('2026-11-08T01:00:00Z'),
      },
    ],
  };

  const calls = { payout: 0, refund: 0, deposit: 0, depositPlan: null };

  function bundle() {
    return {
      ...state.project,
      client: { ...state.project.client },
      freelancer: { ...state.project.freelancer },
      milestones: state.project.milestones.map((m) => ({ ...m })),
      vaultFunds: state.project.vaultFunds.map((v) => ({ ...v })),
      freelancerDeposits: state.project.freelancerDeposits.map((d) => ({ ...d })),
      disputes: state.dispute ? [{ ...state.dispute }] : [],
    };
  }

  const db = {
    project: {
      findUnique: async () => bundle(),
      update: async ({ data }) => {
        Object.assign(state.project, data);
        return bundle();
      },
    },
    dispute: {
      create: async ({ data }) => {
        if (state.dispute && state.dispute.idempotencyKey === data.idempotencyKey) {
          const err = new Error('unique');
          err.code = 'P2002';
          throw err;
        }
        state.dispute = {
          id: 'disp-1',
          freelancerAtFault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        return { ...state.dispute };
      },
      findUnique: async ({ where }) => {
        if (!state.dispute) return null;
        if (where.id && where.id !== state.dispute.id) return null;
        if (where.idempotencyKey && where.idempotencyKey !== state.dispute.idempotencyKey) {
          return null;
        }
        return { ...state.dispute };
      },
      findFirst: async () => (state.dispute ? { ...state.dispute } : null),
      findMany: async () => {
        if (!state.dispute) return [];
        return [
          {
            ...state.dispute,
            project: bundle(),
            raisedBy: { id: 'sarah', name: 'Sarah Chen', role: 'CLIENT' },
          },
        ];
      },
      updateMany: async ({ where, data }) => {
        if (
          !state.dispute ||
          state.dispute.id !== where.id ||
          state.dispute.status !== where.status
        ) {
          return { count: 0 };
        }
        Object.assign(state.dispute, data);
        return { count: 1 };
      },
      update: async ({ data }) => {
        Object.assign(state.dispute, data);
        return { ...state.dispute };
      },
    },
    milestone: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const milestone of state.project.milestones) {
          if (where.projectId && milestone.projectId !== where.projectId) continue;
          if (where.status && where.status.notIn && where.status.notIn.includes(milestone.status)) {
            continue;
          }
          if (typeof where.status === 'string' && milestone.status !== where.status) continue;
          Object.assign(milestone, data);
          count += 1;
        }
        return { count };
      },
    },
    vaultFund: {
      update: async ({ where, data }) => {
        const fund = state.project.vaultFunds.find((row) => row.id === where.id);
        if (!fund) return null;
        Object.assign(fund, data);
        return { ...fund };
      },
    },
    freelancerDeposit: {
      update: async ({ where, data }) => {
        const deposit = state.project.freelancerDeposits.find((row) => row.id === where.id);
        if (!deposit) return null;
        Object.assign(deposit, data);
        return { ...deposit };
      },
    },
    chatMessage: {
      findMany: async () => state.messages.map((m) => ({ ...m, sender: { ...m.sender } })),
    },
    mergeEvent: {
      findMany: async () => state.merges.map((m) => ({ ...m })),
    },
    consentLogs: {
      findMany: async () => state.consents.map((c) => ({ ...c })),
    },
    $transaction: async (fn) => fn(db),
  };

  const exit = paypal
    ? createExitService({ db, paypal, notifications: {} })
    : {
        payoutAmount: async () => {
          calls.payout += 1;
          return { payoutBatchId: 'BATCH-DISP', payoutItemId: 'ITEM-DISP', raw: { mock: true } };
        },
        refundVaultToClient: async ({ amountCents }) => {
          calls.refund += 1;
          return [{ refundId: 'RF-1', amountCents }];
        },
        settleDeposit: async ({ plan }) => {
          calls.deposit += 1;
          calls.depositPlan = plan;
          state.project.depositStatus =
            plan.depositDisposition === 'FORFEITED' ? 'FORFEITED' : 'RETURNED';
          return {
            depositStatus: state.project.depositStatus,
            payout: { payoutBatchId: 'DEP-1', payoutItemId: 'DEP-ITEM' },
          };
        },
      };

  const notifications = {
    notifyDisputeOpened: async () => ({ created: [{}] }),
    notifyDisputeResolved: async () => ({ created: [{}] }),
  };

  const service = createDisputeService({ db, exit, notifications });
  return { service, state, calls };
}

async function testRaiseThenSplitOnce() {
  const { service, state, calls } = makeHarness();

  const opened = await service.raiseDispute({
    projectId: 'proj-1',
    userId: 'sarah',
    milestoneId: 'ms-1',
    reason: 'Login works but the session cookie is missing',
  });
  assert.strictEqual(opened.projectStatus, 'DISPUTED');
  assert.strictEqual(state.project.status, 'DISPUTED');
  assert.strictEqual(opened.dispute.status, 'OPEN');

  await assert.rejects(
    () =>
      service.raiseDispute({
        projectId: 'proj-1',
        userId: 'rohan',
        reason: 'I also disagree',
      }),
    (err) => err.code === 'dispute_exists'
  );

  const preview = await service.previewDecision({
    disputeId: 'disp-1',
    decision: 'SPLIT',
  });
  assert.strictEqual(preview.plan.freelancerPercent, 50);
  assert.strictEqual(preview.plan.freelancerAmountCents, 12500);
  assert.strictEqual(preview.plan.clientRefundCents, 12500);
  assert.strictEqual(preview.plan.depositDisposition, 'RETURNED');
  assert.strictEqual(state.dispute.status, 'OPEN');

  const decided = await service.decideDispute({
    disputeId: 'disp-1',
    decision: 'SPLIT',
    note: 'Split the vault. Deposit goes back to Rohan.',
    decidedByUserId: 'maya',
    decidedByLabel: 'Maya Rao',
  });

  assert.strictEqual(decided.alreadyResolved, false);
  assert.strictEqual(decided.dispute.status, 'RESOLVED');
  assert.strictEqual(decided.dispute.decision, 'SPLIT');
  assert.strictEqual(decided.dispute.freelancerAmountCents, 12500);
  assert.strictEqual(decided.dispute.clientRefundCents, 12500);
  assert.strictEqual(decided.dispute.depositDisposition, 'RETURNED');
  assert.strictEqual(decided.dispute.decidedByLabel, 'Maya Rao');
  assert.strictEqual(decided.dispute.transferIds.freelancerPayoutBatchId, 'BATCH-DISP');
  assert.strictEqual(decided.dispute.transferIds.pending, false);
  assert.strictEqual(state.project.status, 'COMPLETED');
  assert.strictEqual(state.project.milestones[0].status, 'CANCELLED');
  assert.strictEqual(calls.payout, 1);
  assert.strictEqual(calls.refund, 1);
  assert.strictEqual(calls.deposit, 1);
  assert.strictEqual(calls.depositPlan.depositDisposition, 'RETURNED');

  const again = await service.decideDispute({
    disputeId: 'disp-1',
    decision: 'SPLIT',
    note: 'Split the vault. Deposit goes back to Rohan.',
    decidedByLabel: 'Maya Rao',
  });
  assert.strictEqual(again.alreadyResolved, true);
  assert.strictEqual(calls.payout, 1);
  assert.strictEqual(calls.refund, 1);
  assert.strictEqual(calls.deposit, 1);

  await assert.rejects(
    () =>
      service.decideDispute({
        disputeId: 'disp-1',
        decision: 'REFUND_CLIENT',
        note: 'Changed my mind',
      }),
    (err) => err.code === 'dispute_already_resolved'
  );
  assert.strictEqual(calls.payout, 1);
}

async function testReleaseMarksPaidAndForfeitDeposit() {
  const { service, state, calls } = makeHarness();
  await service.raiseDispute({
    projectId: 'proj-1',
    userId: 'rohan',
    reason: 'Client will not accept the login work',
  });

  const decided = await service.decideDispute({
    disputeId: 'disp-1',
    decision: 'RELEASE_TO_FREELANCER',
    freelancerAtFault: true,
    note: 'Work meets the criteria. Deposit forfeited for missed deadline.',
    decidedByLabel: 'demo-admin-key',
  });

  assert.strictEqual(decided.plan.freelancerAmountCents, 25000);
  assert.strictEqual(decided.plan.clientRefundCents, 0);
  assert.strictEqual(decided.dispute.depositDisposition, 'FORFEITED');
  assert.strictEqual(state.project.status, 'COMPLETED');
  assert.strictEqual(state.project.milestones[0].status, 'PAID');
  assert.strictEqual(state.project.milestones[0].paypalPayoutBatchId, 'BATCH-DISP');
  assert.strictEqual(calls.depositPlan.depositDisposition, 'FORFEITED');
  assert.strictEqual(calls.payout, 1);
}

async function testEvidenceContents() {
  const { service, state } = makeHarness();
  await service.raiseDispute({
    projectId: 'proj-1',
    userId: 'sarah',
    milestoneId: 'ms-1',
    reason: 'Cookie never landed',
  });

  const evidence = await service.buildEvidence(
    {
      ...state.project,
      disputes: [state.dispute],
    },
    state.dispute
  );

  assert.strictEqual(evidence.milestones[0].acceptanceCriteria.includes('session cookie'), true);
  assert.strictEqual(evidence.vault.remainingVaultCents, 25000);
  assert.strictEqual(evidence.deposit.status, 'HELD');
  assert.strictEqual(evidence.messages.length, 1);
  assert.strictEqual(evidence.messages[0].createdAt instanceof Date, true);
  assert.strictEqual(evidence.audits[0].passed, true);
  assert.ok(evidence.audits[0].report.includes('PASS'));
  assert.strictEqual(evidence.diffs[0].diffPreview.includes('login form'), true);
  assert.strictEqual(evidence.consent.client.consentVersion, '2.0.0');
  assert.strictEqual(evidence.consent.freelancer.consentVersion, '2.0.0');
  assert.strictEqual(evidence.callRecordings.available, true);
  assert.strictEqual(evidence.callRecordings.preview, true);
  assert.strictEqual(evidence.callRecordings.sample, true);
  assert.strictEqual(evidence.callRecordings.liveCapture, false);
  assert.strictEqual(evidence.callRecordings.label, 'Call recording (preview - sample)');
  assert.ok(evidence.callRecordings.note.includes('Agora'));
  assert.ok(evidence.callRecordings.lines.filter((line) => line.flagged).length >= 2);
  assert.strictEqual(evidence.callRecordings.recordings, undefined);
}

async function testSamplePreviewDoesNotMoveMoney() {
  const { service, state, calls } = makeHarness();
  await service.raiseDispute({
    projectId: 'proj-1',
    userId: 'sarah',
    reason: 'Need a counselor',
  });
  state.project.description = 'agency-sample:caster-thirds\nSample project.';

  await assert.rejects(
    () => service.previewDecision({ disputeId: 'disp-1', decision: 'SPLIT' }),
    (err) => err.code === 'sample_preview_readonly'
  );
  await assert.rejects(
    () =>
      service.decideDispute({
        disputeId: 'disp-1',
        decision: 'SPLIT',
        note: 'Should not settle',
      }),
    (err) => err.code === 'sample_preview_readonly'
  );

  assert.strictEqual(calls.payout, 0);
  assert.strictEqual(calls.refund, 0);
  assert.strictEqual(calls.deposit, 0);
  assert.strictEqual(state.dispute.status, 'OPEN');
  assert.strictEqual(state.project.status, 'DISPUTED');

  const hidden = await service.listDisputes({ status: 'OPEN' });
  assert.strictEqual(hidden.disputes.length, 0);

  state.project.description = 'Real walkthrough project';
  const live = await service.listDisputes({ status: 'OPEN' });
  assert.strictEqual(live.disputes.length, 1);
  assert.strictEqual(live.disputes[0].id, 'disp-1');
}

function openDispute(state, extra = {}) {
  state.project.status = 'DISPUTED';
  state.dispute = {
    id: 'disp-1',
    projectId: 'proj-1',
    status: 'OPEN',
    reason: 'The PayPal payment never finished',
    idempotencyKey: 'dispute:proj-1',
    freelancerAtFault: false,
    milestoneId: 'ms-1',
    ...extra,
  };
}

function resourceNotFoundError() {
  const err = new Error('The specified resource does not exist.');
  err.status = 404;
  err.code = 'paypal_api_error';
  err.details = {
    name: 'RESOURCE_NOT_FOUND',
    message: 'The specified resource does not exist.',
    debug_id: 'secret-debug-id',
    details: [{ issue: 'INVALID_RESOURCE_ID' }],
  };
  return err;
}

async function testUnfundedDecisionRecordsWithoutPaypal() {
  const { service, state } = makeHarness();
  state.project.vaultFunds[0].status = 'ORDER_CREATED';
  state.project.vaultFunds[0].paypalCaptureId = null;
  state.project.vaultFunds[0].paypalOrderId = 'ORDER-UNFUNDED';
  state.project.milestones[0].status = 'FUNDED';

  await assert.rejects(
    () =>
      service.raiseDispute({
        projectId: 'proj-1',
        userId: 'sarah',
        milestoneId: 'ms-1',
        reason: 'The client never finished PayPal',
      }),
    (err) =>
      err.code === 'escrow_not_captured' &&
      err.message.includes('nothing to dispute yet') &&
      !err.message.includes('RESOURCE_NOT_FOUND')
  );
  assert.strictEqual(state.dispute, null);
  assert.strictEqual(state.project.status, 'ACTIVE');

  const seen = { refund: 0, payout: 0 };
  const paypal = {
    isMock: () => false,
    resolveRefundableCapture: async () => {
      throw new Error('resolve should not run for an uncaptured order');
    },
    refundCapture: async () => {
      seen.refund += 1;
      throw resourceNotFoundError();
    },
    createPayout: async () => {
      seen.payout += 1;
      throw resourceNotFoundError();
    },
  };
  const live = makeHarness({ paypal });
  live.state.project.vaultFunds = [
    {
      id: 'vf-open',
      status: 'ORDER_CREATED',
      amountCents: 30000,
      refundedCents: 0,
      currency: 'USD',
      paypalOrderId: 'ORDER-UNFUNDED',
      paypalCaptureId: null,
      createdAt: new Date('2026-11-09T00:00:00Z'),
    },
  ];
  live.state.project.depositStatus = 'PENDING';
  live.state.project.freelancerDeposits = [];
  openDispute(live.state);

  const preview = await live.service.previewDecision({
    disputeId: 'disp-1',
    decision: 'SPLIT',
  });
  assert.strictEqual(preview.escrowCaptured, false);
  assert.ok(preview.lines.some((line) => line.label.includes('never funded through PayPal')));
  assert.strictEqual(live.state.dispute.status, 'OPEN');

  const decided = await live.service.decideDispute({
    disputeId: 'disp-1',
    decision: 'SPLIT',
    note: 'Record the split. PayPal never took the money.',
    decidedByLabel: 'Maya Rao',
  });
  assert.strictEqual(decided.dispute.status, 'RESOLVED');
  assert.strictEqual(decided.dispute.decision, 'SPLIT');
  assert.strictEqual(decided.notice, ESCROW_NEVER_FUNDED_MESSAGE);
  assert.strictEqual(decided.moneyMoved, false);
  assert.strictEqual(decided.dispute.transferIds.pending, false);
  assert.strictEqual(live.state.project.status, 'COMPLETED');
  assert.strictEqual(seen.refund, 0);
  assert.strictEqual(seen.payout, 0);
  assert.ok(!JSON.stringify(decided).includes('specified resource does not exist'));

  const again = await live.service.decideDispute({
    disputeId: 'disp-1',
    decision: 'SPLIT',
    note: 'Record the split. PayPal never took the money.',
    decidedByLabel: 'Maya Rao',
  });
  assert.strictEqual(again.alreadyResolved, true);
  assert.strictEqual(again.notice, ESCROW_NEVER_FUNDED_MESSAGE);
  assert.strictEqual(seen.refund, 0);
  assert.strictEqual(seen.payout, 0);
}

async function testResourceNotFoundStillRecordsDecision() {
  const seen = { refund: 0, payout: 0 };
  const paypal = {
    isMock: () => false,
    resolveRefundableCapture: async () => ({ captureId: 'STALE-CAP', verified: true }),
    refundCapture: async () => {
      seen.refund += 1;
      throw resourceNotFoundError();
    },
    createPayout: async () => {
      seen.payout += 1;
      throw resourceNotFoundError();
    },
  };
  const { service, state } = makeHarness({ paypal });
  state.project.vaultFunds[0].amountCents = 30000;
  state.project.vaultFunds[0].paypalCaptureId = 'STALE-CAP';
  state.project.vaultFunds[0].paypalOrderId = 'ORDER-1';
  state.project.depositStatus = 'PENDING';
  state.project.freelancerDeposits = [];
  openDispute(state);

  const preview = await service.previewDecision({ disputeId: 'disp-1', decision: 'SPLIT' });
  assert.strictEqual(preview.plan.freelancerAmountCents, 15000);
  assert.strictEqual(preview.plan.clientRefundCents, 15000);
  assert.strictEqual(state.dispute.status, 'OPEN');

  const decided = await service.decideDispute({
    disputeId: 'disp-1',
    decision: 'SPLIT',
    note: 'Split the vault that PayPal does not actually have.',
    decidedByLabel: 'Maya Rao',
  });
  const body = JSON.stringify(decided);
  assert.strictEqual(decided.dispute.status, 'RESOLVED');
  assert.strictEqual(decided.notice, ESCROW_NEVER_FUNDED_MESSAGE);
  assert.strictEqual(decided.moneyMoved, false);
  assert.strictEqual(decided.dispute.transferIds.paypalIssue, 'RESOURCE_NOT_FOUND');
  assert.strictEqual(decided.dispute.transferIds.pending, false);
  assert.ok(!body.includes('specified resource does not exist'));
  assert.ok(!body.includes('secret-debug-id'));
  assert.ok(!body.includes('INVALID_RESOURCE_ID'));
  assert.strictEqual(seen.refund, 1);
  assert.strictEqual(seen.payout, 0);

  for (const decision of ['RELEASE_TO_FREELANCER', 'REFUND_CLIENT']) {
    const calls = { refund: 0, payout: 0 };
    const gate = {
      isMock: () => false,
      resolveRefundableCapture: async () => ({ captureId: null, verified: false, reason: 'not_captured' }),
      refundCapture: async () => {
        calls.refund += 1;
        throw resourceNotFoundError();
      },
      createPayout: async () => {
        calls.payout += 1;
        throw resourceNotFoundError();
      },
    };
    const next = makeHarness({ paypal: gate });
    next.state.project.vaultFunds[0].amountCents = 30000;
    next.state.project.vaultFunds[0].paypalCaptureId = 'STALE-CAP';
    next.state.project.vaultFunds[0].paypalOrderId = 'ORDER-1';
    next.state.project.depositStatus = 'PENDING';
    next.state.project.freelancerDeposits = [];
    openDispute(next.state);
    const result = await next.service.decideDispute({
      disputeId: 'disp-1',
      decision,
      note: `Record ${decision} without a capture.`,
      decidedByLabel: 'Maya Rao',
    });
    assert.strictEqual(result.dispute.status, 'RESOLVED', decision);
    assert.strictEqual(result.notice, ESCROW_NEVER_FUNDED_MESSAGE, decision);
    assert.strictEqual(calls.refund, 0, decision);
    assert.strictEqual(calls.payout, 0, decision);
    assert.ok(!JSON.stringify(result).includes('specified resource does not exist'));
  }
}

async function testOrderIdIsReplacedWithCaptureIdBeforeRefund() {
  const seen = { refund: [] };
  const paypal = {
    isMock: () => false,
    resolveRefundableCapture: async () => ({ captureId: 'CAP-REAL', verified: true }),
    refundCapture: async (args) => {
      seen.refund.push(args);
      return { refundId: 'RF-REAL', status: 'COMPLETED' };
    },
    createPayout: async (args) => ({
      payoutBatchId: `BATCH-${args.senderBatchId}`,
      payoutItemId: 'ITEM-1',
    }),
  };
  const { service, state } = makeHarness({ paypal });
  state.project.vaultFunds[0].amountCents = 30000;
  state.project.vaultFunds[0].paypalOrderId = 'ORDER-1';
  state.project.vaultFunds[0].paypalCaptureId = 'ORDER-1';
  state.project.depositStatus = 'PENDING';
  state.project.freelancerDeposits = [];
  openDispute(state);

  const decided = await service.decideDispute({
    disputeId: 'disp-1',
    decision: 'REFUND_CLIENT',
    note: 'Refund the capture, not the order id.',
    decidedByLabel: 'Maya Rao',
  });

  assert.strictEqual(seen.refund.length, 1);
  assert.strictEqual(seen.refund[0].captureId, 'CAP-REAL');
  assert.strictEqual(seen.refund[0].amountCents, 30000);
  assert.strictEqual(state.project.vaultFunds[0].paypalCaptureId, 'CAP-REAL');
  assert.strictEqual(decided.dispute.status, 'RESOLVED');
  assert.strictEqual(decided.moneyMoved, true);
  assert.strictEqual(decided.notice, null);
  assert.strictEqual(decided.dispute.transferIds.vaultRefunds[0].refundId, 'RF-REAL');
}

async function testFundedDecisionsUseCaptureId() {
  async function run(decision, note) {
    const seen = { refund: [], payout: [] };
    const inner = createPaypalService({ mock: true, clientId: 'test-id', clientSecret: 'test-secret' });
    const paypal = {
      isMock: () => true,
      resolveRefundableCapture: (args) => inner.resolveRefundableCapture(args),
      refundCapture: async (args) => {
        seen.refund.push(args);
        return inner.refundCapture(args);
      },
      createPayout: async (args) => {
        seen.payout.push(args);
        return inner.createPayout(args);
      },
    };
    const { service, state } = makeHarness({ paypal });
    state.project.vaultFunds[0].amountCents = 30001;
    state.project.vaultFunds[0].paypalCaptureId = 'CAP-REAL';
    state.project.vaultFunds[0].paypalOrderId = 'ORDER-REAL';
    state.project.milestones[0].amountCents = 30001;
    state.project.freelancerDeposits[0].paypalCaptureId = 'CAP-DEP';
    state.project.freelancerDeposits[0].paypalOrderId = 'ORDER-DEP';
    openDispute(state);
    const decided = await service.decideDispute({
      disputeId: 'disp-1',
      decision,
      note,
      decidedByLabel: 'Maya Rao',
    });
    return { decided, seen, state };
  }

  const split = await run('SPLIT', 'Even split. Odd cent stays with the client. Deposit returns.');
  assert.strictEqual(split.decided.plan.freelancerAmountCents, 15000);
  assert.strictEqual(split.decided.plan.clientRefundCents, 15001);
  assert.strictEqual(
    split.decided.plan.freelancerAmountCents + split.decided.plan.clientRefundCents,
    30001
  );
  assert.strictEqual(split.decided.plan.depositDisposition, 'RETURNED');
  assert.strictEqual(split.decided.notice, null);
  assert.strictEqual(split.decided.moneyMoved, true);
  assert.strictEqual(split.seen.refund.length, 1);
  assert.strictEqual(split.seen.refund[0].captureId, 'CAP-REAL');
  assert.strictEqual(split.seen.refund[0].amountCents, 15001);
  assert.deepStrictEqual(
    split.seen.payout.map((row) => row.amountCents).sort((a, b) => a - b),
    [2500, 15000]
  );
  assert.ok(split.seen.payout.some((row) => row.senderBatchId === 'deposit-return-proj-1'));
  assert.strictEqual(split.state.project.depositStatus, 'RETURNED');
  assert.strictEqual(split.state.dispute.transferIds.pending, false);

  const release = await run('RELEASE_TO_FREELANCER', 'Release the funded milestone to Rohan.');
  assert.strictEqual(release.decided.plan.freelancerAmountCents, 30001);
  assert.strictEqual(release.decided.plan.clientRefundCents, 0);
  assert.strictEqual(release.decided.plan.depositDisposition, 'RETURNED');
  assert.strictEqual(release.seen.refund.length, 0);
  assert.ok(release.seen.payout.some((row) => row.amountCents === 30001 && row.receiverEmail === 'rohan@example.com'));
  assert.ok(release.seen.payout.some((row) => row.senderBatchId === 'deposit-return-proj-1'));
  assert.strictEqual(release.state.project.milestones[0].status, 'PAID');
  assert.ok(release.state.project.milestones[0].paypalPayoutBatchId);

  const refund = await run('REFUND_CLIENT', 'Refund Sarah. Rohan was not at fault.');
  assert.strictEqual(refund.decided.plan.freelancerAmountCents, 0);
  assert.strictEqual(refund.decided.plan.clientRefundCents, 30001);
  assert.strictEqual(refund.decided.plan.depositDisposition, 'RETURNED');
  assert.strictEqual(refund.seen.refund.length, 1);
  assert.strictEqual(refund.seen.refund[0].captureId, 'CAP-REAL');
  assert.strictEqual(refund.seen.refund[0].amountCents, 30001);
  assert.strictEqual(refund.seen.payout.length, 1);
  assert.strictEqual(refund.seen.payout[0].amountCents, 2500);
  assert.strictEqual(refund.state.project.status, 'CANCELLED');
  assert.strictEqual(refund.state.project.depositStatus, 'RETURNED');
}

async function run() {
  await testRaiseThenSplitOnce();
  await testReleaseMarksPaidAndForfeitDeposit();
  await testEvidenceContents();
  await testSamplePreviewDoesNotMoveMoney();
  await testUnfundedDecisionRecordsWithoutPaypal();
  await testResourceNotFoundStillRecordsDecision();
  await testOrderIdIsReplacedWithCaptureIdBeforeRefund();
  await testFundedDecisionsUseCaptureId();
  console.log('dispute service tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
