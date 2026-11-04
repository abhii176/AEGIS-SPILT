const { prisma } = require('../lib/prisma');

/** POST /api/merge — gated by requireKycAndConsent */
async function mergeCode(req, res, next) {
  try {
    const projectId = req.body?.projectId || req.body?.project_id || null;
    const prNumber = req.body?.prNumber ?? req.body?.pr_number ?? null;
    const repoFullName = req.body?.repoFullName || req.body?.repo_full_name || null;

    const event = await prisma.mergeEvent.create({
      data: {
        userId: req.user.id,
        projectId: projectId ? String(projectId) : null,
        prNumber: prNumber != null ? Number(prNumber) : null,
        repoFullName: repoFullName ? String(repoFullName) : null,
      },
    });

    return res.status(201).json({
      mergeEvent: event,
      note: 'GitHub merge + AI audit not wired yet — scaffold record only.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { mergeCode };
