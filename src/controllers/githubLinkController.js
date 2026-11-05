const { prisma } = require('../lib/prisma');
const { loadProjectOrFail } = require('./milestonesController');

/**
 * POST /api/projects/:projectId/milestones/:milestoneId/github
 * Link a GitHub repo (and optional PR) to a milestone. Gated by KYC + consent.
 */
async function linkGithubToMilestone(req, res, next) {
  try {
    const { projectId, milestoneId } = req.params;
    await loadProjectOrFail(projectId, req.user.id);

    const milestone = await prisma.milestone.findFirst({
      where: { id: String(milestoneId), projectId: String(projectId) },
    });
    if (!milestone) {
      return res.status(404).json({ error: 'milestone_not_found' });
    }

    const {
      githubRepoFullName,
      github_repo_full_name: repoSnake,
      repoFullName,
      repo_full_name: repoSnake2,
      githubPrNumber,
      github_pr_number: prSnake,
      prNumber,
      pr_number: prSnake2,
      githubPrUrl,
      github_pr_url: urlSnake,
      prUrl: prUrlCamel,
      pr_url: urlSnake2,
    } = req.body || {};

    const repo = String(
      githubRepoFullName || repoSnake || repoFullName || repoSnake2 || ''
    ).trim();

    if (!repo) {
      return res.status(400).json({
        error: 'github_repo_required',
        message: 'Provide githubRepoFullName (owner/name).',
      });
    }

    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return res.status(400).json({
        error: 'invalid_github_repo',
        message: 'githubRepoFullName must look like owner/repo.',
      });
    }

    const rawPr = githubPrNumber ?? prSnake ?? prNumber ?? prSnake2;
    let prNum = null;
    if (rawPr != null && rawPr !== '') {
      prNum = Number(rawPr);
      if (!Number.isInteger(prNum) || prNum < 1) {
        return res.status(400).json({ error: 'invalid_github_pr_number' });
      }
    }

    let resolvedPrUrl = githubPrUrl || urlSnake || prUrlCamel || urlSnake2 || null;
    if (!resolvedPrUrl && prNum != null) {
      resolvedPrUrl = `https://github.com/${repo}/pull/${prNum}`;
    }

    // Only advance FUNDED → IN_PROGRESS; never imply work started on an unfunded milestone
    const nextStatus = milestone.status === 'FUNDED' ? 'IN_PROGRESS' : milestone.status;

    const updated = await prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        githubRepoFullName: repo,
        githubPrNumber: prNum,
        githubPrUrl: resolvedPrUrl ? String(resolvedPrUrl) : null,
        status: nextStatus,
      },
    });

    return res.status(200).json({
      milestone: updated,
      note: 'GitHub repo/PR linked. Merged PRs will audit + release via webhook or demo simulate.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { linkGithubToMilestone };
