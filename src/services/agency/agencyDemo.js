/**
 * Idempotent agency-preview seed and loader.
 * Writes sample users, projects, vault rows, deposits, and one dispute.
 * Does not call PayPal and does not update Sarah, Rohan, or Maya if they already exist.
 */

const {
  AGENCY_ROSTER,
  SAMPLE_CLIENT,
  PROTECTED_DEMO_EMAILS,
  sampleMarker,
  buildAgencyDashboard,
} = require('../../lib/agencyDashboard');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function daysBefore(now, days) {
  return new Date(now.getTime() - days * DAY_MS);
}

const SAMPLE_PROJECT_SPECS = [
  {
    key: 'overlay-pack',
    title: 'Tournament overlay pack',
    summary:
      'Sample project. Bookkeeping rows only — no PayPal order was created.',
    freelancerKey: 'priya',
    status: 'ACTIVE',
    fundedStatus: 'FUNDED',
    depositStatus: 'HELD',
    depositCents: 18000,
    createdDaysAgo: 5,
    milestones: [
      {
        sequence: 1,
        title: 'Scorebug and lower thirds',
        taskDescription: 'Sample: broadcast overlay package for the weekend bracket.',
        acceptanceCriteria: 'Scorebug, lower thirds, and a safe-area guide.',
        status: 'FUNDED',
        amountCents: 180000,
      },
    ],
    vaultCents: 180000,
    dispute: null,
  },
  {
    key: 'vod-recaps',
    title: 'VOD recap series',
    summary:
      'Sample project. Week 1 is marked paid in the ledger. Week 2 is still unfunded. No PayPal order was created.',
    freelancerKey: 'arjun',
    status: 'ACTIVE',
    fundedStatus: 'PARTIAL',
    depositStatus: 'HELD',
    depositCents: 13500,
    createdDaysAgo: 10,
    milestones: [
      {
        sequence: 1,
        title: 'Week 1 recap',
        taskDescription: 'Sample: edit the opening-weekend recap.',
        acceptanceCriteria: 'Cutdown under six minutes with chapter markers.',
        status: 'PAID',
        amountCents: 95000,
        releasedDaysAgo: 6,
      },
      {
        sequence: 2,
        title: 'Week 2 recap',
        taskDescription: 'Sample: week 2 recap, not funded yet.',
        acceptanceCriteria: 'Same runtime and chapter markers as week 1.',
        status: 'PENDING',
        amountCents: 40000,
      },
    ],
    vaultCents: 95000,
    dispute: null,
  },
  {
    key: 'caster-thirds',
    title: 'Caster lower-thirds',
    summary:
      'Sample project. Open dispute is preview-only and is hidden from the counselor panel.',
    freelancerKey: 'lena',
    status: 'DISPUTED',
    fundedStatus: 'FUNDED',
    depositStatus: 'HELD',
    depositCents: 22000,
    createdDaysAgo: 3,
    milestones: [
      {
        sequence: 1,
        title: 'Lower-third package',
        taskDescription: 'Sample: caster name straps for the analyst desk.',
        acceptanceCriteria: 'Names match the brand kit. Two variants, home and away.',
        status: 'FUNDED',
        amountCents: 220000,
      },
    ],
    vaultCents: 220000,
    dispute: {
      createdDaysAgo: 1,
      reason:
        'Sample dispute: caster names do not match the brand kit. Preview only — this case is hidden from Maya’s counselor panel and cannot move money.',
    },
  },
  {
    key: 'bumper-stings',
    title: 'Season bumper stings',
    summary:
      'Sample project on Rohan’s seat so the preview can sit next to his live Sarah Chen work. No PayPal order was created.',
    freelancerKey: 'rohan',
    status: 'COMPLETED',
    fundedStatus: 'FUNDED',
    depositStatus: 'RETURNED',
    depositCents: 8000,
    createdDaysAgo: 14,
    milestones: [
      {
        sequence: 1,
        title: 'Three bumper stings',
        taskDescription: 'Sample: three 5-second season bumpers.',
        acceptanceCriteria: 'Delivered as ProRes and a web mp4.',
        status: 'PAID',
        amountCents: 80000,
        releasedDaysAgo: 12,
      },
    ],
    vaultCents: 80000,
    dispute: null,
  },
];

function personaData(persona) {
  return {
    email: persona.email,
    name: persona.name,
    role: persona.role,
    countryCode: persona.countryCode,
    locale: 'en',
    paypalEmail: persona.paypalEmail,
  };
}

async function ensureUser(db, persona) {
  const existing = await db.user.findUnique({ where: { email: persona.email } });
  if (existing) {
    if (PROTECTED_DEMO_EMAILS.includes(persona.email)) {
      return { user: existing, created: false };
    }
    const updated = await db.user.update({
      where: { email: persona.email },
      data: {
        name: persona.name,
        role: persona.role,
        countryCode: persona.countryCode,
        locale: 'en',
        paypalEmail: persona.paypalEmail,
      },
    });
    return { user: updated, created: false };
  }
  const user = await db.user.create({ data: personaData(persona) });
  return { user, created: true };
}

async function createSampleProject(tx, spec, ctx, now) {
  const freelancer = ctx.users[spec.freelancerKey];
  const client = ctx.users.studio;
  const createdAt = daysBefore(now, spec.createdDaysAgo);
  const project = await tx.project.create({
    data: {
      clientId: client.id,
      freelancerId: freelancer.id,
      title: spec.title,
      description: `${sampleMarker(spec.key)}\n${spec.summary}`,
      status: spec.status,
      fundedStatus: spec.fundedStatus,
      earlyExitPenaltyPercent: 50,
      freelancerDepositAmountCents: spec.depositCents,
      depositStatus: spec.depositStatus,
      createdAt,
    },
  });

  for (const milestone of spec.milestones) {
    const releasedAt =
      milestone.releasedDaysAgo != null ? daysBefore(now, milestone.releasedDaysAgo) : null;
    await tx.milestone.create({
      data: {
        projectId: project.id,
        sequence: milestone.sequence,
        title: milestone.title,
        taskDescription: milestone.taskDescription,
        acceptanceCriteria: milestone.acceptanceCriteria,
        amountCents: milestone.amountCents,
        currency: 'USD',
        status: milestone.status,
        releasedAt,
        payoutEmail: milestone.status === 'PAID' ? freelancer.paypalEmail || freelancer.email : null,
        createdAt,
      },
    });
  }

  if (spec.vaultCents > 0) {
    await tx.vaultFund.create({
      data: {
        userId: client.id,
        projectId: project.id,
        amountCents: spec.vaultCents,
        currency: 'USD',
        status: 'CAPTURED',
        refundedCents: 0,
        createdAt: new Date(createdAt.getTime() + HOUR_MS),
      },
    });
  }

  if (spec.depositStatus === 'HELD' && spec.depositCents > 0) {
    await tx.freelancerDeposit.create({
      data: {
        userId: freelancer.id,
        projectId: project.id,
        amountCents: spec.depositCents,
        currency: 'USD',
        status: 'CAPTURED',
        createdAt: new Date(createdAt.getTime() + HOUR_MS),
      },
    });
  }

  if (spec.dispute) {
    await tx.dispute.create({
      data: {
        projectId: project.id,
        raisedByUserId: client.id,
        reason: spec.dispute.reason,
        status: 'OPEN',
        idempotencyKey: `dispute:${project.id}`,
        createdAt: daysBefore(now, spec.dispute.createdDaysAgo),
      },
    });
  }

  return project;
}

async function ensureSampleProject(db, spec, ctx, now) {
  const marker = sampleMarker(spec.key);
  const found = await db.project.findFirst({
    where: { description: { contains: marker } },
  });
  if (found) return { key: spec.key, created: false, projectId: found.id };

  try {
    const outcome = await db.$transaction(async (tx) => {
      const again = await tx.project.findFirst({
        where: { description: { contains: marker } },
      });
      if (again) return { existing: again };
      const created = await createSampleProject(tx, spec, ctx, now);
      return { created };
    });
    if (outcome.existing) {
      return { key: spec.key, created: false, projectId: outcome.existing.id };
    }
    return { key: spec.key, created: true, projectId: outcome.created.id };
  } catch (err) {
    const raced = await db.project.findFirst({
      where: { description: { contains: marker } },
    });
    if (raced) return { key: spec.key, created: false, projectId: raced.id };
    throw err;
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} db
 */
async function seedAgencyDemo(db, { now = new Date() } = {}) {
  const personas = [...AGENCY_ROSTER, SAMPLE_CLIENT];
  const users = {};
  const userResults = [];
  for (const persona of personas) {
    const result = await ensureUser(db, persona);
    users[persona.key] = result.user;
    userResults.push({
      key: persona.key,
      id: result.user.id,
      email: result.user.email,
      created: result.created,
    });
  }

  const projects = [];
  for (const spec of SAMPLE_PROJECT_SPECS) {
    projects.push(await ensureSampleProject(db, spec, { users }, now));
  }

  return {
    ok: true,
    createdProjects: projects.filter((row) => row.created).length,
    existingProjects: projects.filter((row) => !row.created).length,
    projects,
    users: userResults,
  };
}

const PROJECT_INCLUDE = {
  client: { select: { id: true, name: true, email: true, role: true } },
  freelancer: { select: { id: true, name: true, email: true, role: true } },
  milestones: true,
  vaultFunds: true,
  freelancerDeposits: true,
  disputes: true,
  exitEvents: true,
};

async function loadAgencyDashboard(db) {
  const emails = AGENCY_ROSTER.map((seat) => seat.email);
  const users = await db.user.findMany({
    where: { email: { in: emails } },
  });
  const memberIds = users.map((user) => user.id);
  const or = [{ description: { contains: 'agency-sample:' } }];
  if (memberIds.length) or.push({ freelancerId: { in: memberIds } });

  const projects = await db.project.findMany({
    where: { OR: or },
    include: PROJECT_INCLUDE,
  });

  return buildAgencyDashboard({
    roster: AGENCY_ROSTER,
    users,
    projects,
  });
}

module.exports = {
  SAMPLE_PROJECT_SPECS,
  seedAgencyDemo,
  loadAgencyDashboard,
};
