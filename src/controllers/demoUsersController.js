const { prisma } = require('../lib/prisma');
const { env } = require('../config/env');
const { summarizeProgress } = require('../services/kyc/sandbox');

const DEMO_PERSONAS = [
  {
    key: 'sarah',
    email: 'sarah.client@aegis-split.demo',
    name: 'Sarah Chen',
    role: 'CLIENT',
    countryCode: 'US',
    locale: 'en',
    paypalEmail: 'sarah-sandbox@example.com',
  },
  {
    key: 'rohan',
    email: 'rohan.freelancer@aegis-split.demo',
    name: 'Rohan Mehta',
    role: 'FREELANCER',
    countryCode: 'IN',
    locale: 'en',
    paypalEmail: 'rohan-sandbox@example.com',
  },
  {
    key: 'maya',
    email: 'maya.counselor@aegis-split.demo',
    name: 'Maya Rao',
    role: 'COUNSELOR',
    countryCode: 'US',
    locale: 'en',
    paypalEmail: 'maya-sandbox@example.com',
  },
];

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    countryCode: user.countryCode,
    locale: user.locale,
    paypalEmail: user.paypalEmail,
    govIdVerified: user.govIdVerified,
    kycProvider: user.kycProvider,
    kycMethod: user.kycMethod || null,
    kycVerifiedAt: user.kycVerifiedAt || null,
    kycMaskedId: user.kycMaskedId || null,
    kycIdLast4: user.kycIdLast4 || null,
    kycPhoneLast4: user.kycPhoneLast4 || null,
    kycSandbox: summarizeProgress(user),
    monitoringConsentGranted: user.monitoringConsentGranted,
    createdAt: user.createdAt,
  };
}

/**
 * Middleware: demo admin key only (no X-User-Id) — used to seed Sarah/Rohan before auth exists.
 */
function requireDemoAdminKey(req, res, next) {
  const key = req.header('x-demo-admin-key') || req.body?.demoAdminKey || req.query?.demoAdminKey;
  if (!key || key !== env.demoAdminKey) {
    return res.status(403).json({
      error: 'demo_admin_forbidden',
      message: 'Provide X-Demo-Admin-Key matching DEMO_ADMIN_KEY.',
    });
  }
  return next();
}

/**
 * POST /api/admin/demo/users/seed
 * Upsert Sarah (client) + Rohan (freelancer) for the hackathon walkthrough.
 */
async function seedDemoUsers(req, res, next) {
  try {
    const users = [];
    for (const persona of DEMO_PERSONAS) {
      const user = await prisma.user.upsert({
        where: { email: persona.email },
        create: {
          email: persona.email,
          name: persona.name,
          role: persona.role,
          countryCode: persona.countryCode,
          locale: persona.locale,
          paypalEmail: persona.paypalEmail,
        },
        update: {
          name: persona.name,
          role: persona.role,
          countryCode: persona.countryCode,
          locale: persona.locale,
          paypalEmail: persona.paypalEmail,
        },
      });
      users.push({ key: persona.key, ...publicUser(user) });
    }

    return res.status(200).json({
      ok: true,
      users,
      note: 'Sarah (CLIENT), Rohan (FREELANCER), and Maya (COUNSELOR) ready. Use their id as X-User-Id. Maya, or the demo admin key, can open disputes.',
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/admin/demo/users
 * List seeded demo personas (or all users when ?all=1).
 */
async function listDemoUsers(req, res, next) {
  try {
    const all = req.query?.all === '1' || req.query?.all === 'true';
    if (all) {
      const rows = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
      return res.status(200).json({ users: rows.map(publicUser) });
    }

    const emails = DEMO_PERSONAS.map((p) => p.email);
    const rows = await prisma.user.findMany({
      where: { email: { in: emails } },
      orderBy: { createdAt: 'asc' },
    });
    const byEmail = new Map(rows.map((u) => [u.email, u]));
    const users = DEMO_PERSONAS.map((p) => {
      const u = byEmail.get(p.email);
      return u ? { key: p.key, ...publicUser(u) } : { key: p.key, seeded: false, email: p.email };
    });

    return res.status(200).json({ users });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  seedDemoUsers,
  listDemoUsers,
  requireDemoAdminKey,
  publicUser,
  DEMO_PERSONAS,
};
