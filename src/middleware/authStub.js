const { prisma } = require('../lib/prisma');

/**
 * Temporary auth stub for scaffolding.
 * Pass `X-User-Id` (cuid of an existing User) until real session/JWT auth lands.
 */
async function requireAuth(req, res, next) {
  try {
    const userId = req.header('x-user-id') || req.body?.userId || req.query?.userId;
    if (!userId) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Provide X-User-Id header (auth stub) until sessions are wired.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: String(userId) } });
    if (!user) {
      return res.status(401).json({ error: 'unauthorized', message: 'User not found.' });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth };
