const { prisma } = require('../lib/prisma');
const { validateCreateProjectBody } = require('../lib/projectValidation');

const PROJECT_INCLUDE = {
  milestones: { orderBy: { sequence: 'asc' } },
  client: { select: { id: true, email: true, name: true, role: true } },
  freelancer: { select: { id: true, email: true, name: true, role: true } },
};

function isProjectParticipant(userId, project) {
  return project.clientId === userId || project.freelancerId === userId;
}

/**
 * POST /api/projects
 * Create a project between client (caller by default) and freelancer.
 * Gated by requireKycAndConsent.
 */
async function createProject(req, res, next) {
  try {
    const {
      title,
      description,
      freelancerId,
      clientId: bodyClientId,
      status,
    } = req.body || {};

    const validation = validateCreateProjectBody({
      title,
      freelancerId,
      clientId: bodyClientId,
    });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.errors[0] });
    }

    const clientId = bodyClientId && typeof bodyClientId === 'string' ? bodyClientId : req.user.id;

    if (clientId !== req.user.id && freelancerId !== req.user.id) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You must be the client or freelancer on the project you create.',
      });
    }

    if (clientId === freelancerId) {
      return res.status(400).json({
        error: 'invalid_parties',
        message: 'clientId and freelancerId must be different users.',
      });
    }

    const [client, freelancer] = await Promise.all([
      prisma.user.findUnique({ where: { id: clientId } }),
      prisma.user.findUnique({ where: { id: freelancerId } }),
    ]);

    if (!client) {
      return res.status(400).json({ error: 'client_not_found' });
    }
    if (!freelancer) {
      return res.status(400).json({ error: 'freelancer_not_found' });
    }

    const allowedStatuses = new Set(['DRAFT', 'ACTIVE']);
    const projectStatus =
      status && allowedStatuses.has(String(status).toUpperCase())
        ? String(status).toUpperCase()
        : 'DRAFT';

    const project = await prisma.project.create({
      data: {
        clientId,
        freelancerId,
        title: title.trim(),
        description: description ? String(description) : null,
        status: projectStatus,
      },
      include: PROJECT_INCLUDE,
    });

    return res.status(201).json({ project });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/projects
 * List projects where the authenticated user is client or freelancer.
 */
async function listProjects(req, res, next) {
  try {
    const projects = await prisma.project.findMany({
      where: {
        OR: [{ clientId: req.user.id }, { freelancerId: req.user.id }],
      },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ projects });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/projects/:projectId
 */
async function getProject(req, res, next) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId },
      include: PROJECT_INCLUDE,
    });

    if (!project) {
      return res.status(404).json({ error: 'project_not_found' });
    }
    if (!isProjectParticipant(req.user.id, project)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    return res.status(200).json({ project });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createProject,
  listProjects,
  getProject,
  isProjectParticipant,
  PROJECT_INCLUDE,
};
