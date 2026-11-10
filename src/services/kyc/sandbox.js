/**
 * DigiLocker-style sandbox for the hackathon demo.
 * Checks a 12-digit ID format (including the Verhoeff checksum) and a fixed
 * on-screen OTP. It never sends email or SMS and never calls a government API.
 * Callers must persist only the mask and last 4 — never the full number.
 */

const KYC_METHOD = 'digilocker_sandbox';
const SANDBOX_OTP = '123456';
const STEPPER_LABEL = 'Identity verification - DigiLocker sandbox (demo)';

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

const GENERIC_DOB = '1990-01-15';
const GENERIC_ADDRESS = '100 Demo Lane, Sandbox City';

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function verhoeffCheckDigit(num) {
  let c = 0;
  const digits = String(num).split('').reverse();
  for (let i = 0; i < digits.length; i += 1) {
    c = D[c][P[(i + 1) % 8][Number(digits[i])]];
  }
  return INV[c];
}

function isValidVerhoeff(num) {
  let c = 0;
  const digits = String(num).split('').reverse();
  for (let i = 0; i < digits.length; i += 1) {
    c = D[c][P[i % 8][Number(digits[i])]];
  }
  return c === 0;
}

function withVerhoeffCheck(base) {
  const digits = String(base || '');
  if (!/^\d{11}$/.test(digits)) {
    throw new Error('Sandbox demo ID base must be 11 digits');
  }
  if (digits[0] === '0' || digits[0] === '1') {
    throw new Error('Sandbox demo ID base must not start with 0 or 1');
  }
  return `${digits}${verhoeffCheckDigit(digits)}`;
}

function profile(seed) {
  const idNumber = withVerhoeffCheck(seed.idBase);
  return {
    key: seed.key,
    email: seed.email,
    name: seed.name,
    dob: seed.dob,
    phone: seed.phone,
    address: seed.address,
    idNumber,
  };
}

const DEMO_PROFILES = [
  profile({
    key: 'sarah',
    email: 'sarah.client@aegis-split.demo',
    name: 'Sarah Chen',
    dob: '1994-03-12',
    phone: '+1 415 555 0142',
    address: '18 Market Street, San Francisco, CA 94105',
    idBase: '23456789012',
  }),
  profile({
    key: 'rohan',
    email: 'rohan.freelancer@aegis-split.demo',
    name: 'Rohan Mehta',
    dob: '1996-08-21',
    phone: '+91 98765 43210',
    address: '42 Residency Road, Bengaluru, Karnataka 560025',
    idBase: '39012345678',
  }),
  profile({
    key: 'maya',
    email: 'maya.counselor@aegis-split.demo',
    name: 'Maya Rao',
    dob: '1988-11-02',
    phone: '+1 512 555 0198',
    address: '9 Lakeview Apartments, Austin, TX 78701',
    idBase: '56789012345',
  }),
];

const GENERIC_DEMO_ID = withVerhoeffCheck('67890123450');

const PROFILES_BY_EMAIL = new Map(
  DEMO_PROFILES.map((row) => [normalizeEmail(row.email), row])
);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function demoProfileForEmail(email) {
  return PROFILES_BY_EMAIL.get(normalizeEmail(email)) || null;
}

function validateIdNumber(raw) {
  const digits = digitsOnly(raw);
  if (!/^\d{12}$/.test(digits) || digits[0] === '0' || digits[0] === '1') {
    return {
      ok: false,
      error: 'invalid_id_format',
      message: 'Enter a 12-digit number that does not start with 0 or 1.',
    };
  }
  if (!isValidVerhoeff(digits)) {
    return {
      ok: false,
      error: 'invalid_id_checksum',
      message: 'That number failed the checksum. Use the sandbox demo number shown on the form.',
    };
  }
  return { ok: true, digits };
}

function maskFromLast4(last4) {
  const digits = String(last4 || '');
  if (!/^\d{4}$/.test(digits)) {
    return { ok: false, error: 'invalid_id_mask', message: 'ID mask is missing the last 4 digits.' };
  }
  return { ok: true, last4: digits, maskedId: `XXXX XXXX ${digits}` };
}

function maskId(digits) {
  return maskFromLast4(String(digits).slice(-4));
}

function validatePhone(raw) {
  const digits = digitsOnly(raw);
  if (digits.length < 10 || digits.length > 15) {
    return {
      ok: false,
      error: 'invalid_phone',
      message: 'Enter a phone number with 10 to 15 digits.',
    };
  }
  return { ok: true, last4: digits.slice(-4) };
}

function otpMatches(otp) {
  return String(otp ?? '').trim() === SANDBOX_OTP;
}

function readProgress(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const last4 = (value) => (typeof value === 'string' && /^\d{4}$/.test(value) ? value : null);
  return {
    emailIssued: src.emailIssued === true,
    emailVerified: src.emailVerified === true,
    phoneIssued: src.phoneIssued === true,
    phoneVerified: src.phoneVerified === true,
    phoneLast4: last4(src.phoneLast4),
    digilockerIssued: src.digilockerIssued === true,
    idLast4: last4(src.idLast4),
  };
}

function mergeProgress(current, patch) {
  return readProgress({ ...readProgress(current), ...(patch || {}) });
}

function summarizeProgress(user) {
  if (!user) return { complete: false, emailVerified: false, phoneVerified: false };
  if (user.govIdVerified === true && user.kycMethod === KYC_METHOD) {
    return {
      complete: true,
      emailVerified: true,
      phoneVerified: true,
      method: KYC_METHOD,
    };
  }
  const progress = readProgress(user.kycSandboxProgress);
  return {
    complete: false,
    emailVerified: progress.emailVerified === true,
    phoneVerified: progress.phoneVerified === true,
    phoneLast4: progress.phoneLast4,
    digilockerIssued: progress.digilockerIssued === true,
  };
}

function addressProof(address) {
  return `Sandbox address proof — utility bill (${address})`;
}

function documentsFor(user, last4) {
  const masked = maskFromLast4(last4);
  if (!masked.ok) return null;
  const known = demoProfileForEmail(user && user.email);
  const address = known?.address || GENERIC_ADDRESS;
  return {
    maskedId: masked.maskedId,
    idLast4: masked.last4,
    name: known?.name || (user && user.name) || 'Sandbox user',
    dob: known?.dob || GENERIC_DOB,
    address,
    addressProof: addressProof(address),
    source: 'demo_data',
    sandbox: true,
  };
}

function assertNoFullId(data) {
  const blob = JSON.stringify(data);
  if (/\d{12}/.test(blob)) {
    const err = new Error('Refusing to store a full ID number.');
    err.status = 500;
    err.code = 'kyc_store_blocked';
    throw err;
  }
  return data;
}

function fail(status, error, message) {
  return { ok: false, status, body: { error, message } };
}

function otpBody(step) {
  return {
    ok: true,
    sandbox: true,
    step,
    sandboxOtp: SANDBOX_OTP,
    hint: `Sandbox OTP: ${SANDBOX_OTP}`,
    message:
      step === 'phone'
        ? 'No SMS was sent. The sandbox code is shown on this screen.'
        : 'No email was sent. The sandbox code is shown on this screen.',
  };
}

function alreadyVerified(user) {
  if (user && user.govIdVerified === true && user.kycMethod === KYC_METHOD && user.kycMaskedId) {
    return {
      ok: true,
      data: null,
      body: {
        ok: true,
        sandbox: true,
        alreadyVerified: true,
        govIdVerified: true,
        kycMethod: KYC_METHOD,
        kycProvider: user.kycProvider || KYC_METHOD,
        documents: documentsFor(user, user.kycIdLast4) || undefined,
      },
    };
  }
  return null;
}

function completionPatch({ idLast4, phoneLast4, now }) {
  const masked = maskFromLast4(idLast4);
  if (!masked.ok) return fail(400, masked.error, masked.message);
  if (!/^\d{4}$/.test(String(phoneLast4 || ''))) {
    return fail(400, 'phone_required', 'Confirm the phone sandbox step first.');
  }
  return {
    ok: true,
    data: {
      govIdVerified: true,
      kycMethod: KYC_METHOD,
      kycProvider: KYC_METHOD,
      kycVerifiedAt: now || new Date(),
      kycIdLast4: masked.last4,
      kycMaskedId: masked.maskedId,
      kycPhoneLast4: phoneLast4,
      kycSandboxProgress: null,
    },
  };
}

function stepEmailStart(user, body = {}) {
  const done = alreadyVerified(user);
  if (done) return done;
  const email = normalizeEmail(body.email);
  if (!email || email !== normalizeEmail(user.email)) {
    return fail(400, 'email_mismatch', 'Use the email already on this demo account.');
  }
  const progress = mergeProgress(user.kycSandboxProgress, { emailIssued: true });
  return {
    ok: true,
    data: { kycSandboxProgress: assertNoFullId(progress) },
    body: otpBody('email'),
  };
}

function stepEmailConfirm(user, body = {}) {
  const done = alreadyVerified(user);
  if (done) return done;
  const progress = readProgress(user.kycSandboxProgress);
  if (!progress.emailIssued) {
    return fail(400, 'email_otp_not_requested', 'Request the sandbox email OTP first.');
  }
  if (!otpMatches(body.otp)) {
    return fail(400, 'invalid_otp', 'That code does not match the sandbox OTP.');
  }
  const next = mergeProgress(progress, { emailVerified: true });
  return {
    ok: true,
    data: { kycSandboxProgress: assertNoFullId(next) },
    body: { ok: true, sandbox: true, step: 'email', emailVerified: true },
  };
}

function stepPhoneStart(user, body = {}) {
  const done = alreadyVerified(user);
  if (done) return done;
  const progress = readProgress(user.kycSandboxProgress);
  if (!progress.emailVerified) {
    return fail(400, 'step_out_of_order', 'Confirm the email sandbox OTP first.');
  }
  const phone = validatePhone(body.phone);
  if (!phone.ok) return fail(400, phone.error, phone.message);
  const next = mergeProgress(progress, {
    phoneIssued: true,
    phoneLast4: phone.last4,
    phoneVerified: false,
    digilockerIssued: false,
    idLast4: null,
  });
  return {
    ok: true,
    data: { kycSandboxProgress: assertNoFullId(next) },
    body: {
      ...otpBody('phone'),
      phoneLast4: phone.last4,
    },
  };
}

function stepPhoneConfirm(user, body = {}) {
  const done = alreadyVerified(user);
  if (done) return done;
  const progress = readProgress(user.kycSandboxProgress);
  if (!progress.emailVerified) {
    return fail(400, 'step_out_of_order', 'Confirm the email sandbox OTP first.');
  }
  if (!progress.phoneIssued || !progress.phoneLast4) {
    return fail(400, 'phone_otp_not_requested', 'Request the sandbox SMS OTP first.');
  }
  if (!otpMatches(body.otp)) {
    return fail(400, 'invalid_otp', 'That code does not match the sandbox OTP.');
  }
  const next = mergeProgress(progress, { phoneVerified: true });
  return {
    ok: true,
    data: { kycSandboxProgress: assertNoFullId(next) },
    body: {
      ok: true,
      sandbox: true,
      step: 'phone',
      phoneVerified: true,
      phoneLast4: next.phoneLast4,
    },
  };
}

function stepDigilockerStart(user, body = {}) {
  const done = alreadyVerified(user);
  if (done) return done;
  const progress = readProgress(user.kycSandboxProgress);
  if (!progress.emailVerified || !progress.phoneVerified) {
    return fail(400, 'step_out_of_order', 'Confirm the phone sandbox OTP first.');
  }
  const idCheck = validateIdNumber(body.idNumber);
  if (!idCheck.ok) return fail(400, idCheck.error, idCheck.message);
  const masked = maskId(idCheck.digits);
  const next = mergeProgress(progress, {
    digilockerIssued: true,
    idLast4: masked.last4,
  });
  return {
    ok: true,
    data: { kycSandboxProgress: assertNoFullId(next) },
    body: {
      ok: true,
      sandbox: true,
      step: 'digilocker',
      sandboxOtp: SANDBOX_OTP,
      hint: `Sandbox OTP: ${SANDBOX_OTP}`,
      message: 'No message was sent. The sandbox code is shown on this screen.',
    },
  };
}

function stepDigilockerConfirm(user, body = {}, now = new Date()) {
  const done = alreadyVerified(user);
  if (done) return done;
  const progress = readProgress(user.kycSandboxProgress);
  if (!progress.emailVerified || !progress.phoneVerified) {
    return fail(400, 'step_out_of_order', 'Confirm the phone sandbox OTP first.');
  }
  if (!progress.digilockerIssued || !progress.idLast4) {
    return fail(400, 'digilocker_otp_not_requested', 'Continue with the DigiLocker-style sandbox first.');
  }
  if (!otpMatches(body.otp)) {
    return fail(400, 'invalid_otp', 'That code does not match the sandbox OTP.');
  }
  const patch = completionPatch({
    idLast4: progress.idLast4,
    phoneLast4: progress.phoneLast4,
    now,
  });
  if (!patch.ok) return patch;
  return {
    ok: true,
    data: assertNoFullId(patch.data),
    body: {
      ok: true,
      sandbox: true,
      govIdVerified: true,
      kycMethod: KYC_METHOD,
      kycProvider: KYC_METHOD,
      documents: documentsFor(user, patch.data.kycIdLast4),
    },
  };
}

function stepQuick(user, now = new Date()) {
  const done = alreadyVerified(user);
  if (done) return done;
  const known = demoProfileForEmail(user && user.email);
  if (!known) {
    return fail(
      403,
      'quick_verify_seeded_only',
      'Quick verify is only for the seeded demo accounts: Sarah, Rohan, and Maya.'
    );
  }
  const idCheck = validateIdNumber(known.idNumber);
  if (!idCheck.ok) {
    throw new Error('Seeded sandbox ID failed its own checksum');
  }
  const phone = validatePhone(known.phone);
  if (!phone.ok) {
    throw new Error('Seeded sandbox phone failed validation');
  }
  const masked = maskId(idCheck.digits);
  const patch = completionPatch({
    idLast4: masked.last4,
    phoneLast4: phone.last4,
    now,
  });
  if (!patch.ok) return patch;
  return {
    ok: true,
    data: assertNoFullId(patch.data),
    body: {
      ok: true,
      sandbox: true,
      quick: true,
      govIdVerified: true,
      kycMethod: KYC_METHOD,
      kycProvider: KYC_METHOD,
      documents: documentsFor(user, masked.last4),
    },
  };
}

function sandboxHint(user) {
  const known = demoProfileForEmail(user && user.email);
  const address = known?.address || GENERIC_ADDRESS;
  return {
    ok: true,
    sandbox: true,
    label: STEPPER_LABEL,
    sandboxOtp: SANDBOX_OTP,
    otpHint: `Sandbox OTP: ${SANDBOX_OTP}`,
    sendsEmail: false,
    sendsSms: false,
    contactsGovernment: false,
    stripeIdentity: 'roadmap',
    stripeTooltip:
      'Stripe Identity is on the roadmap. This demo uses the DigiLocker-style sandbox only.',
    phoneHint: known?.phone || '',
    sandboxDemoId: known?.idNumber || GENERIC_DEMO_ID,
    sandboxDemoIdLabel: 'Sandbox demo number (not a real ID)',
    quickVerify: Boolean(known),
    demoRecord: {
      name: known?.name || (user && user.name) || 'Sandbox user',
      dob: known?.dob || GENERIC_DOB,
      address,
      addressProof: addressProof(address),
      source: 'demo_data',
    },
    steps: summarizeProgress(user),
  };
}

module.exports = {
  KYC_METHOD,
  SANDBOX_OTP,
  STEPPER_LABEL,
  DEMO_PROFILES,
  GENERIC_DEMO_ID,
  verhoeffCheckDigit,
  isValidVerhoeff,
  withVerhoeffCheck,
  validateIdNumber,
  maskId,
  maskFromLast4,
  validatePhone,
  readProgress,
  mergeProgress,
  summarizeProgress,
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
};
