const assert = require('assert');
const {
  AGENCY_BANNER,
  AGENCY_ROSTER,
  assertAgencySampleReadonly,
  buildAgencyDashboard,
  depositAtRiskCents,
  moneyBuckets,
} = require('./agencyDashboard');

const ROHAN = {
  id: 'rohan',
  email: 'rohan.freelancer@aegis-split.demo',
  name: 'Rohan Mehta',
  role: 'FREELANCER',
};
const SARAH = {
  id: 'sarah',
  email: 'sarah.client@aegis-split.demo',
  name: 'Sarah Chen',
  role: 'CLIENT',
};

function testBannerAndWhiteLabelStayPreviewScoped() {
  const dashboard = buildAgencyDashboard({ users: [], projects: [] });
  assert.strictEqual(dashboard.preview, true);
  assert.strictEqual(dashboard.readOnly, true);
  assert.strictEqual(dashboard.moneyMovement, false);
  assert.strictEqual(dashboard.banner, AGENCY_BANNER);
  assert.strictEqual(
    dashboard.banner,
    'Agency dashboard - preview. Sample data for demo; white-label and multi-seat billing are on the roadmap.'
  );
  assert.strictEqual(dashboard.agency.name, 'Escrow eSports Studio');
  assert.strictEqual(dashboard.agency.accentColor, '#C8F542');
  assert.strictEqual(dashboard.agency.whiteLabel.roadmap, true);
  assert.strictEqual(dashboard.agency.whiteLabel.comingSoon, true);
  assert.strictEqual(dashboard.seeded, false);
  assert.strictEqual(dashboard.members.length, AGENCY_ROSTER.length);
  assert.strictEqual(dashboard.members[0].key, 'rohan');
  assert.strictEqual(dashboard.members[0].seeded, false);
  assert.strictEqual(dashboard.members[0].seat, 'live');
  assert.strictEqual(dashboard.totals.projectCount, 0);
}

function testLiveAndSampleMoneyStaySplit() {
  const projects = [
    {
      id: 'live-1',
      title: 'Auth service MVP',
      description: 'Real walkthrough project',
      status: 'ACTIVE',
      fundedStatus: 'FUNDED',
      depositStatus: 'HELD',
      freelancerDepositAmountCents: 2500,
      createdAt: new Date('2026-11-09T00:00:00Z'),
      client: SARAH,
      freelancer: ROHAN,
      milestones: [{ id: 'm-live', status: 'FUNDED', amountCents: 25000, title: 'Login' }],
      vaultFunds: [{ status: 'CAPTURED', amountCents: 25000, refundedCents: 0 }],
      freelancerDeposits: [],
      disputes: [],
    },
    {
      id: 'sample-1',
      title: 'Tournament overlay pack',
      description: 'agency-sample:overlay-pack\nSample project.',
      status: 'ACTIVE',
      fundedStatus: 'FUNDED',
      depositStatus: 'HELD',
      freelancerDepositAmountCents: 18000,
      createdAt: new Date('2026-11-05T12:00:00Z'),
      client: { id: 'studio', name: 'Studio Desk (sample)', email: 'studio.client@aegis-split.demo' },
      freelancer: {
        id: 'priya',
        name: 'Priya Nair',
        email: 'priya.freelancer@aegis-split.demo',
      },
      milestones: [{ id: 'm-s', status: 'FUNDED', amountCents: 180000, title: 'Scorebug' }],
      vaultFunds: [{ status: 'CAPTURED', amountCents: 180000, refundedCents: 0 }],
      freelancerDeposits: [{ status: 'CAPTURED', amountCents: 18000 }],
      disputes: [],
    },
  ];

  const dashboard = buildAgencyDashboard({ users: [ROHAN], projects });
  assert.strictEqual(dashboard.projects[0].sourceLabel, 'live');
  assert.strictEqual(dashboard.projects[0].sample, false);
  assert.strictEqual(dashboard.projects[0].escrowLabel, 'Held in escrow');
  assert.strictEqual(dashboard.projects[0].heldCents, 25000);
  assert.strictEqual(dashboard.projects[1].sourceLabel, 'sample');
  assert.strictEqual(dashboard.projects[1].heldCents, 180000);
  assert.strictEqual(dashboard.totals.live.heldCents, 25000);
  assert.strictEqual(dashboard.totals.sample.heldCents, 180000);
  assert.strictEqual(dashboard.totals.heldCents, 205000);
  assert.strictEqual(dashboard.totals.live.depositsAtRiskCents, 2500);
  assert.strictEqual(dashboard.totals.sample.depositsAtRiskCents, 18000);
  assert.strictEqual(dashboard.seeded, true);

  const rohan = dashboard.members.find((member) => member.key === 'rohan');
  const priya = dashboard.members.find((member) => member.key === 'priya');
  assert.strictEqual(rohan.heldCents, 25000);
  assert.strictEqual(rohan.activeProjects, 1);
  assert.strictEqual(rohan.payoutsCents, 0);
  assert.strictEqual(priya.heldCents, 180000);
  assert.strictEqual(priya.seeded, false);
  assert.strictEqual(priya.seat, 'sample');
}

function testRefundAndMissingVault() {
  const refunded = moneyBuckets({
    milestones: [{ status: 'FUNDED', amountCents: 10000 }],
    vaultFunds: [{ status: 'CAPTURED', amountCents: 10000, refundedCents: 4000 }],
  });
  assert.strictEqual(refunded.heldCents, 6000);

  const released = moneyBuckets({
    milestones: [{ status: 'PAID', amountCents: 95000 }, { status: 'PENDING', amountCents: 40000 }],
    vaultFunds: [{ status: 'CAPTURED', amountCents: 95000, refundedCents: 0 }],
  });
  assert.strictEqual(released.heldCents, 0);
  assert.strictEqual(released.releasedCents, 95000);
  assert.strictEqual(released.pendingCents, 40000);

  const noVault = moneyBuckets({
    milestones: [{ status: 'FUNDED', amountCents: 25000 }],
    vaultFunds: [],
  });
  assert.strictEqual(noVault.heldCents, 25000);

  assert.strictEqual(
    depositAtRiskCents({
      depositStatus: 'RETURNED',
      freelancerDepositAmountCents: 8000,
      milestones: [],
      freelancerDeposits: [{ status: 'CAPTURED', amountCents: 8000 }],
    }),
    0
  );
  assert.strictEqual(
    depositAtRiskCents({
      depositStatus: 'HELD',
      freelancerDepositAmountCents: 2500,
      milestones: [{ amountCents: 25000 }],
      freelancerDeposits: [],
    }),
    2500
  );
}

function testDisputeStateAndActivityCap() {
  const created = new Date('2026-11-01T00:00:00Z');
  const projects = [
    {
      id: 'disputed',
      title: 'Caster lower-thirds',
      description: 'agency-sample:caster-thirds',
      status: 'DISPUTED',
      depositStatus: 'HELD',
      freelancerDepositAmountCents: 22000,
      createdAt: created,
      client: { name: 'Studio Desk (sample)' },
      freelancer: { name: 'Lena Okonkwo', email: 'lena.freelancer@aegis-split.demo' },
      milestones: [{ status: 'FUNDED', amountCents: 220000, title: 'Lower thirds' }],
      vaultFunds: [
        {
          status: 'CAPTURED',
          amountCents: 220000,
          refundedCents: 0,
          createdAt: new Date('2026-11-01T01:00:00Z'),
        },
      ],
      freelancerDeposits: [{ status: 'CAPTURED', amountCents: 22000 }],
      disputes: [
        {
          id: 'disp-sample',
          status: 'OPEN',
          reason: 'Sample dispute',
          createdAt: new Date('2026-11-09T12:00:00Z'),
        },
      ],
    },
  ];

  for (let i = 0; i < 8; i += 1) {
    projects.push({
      id: `extra-${i}`,
      title: `Extra ${i}`,
      description: null,
      status: 'COMPLETED',
      depositStatus: 'RETURNED',
      freelancerDepositAmountCents: 100,
      createdAt: new Date(`2026-10-0${(i % 9) + 1}T00:00:00Z`),
      updatedAt: new Date(`2026-10-1${i % 9}T00:00:00Z`),
      client: SARAH,
      freelancer: ROHAN,
      milestones: [
        {
          status: 'PAID',
          amountCents: 1000 + i,
          title: `Paid ${i}`,
          releasedAt: new Date(`2026-10-2${i % 8}T00:00:00Z`),
        },
      ],
      vaultFunds: [],
      disputes: [],
    });
  }

  const dashboard = buildAgencyDashboard({ users: [ROHAN], projects });
  const disputed = dashboard.projects.find((row) => row.id === 'disputed');
  assert.strictEqual(disputed.escrowState, 'IN_DISPUTE');
  assert.strictEqual(disputed.escrowLabel, 'In dispute');
  assert.strictEqual(disputed.heldCents, 220000);
  assert.strictEqual(dashboard.openDisputes.length, 1);
  assert.strictEqual(dashboard.openDisputes[0].sample, true);
  assert.strictEqual(dashboard.openDisputes[0].counselorVisible, false);
  assert.strictEqual(dashboard.activity.length, 12);
  assert.strictEqual(dashboard.activity[0].kind, 'DISPUTE_OPENED');
  assert.strictEqual(dashboard.activity[0].sample, true);
  const times = dashboard.activity.map((event) => event.at);
  const sorted = [...times].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  assert.deepStrictEqual(times, sorted);

  assert.throws(
    () => assertAgencySampleReadonly({ description: 'agency-sample:caster-thirds' }),
    (err) => err.code === 'sample_preview_readonly' && err.status === 409
  );
  assert.doesNotThrow(() => assertAgencySampleReadonly({ description: 'Real walkthrough' }));
}

function run() {
  testBannerAndWhiteLabelStayPreviewScoped();
  testLiveAndSampleMoneyStaySplit();
  testRefundAndMissingVault();
  testDisputeStateAndActivityCap();
  console.log('agency dashboard tests passed');
}

run();
