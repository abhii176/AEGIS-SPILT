const { env } = require('../../config/env');
const { parseAcceptanceCriteria, extractFilesFromDiff, significantTokens } = require('./parseCriteria');
const { auditDeterministic } = require('./deterministic');
const { auditWithLlm, resolveProvider } = require('./llm');
const { formatAuditReport } = require('./formatReport');

/**
 * AI auditor handoff — called by mergeHandler after a merged PR.
 *
 *   auditMilestone({ milestoneId, diff, acceptanceCriteria, files? })
 *
 * Returns structured:
 *   { passed, reason, checks: [{ criterion, met, evidence }], report, engine, ... }
 *
 * Prefers OpenAI / Anthropic when keys are set; otherwise deterministic heuristics
 * so the hackathon demo works without API credentials.
 */

function createAiAuditor(deps = {}) {
  const {
    llmAudit = auditWithLlm,
    deterministicAudit = auditDeterministic,
    aiEnv = env.ai || {},
  } = deps;

  /**
   * @param {{
   *   milestoneId: string,
   *   diff?: string,
   *   acceptanceCriteria?: string,
   *   files?: string[],
   * }} args
   */
  async function auditMilestone(args = {}) {
    const milestoneId = String(args.milestoneId || '');
    const diff = String(args.diff || '');
    const acceptanceCriteria = String(args.acceptanceCriteria || '');
    const files =
      Array.isArray(args.files) && args.files.length
        ? args.files.map(String)
        : extractFilesFromDiff(diff);

    const criteria = parseAcceptanceCriteria(acceptanceCriteria);
    if (!criteria.length) {
      const empty = {
        passed: false,
        reason: `Milestone ${milestoneId}: no parseable acceptance criteria.`,
        checks: [],
        engine: 'deterministic',
        score: 0,
      };
      return finalize(empty);
    }

    const resolved = resolveProvider({
      provider: aiEnv.provider || 'auto',
      openaiApiKey: aiEnv.openaiApiKey,
      anthropicApiKey: aiEnv.anthropicApiKey,
    });

    if (resolved.name) {
      try {
        const llmResult = await llmAudit(
          { milestoneId, diff, acceptanceCriteria, files },
          {
            openaiApiKey: aiEnv.openaiApiKey,
            anthropicApiKey: aiEnv.anthropicApiKey,
            provider: aiEnv.provider || 'auto',
            ...(deps.llmDeps || {}),
          }
        );
        if (llmResult) {
          return finalize({ ...llmResult, files });
        }
      } catch (err) {
        // Fall through to deterministic so demo/webhook never hard-crash on LLM outage
        if (process.env.NODE_ENV !== 'test' && process.env.AI_AUDITOR_STRICT === 'true') {
          throw err;
        }
        const fallback = deterministicAudit({
          milestoneId,
          diff,
          acceptanceCriteria,
          files,
        });
        return finalize({
          ...fallback,
          reason: `${fallback.reason} (LLM unavailable: ${err.message || 'error'}; used deterministic fallback)`,
          llmError: err.code || err.message,
        });
      }
    }

    return finalize(
      deterministicAudit({
        milestoneId,
        diff,
        acceptanceCriteria,
        files,
      })
    );
  }

  return { auditMilestone };
}

function finalize(result) {
  const report = formatAuditReport(result);
  return {
    passed: Boolean(result.passed),
    reason: result.reason || '',
    checks: Array.isArray(result.checks) ? result.checks : [],
    report,
    engine: result.engine || 'deterministic',
    provider: result.provider || null,
    score: typeof result.score === 'number' ? result.score : null,
    files: result.files || undefined,
    llmError: result.llmError || undefined,
  };
}

const defaultAuditor = createAiAuditor();

module.exports = {
  auditMilestone: defaultAuditor.auditMilestone,
  createAiAuditor,
  parseAcceptanceCriteria,
  extractFilesFromDiff,
  significantTokens,
  formatAuditReport,
  resolveProvider,
  // Back-compat alias used by older github tests
  tokenize: significantTokens,
};
