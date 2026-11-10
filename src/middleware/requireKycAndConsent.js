/**
 * Blocks create-project, fund-vault, and merge-code unless BOTH flags are strictly true.
 * Apply to those route groups after requireAuth.
 */
function requireKycAndConsent(req, res, next) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication required.' });
  }

  const govIdVerified = user.govIdVerified === true;
  const monitoringConsentGranted = user.monitoringConsentGranted === true;

  if (!govIdVerified || !monitoringConsentGranted) {
    return res.status(403).json({
      error: 'kyc_or_consent_required',
      message:
        'Government ID verification and monitoring consent are required before creating a project, funding a vault, or merging code.',
      requirements: {
        gov_id_verified: govIdVerified,
        monitoring_consent_granted: monitoringConsentGranted,
      },
      actions: {
        verifyIdentity: 'POST /api/auth/kyc/sandbox/digilocker/confirm',
        quickVerify: 'POST /api/auth/kyc/sandbox/quick',
        recordMonitoringConsent: 'POST /api/consent/monitoring',
      },
    });
  }

  return next();
}

module.exports = { requireKycAndConsent };
