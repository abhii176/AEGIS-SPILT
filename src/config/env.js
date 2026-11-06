require('dotenv').config();

/**
 * Env helpers — never hard-code secrets. All KYC credentials come from placeholders in .env.
 */
function optional(name, fallback = '') {
  return process.env[name] || fallback;
}

/**
 * Public origin for PayPal return/cancel and absolute links.
 * Prefer APP_BASE_URL; else host-injected public URL (Render / Railway / Fly).
 */
function resolveAppBaseUrl() {
  const explicit = optional('APP_BASE_URL');
  if (explicit) return explicit.replace(/\/$/, '');

  const renderUrl = optional('RENDER_EXTERNAL_URL');
  if (renderUrl) return renderUrl.replace(/\/$/, '');

  const renderHost = optional('RENDER_EXTERNAL_HOSTNAME');
  if (renderHost) return `https://${renderHost.replace(/\/$/, '')}`;

  const railwayDomain = optional('RAILWAY_PUBLIC_DOMAIN');
  if (railwayDomain) return `https://${railwayDomain.replace(/\/$/, '')}`;

  const flyApp = optional('FLY_APP_NAME');
  if (flyApp) return `https://${flyApp}.fly.dev`;

  return 'http://localhost:3000';
}

const appBaseUrl = resolveAppBaseUrl();

const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appBaseUrl,
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

  paypal: {
    clientId: optional('PAYPAL_CLIENT_ID'),
    clientSecret: optional('PAYPAL_CLIENT_SECRET'),
    /// sandbox | live — base URL for REST calls
    mode: optional('PAYPAL_MODE', 'sandbox'),
    /// true | false | null (unset). null → client may mock when credentials look like placeholders.
    /// Explicit false never silent-mocks (Render live sandbox path).
    mock: (() => {
      const raw = optional('PAYPAL_MOCK', '');
      if (raw === '') return null;
      const v = String(raw).toLowerCase();
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0') return false;
      return null;
    })(),
    /// Default false: create order → buyer approves → capture on return (avoids ORDER_NOT_APPROVED).
    /// Set PAYPAL_AUTO_CAPTURE=true only for mock/local demos that skip the approve redirect.
    autoCapture:
      String(optional('PAYPAL_AUTO_CAPTURE', 'false')).toLowerCase() === 'true' ||
      optional('PAYPAL_AUTO_CAPTURE') === '1',
    /// PayPal buyer return/cancel URLs (Orders application_context)
    returnUrl: optional('PAYPAL_RETURN_URL', `${appBaseUrl}/api/vault/paypal/return`),
    cancelUrl: optional('PAYPAL_CANCEL_URL', `${appBaseUrl}/api/vault/paypal/cancel`),
    /// Optional sandbox personal (buyer) email for demo docs — never a password
    buyerEmail: optional('PAYPAL_BUYER_EMAIL'),
    /// Optional default payout recipient when freelancer.paypalEmail unset
    payoutEmail: optional('PAYPAL_PAYOUT_EMAIL'),
  },

  /// Shared secret for POST /api/admin/demo/... hackathon triggers (header X-Demo-Admin-Key)
  demoAdminKey: optional('DEMO_ADMIN_KEY', 'hackathon-demo-key'),

  github: {
    /// HMAC secret for X-Hub-Signature-256 on POST /api/webhooks/github
    webhookSecret: optional('GITHUB_WEBHOOK_SECRET'),
    /// PAT or installation token to fetch PR diffs (optional when demo stubs a diff)
    token: optional('GITHUB_TOKEN'),
    apiBaseUrl: optional('GITHUB_API_BASE_URL', 'https://api.github.com'),
    /// Optional GitHub App placeholders (wire later; webhook HMAC still uses webhookSecret)
    appId: optional('GITHUB_APP_ID'),
    appPrivateKey: optional('GITHUB_APP_PRIVATE_KEY'),
    appInstallationId: optional('GITHUB_APP_INSTALLATION_ID'),
  },

  /// Milestone AI auditor — LLM when keys set; else deterministic heuristics
  ai: {
    /// auto | openai | anthropic | deterministic
    provider: optional('AI_AUDITOR_PROVIDER', 'auto'),
    openaiApiKey: optional('OPENAI_API_KEY'),
    anthropicApiKey: optional('ANTHROPIC_API_KEY'),
    openaiModel: optional('OPENAI_MODEL', 'gpt-4o-mini'),
    anthropicModel: optional('ANTHROPIC_MODEL', 'claude-3-5-haiku-latest'),
  },
};

module.exports = { env };
