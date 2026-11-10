/**
 * Read-only view model for the Agency dashboard preview.
 * Amounts are integer cents. Sample rows are recognised by the description marker
 * `agency-sample:` — no extra tables. Live Sarah/Rohan projects are included when
 * the freelancer is on the agency roster.
 */

const {
  isCancelledStatus,
  remainingVaultCents,
  resolveDepositAmountCents,
  sumCapturedVaultCents,
  sumMilestoneTotalCents,
} = require('./exitMath');

const SAMPLE_MARKER = 'agency-sample:';

const AGENCY_BANNER =
  'Agency dashboard - preview. Sample data for demo; white-label and multi-seat billing are on the roadmap.';

const AGENCY_PREVIEW = Object.freeze({
  id: 'escrow-esports-studio',
  name: 'Escrow eSports Studio',
  accentColor: '#C8F542',
  banner: AGENCY_BANNER,
  whiteLabel: Object.freeze({
    roadmap: true,
    comingSoon: true,
    note: 'Coming soon. Agency name and accent color are not live in this demo.',
  }),
});

/** Roster emails. Rohan is the live demo freelancer; the others are seeded sample seats. */
const AGENCY_ROSTER = Object.freeze([
  Object.freeze({
    key: 'rohan',
    email: 'rohan.freelancer@aegis-split.demo',
    name: 'Rohan Mehta',
    role: 'FREELANCER',
    countryCode: 'IN',
    paypalEmail: 'rohan-sandbox@example.com',
    seat: 'live',
    seatNote: 'Live demo freelancer. Sample rows on this seat are badged sample.',
  }),
  Object.freeze({
    key: 'priya',
    email: 'priya.freelancer@aegis-split.demo',
    name: 'Priya Nair',
    role: 'FREELANCER',
    countryCode: 'IN',
    paypalEmail: 'priya-sandbox@example.com',
    seat: 'sample',
    seatNote: 'Seeded for this preview. Not a login on the Users step.',
  }),
  Object.freeze({
    key: 'arjun',
    email: 'arjun.freelancer@aegis-split.demo',
    name: 'Arjun Desai',
    role: 'FREELANCER',
    countryCode: 'IN',
    paypalEmail: 'arjun-sandbox@example.com',
    seat: 'sample',
    seatNote: 'Seeded for this preview. Not a login on the Users step.',
  }),
  Object.freeze({
    key: 'lena',
    email: 'lena.freelancer@aegis-split.demo',
    name: 'Lena Okonkwo',
    role: 'FREELANCER',
    countryCode: 'US',
    paypalEmail: 'lena-sandbox@example.com',
    seat: 'sample',
    seatNote: 'Seeded for this preview. Not a login on the Users step.',
  }),
]);

const SAMPLE_CLIENT = Object.freeze({
  key: 'studio',
  email: 'studio.client@aegis-split.demo',
  name: 'Studio Desk (sample)',
  role: 'CLIENT',
  countryCode: 'US',
  paypalEmail: 'studio-sandbox@example.com',
});

/** Demo users the agency seed must not overwrite (KYC, PayPal email, consent). */
const PROTECTED_DEMO_EMAILS = Object.freeze([
  'sarah.client@aegis-split.demo',
  'rohan.freelancer@aegis-split.demo',
  'maya.counselor@aegis-split.demo',
]);

const HELD_MILESTONE_STATUSES = new Set([
  'FUNDED',
  'IN_PROGRESS',
  'SUBMITTED',
  'AUDITING',
  'PASSED',
  'FAILED',
]);
const RELEASED_MILESTONE_STATUSES = new Set(['RELEASED', 'PAID']);
const PENDING_MILESTONE_STATUSES = new Set(['PENDING']);
const ACTIVE_PROJECT_STATUSES = new Set(['DRAFT', 'ACTIVE', 'DISPUTED']);

const ESCROW_LABELS = Object.freeze({
  IN_DISPUTE: 'In dispute',
  HELD: 'Held in escrow',
  RELEASED: 'Released',
  PENDING: 'Pending funding',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  CANCELLED_MUTUAL: 'Cancelled (mutual)',
  CANCELLED_BY_CLIENT: 'Cancelled by client',
  ABANDONED_BY_FREELANCER: 'Freelancer walked away',
  DRAFT: 'Draft',
  ACTIVE: 'Active',
});

const ACTIVITY_LIMIT = 12;

function isSampleProject(project) {
  return String(project?.description || '').includes(SAMPLE_MARKER);
}

function sampleMarker(key) {
  return `${SAMPLE_MARKER}${key}`;
}

function assertAgencySampleReadonly(project) {
  if (!isSampleProject(project)) return;
  const err = new Error(
    'This project is agency-preview sample data. It is read-only and cannot move money.'
  );
  err.status = 409;
  err.code = 'sample_preview_readonly';
  throw err;
}

function sumByStatus(milestones, statuses) {
  return (milestones || []).reduce((sum, milestone) => {
    if (!statuses.has(milestone?.status)) return sum;
    return sum + (Number(milestone.amountCents) || 0);
  }, 0);
}

/**
 * Held = net captured vault minus released milestones when a capture exists.
 * Otherwise held = milestone amounts still in a funded-not-paid status.
 * Pending = milestones not funded yet. Released = RELEASED or PAID amounts.
 */
function moneyBuckets(project) {
  const milestones = project?.milestones || [];
  const releasedCents = sumByStatus(milestones, RELEASED_MILESTONE_STATUSES);
  const pendingCents = sumByStatus(milestones, PENDING_MILESTONE_STATUSES);
  const heldFromMilestones = sumByStatus(milestones, HELD_MILESTONE_STATUSES);
  const vaultFunds = project?.vaultFunds || [];
  const hasCapture = vaultFunds.some((fund) => fund.status === 'CAPTURED');
  const heldCents = hasCapture
    ? remainingVaultCents({
        capturedVaultCents: sumCapturedVaultCents(vaultFunds),
        paidOutCents: releasedCents,
      })
    : heldFromMilestones;
  return { heldCents, releasedCents, pendingCents };
}

function depositAtRiskCents(project) {
  if (String(project?.depositStatus || '') !== 'HELD') return 0;
  const captured = (project.freelancerDeposits || [])
    .filter((row) => row.status === 'CAPTURED')
    .reduce((sum, row) => sum + (Number(row.amountCents) || 0), 0);
  if (captured > 0) return captured;
  return resolveDepositAmountCents({
    freelancerDepositAmountCents: project.freelancerDepositAmountCents,
    milestoneTotalCents: sumMilestoneTotalCents(project.milestones || []),
  });
}

function openDisputeOf(project) {
  return (project?.disputes || []).find((row) => row.status === 'OPEN') || null;
}

function escrowState(project, buckets, openDispute) {
  if (openDispute || project?.status === 'DISPUTED') return 'IN_DISPUTE';
  if (isCancelledStatus(project?.status)) return project.status;
  if (
    project?.status === 'COMPLETED' &&
    buckets.heldCents === 0 &&
    buckets.pendingCents === 0
  ) {
    return 'COMPLETED';
  }
  const mixed =
    (buckets.heldCents > 0 && (buckets.pendingCents > 0 || buckets.releasedCents > 0)) ||
    (buckets.releasedCents > 0 && buckets.pendingCents > 0);
  if (mixed) return 'PARTIAL';
  if (buckets.heldCents > 0) return 'HELD';
  if (buckets.releasedCents > 0) return 'RELEASED';
  if (buckets.pendingCents > 0) return 'PENDING';
  if (project?.status === 'COMPLETED') return 'COMPLETED';
  return project?.status || 'DRAFT';
}

function escrowLabel(state, buckets) {
  if (state === 'PARTIAL') {
    if (buckets.heldCents > 0 && buckets.pendingCents > 0) return 'Part held, part pending';
    if (buckets.releasedCents > 0 && buckets.pendingCents > 0) {
      return 'Part released, part pending';
    }
    if (buckets.heldCents > 0 && buckets.releasedCents > 0) return 'Part held, part released';
    return 'Partial';
  }
  return ESCROW_LABELS[state] || state;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function personName(person, fallback) {
  return person?.name || person?.email || fallback || 'Unknown';
}

function emptySplit() {
  return {
    heldCents: 0,
    releasedCents: 0,
    pendingCents: 0,
    depositsAtRiskCents: 0,
    openDisputes: 0,
    projectCount: 0,
    activeProjectCount: 0,
  };
}

function addSplit(target, row, project) {
  target.heldCents += row.heldCents;
  target.releasedCents += row.releasedCents;
  target.pendingCents += row.pendingCents;
  target.depositsAtRiskCents += row.depositAtRiskCents;
  target.openDisputes += row.openDispute ? 1 : 0;
  target.projectCount += 1;
  if (ACTIVE_PROJECT_STATUSES.has(project.status)) target.activeProjectCount += 1;
}

function pushActivity(events, entry) {
  const at = iso(entry.at);
  if (!at) return;
  events.push({
    at,
    kind: entry.kind,
    message: entry.message,
    sample: Boolean(entry.sample),
    projectTitle: entry.projectTitle,
    amountCents: Number(entry.amountCents) || 0,
  });
}

function buildActivity(projects) {
  const events = [];
  for (const project of projects) {
    const sample = isSampleProject(project);
    const title = project.title;
    const who = personName(project.freelancer, 'freelancer');
    pushActivity(events, {
      at: project.createdAt,
      kind: 'PROJECT_OPENED',
      message: `${title} opened with ${who}`,
      sample,
      projectTitle: title,
      amountCents: 0,
    });

    const capturedFunds = (project.vaultFunds || []).filter((fund) => fund.status === 'CAPTURED');
    for (const fund of capturedFunds) {
      const net = Math.max(0, (Number(fund.amountCents) || 0) - (Number(fund.refundedCents) || 0));
      pushActivity(events, {
        at: fund.createdAt || project.createdAt,
        kind: 'VAULT_CAPTURED',
        message: `${title}: escrow captured`,
        sample,
        projectTitle: title,
        amountCents: net,
      });
    }

    const heldMilestones = (project.milestones || []).filter((m) =>
      HELD_MILESTONE_STATUSES.has(m.status)
    );
    if (!capturedFunds.length && heldMilestones.length) {
      const amount = heldMilestones.reduce((sum, m) => sum + (Number(m.amountCents) || 0), 0);
      pushActivity(events, {
        at: heldMilestones[0].updatedAt || heldMilestones[0].createdAt || project.createdAt,
        kind: 'ESCROW_HELD',
        message: `${title}: milestone funds held without a vault capture row`,
        sample,
        projectTitle: title,
        amountCents: amount,
      });
    }

    for (const milestone of project.milestones || []) {
      if (!RELEASED_MILESTONE_STATUSES.has(milestone.status)) continue;
      pushActivity(events, {
        at: milestone.releasedAt || milestone.updatedAt || milestone.createdAt,
        kind: 'PAYOUT_RELEASED',
        message: `${title}: ${milestone.title} released`,
        sample,
        projectTitle: title,
        amountCents: milestone.amountCents,
      });
    }

    if (project.depositStatus === 'HELD') {
      pushActivity(events, {
        at: project.createdAt,
        kind: 'DEPOSIT_HELD',
        message: `${title}: freelancer deposit held`,
        sample,
        projectTitle: title,
        amountCents: depositAtRiskCents(project),
      });
    } else if (project.depositStatus === 'RETURNED' || project.depositStatus === 'FORFEITED') {
      pushActivity(events, {
        at: project.updatedAt || project.createdAt,
        kind: project.depositStatus === 'RETURNED' ? 'DEPOSIT_RETURNED' : 'DEPOSIT_FORFEITED',
        message: `${title}: freelancer deposit ${project.depositStatus.toLowerCase()}`,
        sample,
        projectTitle: title,
        amountCents: Number(project.freelancerDepositAmountCents) || 0,
      });
    }

    for (const dispute of project.disputes || []) {
      pushActivity(events, {
        at: dispute.createdAt,
        kind: 'DISPUTE_OPENED',
        message: `${title}: dispute opened`,
        sample,
        projectTitle: title,
        amountCents: 0,
      });
      if (dispute.decidedAt) {
        pushActivity(events, {
          at: dispute.decidedAt,
          kind: 'DISPUTE_DECIDED',
          message: `${title}: dispute decided`,
          sample,
          projectTitle: title,
          amountCents: Number(dispute.freelancerAmountCents) || 0,
        });
      }
    }

    for (const exitEvent of project.exitEvents || []) {
      pushActivity(events, {
        at: exitEvent.createdAt,
        kind: 'EXIT',
        message: `${title}: exit ${exitEvent.exitPath || 'recorded'}`,
        sample,
        projectTitle: title,
        amountCents: Number(exitEvent.remainingVaultCents) || 0,
      });
    }
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events.slice(0, ACTIVITY_LIMIT);
}

function projectView(project) {
  const buckets = moneyBuckets(project);
  const dispute = openDisputeOf(project);
  const sample = isSampleProject(project);
  const state = escrowState(project, buckets, dispute);
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    fundedStatus: project.fundedStatus || null,
    sample,
    sourceLabel: sample ? 'sample' : 'live',
    clientName: personName(project.client, 'Client'),
    freelancerName: personName(project.freelancer, 'Freelancer'),
    freelancerEmail: project.freelancer?.email || null,
    escrowState: state,
    escrowLabel: escrowLabel(state, buckets),
    heldCents: buckets.heldCents,
    releasedCents: buckets.releasedCents,
    pendingCents: buckets.pendingCents,
    depositStatus: project.depositStatus || 'PENDING',
    depositAtRiskCents: depositAtRiskCents(project),
    openDispute: dispute
      ? {
          id: dispute.id,
          reason: dispute.reason,
          status: dispute.status,
          sample,
          createdAt: iso(dispute.createdAt),
        }
      : null,
    createdAt: iso(project.createdAt),
  };
}

function projectsForSeat(projects, seat, user) {
  return (projects || []).filter((project) => {
    if (project.freelancer?.email) return project.freelancer.email === seat.email;
    return Boolean(user && project.freelancerId === user.id);
  });
}

function buildAgencyDashboard({ roster = AGENCY_ROSTER, users = [], projects = [] } = {}) {
  const byEmail = new Map((users || []).map((user) => [user.email, user]));
  const views = (projects || []).map(projectView);
  views.sort((a, b) => {
    if (a.sample !== b.sample) return a.sample ? 1 : -1;
    const aAt = a.createdAt || '';
    const bAt = b.createdAt || '';
    return aAt < bAt ? 1 : aAt > bAt ? -1 : 0;
  });

  const live = emptySplit();
  const sample = emptySplit();
  const viewById = new Map(views.map((row) => [row.id, row]));
  for (const project of projects || []) {
    const row = viewById.get(project.id);
    if (!row) continue;
    addSplit(row.sample ? sample : live, row, project);
  }

  const totals = {
    heldCents: live.heldCents + sample.heldCents,
    releasedCents: live.releasedCents + sample.releasedCents,
    pendingCents: live.pendingCents + sample.pendingCents,
    depositsAtRiskCents: live.depositsAtRiskCents + sample.depositsAtRiskCents,
    openDisputes: live.openDisputes + sample.openDisputes,
    projectCount: live.projectCount + sample.projectCount,
    activeProjectCount: live.activeProjectCount + sample.activeProjectCount,
    live,
    sample,
  };

  const members = (roster || []).map((seat) => {
    const user = byEmail.get(seat.email) || null;
    const owned = projectsForSeat(projects, seat, user);
    const rowsForSeat = owned
      .map((project) => viewById.get(project.id))
      .filter(Boolean);
    const sum = (key) => rowsForSeat.reduce((total, row) => total + (row[key] || 0), 0);

    return {
      key: seat.key,
      name: user?.name || seat.name,
      email: seat.email,
      seat: seat.seat,
      seatNote: seat.seatNote,
      seeded: Boolean(user),
      projectCount: rowsForSeat.length,
      activeProjects: owned.filter((project) => ACTIVE_PROJECT_STATUSES.has(project.status)).length,
      heldCents: sum('heldCents'),
      releasedCents: sum('releasedCents'),
      pendingCents: sum('pendingCents'),
      payoutsCents: sum('releasedCents'),
      depositsAtRiskCents: sum('depositAtRiskCents'),
      openDisputes: rowsForSeat.filter((row) => row.openDispute).length,
    };
  });

  const depositsAtRisk = views
    .filter((row) => row.depositAtRiskCents > 0)
    .map((row) => ({
      projectId: row.id,
      title: row.title,
      sample: row.sample,
      memberName: row.freelancerName,
      amountCents: row.depositAtRiskCents,
      depositStatus: row.depositStatus,
    }));

  const openDisputes = views
    .filter((row) => row.openDispute)
    .map((row) => ({
      id: row.openDispute.id,
      projectId: row.id,
      title: row.title,
      sample: row.sample,
      reason: row.openDispute.reason,
      memberName: row.freelancerName,
      createdAt: row.openDispute.createdAt,
      status: row.openDispute.status,
      counselorVisible: !row.sample,
    }));

  return {
    preview: true,
    readOnly: true,
    moneyMovement: false,
    banner: AGENCY_PREVIEW.banner,
    agency: {
      id: AGENCY_PREVIEW.id,
      name: AGENCY_PREVIEW.name,
      accentColor: AGENCY_PREVIEW.accentColor,
      whiteLabel: AGENCY_PREVIEW.whiteLabel,
    },
    seeded: views.some((row) => row.sample),
    totals,
    projects: views,
    members,
    depositsAtRisk,
    openDisputes,
    activity: buildActivity(projects || []),
  };
}

module.exports = {
  SAMPLE_MARKER,
  AGENCY_BANNER,
  AGENCY_PREVIEW,
  AGENCY_ROSTER,
  SAMPLE_CLIENT,
  PROTECTED_DEMO_EMAILS,
  ACTIVITY_LIMIT,
  isSampleProject,
  sampleMarker,
  assertAgencySampleReadonly,
  moneyBuckets,
  depositAtRiskCents,
  escrowState,
  escrowLabel,
  buildAgencyDashboard,
  buildActivity,
};
