require('dotenv').config();

/**
 * Env helpers — never hard-code secrets. All KYC credentials come from placeholders in .env.
 */
function optional(name, fallback = '') {
  return process.env[name] || fallback;
}

const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appBaseUrl: optional('APP_BASE_URL', 'http://localhost:3000'),
  databaseUrl: optional('DATABASE_URL'),

  digilocker: {
    clientId: optional('DIGILOCKER_CLIENT_ID'),
    clientSecret: optional('DIGILOCKER_CLIENT_SECRET'),
    authUrl: optional(
      'DIGILOCKER_AUTH_URL',
      'https://api.digitallocker.gov.in/public/oauth2/1/authorize'
    ),
    tokenUrl: optional(
      'DIGILOCKER_TOKEN_URL',
      'https://api.digitallocker.gov.in/public/oauth2/1/token'
    ),
    redirectUri: optional(
      'DIGILOCKER_REDIRECT_URI',
      'http://localhost:3000/api/auth/verify-identity/callback/digilocker'
    ),
  },

  stripe: {
    secretKey: optional('STRIPE_SECRET_KEY'),
    identityReturnUrl: optional(
      'STRIPE_IDENTITY_RETURN_URL',
      'http://localhost:3000/api/auth/verify-identity/callback/stripe'
    ),
  },

  monitoringConsentVersion: optional('MONITORING_CONSENT_VERSION', '1.0.0'),
  defaultMilestoneCurrency: optional('DEFAULT_MILESTONE_CURRENCY', 'USD'),
};

module.exports = { env };
