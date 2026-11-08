const assert = require('assert');
const {
  validateFundVaultBody,
  validateCaptureVaultBody,
  validateReleaseMilestoneBody,
  validateVerifyIdentityBody,
  validateConsentBody,
  validateMergeBody,
  validateGithubLinkBody,
} = require('./requestValidation');

function testFundVault() {
  assert.ok(validateFundVaultBody({}).errors.includes('project_id_required'));
  assert.strictEqual(validateFundVaultBody({ projectId: 'p1' }).ok, true);
  assert.ok(
    validateFundVaultBody({ projectId: 'p1', amountCents: -1 }).errors.includes('invalid_amount')
  );
  assert.ok(
    validateFundVaultBody({ projectId: 'p1', currency: 'US' }).errors.includes('invalid_currency')
  );
  const ok = validateFundVaultBody({
    projectId: 'p1',
    milestoneId: 'm1',
    amountCents: 25000,
    currency: 'usd',
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.currency, 'USD');
  assert.strictEqual(ok.amountCents, 25000);
}

function testCaptureVault() {
  assert.ok(validateCaptureVaultBody({}).errors.includes('order_or_fund_required'));
  assert.strictEqual(validateCaptureVaultBody({ orderId: '5O190127TN364715T' }).ok, true);
  assert.strictEqual(validateCaptureVaultBody({ token: 'MOCK-ORDER-abc' }).ok, true);
  assert.ok(
    validateCaptureVaultBody({ orderId: 'bad' }).errors.includes('invalid_order_id')
  );
}

function testRelease() {
  assert.ok(validateReleaseMilestoneBody({}).errors.includes('milestone_id_required'));
  assert.strictEqual(
    validateReleaseMilestoneBody({}, { milestoneId: 'm1' }).ok,
    true
  );
  assert.ok(
    validateReleaseMilestoneBody(
      { recipientEmail: 'not-an-email' },
      { milestoneId: 'm1' }
    ).errors.includes('invalid_recipient_email')
  );
}

function testVerifyIdentity() {
  assert.strictEqual(validateVerifyIdentityBody({}).ok, true);
  assert.ok(
    validateVerifyIdentityBody({ countryCode: 'USA' }).errors.includes('invalid_country_code')
  );
  assert.strictEqual(validateVerifyIdentityBody({ countryCode: 'in' }).countryCode, 'IN');
}

function testConsent() {
  assert.ok(validateConsentBody({}).errors.includes('acceptance_required'));
  assert.strictEqual(validateConsentBody({ accepted: true }).ok, true);
}

function testMerge() {
  assert.strictEqual(validateMergeBody({}).ok, true);
  assert.ok(
    validateMergeBody({ repoFullName: 'not-a-repo' }).errors.includes('invalid_github_repo')
  );
  assert.strictEqual(
    validateMergeBody({ projectId: 'p1', prNumber: 3, repoFullName: 'org/repo' }).ok,
    true
  );
}

function testGithubLink() {
  assert.ok(validateGithubLinkBody({}).errors.includes('github_repo_required'));
  assert.strictEqual(
    validateGithubLinkBody({ githubRepoFullName: 'owner/repo', githubPrNumber: 12 }).ok,
    true
  );
}

testFundVault();
testCaptureVault();
testRelease();
testVerifyIdentity();
testConsent();
testMerge();
testGithubLink();
console.log('request validation tests passed');
