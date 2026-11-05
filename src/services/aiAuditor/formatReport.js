/**
 * Human-readable audit report for Milestone.auditReport + judge-facing API.
 */
function formatAuditReport(result) {
  const passed = Boolean(result?.passed);
  const engine = result?.engine || 'unknown';
  const provider = result?.provider ? `/${result.provider}` : '';
  const lines = [
    `${passed ? 'PASS' : 'FAIL'} — ${result?.reason || 'No reason provided.'}`,
    `engine: ${engine}${provider}`,
  ];

  const checks = Array.isArray(result?.checks) ? result.checks : [];
  if (checks.length) {
    lines.push('checks:');
    for (const c of checks) {
      const mark = c.met ? '✓' : '✗';
      lines.push(`  ${mark} ${c.criterion}`);
      if (c.evidence) lines.push(`      evidence: ${c.evidence}`);
    }
  }

  return lines.join('\n');
}

module.exports = { formatAuditReport };
