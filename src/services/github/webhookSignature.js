const crypto = require('crypto');

/**
 * Verify GitHub webhook HMAC (X-Hub-Signature-256).
 * @param {Buffer|string} rawBody - exact request body bytes
 * @param {string|undefined} signatureHeader - e.g. "sha256=abc..."
 * @param {string} secret - GITHUB_WEBHOOK_SECRET
 * @returns {boolean}
 */
function verifyGithubSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader || typeof signatureHeader !== 'string') {
    return false;
  }
  if (!signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Build a valid X-Hub-Signature-256 header for tests / demo tooling.
 */
function signGithubPayload(rawBody, secret) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

module.exports = { verifyGithubSignature, signGithubPayload };
