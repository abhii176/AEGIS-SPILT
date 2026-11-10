/**
 * Read-only markup for the Agency (preview) tab.
 * Loaded as a classic script (window.AegisAgencyPanel) and required by unit tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AegisAgencyPanel = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function agencyPanelFactory() {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatUsd(cents) {
    const n = (Number(cents) || 0) / 100;
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function moneySplit(liveCents, sampleCents, { money = true } = {}) {
    const live = money ? formatUsd(liveCents) : String(liveCents || 0);
    const sample = money ? formatUsd(sampleCents) : String(sampleCents || 0);
    return `Live ${live}. Sample ${sample}.`;
  }

  function renderStats(dashboard) {
    const totals = dashboard.totals || {};
    const live = totals.live || {};
    const sample = totals.sample || {};
    const cards = [
      ['Held in escrow', 'Money captured and not yet released.', totals.heldCents, live.heldCents, sample.heldCents, true],
      ['Released', 'Milestone amounts already marked paid.', totals.releasedCents, live.releasedCents, sample.releasedCents, true],
      ['Pending', 'Milestone amounts not funded yet.', totals.pendingCents, live.pendingCents, sample.pendingCents, true],
      [
        'Deposits at risk',
        'Freelancer deposits still held.',
        totals.depositsAtRiskCents,
        live.depositsAtRiskCents,
        sample.depositsAtRiskCents,
        true,
      ],
      ['Open disputes', 'Cases waiting on a decision.', totals.openDisputes, live.openDisputes, sample.openDisputes, false],
    ];
    return `<div class="stat-row">${cards
      .map(
        ([label, hint, total, liveValue, sampleValue, money]) => `<article class="stat-card">
          <p class="stat-label">${escapeHtml(label)}</p>
          <p class="stat-value">${money ? formatUsd(total) : escapeHtml(total || 0)}</p>
          <p class="stat-split">${escapeHtml(moneySplit(liveValue, sampleValue, { money }))}</p>
          <p class="stat-hint">${escapeHtml(hint)}</p>
        </article>`
      )
      .join('')}</div>`;
  }

  function renderTeamLine(dashboard) {
    const members = (dashboard.members || []).filter((member) => member.projectCount > 0);
    if (!members.length) return '';
    const text = members
      .map(
        (member) =>
          `${member.name}: ${member.activeProjects} active, ${formatUsd(member.payoutsCents)} released, ${formatUsd(member.heldCents)} held`
      )
      .join('. ');
    return `<p class="agency-plain">Team workload. ${escapeHtml(text)}.</p>`;
  }

  function projectNote(row) {
    const bits = [row.sample ? 'Sample' : 'Live'];
    if (row.depositAtRiskCents > 0) {
      bits.push(`deposit ${formatUsd(row.depositAtRiskCents)} at risk`);
    }
    if (row.openDispute) bits.push('dispute open');
    return bits.join(' · ');
  }

  function renderTable(dashboard) {
    const rows = dashboard.projects || [];
    if (!rows.length) {
      return '<p class="field-hint">No projects yet.</p>';
    }
    const body = rows
      .map(
        (row) => `<tr data-source="${row.sample ? 'sample' : 'live'}">
          <td>
            <span class="agency-project">${escapeHtml(row.title)}</span>
            <span class="agency-project-note">${escapeHtml(projectNote(row))}</span>
          </td>
          <td>${escapeHtml(row.freelancerName)}</td>
          <td>${escapeHtml(row.escrowLabel)}</td>
          <td>${formatUsd(row.heldCents)}</td>
          <td>${formatUsd(row.releasedCents)}</td>
          <td>${formatUsd(row.pendingCents)}</td>
        </tr>`
      )
      .join('');
    return `<div class="agency-table-wrap">
      <table class="agency-table">
        <caption>One row per project. Sample rows are seeded. Live rows are real Sarah and Rohan projects.</caption>
        <thead>
          <tr>
            <th>Project</th>
            <th>Member</th>
            <th>Escrow</th>
            <th>Held</th>
            <th>Released</th>
            <th>Pending</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  }

  function renderActivity(dashboard) {
    const rows = (dashboard.activity || []).slice(0, 4);
    if (!rows.length) return '';
    const text = rows
      .map((row) => `${row.message} (${row.sample ? 'sample' : 'live'})`)
      .join('. ');
    return `<p class="agency-plain">Recent activity. ${escapeHtml(text)}.</p>`;
  }

  function render(dashboard) {
    return `${renderStats(dashboard)}${renderTeamLine(dashboard)}${renderTable(dashboard)}${renderActivity(dashboard)}`;
  }

  return {
    escapeHtml,
    formatUsd,
    render,
    renderStats,
    renderTable,
    renderTeamLine,
    renderActivity,
  };
});
