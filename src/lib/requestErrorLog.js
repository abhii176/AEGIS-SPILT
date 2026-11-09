/**
 * Server-side error logging and the JSON body returned to clients.
 * Prisma known-request errors (P2022 missing column, etc.) put the column on
 * err.meta. That meta is logged here and is never copied onto the client body.
 */

function prismaMeta(err) {
  if (!err || !err.meta || typeof err.meta !== 'object' || Array.isArray(err.meta)) {
    return null;
  }
  return err.meta;
}

function requestErrorLogRecord(err, req) {
  const meta = prismaMeta(err);
  return {
    method: req && req.method ? req.method : undefined,
    path: req ? req.originalUrl || req.url : undefined,
    code: err && err.code ? err.code : null,
    message: err && err.message ? String(err.message) : null,
    column: meta && meta.column != null ? meta.column : null,
    modelName: meta && (meta.modelName || meta.model) ? meta.modelName || meta.model : null,
    meta,
  };
}

/**
 * Client payload. Production 5xx responses stay generic so column names,
 * SQL, and stack traces are not returned to the browser.
 */
function publicErrorBody(err, { isProduction, status } = {}) {
  const message =
    isProduction && status >= 500
      ? 'Unexpected error'
      : (err && err.message) || 'Unexpected error';
  const body = {
    error: (err && err.code) || 'internal_error',
    message,
  };
  if (!isProduction && err && err.details) {
    body.details = err.details;
  }
  return body;
}

function logRequestError(err, req) {
  const record = requestErrorLogRecord(err, req);
  // One line Render can grep: code, missing column, model, path.
  // eslint-disable-next-line no-console
  console.error(
    '[api] request error code=%s column=%s model=%s path=%s',
    record.code,
    record.column,
    record.modelName,
    record.path
  );
  if (record.meta) {
    // eslint-disable-next-line no-console
    console.error('[api] prisma meta', record.meta);
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return record;
}

module.exports = {
  requestErrorLogRecord,
  publicErrorBody,
  logRequestError,
};
