/**
 * Pure money math for Aegis-Split exit / penalty paths.
 * All amounts are integer cents. Rounding: floor (never invent fractional cents).
 */

const CANCELLED_STATUSES = Object.freeze([
  'CANCELLED',
  'CANCELLED_MUTUAL',
  'CANCELLED_BY_CLIENT',
  'ABANDONED_BY_FREELANCER',
]);

const PAID_LIKE_STATUSES = Object.freeze(['RELEASED', 'PAID']);

/**
 * Default deposit = 10% of milestone total, floored to cents.
 * Explicit override wins when provided as a positive integer.
 */
function resolveDepositAmountCents({
  freelancerDepositAmountCents = null,
  milestoneTotalCents = 0,
} = {}) {
  if (
    freelancerDepositAmountCents != null &&
    Number.isInteger(freelancerDepositAmountCents) &&
    freelancerDepositAmountCents > 0
  ) {
    return freelancerDepositAmountCents;
  }
  const total = Number(milestoneTotalCents) || 0;
  if (!Number.isInteger(total) || total < 0) {
    return 0;
  }
  return Math.floor((total * 10) / 100);
}

/**
 * Remaining vault = captured vault funds − already paid/released milestones.
 * Never negative.
 */
function remainingVaultCents({ capturedVaultCents = 0, paidOutCents = 0 } = {}) {
  const captured = Number(capturedVaultCents) || 0;
  const paid = Number(paidOutCents) || 0;
  return Math.max(0, captured - paid);
}

/**
 * Client one-sided early-exit penalty from remaining vault.
 * penalty = floor(remaining * percent / 100); clientRefund = remaining − penalty.
 */
function computeClientOnesidedSplit({
  remainingVaultCents: remaining,
  earlyExitPenaltyPercent = 20,
} = {}) {
  const vault = Math.max(0, Number(remaining) || 0);
  let percent = Number(earlyExitPenaltyPercent);
  if (!Number.isFinite(percent) || percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  const penaltyCents = Math.floor((vault * percent) / 100);
  const clientRefundCents = vault - penaltyCents;
  return {
    remainingVaultCents: vault,
    penaltyCents,
    clientRefundCents,
    freelancerPayoutCents: penaltyCents,
  };
}

/**
 * Build the money plan for a given exit path (before any PayPal calls).
 */
function buildExitMoneyPlan({
  exitPath,
  remainingVaultCents: remaining,
  earlyExitPenaltyPercent = 20,
  depositCents = 0,
  depositStatus = 'PENDING',
} = {}) {
  const vault = Math.max(0, Number(remaining) || 0);
  const deposit = Math.max(0, Number(depositCents) || 0);
  const depositHeld = depositStatus === 'HELD' && deposit > 0;

  if (exitPath === 'MUTUAL') {
    return {
      exitPath: 'MUTUAL',
      projectStatus: 'CANCELLED_MUTUAL',
      remainingVaultCents: vault,
      penaltyCents: 0,
      clientRefundCents: vault,
      freelancerPayoutCents: 0,
      depositCents: depositHeld ? deposit : 0,
      depositDisposition: depositHeld ? 'RETURNED' : 'NONE',
      /** Who receives the deposit amount via payout */
      depositPayoutTo: depositHeld ? 'freelancer' : null,
    };
  }

  if (exitPath === 'CLIENT_ONESIDED') {
    const split = computeClientOnesidedSplit({
      remainingVaultCents: vault,
      earlyExitPenaltyPercent,
    });
    return {
      exitPath: 'CLIENT_ONESIDED',
      projectStatus: 'CANCELLED_BY_CLIENT',
      remainingVaultCents: vault,
      penaltyCents: split.penaltyCents,
      clientRefundCents: split.clientRefundCents,
      freelancerPayoutCents: split.freelancerPayoutCents,
      depositCents: depositHeld ? deposit : 0,
      depositDisposition: depositHeld ? 'RETURNED' : 'NONE',
      depositPayoutTo: depositHeld ? 'freelancer' : null,
    };
  }

  if (exitPath === 'FREELANCER_WALKAWAY') {
    return {
      exitPath: 'FREELANCER_WALKAWAY',
      projectStatus: 'ABANDONED_BY_FREELANCER',
      remainingVaultCents: vault,
      penaltyCents: 0,
      clientRefundCents: vault,
      freelancerPayoutCents: 0,
      depositCents: depositHeld ? deposit : 0,
      depositDisposition: depositHeld ? 'FORFEITED' : 'NONE',
      depositPayoutTo: depositHeld ? 'client' : null,
    };
  }

  const err = new Error(`Unknown exit path: ${exitPath}`);
  err.code = 'invalid_exit_path';
  throw err;
}

function isCancelledStatus(status) {
  return CANCELLED_STATUSES.includes(String(status || ''));
}

function sumMilestoneTotalCents(milestones = []) {
  return milestones.reduce((sum, m) => sum + (Number(m.amountCents) || 0), 0);
}

function sumPaidOutCents(milestones = []) {
  return milestones
    .filter((m) => PAID_LIKE_STATUSES.includes(m.status))
    .reduce((sum, m) => sum + (Number(m.amountCents) || 0), 0);
}

function sumCapturedVaultCents(vaultFunds = []) {
  return vaultFunds
    .filter((f) => f.status === 'CAPTURED')
    .reduce((sum, f) => {
      const refunded = Number(f.refundedCents) || 0;
      return sum + Math.max(0, (Number(f.amountCents) || 0) - refunded);
    }, 0);
}

module.exports = {
  CANCELLED_STATUSES,
  PAID_LIKE_STATUSES,
  resolveDepositAmountCents,
  remainingVaultCents,
  computeClientOnesidedSplit,
  buildExitMoneyPlan,
  isCancelledStatus,
  sumMilestoneTotalCents,
  sumPaidOutCents,
  sumCapturedVaultCents,
};
