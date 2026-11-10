const { service } = require('../services/kyc/sandboxService');

function send(res, result) {
  const status = result.status || (result.ok ? 200 : 400);
  return res.status(status).json(result.body || { error: 'kyc_sandbox_failed' });
}

function wrap(method) {
  return async function kycSandboxHandler(req, res, next) {
    try {
      const result = await method(req.user, req.body || {});
      return send(res, result);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  getSandboxHint: async function getSandboxHint(req, res, next) {
    try {
      return send(res, service.hint(req.user));
    } catch (err) {
      return next(err);
    }
  },
  emailStart: wrap((user, body) => service.emailStart(user, body)),
  emailConfirm: wrap((user, body) => service.emailConfirm(user, body)),
  phoneStart: wrap((user, body) => service.phoneStart(user, body)),
  phoneConfirm: wrap((user, body) => service.phoneConfirm(user, body)),
  digilockerStart: wrap((user, body) => service.digilockerStart(user, body)),
  digilockerConfirm: wrap((user, body) => service.digilockerConfirm(user, body)),
  quickVerify: wrap((user) => service.quick(user)),
};
