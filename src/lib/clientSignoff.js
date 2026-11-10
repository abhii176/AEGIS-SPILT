/**
 * Client sign-off rules for milestones that opt out of automatic payout.
 * Objective milestones (requiresManualSignoff false) never use this path.
 */

function releaseBlockedAwaitingClientSignoff(milestone, { allowDemoBypass = false } = {}) {
  if (!milestone || milestone.requiresManualSignoff !== true) return false;
  if (milestone.manualSignedOffAt) return false;
  if (allowDemoBypass) return false;
  return true;
}

function assertClientCanSignOff({ milestone, userId }) {
  if (!milestone) {
    const err = new Error('Milestone not found');
    err.status = 404;
    err.code = 'milestone_not_found';
    throw err;
  }

  const project = milestone.project;
  if (!project || project.clientId !== userId) {
    const err = new Error('Only the client can sign off subjective work');
    err.status = 403;
    err.code = 'client_signoff_only';
    throw err;
  }

  if (milestone.requiresManualSignoff !== true) {
    const err = new Error('This milestone pays automatically after an AI pass');
    err.status = 409;
    err.code = 'signoff_not_required';
    throw err;
  }

  if (milestone.status === 'RELEASED' || milestone.status === 'PAID') {
    return { alreadyPaid: true };
  }

  if (milestone.auditPassed !== true || milestone.status !== 'PASSED') {
    const err = new Error('Client sign-off is available only after the AI audit passes');
    err.status = 409;
    err.code = 'audit_not_passed';
    throw err;
  }

  return { alreadyPaid: false, alreadySigned: Boolean(milestone.manualSignedOffAt) };
}

module.exports = {
  releaseBlockedAwaitingClientSignoff,
  assertClientCanSignOff,
};
