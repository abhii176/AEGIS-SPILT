const assert = require('assert');
const {
  verifyGithubSignature,
  signGithubPayload,
} = require('./webhookSignature');
const { createMergeHandler } = require('./mergeHandler');
const { auditMilestone, tokenize } = require('../aiAuditor');

function testSignatureRoundTrip() {
  const secret = 'test-webhook-secret';
  const body = Buffer.from(
    JSON.stringify({ action: 'closed', pull_request: { merged: true, number: 1 } }),
    'utf8'
  );
  const sig = signGithubPayload(body, secret);
  assert.ok(sig.startsWith('sha256='));
  assert.strictEqual(verifyGithubSignature(body, sig, secret), true);
  assert.strictEqual(verifyGithubSignature(body, 'sha256=deadbeef', secret), false);
  assert.strictEqual(verifyGithubSignature(body, sig, 'wrong-secret'), false);
  assert.strictEqual(verifyGithubSignature(body, undefined, secret), false);
  assert.strictEqual(verifyGithubSignature(body, sig, ''), false);
}

function testSignatureRejectsWrongLength() {
  const secret = 's';
  const body = Buffer.from('{}', 'utf8');
  const sig = signGithubPayload(body, secret);
  assert.strictEqual(verifyGithubSignature(body, 'sha256=ab', secret), false);
  assert.strictEqual(verifyGithubSignature(Buffer.from('{x}', 'utf8'), sig, secret), false);
}

async function testAiAuditorHandoffStillWorks() {
  // Smoke: merge path still consumes { passed, report } from hardened auditor
  const pass = await auditMilestone({
    milestoneId: 'ms-1',
    acceptanceCriteria: 'Ship hero CTA lighthouse accessibility',
    diff: '+ export const hero = true\n+ // CTA lighthouse accessibility ship',
  });
  assert.strictEqual(pass.passed, true);
  assert.ok(pass.report.includes('PASS'));
  assert.ok(Array.isArray(pass.checks));

  const fail = await auditMilestone({
    milestoneId: 'ms-2',
    acceptanceCriteria: 'Ship hero CTA lighthouse accessibility',
    diff: '+ console.log("hello")\n',
  });
  assert.strictEqual(fail.passed, false);
  assert.ok(fail.checks.some((c) => c.met === false));

  assert.ok(tokenize('Ship hero CTA').includes('ship'));
  assert.ok(tokenize('Ship hero CTA').includes('hero'));
}

function makeMockDb(seed = {}) {
  const state = {
    milestone: {
      id: 'ms-demo',
      projectId: 'proj-1',
      status: 'FUNDED',
      title: 'M1',
      acceptanceCriteria: 'Ship hero CTA lighthouse',
      amountCents: 25000,
      currency: 'USD',
      githubRepoFullName: 'acme/landing',
      githubPrNumber: 7,
      auditPassed: null,
      auditReport: null,
      ...seed.milestone,
    },
    project: {
      id: 'proj-1',
      clientId: 'client-1',
      freelancerId: 'free-1',
      client: {
        id: 'client-1',
        govIdVerified: true,
        monitoringConsentGranted: true,
        email: 'sarah@example.com',
        paypalEmail: null,
      },
      freelancer: {
        id: 'free-1',
        govIdVerified: true,
        monitoringConsentGranted: true,
        email: 'rohan@example.com',
        paypalEmail: 'rohan-paypal@example.com',
      },
      ...seed.project,
    },
    mergeEvents: [],
    notifications: [],
  };

  return {
    _state: state,
    milestone: {
      findUnique: async ({ where }) => {
        if (where.id !== state.milestone.id) return null;
        return { ...state.milestone, project: state.project };
      },
      findFirst: async ({ where }) => {
        if (
          where.githubRepoFullName === state.milestone.githubRepoFullName &&
          where.githubPrNumber === state.milestone.githubPrNumber
        ) {
          return { ...state.milestone, project: state.project };
        }
        return null;
      },
      update: async ({ where, data }) => {
        assert.strictEqual(where.id, state.milestone.id);
        Object.assign(state.milestone, data);
        return { ...state.milestone };
      },
    },
    mergeEvent: {
      create: async ({ data }) => {
        const row = { id: `me-${state.mergeEvents.length + 1}`, ...data };
        state.mergeEvents.push(row);
        return row;
      },
    },
    notification: {
      findFirst: async ({ where }) =>
        state.notifications.find(
          (n) =>
            (!where.userId || n.userId === where.userId) &&
            (where.dedupeKey == null || n.dedupeKey === where.dedupeKey)
        ) || null,
      create: async ({ data }) => {
        const row = {
          id: `n-${state.notifications.length + 1}`,
          readAt: null,
          createdAt: new Date(),
          ...data,
        };
        state.notifications.push(row);
        return { ...row };
      },
      findMany: async () => [...state.notifications],
      count: async () => state.notifications.length,
      updateMany: async () => ({ count: 0 }),
    },
  };
}

async function testMergeHandlerPassAndRelease() {
  const db = makeMockDb();
  const releases = [];
  const escrow = {
    releaseMilestone: async (args) => {
      releases.push(args);
      db._state.milestone.status = 'PAID';
      return {
        milestone: { ...db._state.milestone },
        paypal: { payoutBatchId: 'MOCK-BATCH', mock: true },
      };
    },
  };

  const handler = createMergeHandler({
    db,
    escrow,
    github: {
      fetchPullRequestDiff: async () => {
        throw Object.assign(new Error('should use stub'), { code: 'unused' });
      },
    },
  });

  const result = await handler.handleMergedPullRequest({
    repoFullName: 'acme/landing',
    prNumber: 7,
    mergeSha: 'abc123',
    diff: '+ Ship hero CTA lighthouse feature',
    source: 'webhook',
  });

  assert.strictEqual(result.audit.passed, true);
  assert.strictEqual(result.milestone.status, 'PAID');
  assert.strictEqual(db._state.milestone.githubMergeSha, 'abc123');
  assert.strictEqual(db._state.milestone.auditPassed, true);
  assert.strictEqual(releases.length, 1);
  assert.strictEqual(releases[0].milestoneId, 'ms-demo');
  assert.strictEqual(db._state.mergeEvents.length, 1);
  assert.strictEqual(db._state.mergeEvents[0].source, 'webhook');
  assert.ok(db._state.notifications.some((n) => n.type === 'AUDIT_PASSED'));
}

async function testMergeHandlerFailMarksFailed() {
  const db = makeMockDb();
  const escrow = {
    releaseMilestone: async () => {
      throw new Error('should not release on fail');
    },
  };

  const handler = createMergeHandler({ db, escrow });
  const result = await handler.handleMergedPullRequest({
    repoFullName: 'acme/landing',
    prNumber: 7,
    mergeSha: 'def456',
    diff: '+ unrelated change',
    source: 'demo',
  });

  assert.strictEqual(result.audit.passed, false);
  assert.strictEqual(result.milestone.status, 'FAILED');
  assert.strictEqual(result.payout, null);
  assert.strictEqual(db._state.milestone.auditPassed, false);
  assert.ok(db._state.notifications.some((n) => n.type === 'AUDIT_FAILED'));
}

async function testMergeHandlerBlocksWithoutKyc() {
  const db = makeMockDb({
    project: {
      id: 'proj-1',
      clientId: 'client-1',
      freelancerId: 'free-1',
      client: {
        id: 'client-1',
        govIdVerified: false,
        monitoringConsentGranted: true,
        email: 'sarah@example.com',
      },
      freelancer: {
        id: 'free-1',
        govIdVerified: true,
        monitoringConsentGranted: true,
        email: 'rohan@example.com',
        paypalEmail: 'rohan@example.com',
      },
    },
  });

  const handler = createMergeHandler({
    db,
    escrow: { releaseMilestone: async () => ({}) },
  });

  await assert.rejects(
    () =>
      handler.handleMergedPullRequest({
        repoFullName: 'acme/landing',
        prNumber: 7,
        diff: '+ Ship hero CTA lighthouse',
      }),
    (err) => err.code === 'kyc_or_consent_required' && err.status === 403
  );
}

async function testMergeHandlerMissingMilestone() {
  const db = makeMockDb();
  const handler = createMergeHandler({
    db,
    escrow: { releaseMilestone: async () => ({}) },
  });

  await assert.rejects(
    () =>
      handler.handleMergedPullRequest({
        repoFullName: 'other/repo',
        prNumber: 99,
        diff: 'x',
      }),
    (err) => err.code === 'milestone_not_linked'
  );
}

async function testMergeHandlerRejectsUnfunded() {
  const db = makeMockDb({ milestone: { status: 'PENDING' } });
  const handler = createMergeHandler({
    db,
    escrow: {
      releaseMilestone: async () => {
        throw new Error('should not release unfunded');
      },
    },
  });

  await assert.rejects(
    () =>
      handler.handleMergedPullRequest({
        repoFullName: 'acme/landing',
        prNumber: 7,
        diff: '+ Ship hero CTA lighthouse',
      }),
    (err) => err.code === 'milestone_not_funded' && err.status === 409
  );
}

async function testMergeHandlerManualSignoffHoldsPayout() {
  const db = makeMockDb({ milestone: { requiresManualSignoff: true } });
  const handler = createMergeHandler({
    db,
    escrow: {
      releaseMilestone: async () => {
        throw new Error('should not auto-pay a manual milestone');
      },
    },
  });

  const result = await handler.handleMergedPullRequest({
    repoFullName: 'acme/landing',
    prNumber: 7,
    mergeSha: 'hold1',
    diff: '+ Ship hero CTA lighthouse feature',
    source: 'webhook',
  });

  assert.strictEqual(result.audit.passed, true);
  assert.strictEqual(result.awaitingClientSignoff, true);
  assert.strictEqual(result.payout, null);
  assert.strictEqual(result.milestone.status, 'PASSED');
  assert.strictEqual(db._state.milestone.auditPassed, true);
}

async function run() {
  testSignatureRoundTrip();
  testSignatureRejectsWrongLength();
  await testAiAuditorHandoffStillWorks();
  await testMergeHandlerPassAndRelease();
  await testMergeHandlerFailMarksFailed();
  await testMergeHandlerBlocksWithoutKyc();
  await testMergeHandlerMissingMilestone();
  await testMergeHandlerRejectsUnfunded();
  await testMergeHandlerManualSignoffHoldsPayout();
  console.log('github webhook + merge handler tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
