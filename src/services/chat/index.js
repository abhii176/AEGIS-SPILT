const { prisma: defaultPrisma } = require('../../lib/prisma');
const { validateChatMessageBody, parseListLimit } = require('../../lib/chatValidation');

/**
 * Project text chat — client ↔ freelancer only.
 * Allowed after project cancel so parties can still discuss disputes.
 * No calls / voice / video.
 */
function createChatService({ db = defaultPrisma } = {}) {
  function isParticipant(userId, project) {
    return Boolean(project) && (project.clientId === userId || project.freelancerId === userId);
  }

  async function loadProject(projectId) {
    return db.project.findUnique({
      where: { id: projectId },
      select: { id: true, clientId: true, freelancerId: true, status: true },
    });
  }

  async function assertParticipantAccess(projectId, userId) {
    const project = await loadProject(projectId);
    if (!project) {
      const err = new Error('Project not found');
      err.status = 404;
      err.code = 'project_not_found';
      throw err;
    }
    if (!isParticipant(userId, project)) {
      const err = new Error('Forbidden');
      err.status = 403;
      err.code = 'forbidden';
      throw err;
    }
    return project;
  }

  /**
   * List messages for a project (oldest → newest). Participants only.
   */
  async function listMessages({ projectId, userId, query = {} }) {
    await assertParticipantAccess(projectId, userId);
    const take = parseListLimit(query);

    const messages = await db.chatMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      take,
      include: {
        sender: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return { messages };
  }

  /**
   * Post a text message. Participants only; non-empty body, max length enforced.
   */
  async function postMessage({ projectId, userId, body }) {
    await assertParticipantAccess(projectId, userId);

    const validation = validateChatMessageBody(body || {});
    if (!validation.ok) {
      const err = new Error(validation.errors[0]);
      err.status = 400;
      err.code = validation.errors[0];
      throw err;
    }

    const message = await db.chatMessage.create({
      data: {
        projectId,
        senderUserId: userId,
        body: validation.body,
      },
      include: {
        sender: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    return { message };
  }

  return {
    isParticipant,
    listMessages,
    postMessage,
  };
}

module.exports = {
  createChatService,
};
