const { prisma } = require('../lib/prisma');
const { env } = require('../config/env');
const { validateConsentBody } = require('../lib/requestValidation');
const {
  USER_CONSENT_AGREEMENT_VERSION,
  USER_CONSENT_AGREEMENT_TITLE,
  USER_CONSENT_AGREEMENT_MARKDOWN,
} = require('../lib/consentAgreement');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** GET /api/consent/agreement — public text of the User Consent Agreement */
async function getConsentAgreement(_req, res) {
  return res.status(200).json({
    title: USER_CONSENT_AGREEMENT_TITLE,
    version: USER_CONSENT_AGREEMENT_VERSION,
    markdown: USER_CONSENT_AGREEMENT_MARKDOWN,
  });
}

/**
 * POST /api/consent/monitoring
 * Records ConsentLogs (timestamp + IP + agreed name) for User Consent Agreement v2+
 * and sets monitoring_consent_granted=true (legacy gate field).
 */
async function recordMonitoringConsent(req, res, next) {
  try {
    const user = req.user;
    const validation = validateConsentBody(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.errors[0],
        message:
          validation.errors[0] === 'acceptance_required'
            ? 'You must tick “I agree” and accept the Aegis-Split User Consent Agreement (accepted: true).'
            : validation.errors[0] === 'agreed_name_required'
              ? 'Provide agreedName (your full name) with the agreement date.'
              : 'Invalid consent payload.',
      });
    }

    const version = String(
      validation.consentVersion || env.monitoringConsentVersion || USER_CONSENT_AGREEMENT_VERSION
    );
    const agreedName = validation.agreedName;
    const agreedDate =
      validation.agreedDate || new Date().toISOString().slice(0, 10);

    const ipAddress = clientIp(req);
    const userAgent = req.get('user-agent') || null;
    const agreedAt = new Date();

    const [consentLog, updatedUser] = await prisma.$transaction([
      prisma.consentLogs.create({
        data: {
          userId: user.id,
          consentType: 'MONITORING',
          consentVersion: version,
          agreedAt,
          ipAddress,
          userAgent,
          metadata: {
            title: USER_CONSENT_AGREEMENT_TITLE,
            agreedName,
            agreedDate,
            tosSummary:
              'User agrees to the Aegis-Split User Consent Agreement (identity, platform-only communication, exit/penalty rules, code of conduct, dispute resolution; includes monitoring of chats/calls).',
            source: 'POST /api/consent/monitoring',
          },
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          monitoringConsentGranted: true,
          ...(agreedName && !user.name ? { name: agreedName } : {}),
        },
      }),
    ]);

    return res.status(201).json({
      ok: true,
      monitoring_consent_granted: updatedUser.monitoringConsentGranted,
      agreement: {
        title: USER_CONSENT_AGREEMENT_TITLE,
        version,
        agreedName,
        agreedDate,
      },
      consentLog: {
        id: consentLog.id,
        consent_type: consentLog.consentType,
        consent_version: consentLog.consentVersion,
        agreed_at: consentLog.agreedAt,
        ip_address: consentLog.ipAddress,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  recordMonitoringConsent,
  getConsentAgreement,
  clientIp,
};
