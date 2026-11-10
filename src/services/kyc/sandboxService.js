const { Prisma } = require('@prisma/client');
const { prisma: defaultPrisma } = require('../../lib/prisma');
const { publicUser } = require('../../controllers/demoUsersController');
const sandbox = require('./sandbox');

function toWriteData(data) {
  const next = { ...data };
  if (Object.prototype.hasOwnProperty.call(next, 'kycSandboxProgress') && next.kycSandboxProgress == null) {
    next.kycSandboxProgress = Prisma.DbNull;
  }
  return sandbox.assertNoFullId(next);
}

function attach(body, user) {
  const next = { ...body, user: publicUser(user) };
  if (body && body.govIdVerified && user && user.kycVerifiedAt) {
    next.kycVerifiedAt = user.kycVerifiedAt;
  }
  if (next.documents) sandbox.assertNoFullId(next.documents);
  return next;
}

function createSandboxService(prisma = defaultPrisma) {
  async function persist(user, decision) {
    if (!decision.ok) return decision;
    if (!decision.data) {
      return { ok: true, status: 200, body: attach(decision.body, user) };
    }
    const data = toWriteData(decision.data);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });
    return { ok: true, status: 200, body: attach(decision.body, updated) };
  }

  return {
    hint(user) {
      return { ok: true, status: 200, body: sandbox.sandboxHint(user) };
    },
    emailStart(user, body) {
      return persist(user, sandbox.stepEmailStart(user, body));
    },
    emailConfirm(user, body) {
      return persist(user, sandbox.stepEmailConfirm(user, body));
    },
    phoneStart(user, body) {
      return persist(user, sandbox.stepPhoneStart(user, body));
    },
    phoneConfirm(user, body) {
      return persist(user, sandbox.stepPhoneConfirm(user, body));
    },
    digilockerStart(user, body) {
      return persist(user, sandbox.stepDigilockerStart(user, body));
    },
    digilockerConfirm(user, body) {
      return persist(user, sandbox.stepDigilockerConfirm(user, body));
    },
    quick(user) {
      return persist(user, sandbox.stepQuick(user));
    },
  };
}

module.exports = {
  createSandboxService,
  service: createSandboxService(),
};
