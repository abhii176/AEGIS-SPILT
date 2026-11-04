const crypto = require('crypto');
const { env } = require('../../config/env');

const PROVIDER = 'digilocker';

/**
 * DigiLocker OAuth scaffold for Indian users (countryCode === 'IN').
 * Uses env placeholders only — no real secrets in code.
 */
function buildAuthorizeUrl({ userId, state }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.digilocker.clientId || 'DIGILOCKER_CLIENT_ID_PLACEHOLDER',
    redirect_uri: env.digilocker.redirectUri,
    state: state || createState(userId),
    // Request Aadhaar / identity documents scope as configured with DigiLocker
    scope: 'openid',
  });

  return `${env.digilocker.authUrl}?${params.toString()}`;
}

function createState(userId) {
  const nonce = crypto.randomBytes(16).toString('hex');
  return Buffer.from(JSON.stringify({ userId, nonce, provider: PROVIDER })).toString('base64url');
}

function parseState(state) {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Exchange authorization code for tokens (scaffold — does not call DigiLocker yet).
 * Returns a structured result so the callback can mark the user verified.
 */
async function exchangeCodeAndVerify({ code, state }) {
  const parsed = parseState(state);
  if (!parsed?.userId) {
    const err = new Error('Invalid DigiLocker OAuth state');
    err.status = 400;
    throw err;
  }

  if (!code) {
    const err = new Error('Missing DigiLocker authorization code');
    err.status = 400;
    throw err;
  }

  // Scaffold: real implementation would POST to env.digilocker.tokenUrl with
  // client_id / client_secret / code / redirect_uri, then fetch identity docs.
  // We deliberately do not perform network calls with placeholder secrets here.
  return {
    userId: parsed.userId,
    provider: PROVIDER,
    verified: true,
    scaffold: true,
    note: 'Token exchange + document fetch not executed; wire DIGILOCKER_* env vars and enable live calls in production.',
  };
}

module.exports = {
  PROVIDER,
  buildAuthorizeUrl,
  createState,
  parseState,
  exchangeCodeAndVerify,
};
