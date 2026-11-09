const { prisma } = require('../lib/prisma');
const { loadProjectOrFail } = require('./milestonesController');
const { validateGithubLinkBody } = require('../lib/requestValidation');
const { assertProjectNotCancelled } = require('../lib/projectStatus');

/**
 * POST /api/projects/:projectId/milestones/:milestoneId/github
 * Link a GitHub repo (and optional PR) to a milestone. Gated by KYC + consent.
 */
async function linkGithubToMilestone(req, res, next) {
  try {
    const { projectId, milestoneId } = req.params;
    const project = await loadProjectOrFail(projectId, req.user.id);
    assertProjectNotCancelled(project, 'linking GitHub');

    const milestone = await prisma.milestone.findFirst({
      where: { id: String(milestoneId), projectId: String(projectId) },
    });
    if (!milestone) {
      return res.status(404).json({ error: 'milestone_not_found' });
    }

    const validation = validateGithubLinkBody(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.errors[0],
        message:
          validation.errors[0] === 'github_repo_required'
            ? 'Provide githubRepoFullName (owner/name).'
            : validation.errors[0] === 'invalid_github_repo'
              ? 'githubRepoFullName must look like owner/repo.'
              : undefined,
      });
    }

    const { repo, prNum } = validation;
    let resolvedPrUrl = validation.prUrl;
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
