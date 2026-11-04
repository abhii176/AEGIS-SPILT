const digilocker = require('./digilocker');
const stripeIdentity = require('./stripeIdentity');

/**
 * Route KYC by country/locale.
 * India (IN) → DigiLocker only.
 * All other countries → Stripe Identity scaffold (or replace with a regional gov-ID verifier).
 */
function resolveKycProvider({ countryCode, locale }) {
  const code = String(countryCode || '')
    .trim()
    .toUpperCase();

  if (code === 'IN' || code === 'IND') {
    return {
      provider: digilocker.PROVIDER,
      countryCode: 'IN',
      locale: locale || 'en-IN',
      adapter: digilocker,
    };
  }

  return {
    provider: stripeIdentity.PROVIDER,
    countryCode: code || null,
    locale: locale || 'en',
    adapter: stripeIdentity,
  };
}

module.exports = {
  resolveKycProvider,
  digilocker,
  stripeIdentity,
};
