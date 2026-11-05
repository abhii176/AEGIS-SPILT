const assert = require('assert');
const {
  auditMilestone,
  createAiAuditor,
  parseAcceptanceCriteria,
  extractFilesFromDiff,
  formatAuditReport,
  resolveProvider,
} = require('./index');
const { auditDeterministic } = require('./deterministic');
const { normalizeLlmResult } = require('./llm');

function testParseCriteriaBullets() {
  const criteria = parseAcceptanceCriteria(`
- Ship hero section with CTA
- Lighthouse accessibility score >= 90
- Add unit tests for hero
`);
  assert.strictEqual(criteria.length, 3);
  assert.ok(criteria[0].toLowerCase().includes('hero'));
  assert.ok(criteria[2].toLowerCase().includes('unit tests'));
}

function testParseCriteriaSentences() {
  const criteria = parseAcceptanceCriteria(
    'Ship the hero CTA. Include lighthouse accessibility improvements.'
  );
  assert.ok(criteria.length >= 2);
}

function testExtractFilesFromDiff() {
  const diff = [
    'diff --git a/src/Hero.tsx b/src/Hero.tsx',
    '--- a/src/Hero.tsx',
    '+++ b/src/Hero.tsx',
    '@@ -1 +1 @@',
    '+export function Hero() { return <button>CTA</button> }',
    'diff --git a/src/Hero.test.tsx b/src/Hero.test.tsx',
    '--- /dev/null',
    '+++ b/src/Hero.test.tsx',
    '@@ -0,0 +1 @@',
    '+test("hero", () => {})',
  ].join('\n');
  const files = extractFilesFromDiff(diff);
  assert.deepStrictEqual(files, ['src/Hero.tsx', 'src/Hero.test.tsx']);
}

async function testDeterministicPassAndFail() {
  const passDiff = [
    'diff --git a/src/Hero.tsx b/src/Hero.tsx',
    '+++ b/src/Hero.tsx',
    '+export function Hero() { return <a className="cta">Ship hero CTA</a> }',
    '+// lighthouse accessibility improvements',
    'diff --git a/src/Hero.test.tsx b/src/Hero.test.tsx',
    '+++ b/src/Hero.test.tsx',
    '+test("hero cta", () => { expect(true).toBe(true) })',
  ].join('\n');

  const pass = await auditMilestone({
    milestoneId: 'ms-pass',
    acceptanceCriteria: `- Ship hero CTA
- Lighthouse accessibility
- Unit tests for hero`,
    diff: passDiff,
  });

  assert.strictEqual(pass.passed, true);
  assert.strictEqual(pass.engine, 'deterministic');
  assert.ok(Array.isArray(pass.checks));
  assert.strictEqual(pass.checks.length, 3);
  assert.ok(pass.checks.every((c) => c.met === true));
  assert.ok(pass.report.includes('PASS'));
  assert.ok(pass.report.includes('✓'));
  assert.ok(pass.reason);

  const fail = await auditMilestone({
    milestoneId: 'ms-fail',
    acceptanceCriteria: `- Ship hero CTA
- Lighthouse accessibility
- Unit tests for hero`,
    diff: '+ console.log("hello world")\n',
  });
  assert.strictEqual(fail.passed, false);
  assert.ok(fail.checks.some((c) => c.met === false));
  assert.ok(fail.report.includes('FAIL'));
  assert.ok(fail.report.includes('✗'));
}

async function testEmptyDiffFails() {
  const result = await auditMilestone({
    milestoneId: 'ms-empty',
    acceptanceCriteria: '- Must ship hero',
    diff: '',
  });
  assert.strictEqual(result.passed, false);
  assert.ok(/empty diff/i.test(result.reason));
}

function testResolveProvider() {
  assert.strictEqual(
    resolveProvider({ provider: 'auto', openaiApiKey: '', anthropicApiKey: '' }).name,
    null
  );
  assert.strictEqual(
    resolveProvider({ provider: 'auto', openaiApiKey: 'sk-test', anthropicApiKey: '' }).name,
    'openai'
  );
  assert.strictEqual(
    resolveProvider({
      provider: 'anthropic',
      openaiApiKey: 'sk-test',
      anthropicApiKey: 'ant-test',
    }).name,
    'anthropic'
  );
  assert.strictEqual(
    resolveProvider({
      provider: 'deterministic',
      openaiApiKey: 'sk-test',
    }).name,
    null
  );
}

async function testLlmMockPass() {
  const auditor = createAiAuditor({
    aiEnv: {
      provider: 'openai',
      openaiApiKey: 'sk-test',
      anthropicApiKey: '',
    },
    llmDeps: {
      openaiCaller: async () => ({
        passed: true,
        reason: 'Model says all good',
        checks: [
          {
            criterion: 'Ship hero CTA',
            met: true,
            evidence: 'src/Hero.tsx adds CTA button',
          },
        ],
      }),
    },
  });

  const result = await auditor.auditMilestone({
    milestoneId: 'ms-llm',
    acceptanceCriteria: '- Ship hero CTA',
    diff: '+ export const Hero = () => <button>CTA</button>',
  });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.engine, 'llm');
  assert.strictEqual(result.provider, 'openai');
  assert.strictEqual(result.checks[0].met, true);
  assert.ok(result.report.includes('PASS'));
  assert.ok(result.report.includes('openai'));
}

async function testLlmMockFail() {
  const auditor = createAiAuditor({
    aiEnv: {
      provider: 'anthropic',
      openaiApiKey: '',
      anthropicApiKey: 'ant-test',
    },
    llmDeps: {
      anthropicCaller: async () => ({
        passed: false,
        reason: 'Missing accessibility work',
        checks: [
          {
            criterion: 'Lighthouse accessibility',
            met: false,
            evidence: 'No a11y-related changes in diff',
          },
        ],
      }),
    },
  });

  const result = await auditor.auditMilestone({
    milestoneId: 'ms-llm-fail',
    acceptanceCriteria: '- Lighthouse accessibility',
    diff: '+ console.log(1)',
  });

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.engine, 'llm');
  assert.strictEqual(result.provider, 'anthropic');
  assert.strictEqual(result.checks[0].met, false);
}

async function testLlmErrorFallsBack() {
  const auditor = createAiAuditor({
    aiEnv: {
      provider: 'openai',
      openaiApiKey: 'sk-test',
    },
    llmDeps: {
      openaiCaller: async () => {
        const err = new Error('boom');
        err.code = 'openai_audit_failed';
        throw err;
      },
    },
  });

  const result = await auditor.auditMilestone({
    milestoneId: 'ms-fallback',
    acceptanceCriteria: '- Ship hero CTA lighthouse',
    diff: '+ // ship hero CTA lighthouse feature\n',
  });

  assert.strictEqual(result.engine, 'deterministic');
  assert.ok(/LLM unavailable/i.test(result.reason));
  assert.strictEqual(result.passed, true);
}

function testNormalizeLlmRequiresAllCriteria() {
  const normalized = normalizeLlmResult(
    {
      passed: true,
      reason: 'claimed pass',
      checks: [{ criterion: 'A', met: true, evidence: 'ok' }],
    },
    ['A', 'B'],
    'openai'
  );
  // Missing second check → treated unmet → overall fail even if model said passed
  assert.strictEqual(normalized.passed, false);
  assert.strictEqual(normalized.checks.length, 2);
  assert.strictEqual(normalized.checks[1].met, false);
}

function testFormatReport() {
  const text = formatAuditReport({
    passed: true,
    reason: 'All good',
    engine: 'deterministic',
    checks: [{ criterion: 'Ship hero', met: true, evidence: 'Hero.tsx' }],
  });
  assert.ok(text.startsWith('PASS'));
  assert.ok(text.includes('✓ Ship hero'));
}

function testDeterministicDirect() {
  const result = auditDeterministic({
    milestoneId: 'x',
    acceptanceCriteria: 'Add README docs',
    diff: 'diff --git a/README.md b/README.md\n+++ b/README.md\n+ # Docs\n',
  });
  assert.strictEqual(result.passed, true);
  assert.ok(result.checks[0].met);
}

async function run() {
  testParseCriteriaBullets();
  testParseCriteriaSentences();
  testExtractFilesFromDiff();
  await testDeterministicPassAndFail();
  await testEmptyDiffFails();
  testResolveProvider();
  await testLlmMockPass();
  await testLlmMockFail();
  await testLlmErrorFallsBack();
  testNormalizeLlmRequiresAllCriteria();
  testFormatReport();
  testDeterministicDirect();
  console.log('ai auditor tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
