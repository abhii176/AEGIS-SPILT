const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  KYC_METHOD,
  SANDBOX_OTP,
  DEMO_PROFILES,
  verhoeffCheckDigit,
  isValidVerhoeff,
  validateIdNumber,
  maskId,
  validatePhone,
  readProgress,
  mergeProgress,
  documentsFor,
  assertNoFullId,
  demoProfileForEmail,
  sandboxHint,
  stepEmailStart,
  stepEmailConfirm,
  stepPhoneStart,
  stepPhoneConfirm,
  stepDigilockerStart,
  stepDigilockerConfirm,
  stepQuick,
} = require('./sandbox');
const { createSandboxService } = require('./sandboxService');

function testVerhoeffKnownVector() {
  assert.strictEqual(verhoeffCheckDigit('236'), 3);
  assert.strictEqual(isValidVerhoeff('2363'), true);
  assert.strictEqual(isValidVerhoeff('2364'), false);
}

function testDemoIdsPassFormatAndChecksum() {
  for (const persona of DEMO_PROFILES) {
    const checked = validateIdNumber(persona.idNumber);
    assert.strictEqual(checked.ok, true, persona.key);
    assert.strictEqual(checked.digits, persona.idNumber);
    assert.strictEqual(isValidVerhoeff(persona.idNumber), true);
    const masked = maskId(persona.idNumber);
    assert.strictEqual(masked.maskedId, `XXXX XXXX ${persona.idNumber.slice(-4)}`);
    assert.strictEqual(masked.maskedId.includes(persona.idNumber), false);
  }
}

function testIdFormatRejections() {
  assert.strictEqual(validateIdNumber('12345').error, 'invalid_id_format');
  assert.strictEqual(validateIdNumber('1234567890123').error, 'invalid_id_format');
  assert.strictEqual(validateIdNumber('012345678901').error, 'invalid_id_format');
  assert.strictEqual(validateIdNumber('1234-5678-901').error, 'invalid_id_format');
  assert.strictEqual(validateIdNumber('abcdefghijkl').error, 'invalid_id_format');
  const sarah = DEMO_PROFILES[0].idNumber;
  const broken = `${sarah.slice(0, 11)}${sarah.endsWith('0') ? '1' : '0'}`;
  assert.notStrictEqual(broken, sarah);
  assert.strictEqual(validateIdNumber(broken).error, 'invalid_id_checksum');
  const spaced = `${sarah.slice(0, 4)} ${sarah.slice(4, 8)} ${sarah.slice(8)}`;
  assert.strictEqual(validateIdNumber(spaced).ok, true);
}

function testMaskAndPhone() {
  const sarah = demoProfileForEmail('sarah.client@aegis-split.demo');
  const masked = maskId(sarah.idNumber);
  assert.strictEqual(masked.last4, sarah.idNumber.slice(-4));
  assert.match(masked.maskedId, /^XXXX XXXX \d{4}$/);
  const phone = validatePhone(sarah.phone);
  assert.strictEqual(phone.ok, true);
  assert.strictEqual(phone.last4, '0142');
  assert.strictEqual(validatePhone('555-010').error, 'invalid_phone');
  assert.strictEqual(validatePhone('+91 98765 43210').last4, '3210');
}

function testProgressDropsFullId() {
  const full = DEMO_PROFILES[1].idNumber;
  const merged = mergeProgress(
    { idNumber: full, phone: '+919876543210', emailVerified: true },
    { digilockerIssued: true, idLast4: full.slice(-4), idNumber: full }
  );
  assert.strictEqual(merged.emailVerified, true);
  assert.strictEqual(merged.idLast4, full.slice(-4));
  assert.strictEqual(Object.hasOwn(merged, 'idNumber'), false);
  assert.strictEqual(JSON.stringify(merged).includes(full), false);
  assert.throws(() => assertNoFullId({ idNumber: full }), /full ID number/);
  assert.doesNotThrow(() => assertNoFullId(merged));
}

function testDocumentsAreMaskedDemoData() {
  const sarah = demoProfileForEmail('Sarah.Client@aegis-split.demo');
  const docs = documentsFor(
    { email: sarah.email, name: 'Sarah Chen' },
    sarah.idNumber.slice(-4)
  );
  assert.strictEqual(docs.maskedId, `XXXX XXXX ${sarah.idNumber.slice(-4)}`);
  assert.strictEqual(docs.name, 'Sarah Chen');
  assert.strictEqual(docs.dob, '1994-03-12');
  assert.match(docs.addressProof, /18 Market Street/);
  assert.strictEqual(docs.source, 'demo_data');
  assert.strictEqual(JSON.stringify(docs).includes(sarah.idNumber), false);
  assert.strictEqual(Object.hasOwn(docs, 'idNumber'), false);
  const guest = documentsFor({ email: 'guest@example.com', name: 'Guest' }, '4242');
  assert.strictEqual(guest.name, 'Guest');
  assert.strictEqual(guest.maskedId, 'XXXX XXXX 4242');
  assert.strictEqual(guest.address, '100 Demo Lane, Sandbox City');
}

function freshUser(profile, extra = {}) {
  return {
    id: 'user-test',
    email: profile.email,
    name: profile.name,
    govIdVerified: false,
    kycProvider: null,
    kycMethod: null,
    kycVerifiedAt: null,
    kycIdLast4: null,
    kycMaskedId: null,
    kycPhoneLast4: null,
    kycSandboxProgress: null,
    ...extra,
  };
}

function apply(user, decision) {
  assert.strictEqual(decision.ok, true, JSON.stringify(decision.body));
  if (decision.data) {
    assert.strictEqual(JSON.stringify(decision.data).includes(demoProfileForEmail(user.email).idNumber), false);
    assert.doesNotThrow(() => assertNoFullId(decision.data));
    Object.assign(user, decision.data);
  }
  return decision;
}

function testStepOrderAndMasking() {
  const profile = demoProfileForEmail('rohan.freelancer@aegis-split.demo');
  const user = freshUser(profile);
  const early = stepDigilockerStart(user, { idNumber: profile.idNumber });
  assert.strictEqual(early.ok, false);
  assert.strictEqual(early.body.error, 'step_out_of_order');

  const wrongEmail = stepEmailStart(user, { email: 'other@example.com' });
  assert.strictEqual(wrongEmail.body.error, 'email_mismatch');

  apply(user, stepEmailStart(user, { email: '  Rohan.Freelancer@aegis-split.demo ' }));
  const badOtp = stepEmailConfirm(user, { otp: '000000' });
  assert.strictEqual(badOtp.body.error, 'invalid_otp');
  apply(user, stepEmailConfirm(user, { otp: SANDBOX_OTP }));

  const badPhone = stepPhoneStart(user, { phone: '123' });
  assert.strictEqual(badPhone.body.error, 'invalid_phone');
  apply(user, stepPhoneStart(user, { phone: profile.phone }));
  assert.strictEqual(user.kycSandboxProgress.phoneLast4, '3210');
  assert.strictEqual(JSON.stringify(user.kycSandboxProgress).includes('9876543210'), false);
  apply(user, stepPhoneConfirm(user, { otp: Number(SANDBOX_OTP) }));

  const badId = stepDigilockerStart(user, { idNumber: '222222222222' });
  assert.strictEqual(badId.ok, false);
  apply(user, stepDigilockerStart(user, { idNumber: profile.idNumber }));
  assert.strictEqual(user.kycSandboxProgress.idLast4, profile.idNumber.slice(-4));
  assert.strictEqual(JSON.stringify(user.kycSandboxProgress).includes(profile.idNumber), false);
  assert.strictEqual(readProgress(user.kycSandboxProgress).digilockerIssued, true);

  const now = new Date('2026-11-10T08:00:00.000Z');
  const done = apply(user, stepDigilockerConfirm(user, { otp: SANDBOX_OTP }, now));
  assert.strictEqual(user.govIdVerified, true);
  assert.strictEqual(user.kycMethod, KYC_METHOD);
  assert.strictEqual(user.kycProvider, KYC_METHOD);
  assert.strictEqual(user.kycVerifiedAt.toISOString(), now.toISOString());
  assert.strictEqual(user.kycMaskedId, `XXXX XXXX ${profile.idNumber.slice(-4)}`);
  assert.strictEqual(user.kycIdLast4, profile.idNumber.slice(-4));
  assert.strictEqual(user.kycPhoneLast4, '3210');
  assert.strictEqual(user.kycSandboxProgress, null);
  assert.strictEqual(JSON.stringify(done.body).includes(profile.idNumber), false);
  assert.strictEqual(done.body.documents.name, 'Rohan Mehta');
  assert.match(done.body.documents.addressProof, /Bengaluru/);
}

function testChangingPhoneRequiresANewOtp() {
  const known = demoProfileForEmail('sarah.client@aegis-split.demo');
  const user = freshUser(known);
  apply(user, stepEmailStart(user, { email: known.email }));
  apply(user, stepEmailConfirm(user, { otp: SANDBOX_OTP }));
  apply(user, stepPhoneStart(user, { phone: known.phone }));
  apply(user, stepPhoneConfirm(user, { otp: SANDBOX_OTP }));
  apply(user, stepDigilockerStart(user, { idNumber: known.idNumber }));
  apply(user, stepPhoneStart(user, { phone: '+1 415 555 0199' }));
  assert.strictEqual(user.kycSandboxProgress.phoneLast4, '0199');
  assert.strictEqual(user.kycSandboxProgress.phoneVerified, false);
  assert.strictEqual(user.kycSandboxProgress.digilockerIssued, false);
  assert.strictEqual(user.kycSandboxProgress.idLast4, null);
  const blocked = stepDigilockerConfirm(user, { otp: SANDBOX_OTP });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.body.error, 'step_out_of_order');
  assert.strictEqual(JSON.stringify(user.kycSandboxProgress).includes('4155550199'), false);
}

function testQuickVerifySeededOnly() {
  const now = new Date('2026-11-10T09:00:00.000Z');
  for (const persona of DEMO_PROFILES) {
    const user = freshUser(persona);
    const done = apply(user, stepQuick(user, now));
    assert.strictEqual(done.body.quick, true);
    assert.strictEqual(user.kycMethod, KYC_METHOD);
    assert.strictEqual(user.govIdVerified, true);
    assert.strictEqual(user.kycMaskedId.startsWith('XXXX XXXX '), true);
    assert.strictEqual(JSON.stringify(user).includes(persona.idNumber), false);
    assert.strictEqual(JSON.stringify(done.body.documents).includes(persona.idNumber), false);
    const again = stepQuick(user);
    assert.strictEqual(again.body.alreadyVerified, true);
    assert.strictEqual(again.data, null);
  }

  const stranger = stepQuick(freshUser({ email: 'guest@example.com', name: 'Guest', idNumber: '999999999999' }));
  assert.strictEqual(stranger.ok, false);
  assert.strictEqual(stranger.status, 403);
  assert.strictEqual(stranger.body.error, 'quick_verify_seeded_only');
}

function testHintShowsDemoNumberButCompletionDoesNot() {
  const sarah = demoProfileForEmail('sarah.client@aegis-split.demo');
  const hint = sandboxHint(freshUser(sarah));
  assert.strictEqual(hint.sandboxDemoId, sarah.idNumber);
  assert.strictEqual(hint.sendsEmail, false);
  assert.strictEqual(hint.sendsSms, false);
  assert.strictEqual(hint.contactsGovernment, false);
  assert.strictEqual(hint.otpHint, 'Sandbox OTP: 123456');
  const done = stepQuick(freshUser(sarah));
  assert.strictEqual(JSON.stringify(done.body).includes(sarah.idNumber), false);
  assert.strictEqual(JSON.stringify(done.data).includes(sarah.idNumber), false);
}

function memoryPrisma(initial) {
  const row = { ...initial };
  const writes = [];
  return {
    writes,
    row: () => row,
    prisma: {
      user: {
        async update({ data }) {
          writes.push(JSON.parse(JSON.stringify(data)));
          if (/\d{12}/.test(JSON.stringify(data))) {
            throw new Error(`prisma update stored a 12-digit id: ${JSON.stringify(data)}`);
          }
          Object.assign(row, data);
          return { ...row };
        },
      },
    },
  };
}

async function testServicePersistsMaskOnly() {
  const persona = demoProfileForEmail('maya.counselor@aegis-split.demo');
  const db = memoryPrisma(freshUser(persona, { id: 'maya-1' }));
  const svc = createSandboxService(db.prisma);
  let user = db.row();

  const mismatch = await svc.emailStart(user, { email: 'nope@example.com' });
  assert.strictEqual(mismatch.status, 400);
  assert.strictEqual(db.writes.length, 0);

  user = db.row();
  await svc.emailStart(user, { email: persona.email });
  user = db.row();
  await svc.emailConfirm(user, { otp: SANDBOX_OTP });
  user = db.row();
  await svc.phoneStart(user, { phone: persona.phone });
  user = db.row();
  await svc.phoneConfirm(user, { otp: SANDBOX_OTP });
  user = db.row();
  const started = await svc.digilockerStart(user, { idNumber: persona.idNumber });
  assert.strictEqual(JSON.stringify(started.body).includes(persona.idNumber), false);
  user = db.row();
  const finished = await svc.digilockerConfirm(user, { otp: SANDBOX_OTP });
  assert.strictEqual(finished.status, 200);
  assert.strictEqual(finished.body.user.govIdVerified, true);
  assert.strictEqual(finished.body.user.kycMethod, KYC_METHOD);
  assert.strictEqual(finished.body.user.kycMaskedId, `XXXX XXXX ${persona.idNumber.slice(-4)}`);
  assert.strictEqual(finished.body.user.kycPhoneLast4, '0198');
  assert.strictEqual(JSON.stringify(finished.body).includes(persona.idNumber), false);
  for (const write of db.writes) {
    assert.strictEqual(JSON.stringify(write).includes(persona.idNumber), false);
    assert.doesNotThrow(() => assertNoFullId(write));
  }

  const quickDb = memoryPrisma(freshUser(persona, { id: 'maya-2' }));
  const quickSvc = createSandboxService(quickDb.prisma);
  const quick = await quickSvc.quick(quickDb.row());
  assert.strictEqual(quick.body.quick, true);
  assert.strictEqual(quickDb.row().kycMethod, KYC_METHOD);
  assert.strictEqual(JSON.stringify(quickDb.writes[0]).includes(persona.idNumber), false);
  assert.strictEqual(quick.body.documents.dob, '1988-11-02');
}

function testSchemaMapsEveryNewKycColumn() {
  const root = path.join(__dirname, '..', '..', '..');
  const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
  const userBlock = schema.match(/model User \{[\s\S]*?\n\}/);
  assert.ok(userBlock, 'User model missing');
  const fields = {
    kycMethod: 'kyc_method',
    kycVerifiedAt: 'kyc_verified_at',
    kycIdLast4: 'kyc_id_last4',
    kycMaskedId: 'kyc_masked_id',
    kycPhoneLast4: 'kyc_phone_last4',
    kycSandboxProgress: 'kyc_sandbox_progress',
  };
  const migration = fs.readFileSync(
    path.join(root, 'prisma', 'migrations', '20261110140000_kyc_sandbox', 'migration.sql'),
    'utf8'
  );
  for (const [field, column] of Object.entries(fields)) {
    const mapped = new RegExp(`${field}\\s+\\S+\\s+@map\\("${column}"\\)|${field}\\s+\\S+\\s+\\S+\\s+@map\\("${column}"\\)`);
    assert.match(userBlock[0], mapped, `${field} is missing @map("${column}")`);
    assert.match(migration, new RegExp(`"${column}"`));
  }
}

async function main() {
  testVerhoeffKnownVector();
  testDemoIdsPassFormatAndChecksum();
  testIdFormatRejections();
  testMaskAndPhone();
  testProgressDropsFullId();
  testDocumentsAreMaskedDemoData();
  testStepOrderAndMasking();
  testChangingPhoneRequiresANewOtp();
  testQuickVerifySeededOnly();
  testHintShowsDemoNumberButCompletionDoesNot();
  await testServicePersistsMaskOnly();
  testSchemaMapsEveryNewKycColumn();
  console.log('kyc sandbox validation and masking tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
