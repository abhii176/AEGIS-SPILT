const { prisma } = require('../lib/prisma');
const { resolveKycProvider, digilocker, stripeIdentity } = require('../services/kyc');

/**
 * POST /api/auth/verify-identity
 * Starts DigiLocker OAuth (IN) or Stripe Identity / regional verifier (elsewhere).
 * Country/locale come from request body, falling back to the authenticated user profile.
 */
async function startVerifyIdentity(req, res, next) {
  try {
    const user = req.user;
    const countryCode = req.body?.countryCode || req.body?.country || user.countryCode;
    const locale = req.body?.locale || user.locale;

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
 * DigiLocker OAuth callback scaffold — sets gov_id_verified + kyc_provider.
 */
async function digilockerCallback(req, res, next) {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      return res.status(400).json({
        error: 'digilocker_oauth_error',
        message: errorDescription || String(error),
      });
    }

    const result = await digilocker.exchangeCodeAndVerify({
      code: code ? String(code) : '',
      state: state ? String(state) : '',
    });

    if (!result.verified) {
      return res.status(400).json({ error: 'verification_failed', provider: digilocker.PROVIDER });
    }

    const user = await prisma.user.update({
      where: { id: result.userId },
      data: {
        govIdVerified: true,
        kycProvider: digilocker.PROVIDER,
      },
    });

    return res.status(200).json({
      ok: true,
      provider: digilocker.PROVIDER,
      gov_id_verified: user.govIdVerified,
      kyc_provider: user.kycProvider,
      scaffold: result.scaffold === true,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/auth/verify-identity/callback/stripe
 * Stripe Identity (or regional) return URL scaffold — sets gov_id_verified + kyc_provider.
 */
async function stripeIdentityCallback(req, res, next) {
  try {
    const sessionId = String(req.query.session_id || req.query.sessionId || '');
    const userId = String(req.query.user_id || req.query.userId || req.header('x-user-id') || '');

    const result = await stripeIdentity.completeVerification({ sessionId, userId });

    if (!result.verified) {
      return res.status(400).json({
        error: 'verification_failed',
        provider: stripeIdentity.PROVIDER,
      });
    }

    const user = await prisma.user.update({
      where: { id: result.userId },
      data: {
        govIdVerified: true,
        kycProvider: stripeIdentity.PROVIDER,
      },
    });

    return res.status(200).json({
      ok: true,
      provider: stripeIdentity.PROVIDER,
      gov_id_verified: user.govIdVerified,
      kyc_provider: user.kycProvider,
      session_id: result.sessionId,
      scaffold: result.scaffold === true,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  startVerifyIdentity,
  digilockerCallback,
  stripeIdentityCallback,
};
