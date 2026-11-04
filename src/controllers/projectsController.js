const { prisma } = require('../lib/prisma');

/** POST /api/projects — gated by requireKycAndConsent */
async function createProject(req, res, next) {
  try {
    const { title, description } = req.body || {};
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title_required' });
    }

    const project = await prisma.project.create({
      data: {
        ownerId: req.user.id,
        title: title.trim(),
        description: description ? String(description) : null,
      },
    });

    return res.status(201).json({ project });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createProject };
