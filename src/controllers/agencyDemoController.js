const { prisma } = require('../lib/prisma');
const { loadAgencyDashboard, seedAgencyDemo } = require('../services/agency/agencyDemo');

/** GET /api/admin/demo/agency — read-only preview. Demo key, no KYC, no money movement. */
async function getAgencyPreview(req, res, next) {
  try {
    const dashboard = await loadAgencyDashboard(prisma);
    return res.status(200).json(dashboard);
  } catch (err) {
    return next(err);
  }
}

/** POST /api/admin/demo/agency/seed — idempotent sample roster and projects. */
async function seedAgencyPreview(req, res, next) {
  try {
    const seed = await seedAgencyDemo(prisma);
    const dashboard = await loadAgencyDashboard(prisma);
    return res.status(200).json({ ok: true, seed, dashboard });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getAgencyPreview,
  seedAgencyPreview,
};
