/**
 * Fund-step visibility for the freelancer security deposit.
 * The client can read the status. Only the project's freelancer gets the pay buttons.
 * Loaded as a classic script (window.AegisDepositPanel) and required by unit tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AegisDepositPanel = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function depositPanelFactory() {
  const SETTLED = new Set(['HELD', 'RETURNED', 'FORFEITED']);

  function formatUsd(cents) {
    const n = Number(cents) / 100;
    if (!Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  }

  function statusWord(status) {
    switch (String(status || 'PENDING').toUpperCase()) {
      case 'HELD':
        return 'paid';
      case 'PENDING':
        return 'pending';
      case 'RETURNED':
        return 'returned';
      case 'FORFEITED':
        return 'forfeited';
      default:
        return String(status || 'pending').toLowerCase();
    }
  }

  function sumMilestoneCents(milestones) {
    if (!Array.isArray(milestones) || !milestones.length) return null;
    return milestones.reduce((sum, milestone) => sum + (Number(milestone.amountCents) || 0), 0);
  }

  function positiveCents(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function amountCents(project, milestoneTotalCents) {
    if (!project && positiveCents(milestoneTotalCents) == null) return null;

    const explicit = project?.freelancerDepositAmountCents;
    if (
      explicit != null &&
      explicit !== '' &&
      Number.isInteger(Number(explicit)) &&
      Number(explicit) > 0
    ) {
      return Number(explicit);
    }

    // A create-project response resolves the deposit before the milestone exists,
    // so effectiveDepositAmountCents can be 0 until the next read. Prefer any
    // positive milestone total we already know, matching the server's 10% default.
    const total =
      positiveCents(project?.milestoneTotalCents) ??
      positiveCents(sumMilestoneCents(project?.milestones)) ??
      positiveCents(milestoneTotalCents);
    if (total != null) return Math.floor((total * 10) / 100);

    const effective = positiveCents(project?.effectiveDepositAmountCents);
    if (effective != null) return effective;
    return project ? 0 : null;
  }

  function isProjectFreelancer({ userId, project, userRole }) {
    if (!userId) return false;
    if (project?.freelancerId) return project.freelancerId === userId;
    return String(userRole || '').toUpperCase() === 'FREELANCER';
  }

  function freelancerFirstName(name) {
    const first = String(name || '').trim().split(/\s+/)[0];
    return first || 'Rohan';
  }

  /**
   * @returns {{
   *   showActions: boolean,
   *   showHint: boolean,
   *   statusText: string,
   *   hintText: string,
   *   showApprove: boolean,
   *   approveUrl: string,
   * }}
   */
  function view({
    userId = '',
    userRole = '',
    project = null,
    freelancerName = '',
    milestoneTotalCents = null,
    depositApprovalUrl = '',
  } = {}) {
    const freelancer = isProjectFreelancer({ userId, project, userRole });
    const cents = amountCents(project, milestoneTotalCents);
    const word = statusWord(project?.depositStatus);
    const statusText =
      cents == null ? 'Freelancer deposit: —' : `Freelancer deposit: ${formatUsd(cents)} - ${word}`;
    const settled = SETTLED.has(String(project?.depositStatus || '').toUpperCase());
    const approveUrl = !freelancer || settled ? '' : String(depositApprovalUrl || '');

    return {
      showActions: freelancer,
      showHint: !freelancer && !settled,
      statusText,
      hintText: `Switch to ${freelancerFirstName(freelancerName)} (freelancer) to pay the deposit`,
      showApprove: Boolean(approveUrl),
      approveUrl,
    };
  }

  return {
    view,
    formatUsd,
    statusWord,
    amountCents,
    isProjectFreelancer,
  };
});
