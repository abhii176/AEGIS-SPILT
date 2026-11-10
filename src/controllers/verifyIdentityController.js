const { prisma } = require('../lib/prisma');
const { resolveKycProvider, digilocker, stripeIdentity } = require('../services/kyc');
const { validateVerifyIdentityBody } = require('../lib/requestValidation');

/**
 * POST /api/auth/verify-identity
 * Starts DigiLocker OAuth (IN) or Stripe Identity / regional verifier (elsewhere).
 * Country/locale come from request body, falling back to the authenticated user profile.
 */
async function startVerifyIdentity(req, res, next) {
  try {
    const user = req.user;
    const validation = validateVerifyIdentityBody(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.errors[0],
        message: 'Invalid verify-identity payload.',
      });
    }

    const countryCode = validation.countryCode || user.countryCode;
    const locale = validation.locale || user.locale;

    if (!countryCode) {
      return res.status(400).json({
        error: 'country_required',
        message: 'Provide countryCode in the body or set it on the user profile.',
      });
    }

    // Persist country/locale if provided so future gates use the profile.
    if (
      (req.body?.countryCode || req.body?.country || req.body?.locale) &&
      (countryCode !== user.countryCode || locale !== user.locale)
    ) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          countryCode: String(countryCode).toUpperCase().slice(0, 2),
          ...(locale ? { locale: String(locale) } : {}),
        },
      });
    }

    const resolved = resolveKycProvider({ countryCode, locale });

    if (resolved.provider === digilocker.PROVIDER) {
      const state = digilocker.createState(user.id);
      const authorizeUrl = digilocker.buildAuthorizeUrl({ userId: user.id, state });
      return res.status(200).json({
        provider: resolved.provider,
        countryCode: resolved.countryCode,
        flow: 'oauth',
        authorizeUrl,
        next: 'Redirect the user to authorizeUrl, then DigiLocker returns to GET /api/auth/verify-identity/callback/digilocker',
      });
    }

    const session = stripeIdentity.buildVerificationSession({
      userId: user.id,
      countryCode: resolved.countryCode,
      locale: resolved.locale,
    });

    return res.status(200).json({
      provider: resolved.provider,
      countryCode: resolved.countryCode,
      flow: 'hosted_verification',
      sessionId: session.sessionId,
      verificationUrl: session.url,
      scaffold: session.scaffold,
      next: 'Send the user to verificationUrl; on completion they hit GET /api/auth/verify-identity/callback/stripe',
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/auth/verify-identity/callback/digilocker
 * Refused. The demo sandbox is the only path that sets the ID flag.
 */
async function digilockerCallback(_req, res) {
  return res.status(400).json({
    error: 'sandbox_required',
    message:
      'This callback does not verify an ID. Use the DigiLocker-style sandbox on the Verify step.',
  });
}

/**
 * GET /api/auth/verify-identity/callback/stripe
 * Refused. Stripe Identity is roadmap and does not set the ID flag.
 */
async function stripeIdentityCallback(_req, res) {
  return res.status(400).json({
    error: 'sandbox_required',
    message:
      'Stripe Identity is not connected. Use the DigiLocker-style sandbox on the Verify step.',
  });
}

module.exports = {
  startVerifyIdentity,
  digilockerCallback,
  stripeIdentityCallback,
};
