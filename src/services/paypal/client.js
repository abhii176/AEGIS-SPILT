const { env } = require('../../config/env');

/**
 * Thin PayPal REST client (OAuth + JSON).
 * Inject `fetchImpl` in tests to mock HTTP without hitting sandbox.
 */
function getBaseUrl(mode = env.paypal.mode) {
  const normalized = String(mode || 'sandbox').toLowerCase();
  if (normalized === 'live' || normalized === 'production') {
    return 'https://api-m.paypal.com';
  }
  return 'https://api-m.sandbox.paypal.com';
}

function createPaypalClient({
  clientId = env.paypal.clientId,
  clientSecret = env.paypal.clientSecret,
  mode = env.paypal.mode,
  mock = env.paypal.mock,
  fetchImpl = globalThis.fetch,
} = {}) {
  let cachedToken = null;
  let cachedExpiresAt = 0;

  function looksLikePlaceholder(value) {
    const v = String(value || '').trim().toLowerCase();
    return !v || v.startsWith('your_') || v.includes('placeholder');
  }

  function isMock() {
    if (mock === true || String(mock).toLowerCase() === 'true' || mock === '1') {
      return true;
    }
    // Empty or .env.example placeholders → mock so local/hackathon boot without secrets
    return looksLikePlaceholder(clientId) || looksLikePlaceholder(clientSecret);
  }

  async function getAccessToken() {
    if (isMock()) {
      return 'mock-access-token';
    }
    if (!clientId || !clientSecret) {
      const err = new Error('PayPal credentials missing (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
      err.status = 500;
      err.code = 'paypal_config_missing';
      throw err;
    }
    if (!fetchImpl) {
      const err = new Error('fetch is not available; use Node 18+ or inject fetchImpl');
      err.status = 500;
      err.code = 'paypal_fetch_unavailable';
      throw err;
    }

    const now = Date.now();
    if (cachedToken && now < cachedExpiresAt - 30_000) {
      return cachedToken;
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetchImpl(`${getBaseUrl(mode)}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error_description || body?.message || 'PayPal OAuth failed');
      err.status = res.status;
      err.code = 'paypal_oauth_failed';
      err.details = body;
      throw err;
    }

    cachedToken = body.access_token;
    cachedExpiresAt = now + Number(body.expires_in || 300) * 1000;
    return cachedToken;
  }

  async function request(method, path, { body, headers = {}, idempotencyKey } = {}) {
    if (isMock()) {
      return { mock: true, method, path, body };
    }

    const token = await getAccessToken();
    const res = await fetchImpl(`${getBaseUrl(mode)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}),
        ...headers,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!res.ok) {
      const err = new Error(parsed?.message || parsed?.error_description || `PayPal ${method} ${path} failed`);
      err.status = res.status;
      err.code = 'paypal_api_error';
      err.details = parsed;
      throw err;
    }

    return parsed;
  }

  return {
    isMock,
    getBaseUrl: () => getBaseUrl(mode),
    getAccessToken,
    request,
    clearTokenCache() {
      cachedToken = null;
      cachedExpiresAt = 0;
    },
  };
}

module.exports = { createPaypalClient, getBaseUrl };
