const { rateLimit } = require('express-rate-limit');

/**
 * Sensible defaults for hackathon demo + production.
 * trust proxy is set on the app so X-Forwarded-For is used for IP keys.
 */
function createLimiter({ windowMs, max, message, code }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: code || 'rate_limit_exceeded',
      message: message || 'Too many requests. Please try again later.',
    },
  });
}

/** Auth / KYC start — abuse-prone */
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 40 : 120,
  code: 'auth_rate_limited',
  message: 'Too many auth requests. Try again in a few minutes.',
});

/** Vault fund / capture — money paths */
const vaultLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 30 : 100,
  code: 'vault_rate_limited',
  message: 'Too many vault requests. Try again in a few minutes.',
});

/** Milestone payout / release */
const payoutLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 80,
  code: 'payout_rate_limited',
  message: 'Too many payout requests. Try again in a few minutes.',
});

/** GitHub + PayPal webhooks — allow bursts from providers */
const webhookLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 120 : 300,
  code: 'webhook_rate_limited',
  message: 'Too many webhook requests.',
});

/** Admin demo seed / simulate / release */
const adminDemoLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 30 : 100,
  code: 'admin_demo_rate_limited',
  message: 'Too many admin demo requests. Try again in a few minutes.',
});

module.exports = {
  authLimiter,
  vaultLimiter,
  payoutLimiter,
  webhookLimiter,
  adminDemoLimiter,
};
