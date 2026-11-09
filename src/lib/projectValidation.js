/**
 * Pure validators for project / milestone payloads (unit-testable without DB).
 */

function validateCreateProjectBody(body = {}) {
  const errors = [];
  const title = body.title;
  const freelancerId = body.freelancerId;

  if (!title || typeof title !== 'string' || !title.trim()) {
    errors.push('title_required');
  } else if (title.trim().length > 200) {
    errors.push('title_too_long');
  }
  if (!freelancerId || typeof freelancerId !== 'string' || !freelancerId.trim()) {
    errors.push('freelancer_id_required');
  } else if (freelancerId.length > 128) {
    errors.push('invalid_freelancer_id');
  }

  const clientId = body.clientId && typeof body.clientId === 'string' ? body.clientId : null;
  if (clientId && clientId.length > 128) {
    errors.push('invalid_client_id');
  }
  if (clientId && freelancerId && clientId === freelancerId) {
    errors.push('invalid_parties');
  }

  if (body.description != null && typeof body.description === 'string' && body.description.length > 5000) {
    errors.push('description_too_long');
  }

  if (body.earlyExitPenaltyPercent != null && body.earlyExitPenaltyPercent !== '') {
    const pct = Number(body.earlyExitPenaltyPercent);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      errors.push('invalid_early_exit_penalty_percent');
    }
  }

  if (body.freelancerDepositAmountCents != null && body.freelancerDepositAmountCents !== '') {
    const dep = Number(body.freelancerDepositAmountCents);
    if (!Number.isInteger(dep) || dep < 0 || dep > 1_000_000_000) {
      errors.push('invalid_freelancer_deposit_amount');
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateAddMilestoneBody(body = {}) {
  const errors = [];
  const title = body.title;
  const task = body.taskDescription || body.task_description;
  const criteria = body.acceptanceCriteria || body.acceptance_criteria;
  const amount = Number(body.amountCents ?? body.amount_cents);

  if (!title || typeof title !== 'string' || !title.trim()) {
    errors.push('title_required');
  } else if (title.trim().length > 200) {
    errors.push('title_too_long');
  }
  if (!task || typeof task !== 'string' || !String(task).trim()) {
    errors.push('task_description_required');
  } else if (String(task).length > 5000) {
    errors.push('task_description_too_long');
  }
  if (!criteria || typeof criteria !== 'string' || !String(criteria).trim()) {
    errors.push('acceptance_criteria_required');
  } else if (String(criteria).length > 5000) {
    errors.push('acceptance_criteria_too_long');
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000) {
    errors.push('invalid_amount');
  }

  if (body.currency != null && body.currency !== '') {
    const currency = String(body.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push('invalid_currency');
    }
  }

  if (body.sequence != null) {
    const sequence = Number(body.sequence);
    if (!Number.isInteger(sequence) || sequence < 1) {
      errors.push('invalid_sequence');
    }
  }

  return { ok: errors.length === 0, errors, amountCents: Number.isInteger(amount) ? amount : null };
}

module.exports = {
  validateCreateProjectBody,
  validateAddMilestoneBody,
};
