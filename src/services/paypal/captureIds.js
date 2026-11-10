/**
 * PayPal capture ids are not order ids. Refunds go to
 * /v2/payments/captures/{capture_id}/refund — an order id there is RESOURCE_NOT_FOUND.
 */

const ESCROW_NEVER_FUNDED_MESSAGE =
  "This project's escrow was never funded through PayPal, so there is no money to release or refund. The decision was recorded.";

const ESCROW_NOT_READY_NOTE =
  "This project's escrow was never funded through PayPal, so there is no money to release or refund.";

const PAYPAL_RETRY_MESSAGE =
  'PayPal could not move the money just now. Nothing was charged twice. Try again in a moment.';

function captureIdFromPaypalBody(body) {
  const units = body?.purchase_units || [];
  for (const unit of units) {
    const captures = unit?.payments?.captures || [];
    if (captures[0]?.id) return String(captures[0].id);
  }
  return null;
}

/**
 * A capture id that is missing or identical to the order id cannot be refunded.
 * PayPal order ids and capture ids are different resources.
 */
function usableCaptureId({ captureId, orderId } = {}) {
  if (!captureId) return null;
  const capture = String(captureId);
  if (orderId && capture === String(orderId)) return null;
  return capture;
}

function paypalIssue(err) {
  const details = err?.details;
  if (!details || typeof details !== 'object') return null;
  const nested = Array.isArray(details.details) ? details.details[0] : null;
  return details.name || nested?.issue || null;
}

function isPaypalResourceNotFound(err) {
  if (!err) return false;
  const issue = String(paypalIssue(err) || '');
  if (issue === 'RESOURCE_NOT_FOUND' || issue === 'INVALID_RESOURCE_ID') return true;
  if (err.status === 404 && (err.code === 'paypal_api_error' || err.code === 'paypal_oauth_failed')) {
    return true;
  }
  return /specified resource does not exist/i.test(String(err.message || ''));
}

function isPaypalApiError(err) {
  return Boolean(err && (err.code === 'paypal_api_error' || err.code === 'paypal_oauth_failed'));
}

function isDuplicatePayoutBatch(err) {
  const issue = String(paypalIssue(err) || '');
  if (/SENDER_BATCH_ID|DUPLICATE/i.test(issue)) return true;
  return /sender_batch_id already exists|batch with given sender batch id already exists/i.test(
    String(err?.message || '')
  );
}

/**
 * Never forward PayPal's raw message or debug_id to the client.
 * Returns the same error when it is not a PayPal API failure.
 */
function toFriendlyPaypalError(err) {
  if (!err || err.code === 'paypal_unavailable' || err.code === 'escrow_not_funded') return err;
  if (!isPaypalApiError(err) && !isPaypalResourceNotFound(err)) return err;
  if (isPaypalResourceNotFound(err)) {
    const wrapped = new Error(ESCROW_NEVER_FUNDED_MESSAGE);
    wrapped.status = 409;
    wrapped.code = 'escrow_not_funded';
    wrapped.paypalIssue = 'RESOURCE_NOT_FOUND';
    return wrapped;
  }
  const wrapped = new Error(PAYPAL_RETRY_MESSAGE);
  wrapped.status = 422;
  wrapped.code = 'paypal_unavailable';
  wrapped.paypalIssue = paypalIssue(err) || 'PAYPAL_ERROR';
  return wrapped;
}

module.exports = {
  ESCROW_NEVER_FUNDED_MESSAGE,
  ESCROW_NOT_READY_NOTE,
  PAYPAL_RETRY_MESSAGE,
  captureIdFromPaypalBody,
  usableCaptureId,
  paypalIssue,
  isPaypalResourceNotFound,
  isPaypalApiError,
  isDuplicatePayoutBatch,
  toFriendlyPaypalError,
};
