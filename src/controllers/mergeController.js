const { prisma } = require('../lib/prisma');
const { validateMergeBody } = require('../lib/requestValidation');

/** POST /api/merge — gated by requireKycAndConsent */
async function mergeCode(req, res, next) {
  try {
    const validation = validateMergeBody(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ error: validation.errors[0] });
    }

    const event = await prisma.mergeEvent.create({
      data: {
        userId: req.user.id,
        projectId: validation.projectId ? String(validation.projectId) : null,
        prNumber: validation.prNumber != null ? Number(validation.prNumber) : null,
        repoFullName: validation.repoFullName ? String(validation.repoFullName) : null,
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
