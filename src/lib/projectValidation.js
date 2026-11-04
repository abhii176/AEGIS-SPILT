/**
 * Pure validators for project / milestone payloads (unit-testable without DB).
 */

function validateCreateProjectBody(body = {}) {
  const errors = [];
  const title = body.title;
  const freelancerId = body.freelancerId;

  if (!title || typeof title !== 'string' || !title.trim()) {
    errors.push('title_required');
  }
  if (!freelancerId || typeof freelancerId !== 'string') {
    errors.push('freelancer_id_required');
  }

  const clientId = body.clientId && typeof body.clientId === 'string' ? body.clientId : null;
  if (clientId && freelancerId && clientId === freelancerId) {
    errors.push('invalid_parties');
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
  }
  if (!task || typeof task !== 'string' || !String(task).trim()) {
    errors.push('task_description_required');
  }
  if (!criteria || typeof criteria !== 'string' || !String(criteria).trim()) {
    errors.push('acceptance_criteria_required');
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    errors.push('invalid_amount');
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
