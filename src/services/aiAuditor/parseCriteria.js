/**
 * Parse free-form milestone acceptanceCriteria into discrete requirements.
 * Supports bullets, numbered lists, newlines, semicolons, and sentence splits.
 */

const BULLET_RE = /^\s*(?:[-*•]|\d+[.)]|\[\s*[xX ]?\s*\])\s+/;
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'of',
  'for',
  'in',
  'on',
  'at',
  'is',
  'are',
  'be',
  'with',
  'that',
  'this',
  'from',
  'as',
  'by',
  'it',
  'its',
  'must',
  'should',
  'shall',
  'will',
  'can',
  'all',
  'any',
  'have',
  'has',
]);

function parseAcceptanceCriteria(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let parts = [];
  if (lines.length > 1) {
    parts = lines.map((l) => l.replace(BULLET_RE, '').trim()).filter(Boolean);
  } else {
    const single = lines[0] || raw;
    if (BULLET_RE.test(single) || /;/.test(single)) {
      parts = single
        .split(/;/)
        .map((p) => p.replace(BULLET_RE, '').trim())
        .filter(Boolean);
    } else {
      // Split long prose on sentence boundaries when multiple clauses exist
      const sentences = single
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 8);
      parts = sentences.length > 1 ? sentences : [single];
    }
  }

  // De-dupe while preserving order
  const seen = new Set();
  const criteria = [];
  for (const part of parts) {
    const cleaned = part.replace(/\s+/g, ' ').replace(/[.]+$/, '').trim();
    if (!cleaned || cleaned.length < 3) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    criteria.push(cleaned);
  }

  return criteria.slice(0, 20);
}

function significantTokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_+./-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .filter((t) => !STOP_WORDS.has(t))
    .filter((t, i, arr) => arr.indexOf(t) === i);
}

/**
 * Pull changed file paths from a unified diff.
 */
function extractFilesFromDiff(diff) {
  const files = [];
  const seen = new Set();
  const text = String(diff || '');
  const gitRe = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let m;
  while ((m = gitRe.exec(text))) {
    const path = m[2] || m[1];
    if (path && !seen.has(path)) {
      seen.add(path);
      files.push(path);
    }
  }
  if (!files.length) {
    const plusRe = /^\+\+\+\s+b\/(.+)$/gm;
    while ((m = plusRe.exec(text))) {
      const path = m[1];
      if (path && path !== '/dev/null' && !seen.has(path)) {
        seen.add(path);
        files.push(path);
      }
    }
  }
  return files;
}

/**
 * Added (+…) lines only — primary evidence surface for heuristics.
 */
function extractAddedLines(diff) {
  return String(diff || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

module.exports = {
  parseAcceptanceCriteria,
  significantTokens,
  extractFilesFromDiff,
  extractAddedLines,
};
