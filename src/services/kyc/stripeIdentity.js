const crypto = require('crypto');
const { env } = require('../../config/env');

const PROVIDER = 'stripe_identity';

/**
 * Stripe Identity (or regional equivalent) scaffold for non-India users.
 * Swap this module for a country-local gov-ID verifier when one is preferred.
 */
function buildVerificationSession({ userId, countryCode, locale }) {
  const sessionId = `vs_scaffold_${crypto.randomBytes(12).toString('hex')}`;
  const returnUrl = new URL(env.stripe.identityReturnUrl);
  returnUrl.searchParams.set('session_id', sessionId);
  returnUrl.searchParams.set('user_id', userId);

  // Scaffold: real implementation would call Stripe Identity API:
  // POST https://api.stripe.com/v1/identity/verification_sessions
  // Authorization: Bearer ${env.stripe.secretKey}
  return {
    provider: PROVIDER,
    sessionId,
    countryCode: countryCode || null,
    locale: locale || 'en',
    url: returnUrl.toString(),
    scaffold: true,
    note: 'VerificationSession create not executed; wire STRIPE_SECRET_KEY and enable live Identity API calls in production.',
  };
}

/**
 * Handle return/callback after the user completes Identity verification (scaffold).
 */
async function completeVerification({ sessionId, userId }) {
  if (!sessionId || !userId) {
    const err = new Error('Missing session_id or user_id for Stripe Identity callback');
    err.status = 400;
    throw err;
  }

  // Scaffold: retrieve VerificationSession and confirm status === 'verified'
  return {
    userId,
    provider: PROVIDER,
    sessionId,
    verified: true,
    scaffold: true,
    note: 'Session status not fetched from Stripe; treating scaffold callback as verified.',
  };
}

module.exports = {
  PROVIDER,
  buildVerificationSession,
  completeVerification,
};
