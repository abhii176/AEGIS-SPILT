const { prisma } = require('../../lib/prisma');
const { createEscrowService } = require('../paypal/escrow');
const { createGithubClient } = require('./client');
const { createNotificationService } = require('../notifications');
const { assertProjectNotCancelled } = require('../../lib/projectStatus');
const { isDisputeOpenStatus } = require('../../lib/disputeMath');
const aiAuditor = require('../aiAuditor');

/** Statuses that imply escrow was locked before merge audit/release */
const MERGEABLE_STATUSES = new Set([
  'FUNDED',
  'IN_PROGRESS',
  'SUBMITTED',
  'AUDITING',
  'PASSED',
]);

/**
 * Resolve a linked milestone from repo + PR, run AI audit stub, then release or fail.
 * Used by GitHub webhook + admin/demo simulate-merge.
 */
function createMergeHandler({
  db = prisma,
  escrow = createEscrowService(),
  github = createGithubClient(),
  auditor = aiAuditor,
  notifications = createNotificationService({ db }),
} = {}) {
  function partiesHaveKycAndConsent(project) {
    const clientOk =
      project.client?.govIdVerified === true &&
      project.client?.monitoringConsentGranted === true;
    const freelancerOk =
      project.freelancer?.govIdVerified === true &&
      project.freelancer?.monitoringConsentGranted === true;
    return { clientOk, freelancerOk, ok: clientOk && freelancerOk };
  }

  async function findLinkedMilestone({ repoFullName, prNumber, milestoneId }) {
    if (milestoneId) {
      return db.milestone.findUnique({
        where: { id: String(milestoneId) },
        include: {
          project: { include: { client: true, freelancer: true } },
        },
      });
    }

    const repo = String(repoFullName || '').trim();
    const pr = Number(prNumber);
    if (!repo || !Number.isInteger(pr) || pr < 1) {
      return null;
    }

    return db.milestone.findFirst({
      where: {
        githubRepoFullName: repo,
        githubPrNumber: pr,
      },
      include: {
        project: { include: { client: true, freelancer: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * @param {{
   *   repoFullName: string,
   *   prNumber: number,
   *   mergeSha?: string|null,
   *   mergedAt?: Date|string|null,
   *   diff?: string|null,
   *   milestoneId?: string|null,
   *   actorUserId?: string|null,
   *   source?: string,
   *   skipRelease?: boolean,
   * }} input
   */
  async function handleMergedPullRequest(input) {
    const {
      repoFullName,
      prNumber,
      mergeSha = null,
      mergedAt = null,
      diff: providedDiff = null,
      milestoneId = null,
      actorUserId = null,
      source = 'webhook',
      skipRelease = false,
    } = input || {};

    const milestone = await findLinkedMilestone({
      repoFullName,
      prNumber,
      milestoneId,
    });

    if (!milestone) {
      const err = new Error(
        'No milestone linked to this repo/PR — call POST .../milestones/:id/github first'
      );
      err.status = 404;
      err.code = 'milestone_not_linked';
      throw err;
    }

    assertProjectNotCancelled(milestone.project, 'merging / auditing');

    if (['RELEASED', 'PAID'].includes(milestone.status)) {
      return {
        alreadyReleased: true,
        milestone,
        audit: null,
        payout: null,
      };
    }

    // Idempotent: same merge SHA already audited/released path
    if (
      mergeSha &&
      milestone.githubMergeSha &&
      String(mergeSha) === String(milestone.githubMergeSha) &&
      milestone.auditPassed != null
    ) {
      return {
        alreadyReleased: milestone.auditPassed === true && ['PASSED', 'RELEASED', 'PAID'].includes(milestone.status),
        alreadyFailed: milestone.auditPassed === false,
        milestone,
        audit: {
          passed: milestone.auditPassed,
          report: milestone.auditReport,
        },
        payout: null,
      };
    }

    if (milestone.status === 'FAILED' && milestone.auditPassed === false) {
      return {
        alreadyFailed: true,
        milestone,
        audit: {
          passed: false,
          report: milestone.auditReport,
        },
        payout: null,
      };
    }

    if (!MERGEABLE_STATUSES.has(milestone.status)) {
      const err = new Error(
        `Milestone status ${milestone.status} cannot be merge-audited (fund escrow first; need FUNDED…PASSED)`
      );
      err.status = 409;
      err.code = 'milestone_not_funded';
      throw err;
    }

    const kyc = partiesHaveKycAndConsent(milestone.project);
    if (!kyc.ok) {
      const err = new Error(
        'Both client and freelancer must have gov ID verified and monitoring consent before merge audit/release'
      );
      err.status = 403;
      err.code = 'kyc_or_consent_required';
      err.details = {
        client: kyc.clientOk,
        freelancer: kyc.freelancerOk,
      };
      throw err;
    }

    const repo = String(repoFullName || milestone.githubRepoFullName || '').trim();
    const pr = Number(prNumber ?? milestone.githubPrNumber);
    const sha = mergeSha ? String(mergeSha) : null;
    const when = mergedAt ? new Date(mergedAt) : new Date();

    let diff = providedDiff != null ? String(providedDiff) : null;
    if (diff == null || diff === '') {
      try {
        diff = await github.fetchPullRequestDiff({
          repoFullName: repo,
          prNumber: pr,
        });
      } catch (fetchErr) {
        if (fetchErr.code === 'github_token_missing') {
          diff = '';
        } else {
          throw fetchErr;
        }
      }
    }

    await db.milestone.update({
      where: { id: milestone.id },
      data: {
        status: 'AUDITING',
        githubRepoFullName: repo || milestone.githubRepoFullName,
        githubPrNumber: Number.isInteger(pr) ? pr : milestone.githubPrNumber,
        githubMergeSha: sha,
        githubMergedAt: when,
      },
    });

    const actorId = actorUserId || milestone.project.freelancerId;

    await db.mergeEvent.create({
      data: {
        userId: actorId,
        projectId: milestone.projectId,
        milestoneId: milestone.id,
        prNumber: Number.isInteger(pr) ? pr : null,
        repoFullName: repo || null,
        mergeSha: sha,
        source: String(source || 'webhook'),
        metadata: {
          diffPreview: String(diff || '').slice(0, 4000),
          mergedAt: when.toISOString(),
        },
      },
    });

    const audit = await auditor.auditMilestone({
      milestoneId: milestone.id,
      diff: diff || '',
      acceptanceCriteria: milestone.acceptanceCriteria,
    });

    // Persist judge-facing text; keep structured audit on the API response object
    const auditReportText =
      audit.report ||
      `${audit.passed ? 'PASS' : 'FAIL'} — ${audit.reason || ''}`.trim();

    async function emitAuditNotice(passed, milestoneRow) {
      if (typeof notifications.notifyAudit !== 'function') return;
      try {
        await notifications.notifyAudit({
          project: milestone.project,
          milestone: milestoneRow,
          passed,
          reason: audit.reason || '',
        });
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          // eslint-disable-next-line no-console
          console.warn('[notifications] audit emit failed:', err.message || err);
        }
      }
    }

    if (!audit.passed) {
      const failed = await db.milestone.update({
        where: { id: milestone.id },
        data: {
          status: 'FAILED',
          auditPassed: false,
          auditReport: auditReportText,
          auditCheckedAt: new Date(),
        },
      });

      await emitAuditNotice(false, failed);

      return {
        alreadyReleased: false,
        alreadyFailed: false,
        milestone: failed,
        audit,
        payout: null,
      };
    }

    const passed = await db.milestone.update({
      where: { id: milestone.id },
      data: {
        status: 'PASSED',
        auditPassed: true,
        auditReport: auditReportText,
        auditCheckedAt: new Date(),
      },
    });

    await emitAuditNotice(true, passed);

    let disputed = isDisputeOpenStatus(milestone.project?.status);
    if (typeof db.project?.findUnique === 'function') {
      const fresh = await db.project.findUnique({
        where: { id: milestone.projectId },
        select: { status: true },
      });
      if (fresh?.status) disputed = isDisputeOpenStatus(fresh.status);
    }

    if (skipRelease || passed.requiresManualSignoff === true || disputed) {
      return {
        alreadyReleased: false,
        alreadyFailed: false,
        awaitingClientSignoff: passed.requiresManualSignoff === true && !disputed,
        payoutPaused: disputed,
        disputeOpen: disputed,
        milestone: passed,
        audit,
        payout: null,
      };
    }

    // Reuse escrow release path (same as payoutsController) — no duplicated PayPal logic
    const payout = await escrow.releaseMilestone({
      milestoneId: milestone.id,
      actorUserId: actorId,
      allowDemoBypass: source === 'demo',
    });

    return {
      alreadyReleased: false,
      alreadyFailed: false,
      awaitingClientSignoff: false,
      milestone: payout.milestone,
      audit,
      payout,
    };
  }

  return {
    handleMergedPullRequest,
    findLinkedMilestone,
    partiesHaveKycAndConsent,
    MERGEABLE_STATUSES,
  };
}

module.exports = { createMergeHandler, MERGEABLE_STATUSES };
