const { prisma } = require('../lib/prisma');
const { env } = require('../config/env');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * POST /api/consent/monitoring
 * Records ConsentLogs (timestamp + IP) and sets monitoring_consent_granted=true.
 * Consent acknowledges that on-platform chats and call recordings may be monitored/
 * accessed for dispute resolution and counseling.
 */
async function recordMonitoringConsent(req, res, next) {
  try {
    const user = req.user;
    const version = String(req.body?.consentVersion || env.monitoringConsentVersion);
    const accepted = req.body?.accepted === true || req.body?.accepted === 'true';

    if (!accepted) {
      return res.status(400).json({
        error: 'acceptance_required',
        message:
          'You must explicitly accept monitoring of on-platform chats and call recordings for dispute resolution and counseling (accepted: true).',
      });
    }

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
            tosSummary:
              'User agrees that on-platform chats and call recordings will be monitored/accessed for dispute resolution and counseling.',
            source: 'POST /api/consent/monitoring',
          },
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { monitoringConsentGranted: true },
      }),
    ]);

    return res.status(201).json({
      ok: true,
      monitoring_consent_granted: updatedUser.monitoringConsentGranted,
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

module.exports = { recordMonitoringConsent, clientIp };
