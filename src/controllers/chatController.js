const { createChatService } = require('../services/chat');

const chat = createChatService();

/**
 * GET /api/projects/:projectId/messages
 * List chat messages (project client or freelancer only).
 */
async function listMessages(req, res, next) {
  try {
    const result = await chat.listMessages({
      projectId: req.params.projectId,
      userId: req.user.id,
      query: req.query || {},
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/projects/:projectId/messages
 * Body: { body: string } — non-empty, max 2000 chars.
 * Allowed after cancel for dispute context.
 */
async function postMessage(req, res, next) {
  try {
    const result = await chat.postMessage({
      projectId: req.params.projectId,
      userId: req.user.id,
      body: req.body || {},
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listMessages,
  postMessage,
};
