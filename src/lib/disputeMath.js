/**
 * Pure dispute state machine and split math.
 * Amounts are integer cents. The freelancer share is floored; the client gets the remainder
 * so a split never drops or invents a cent.
 */

const { isCancelledStatus } = require('./exitMath');

const DECISIONS = Object.freeze([
  'RELEASE_TO_FREELANCER',
  'REFUND_CLIENT',
  'SPLIT',
]);

/** Milestone statuses that still hold funded escrow (not yet paid or cancelled). */
const DISPUTABLE_MILESTONE_STATUSES = Object.freeze([
  'FUNDED',
  'IN_PROGRESS',
  'SUBMITTED',
  'AUDITING',
  'PASSED',
  'FAILED',
]);

function fail(message, code, status = 409) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function isDisputeOpenStatus(projectStatus) {
  return String(projectStatus || '') === 'DISPUTED';
}

/**
 * Whether a party may open a dispute. Does not write anything.
 * @returns {{ ok: true, projectStatus: 'DISPUTED', disputeStatus: 'OPEN' } | { ok: false, code: string, status: number, message: string }}
 */
function raiseDisputeTransition({
  projectStatus,
  milestones = [],
  milestoneId = null,
  hasOpenDispute = false,
} = {}) {
  if (hasOpenDispute || isDisputeOpenStatus(projectStatus)) {
    return {
      ok: false,
      code: 'dispute_exists',
      status: 409,
      message: 'This project already has a dispute',
    };
  }
  if (isCancelledStatus(projectStatus) || projectStatus === 'COMPLETED') {
    return {
      ok: false,
      code: 'project_not_disputable',
      status: 409,
      message: `Project is ${projectStatus}; disputes are closed`,
    };
  }

  const rows = Array.isArray(milestones) ? milestones : [];
  if (milestoneId) {
    const milestone = rows.find((m) => m && m.id === milestoneId);
    if (!milestone) {
      return {
        ok: false,
        code: 'milestone_not_found',
        status: 404,
        message: 'Milestone not found on this project',
      };
    }
    if (!DISPUTABLE_MILESTONE_STATUSES.includes(milestone.status)) {
      return {
        ok: false,
        code: 'milestone_not_funded',
        status: 409,
        message:
          "This milestone's escrow was never funded through PayPal, so there is nothing to dispute yet.",
      };
    }
  } else {
    const funded = rows.some((m) => DISPUTABLE_MILESTONE_STATUSES.includes(m?.status));
    if (!funded) {
      return {
        ok: false,
        code: 'nothing_funded',
        status: 409,
        message:
          "This milestone's escrow was never funded through PayPal, so there is nothing to dispute yet.",
      };
    }
  }

  return { ok: true, projectStatus: 'DISPUTED', disputeStatus: 'OPEN' };
}

function assertRaiseAllowed(input) {
  const result = raiseDisputeTransition(input);
  if (!result.ok) {
    throw fail(result.message, result.code, result.status);
  }
  return result;
}

function assertPayoutAllowed(project, action = 'payout') {
  if (isDisputeOpenStatus(project?.status)) {
    throw fail(
      `Project is DISPUTED; ${action} is paused until the counselor decides`,
      'dispute_open'
    );
  }
  return project;
}

function assertExitAllowed(project, action = 'exits') {
  if (isDisputeOpenStatus(project?.status)) {
    throw fail(
      `Project is DISPUTED; ${action} are paused until the counselor decides`,
      'dispute_open'
    );
  }
  return project;
}

function normalizeDecision(decision) {
  const value = String(decision || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!DECISIONS.includes(value)) {
    throw fail(
      'decision must be RELEASE_TO_FREELANCER, REFUND_CLIENT, or SPLIT',
      'invalid_decision',
      400
    );
  }
  return value;
}

/**
 * Freelancer percent of the remaining vault.
 * Release is 100, refund is 0, split defaults to 50.
 */
function normalizeFreelancerPercent(decision, freelancerPercent) {
  const kind = normalizeDecision(decision);
  if (kind === 'RELEASE_TO_FREELANCER') return 100;
  if (kind === 'REFUND_CLIENT') return 0;
  if (freelancerPercent == null || freelancerPercent === '') return 50;
  const n = Number(freelancerPercent);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw fail(
      'freelancerPercent must be an integer from 0 to 100',
      'invalid_split_percent',
      400
    );
  }
  return n;
}

function assertDecisionNote(note) {
  const text = String(note || '').trim();
  if (text.length < 3) {
    throw fail('A short written note is required', 'decision_note_required', 400);
  }
  if (text.length > 2000) {
    throw fail('Note must be 2000 characters or fewer', 'decision_note_too_long', 400);
  }
  return text;
}

/**
 * Split the remaining vault and choose the deposit. Deposit is returned unless
 * the counselor marks the freelancer at fault.
 */
function buildDisputeMoneyPlan({
  decision,
  freelancerPercent,
  remainingVaultCents: remaining,
  depositCents = 0,
  depositHeld = false,
  freelancerAtFault = false,
} = {}) {
  const kind = normalizeDecision(decision);
  const percent = normalizeFreelancerPercent(kind, freelancerPercent);
  const vault = Math.max(0, Math.floor(Number(remaining) || 0));
  const freelancerAmountCents = Math.floor((vault * percent) / 100);
  const clientRefundCents = vault - freelancerAmountCents;
  const held = Boolean(depositHeld);
  const deposit = held ? Math.max(0, Math.floor(Number(depositCents) || 0)) : 0;
  const atFault = Boolean(freelancerAtFault);
  let depositDisposition = 'NONE';
  let depositPayoutTo = null;
  if (deposit > 0) {
    depositDisposition = atFault ? 'FORFEITED' : 'RETURNED';
    depositPayoutTo = atFault ? 'client' : 'freelancer';
  }

  return {
    decision: kind,
    freelancerPercent: percent,
    remainingVaultCents: vault,
    freelancerAmountCents,
    clientRefundCents,
    depositCents: deposit,
    depositDisposition,
    depositPayoutTo,
    freelancerAtFault: atFault,
    /** Full refund closes the project as cancelled. Any freelancer share completes it. */
    projectStatus: percent > 0 ? 'COMPLETED' : 'CANCELLED',
    /** 100% to the freelancer marks open milestones paid. Anything less closes them. */
    milestoneStatus: percent === 100 ? 'PAID' : 'CANCELLED',
  };
}

function describeDisputeLines(plan) {
  const lines = [];
  if (plan.freelancerAmountCents > 0) {
    lines.push({
      to: 'freelancer',
      label: `Pay ${plan.freelancerPercent}% of the remaining vault to the freelancer`,
      amountCents: plan.freelancerAmountCents,
    });
  }
  if (plan.clientRefundCents > 0) {
    lines.push({
      to: 'client',
      label: 'Refund the rest of the vault to the client',
      amountCents: plan.clientRefundCents,
    });
  }
  if (plan.depositDisposition === 'RETURNED' && plan.depositCents > 0) {
    lines.push({
      to: 'freelancer',
      label: 'Return security deposit to the freelancer',
      amountCents: plan.depositCents,
    });
  }
  if (plan.depositDisposition === 'FORFEITED' && plan.depositCents > 0) {
    lines.push({
      to: 'client',
      label: 'Forfeit security deposit to the client (freelancer at fault)',
      amountCents: plan.depositCents,
    });
  }
  if (!lines.length) {
    lines.push({ to: 'none', label: 'No funds to move', amountCents: 0 });
  }
  return lines;
}

/**
 * Applying a decision is only valid while the project is DISPUTED and the case is OPEN.
 */
function decisionTransition({ projectStatus, disputeStatus, plan } = {}) {
  if (disputeStatus === 'RESOLVED') {
    throw fail('This dispute is already decided', 'dispute_already_resolved');
  }
  if (!isDisputeOpenStatus(projectStatus) || disputeStatus !== 'OPEN') {
    throw fail('Dispute is not open', 'dispute_not_open');
  }
  if (!plan || !plan.projectStatus) {
    throw fail('Money plan is required', 'invalid_decision', 400);
  }
  return {
    projectStatus: plan.projectStatus,
    disputeStatus: 'RESOLVED',
    milestoneStatus: plan.milestoneStatus,
  };
}

module.exports = {
  DECISIONS,
  DISPUTABLE_MILESTONE_STATUSES,
  isDisputeOpenStatus,
  raiseDisputeTransition,
  assertRaiseAllowed,
  assertPayoutAllowed,
  assertExitAllowed,
  normalizeDecision,
  normalizeFreelancerPercent,
  assertDecisionNote,
  buildDisputeMoneyPlan,
  describeDisputeLines,
  decisionTransition,
};
