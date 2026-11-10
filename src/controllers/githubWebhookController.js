const { env } = require('../config/env');
const { verifyGithubSignature } = require('../services/github/webhookSignature');
const { createMergeHandler } = require('../services/github/mergeHandler');

const mergeHandler = createMergeHandler();

/**
 * POST /api/webhooks/github
 * Verifies X-Hub-Signature-256, handles pull_request closed+merged.
 */
async function githubWebhook(req, res, next) {
  try {
    const secret = env.github.webhookSecret;
    if (!secret) {
      return res.status(503).json({
        error: 'webhook_secret_missing',
        message: 'Set GITHUB_WEBHOOK_SECRET to accept GitHub webhooks.',
      });
    }

    const signature = req.header('x-hub-signature-256');
    const rawBody = req.rawBody;
    if (!rawBody || !verifyGithubSignature(rawBody, signature, secret)) {
      return res.status(401).json({
        error: 'invalid_signature',
        message: 'X-Hub-Signature-256 verification failed.',
      });
    }

    const event = req.header('x-github-event') || '';
    const payload = req.body || {};

    if (event === 'ping') {
      return res.status(200).json({ ok: true, pong: true });
    }

    if (event !== 'pull_request') {
      return res.status(200).json({ ok: true, ignored: true, event });
    }

    const action = payload.action;
    const pr = payload.pull_request || {};
    const merged = pr.merged === true;
    const closed = action === 'closed';

    if (!closed || !merged) {
      return res.status(200).json({
        ok: true,
        ignored: true,
        reason: 'not_a_merged_pull_request',
        action,
        merged: Boolean(pr.merged),
      });
    }

    const repoFullName =
      payload.repository?.full_name ||
      (payload.repository?.owner?.login && payload.repository?.name
        ? `${payload.repository.owner.login}/${payload.repository.name}`
        : null);
    const prNumber = pr.number;
    const mergeSha = pr.merge_commit_sha || pr.head?.sha || null;
    const mergedAt = pr.merged_at || null;

    // Optional demo/hackathon: embed a diff stub (do not use PR description as audit input)
    const diffStub =
      payload.diff ||
      payload.diff_stub ||
      payload.aegis_diff ||
      null;

    const result = await mergeHandler.handleMergedPullRequest({
      repoFullName,
      prNumber,
      mergeSha,
      mergedAt,
      diff: diffStub,
      source: 'webhook',
    });

    return res.status(200).json({
      ok: true,
      handled: true,
      milestone: result.milestone,
      audit: result.audit,
      payout: result.payout
        ? {
            paypal: result.payout.paypal,
            status: result.payout.milestone?.status,
          }
        : null,
      alreadyReleased: Boolean(result.alreadyReleased),
      alreadyFailed: Boolean(result.alreadyFailed),
      awaitingClientSignoff: Boolean(result.awaitingClientSignoff),
    });
  } catch (err) {
    // Ack business/KYC misses with 200 so GitHub does not retry forever
    if (
      err.code === 'milestone_not_linked' ||
      err.code === 'kyc_or_consent_required' ||
      err.code === 'milestone_not_funded'
    ) {
      return res.status(200).json({
        ok: true,
        handled: false,
        error: err.code,
        message: err.message,
        details: err.details || undefined,
      });
    }
    return next(err);
  }
}

/**
 * POST /api/admin/demo/milestones/:milestoneId/simulate-merge
 * Hackathon helper when a public webhook URL is unavailable.
 */
async function simulateMerge(req, res, next) {
  try {
    const milestoneId = req.params.milestoneId;
    const {
      repoFullName,
      repo_full_name: repoSnake,
      prNumber,
      pr_number: prSnake,
      mergeSha,
      merge_sha: shaSnake,
      diff,
      diffStub,
      diff_stub: diffSnake,
      acceptanceBoost,
    } = req.body || {};

    const { prisma } = require('../lib/prisma');
    const milestone = await prisma.milestone.findUnique({ where: { id: String(milestoneId) } });
    if (!milestone) {
      return res.status(404).json({ error: 'milestone_not_found' });
    }

    const repo =
      repoFullName ||
      repoSnake ||
      milestone.githubRepoFullName ||
      'demo/aegis-split';
    const pr = Number(prNumber ?? prSnake ?? milestone.githubPrNumber ?? 1);
    const sha = mergeSha || shaSnake || `demo-sha-${Date.now().toString(16)}`;

    // Default demo diff includes acceptance-criteria keywords so stub auditor can PASS
    let demoDiff = diff || diffStub || diffSnake || null;
    if (demoDiff == null) {
      const boost =
        acceptanceBoost === false
          ? ''
          : `\n+ // satisfies: ${milestone.acceptanceCriteria}\n`;
      demoDiff = [
        `diff --git a/demo.js b/demo.js`,
        `--- a/demo.js`,
        `+++ b/demo.js`,
        `@@ -0,0 +1,5 @@`,
        `+// Demo merge for milestone ${milestone.id}`,
        `+export function ship() { return true }`,
        boost,
      ].join('\n');
    }

    // Ensure link fields exist so webhook-style lookup would also work
    if (!milestone.githubRepoFullName || milestone.githubPrNumber == null) {
      await prisma.milestone.update({
        where: { id: milestone.id },
        data: {
          githubRepoFullName: repo,
          githubPrNumber: pr,
          githubPrUrl: `https://github.com/${repo}/pull/${pr}`,
        },
      });
    }

    const result = await mergeHandler.handleMergedPullRequest({
      repoFullName: repo,
      prNumber: pr,
      mergeSha: sha,
      mergedAt: new Date(),
      diff: demoDiff,
      milestoneId: milestone.id,
      actorUserId: req.user?.id || null,
      source: 'demo',
    });

    return res.status(200).json({
      ok: true,
      simulated: true,
      milestone: result.milestone,
      audit: result.audit,
      payout: result.payout
        ? {
            paypal: result.payout.paypal,
            status: result.payout.milestone?.status,
          }
        : null,
      alreadyReleased: Boolean(result.alreadyReleased),
      alreadyFailed: Boolean(result.alreadyFailed),
      awaitingClientSignoff: Boolean(result.awaitingClientSignoff),
      note: result.awaitingClientSignoff
        ? 'AI passed. Payout waits for the client sign-off.'
        : 'Simulated GitHub merge without a public webhook URL.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { githubWebhook, simulateMerge };
