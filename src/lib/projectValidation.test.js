const assert = require('assert');
const {
  validateCreateProjectBody,
  validateAddMilestoneBody,
} = require('./projectValidation');

function testCreateProjectValidation() {
  assert.deepStrictEqual(validateCreateProjectBody({}).errors, [
    'title_required',
    'freelancer_id_required',
  ]);
  assert.strictEqual(
    validateCreateProjectBody({ title: 'App', freelancerId: 'u2' }).ok,
    true
  );
  assert.ok(
    validateCreateProjectBody({
      title: 'App',
      freelancerId: 'u1',
      clientId: 'u1',
    }).errors.includes('invalid_parties')
  );
  assert.ok(
    validateCreateProjectBody({
      title: 'App',
      freelancerId: 'u2',
      earlyExitPenaltyPercent: 150,
    }).errors.includes('invalid_early_exit_penalty_percent')
  );
  assert.strictEqual(
    validateCreateProjectBody({
      title: 'App',
      freelancerId: 'u2',
      earlyExitPenaltyPercent: 50,
      freelancerDepositAmountCents: 2500,
    }).ok,
    true
  );
}

function testAddMilestoneValidation() {
  assert.ok(
    validateAddMilestoneBody({}).errors.includes('title_required')
  );
  assert.ok(
    validateAddMilestoneBody({ title: 'M1' }).errors.includes('task_description_required')
  );
  const ok = validateAddMilestoneBody({
    title: 'M1',
    taskDescription: 'Build login',
    acceptanceCriteria: 'JWT auth + tests',
    amountCents: 25000,
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.amountCents, 25000);

  const snake = validateAddMilestoneBody({
    title: 'M1',
    task_description: 'Build login',
    acceptance_criteria: 'JWT auth + tests',
    amount_cents: 100,
  });
  assert.strictEqual(snake.ok, true);

  const manual = validateAddMilestoneBody({
    title: 'M1',
    taskDescription: 'Match the mock',
    acceptanceCriteria: 'Layout matches the approved frame',
    amountCents: 100,
    requiresManualSignoff: true,
  });
  assert.strictEqual(manual.ok, true);
  assert.strictEqual(manual.requiresManualSignoff, true);

  const badFlag = validateAddMilestoneBody({
    title: 'M1',
    taskDescription: 'Match the mock',
    acceptanceCriteria: 'Layout matches the approved frame',
    amountCents: 100,
    requiresManualSignoff: 'yes',
  });
  assert.ok(badFlag.errors.includes('invalid_requires_manual_signoff'));
}

testCreateProjectValidation();
testAddMilestoneValidation();
console.log('project/milestone validation tests passed');
