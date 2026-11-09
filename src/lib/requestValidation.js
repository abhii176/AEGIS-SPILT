/**
 * Pure validators for remaining write endpoints (hand checks, same style as projectValidation).
 */

const ID_MAX = 128;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_RE = /^[A-Za-z]{2}$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const ORDER_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function asNonEmptyString(value, max = ID_MAX) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function validateFundVaultBody(body = {}) {
  const errors = [];
  const projectId = asNonEmptyString(body.projectId || body.project_id);
  if (!projectId) errors.push('project_id_required');

  const milestoneRaw = body.milestoneId ?? body.milestone_id;
  let milestoneId = null;
  if (milestoneRaw != null && milestoneRaw !== '') {
    milestoneId = asNonEmptyString(String(milestoneRaw));
    if (!milestoneId) errors.push('invalid_milestone_id');
  }

  const amountRaw = body.amountCents ?? body.amount_cents;
  let amountCents = null;
  if (amountRaw != null && amountRaw !== '') {
    amountCents = Number(amountRaw);
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 1_000_000_000) {
      errors.push('invalid_amount');
      amountCents = null;
    }
  }

  let currency;
  if (body.currency != null && body.currency !== '') {
    const c = String(body.currency).trim().toUpperCase();
    if (!CURRENCY_RE.test(c)) {
      errors.push('invalid_currency');
    } else {
      currency = c;
    }
  }

  if (body.capture != null && typeof body.capture !== 'boolean' && body.capture !== 'true' && body.capture !== 'false') {
    errors.push('invalid_capture_flag');
  }
  if (
    body.autoCapture != null &&
    typeof body.autoCapture !== 'boolean' &&
    body.autoCapture !== 'true' &&
    body.autoCapture !== 'false'
  ) {
    errors.push('invalid_auto_capture_flag');
  }

  return {
    ok: errors.length === 0,
    errors,
    projectId,
    milestoneId,
    amountCents,
    currency,
  };
}

function validateCaptureVaultBody(body = {}) {
  const errors = [];
  const vaultFundId = asNonEmptyString(body.vaultFundId || body.vault_fund_id);
  const orderId = asNonEmptyString(body.orderId || body.order_id || body.token, 64);

  if (!vaultFundId && !orderId) {
    errors.push('order_or_fund_required');
  }
  if (orderId && !ORDER_ID_RE.test(orderId) && !orderId.startsWith('MOCK-ORDER-')) {
    errors.push('invalid_order_id');
  }

  return { ok: errors.length === 0, errors, vaultFundId, orderId };
}

function validateReleaseMilestoneBody(body = {}, params = {}) {
  const errors = [];
  const milestoneId = asNonEmptyString(
    params.milestoneId || body.milestoneId || body.milestone_id
  );
  if (!milestoneId) errors.push('milestone_id_required');

  const emailRaw =
    body.recipientEmail || body.recipient_email || body.paypalEmail || body.paypal_email || null;
  let recipientEmail = null;
  if (emailRaw != null && emailRaw !== '') {
    recipientEmail = String(emailRaw).trim();
    if (!EMAIL_RE.test(recipientEmail) || recipientEmail.length > 254) {
      errors.push('invalid_recipient_email');
      recipientEmail = null;
    }
  }

  return { ok: errors.length === 0, errors, milestoneId, recipientEmail };
}

function validateVerifyIdentityBody(body = {}) {
  const errors = [];
  const countryRaw = body.countryCode || body.country || null;
  let countryCode = null;
  if (countryRaw != null && countryRaw !== '') {
    countryCode = String(countryRaw).trim().toUpperCase();
    if (!COUNTRY_RE.test(countryCode)) {
      errors.push('invalid_country_code');
      countryCode = null;
    }
  }

  let locale = null;
  if (body.locale != null && body.locale !== '') {
    locale = asNonEmptyString(String(body.locale), 32);
    if (!locale) errors.push('invalid_locale');
  }

  return { ok: errors.length === 0, errors, countryCode, locale };
}

function validateConsentBody(body = {}) {
  const errors = [];
  const accepted = body.accepted === true || body.accepted === 'true';
  if (!accepted) errors.push('acceptance_required');

  let consentVersion = null;
  if (body.consentVersion != null && body.consentVersion !== '') {
    consentVersion = asNonEmptyString(String(body.consentVersion), 64);
    if (!consentVersion) errors.push('invalid_consent_version');
  }

  // Name + date required for User Consent Agreement v2+
  let agreedName = asNonEmptyString(body.agreedName || body.agreed_name || body.name, 200);
  if (!agreedName) errors.push('agreed_name_required');

  let agreedDate = null;
  const dateRaw = body.agreedDate || body.agreed_date || body.date || null;
  if (dateRaw != null && dateRaw !== '') {
    agreedDate = asNonEmptyString(String(dateRaw), 32);
    if (!agreedDate) errors.push('invalid_agreed_date');
  } else {
    agreedDate = new Date().toISOString().slice(0, 10);
  }

  return {
    ok: errors.length === 0,
    errors,
    accepted,
    consentVersion,
    agreedName,
    agreedDate,
  };
}

function validateMergeBody(body = {}) {
  const errors = [];
  const projectId = body.projectId || body.project_id || null;
  let projectIdOut = null;
  if (projectId != null && projectId !== '') {
    projectIdOut = asNonEmptyString(String(projectId));
    if (!projectIdOut) errors.push('invalid_project_id');
  }

  const prRaw = body.prNumber ?? body.pr_number;
  let prNumber = null;
  if (prRaw != null && prRaw !== '') {
    prNumber = Number(prRaw);
    if (!Number.isInteger(prNumber) || prNumber < 1) {
      errors.push('invalid_pr_number');
      prNumber = null;
    }
  }

  const repoRaw = body.repoFullName || body.repo_full_name || null;
  let repoFullName = null;
  if (repoRaw != null && repoRaw !== '') {
    repoFullName = asNonEmptyString(String(repoRaw), 200);
    if (!repoFullName || !REPO_RE.test(repoFullName)) {
      errors.push('invalid_github_repo');
      repoFullName = null;
    }
  }

  return { ok: errors.length === 0, errors, projectId: projectIdOut, prNumber, repoFullName };
}

function validateGithubLinkBody(body = {}) {
  const errors = [];
  const repo = asNonEmptyString(
    body.githubRepoFullName ||
      body.github_repo_full_name ||
      body.repoFullName ||
      body.repo_full_name ||
      '',
    200
  );
  if (!repo) {
    errors.push('github_repo_required');
  } else if (!REPO_RE.test(repo)) {
    errors.push('invalid_github_repo');
  }

  const rawPr =
    body.githubPrNumber ?? body.github_pr_number ?? body.prNumber ?? body.pr_number;
  let prNum = null;
  if (rawPr != null && rawPr !== '') {
    prNum = Number(rawPr);
    if (!Number.isInteger(prNum) || prNum < 1) {
      errors.push('invalid_github_pr_number');
      prNum = null;
    }
  }

  let prUrl =
    body.githubPrUrl || body.github_pr_url || body.prUrl || body.pr_url || null;
  if (prUrl != null && prUrl !== '') {
    prUrl = asNonEmptyString(String(prUrl), 500);
    if (!prUrl || !/^https?:\/\//i.test(prUrl)) {
      errors.push('invalid_github_pr_url');
      prUrl = null;
    }
  } else {
    prUrl = null;
  }

  return {
    ok: errors.length === 0,
    errors,
    repo: repo && REPO_RE.test(repo) ? repo : null,
    prNum,
    prUrl,
  };
}

module.exports = {
  validateFundVaultBody,
  validateCaptureVaultBody,
  validateReleaseMilestoneBody,
  validateVerifyIdentityBody,
  validateConsentBody,
  validateMergeBody,
  validateGithubLinkBody,
};
