/**
 * AI auditor handoff stub.
 *
 * Next PR can replace `auditMilestone` with a real LLM / static-analysis pass.
 * Keep this signature stable so mergeHandler can call it without changes:
 *   auditMilestone({ milestoneId, diff, acceptanceCriteria })
 *
 * Hackathon stub: simple keyword overlap between acceptance criteria and the diff.
 */

/**
 * @param {{ milestoneId: string, diff: string, acceptanceCriteria: string }} args
 * @returns {Promise<{ passed: boolean, report: string, score: number, matchedKeywords: string[], missingKeywords: string[] }>}
 */
async function auditMilestone({ milestoneId, diff, acceptanceCriteria }) {
  const criteria = String(acceptanceCriteria || '').trim();
  const body = String(diff || '');

  if (!criteria) {
    return {
      passed: false,
      report: `Milestone ${milestoneId}: no acceptance criteria to audit against.`,
      score: 0,
      matchedKeywords: [],
      missingKeywords: [],
    };
  }

  if (!body.trim()) {
    return {
      passed: false,
      report: `Milestone ${milestoneId}: empty diff — cannot verify acceptance criteria.`,
      score: 0,
      matchedKeywords: [],
      missingKeywords: tokenize(criteria),
    };
  }

  const keywords = tokenize(criteria);
  const haystack = body.toLowerCase();
  const matchedKeywords = keywords.filter((k) => haystack.includes(k));
  const missingKeywords = keywords.filter((k) => !haystack.includes(k));

  // Pass when at least half of significant keywords appear in the diff (demo heuristic)
  const score = keywords.length ? matchedKeywords.length / keywords.length : 0;
  const passed = keywords.length === 0 ? false : score >= 0.5;

  const report = passed
    ? `PASS (stub): milestone ${milestoneId} — matched ${matchedKeywords.length}/${keywords.length} criteria keywords (${matchedKeywords.join(', ') || 'n/a'}).`
    : `FAIL (stub): milestone ${milestoneId} — matched ${matchedKeywords.length}/${keywords.length}; missing: ${missingKeywords.join(', ') || 'n/a'}.`;

  return {
    passed,
    report,
    score,
    matchedKeywords,
    missingKeywords,
  };
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_+.-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 24);
}

module.exports = { auditMilestone, tokenize };
