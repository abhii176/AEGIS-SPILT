const assert = require('assert');
const { resolveKycProvider } = require('./index');
const { requireKycAndConsent } = require('../../middleware/requireKycAndConsent');

function testResolveIndia() {
  const r = resolveKycProvider({ countryCode: 'IN', locale: 'en-IN' });
  assert.strictEqual(r.provider, 'digilocker');
  assert.strictEqual(r.countryCode, 'IN');
}

function testResolveInternational() {
  const r = resolveKycProvider({ countryCode: 'US', locale: 'en-US' });
  assert.strictEqual(r.provider, 'stripe_identity');
}

function testGateBlocksPartial() {
  const cases = [
    { govIdVerified: false, monitoringConsentGranted: false },
    { govIdVerified: true, monitoringConsentGranted: false },
    { govIdVerified: false, monitoringConsentGranted: true },
  ];

  for (const user of cases) {
    const req = { user };
    let status = null;
    let body = null;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    let nextCalled = false;
    requireKycAndConsent(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(status, 403);
    assert.strictEqual(body.error, 'kyc_or_consent_required');
  }
}

function testGateAllowsBothTrue() {
  const req = { user: { govIdVerified: true, monitoringConsentGranted: true } };
  let nextCalled = false;
  requireKycAndConsent(req, {}, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
}

testResolveIndia();
testResolveInternational();
testGateBlocksPartial();
testGateAllowsBothTrue();
console.log('kyc + consent gate smoke tests passed');
