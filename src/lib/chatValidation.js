/**
 * Pure validators for project chat payloads.
 */

const BODY_MAX = 2000;
const LIST_LIMIT_DEFAULT = 100;
const LIST_LIMIT_MAX = 200;

function validateChatMessageBody(body = {}) {
  const errors = [];
  const raw = body.body ?? body.message ?? body.text;
  if (raw == null || typeof raw !== 'string' || !raw.trim()) {
    errors.push('body_required');
    return { ok: false, errors, body: null };
  }
  const trimmed = raw.trim();
  if (trimmed.length > BODY_MAX) {
    errors.push('body_too_long');
    return { ok: false, errors, body: null };
  }
  return { ok: true, errors, body: trimmed };
}

function parseListLimit(query = {}) {
  const raw = query.limit ?? query.take;
  if (raw == null || raw === '') return LIST_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return LIST_LIMIT_DEFAULT;
  return Math.min(n, LIST_LIMIT_MAX);
}

module.exports = {
  BODY_MAX,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  validateChatMessageBody,
  parseListLimit,
};
