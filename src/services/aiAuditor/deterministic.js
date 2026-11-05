const {
  parseAcceptanceCriteria,
  significantTokens,
  extractFilesFromDiff,
  extractAddedLines,
} = require('./parseCriteria');

/**
 * Deterministic hackathon auditor — no API keys required.
 * Scores each criterion against added diff lines + file paths.
 */
function auditDeterministic({ milestoneId, diff, acceptanceCriteria, files }) {
  const criteria = parseAcceptanceCriteria(acceptanceCriteria);
  const fileList =
    Array.isArray(files) && files.length
      ? files.map(String)
      : extractFilesFromDiff(diff);
  const added = extractAddedLines(diff);
  const addedText = added.join('\n').toLowerCase();
  const pathsText = fileList.join('\n').toLowerCase();
  const haystack = `${addedText}\n${pathsText}`;

  if (!criteria.length) {
    return {
      passed: false,
      reason: `Milestone ${milestoneId}: no parseable acceptance criteria.`,
      checks: [],
      engine: 'deterministic',
      score: 0,
    };
  }

  if (!String(diff || '').trim() && !fileList.length) {
    return {
      passed: false,
      reason: `Milestone ${milestoneId}: empty diff — cannot verify acceptance criteria.`,
      checks: criteria.map((criterion) => ({
        criterion,
        met: false,
        evidence: 'No diff or file list provided.',
      })),
      engine: 'deterministic',
      score: 0,
    };
  }

  const checks = criteria.map((criterion) => evaluateCriterion(criterion, haystack, fileList, added));
  const metCount = checks.filter((c) => c.met).length;
  const score = checks.length ? metCount / checks.length : 0;
  // Require every discrete criterion for PASS (clear judge story)
  const passed = checks.length > 0 && metCount === checks.length;

  const reason = passed
    ? `All ${checks.length} acceptance criteria appear satisfied in the PR diff (deterministic).`
    : `${metCount}/${checks.length} criteria met — failing: ${checks
        .filter((c) => !c.met)
        .map((c) => c.criterion)
        .join('; ')}.`;

  return {
    passed,
    reason,
    checks,
    engine: 'deterministic',
    score,
    files: fileList,
  };
}

function evaluateCriterion(criterion, haystack, fileList, addedLines) {
  const tokens = significantTokens(criterion);
  if (!tokens.length) {
    return {
      criterion,
      met: haystack.includes(criterion.toLowerCase()),
      evidence: 'No significant tokens; used full-string search.',
    };
  }

  const matched = tokens.filter((t) => haystack.includes(t));
  const ratio = matched.length / tokens.length;

  // Path / filename hints (e.g. "unit tests" ↔ **/test/**)
  const pathHits = matchPathHints(criterion, fileList);
  const snippet = findEvidenceSnippet(matched, addedLines, fileList);

  // Soft path-only criteria (tests, docs, readme) can pass via path hits
  const pathOnlyPass = pathHits.length > 0 && ratio >= 0.25;
  const met = ratio >= 0.5 || pathOnlyPass || (matched.length >= 2 && ratio >= 0.4);

  let evidence;
  if (met) {
    const bits = [];
    if (matched.length) bits.push(`tokens: ${matched.join(', ')}`);
    if (pathHits.length) bits.push(`files: ${pathHits.join(', ')}`);
    if (snippet) bits.push(`snippet: ${snippet}`);
    evidence = bits.join(' | ') || 'Matched via heuristics.';
  } else {
    const missing = tokens.filter((t) => !matched.includes(t));
    evidence = `Missing tokens: ${missing.slice(0, 8).join(', ') || 'n/a'}${
      snippet ? ` | nearest: ${snippet}` : ''
    }`;
  }

  return { criterion, met, evidence };
}

function matchPathHints(criterion, fileList) {
  const c = criterion.toLowerCase();
  const hits = [];
  for (const f of fileList) {
    const fl = f.toLowerCase();
    if (/(test|spec|jest|vitest|pytest)/.test(c) && /(test|spec|__tests__)/.test(fl)) {
      hits.push(f);
    } else if (/(readme|docs?|documentation)/.test(c) && /(readme|docs?\/)/.test(fl)) {
      hits.push(f);
    } else if (/(css|style|tailwind)/.test(c) && /\.(css|scss|sass|less)$/.test(fl)) {
      hits.push(f);
    } else if (/(api|endpoint|route)/.test(c) && /(route|controller|api|handler)/.test(fl)) {
      hits.push(f);
    } else if (/(component|ui|frontend|react)/.test(c) && /\.(jsx|tsx|vue|svelte)$/.test(fl)) {
      hits.push(f);
    }
  }
  return hits.slice(0, 5);
}

function findEvidenceSnippet(matchedTokens, addedLines, fileList) {
  if (matchedTokens.length) {
    const lowerTokens = matchedTokens.map((t) => t.toLowerCase());
    for (const line of addedLines) {
      const low = line.toLowerCase();
      if (lowerTokens.some((t) => low.includes(t))) {
        return line.trim().slice(0, 120);
      }
    }
  }
  if (fileList.length) return fileList[0];
  return null;
}

module.exports = { auditDeterministic, evaluateCriterion };
