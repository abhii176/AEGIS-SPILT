const STEPS = [
  { id: 'landing', label: 'Home', rail: false },
  { id: 'users', label: 'People' },
  { id: 'verify', label: 'Verify' },
  { id: 'project', label: 'Project' },
  { id: 'fund', label: 'Fund' },
  { id: 'work', label: 'Work' },
  { id: 'paid', label: 'Paid' },
  { id: 'exit', label: 'Exit' },
  { id: 'counselor', label: 'Counselor' },
  { id: 'agency', label: 'Agency' },
];

const STEP_ALIAS = { github: 'work', audit: 'work' };

const state = {
  demoKey: localStorage.getItem('aegis.demoKey') || 'hackathon-demo-key',
  userId: localStorage.getItem('aegis.userId') || '',
  user: null,
  users: {},
  projectId: localStorage.getItem('aegis.projectId') || '',
  milestoneId: localStorage.getItem('aegis.milestoneId') || '',
  approvalUrl: '',
  depositApprovalUrl: '',
  lastAudit: null,
  lastMilestone: null,
  lastProject: null,
  pendingExitPath: null,
  pendingExitPreview: null,
  notifications: [],
  unreadCount: 0,
  seenNotifIds: new Set(JSON.parse(localStorage.getItem('aegis.seenNotifs') || '[]')),
  chatMessages: [],
  chatPollTimer: null,
  counselorStatus: 'OPEN',
  agencySeedNote: '',
  kycHint: null,
  vaultFunded: false,
  workChecked: false,
};

function $(sel, root = document) {
  return root.querySelector(sel);
}

function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

function showLog(id, data) {
  const el = $(id);
  if (!el) return;
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const failure =
    typeof data === 'string' ||
    Boolean(data?.error) ||
    (data?.message && data.ok !== true && !data.vaultFund && !data.project && !data.milestone);
  el.textContent = text;
  el.hidden = !failure;
  if (failure) {
    const details = el.closest('details');
    if (details) details.open = true;
  }
}

function isPartyUser() {
  const id = state.userId;
  if (!id) return false;
  const project = state.lastProject;
  if (project?.clientId && project?.freelancerId) {
    return id === project.clientId || id === project.freelancerId;
  }
  return id === state.users.sarah?.id || id === state.users.rohan?.id;
}

async function readProject() {
  try {
    return await api(`/api/projects/${state.projectId}`);
  } catch (err) {
    if (err.status !== 403) throw err;
    const prior = state.userId;
    const fallback = state.users.sarah?.id || state.users.rohan?.id;
    if (!fallback || fallback === prior) throw err;
    state.userId = fallback;
    try {
      return await api(`/api/projects/${state.projectId}`);
    } finally {
      state.userId = prior;
    }
  }
}

async function api(path, { method = 'GET', body, auth = true, demo = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (auth && state.userId) headers['X-User-Id'] = state.userId;
  if (demo) headers['X-Demo-Admin-Key'] = state.demoKey;

  const res = await fetch(path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function persist() {
  localStorage.setItem('aegis.demoKey', state.demoKey);
  if (state.userId) localStorage.setItem('aegis.userId', state.userId);
  else localStorage.removeItem('aegis.userId');
  if (state.projectId) localStorage.setItem('aegis.projectId', state.projectId);
  if (state.milestoneId) localStorage.setItem('aegis.milestoneId', state.milestoneId);
}

function go(step) {
  step = STEP_ALIAS[step] || step;
  if (!STEPS.some((s) => s.id === step)) return;
  $all('.panel').forEach((p) => p.classList.toggle('active', p.dataset.step === step));
  $all('.step-rail button').forEach((b) => b.classList.toggle('active', b.dataset.go === step));
  history.replaceState(null, '', `#${step}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (step === 'verify') {
    refreshVerifyUi();
    loadKycHint();
  }
  if (step === 'paid' && (isPartyUser() || state.users.sarah?.id || state.users.rohan?.id)) refreshPaid();
  if (step === 'fund') refreshDepositPanel();
  if (step === 'work') syncWorkActions();
  if (step === 'project') {
    refreshChat();
    startChatPolling();
  } else {
    stopChatPolling();
  }
  if (step === 'project' || step === 'exit' || step === 'paid') refreshDisputeOutcome();
  if (step === 'counselor') refreshCounselor();
  if (step === 'agency') refreshAgency();
}

function renderRail() {
  const rail = $('#step-rail');
  rail.innerHTML = STEPS.filter((s) => s.rail !== false)
    .map((s) => `<button type="button" data-go="${s.id}">${s.label}</button>`)
    .join('');
}

function updateSessionChip() {
  const chip = $('#session-chip');
  if (!state.user) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  $('#session-name').textContent = `${state.user.name || state.user.email} · ${state.user.role}`;
  const activeId = state.userId;
  $all('.persona').forEach((b) => {
    const persona = state.users[b.dataset.persona];
    b.classList.toggle('selected', Boolean(persona?.id && persona.id === activeId));
  });
}

function persistSeenNotifs() {
  const ids = [...state.seenNotifIds].slice(-80);
  localStorage.setItem('aegis.seenNotifs', JSON.stringify(ids));
}

function showToast(notification) {
  const stack = $('#toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<strong>${escapeHtml(notification.type)}</strong>${escapeHtml(notification.message)}`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.35s ease';
    setTimeout(() => el.remove(), 380);
  }, 4200);
}

function renderNotifications() {
  const badge = $('#notif-badge');
  const list = $('#notif-list');
  if (!badge || !list) return;

  const unread = state.unreadCount || 0;
  if (unread > 0) {
    badge.hidden = false;
    badge.textContent = unread > 9 ? '9+' : String(unread);
  } else {
    badge.hidden = true;
  }

  if (!state.notifications.length) {
    list.innerHTML = '<li class="notif-empty">No alerts yet — fund, audit, or pay to see them</li>';
    return;
  }

  list.innerHTML = state.notifications
    .map((n) => {
      const unreadClass = n.readAt ? '' : ' unread';
      const when = n.createdAt ? new Date(n.createdAt).toLocaleString() : '';
      return `<li class="${unreadClass.trim()}">
        <button type="button" data-notif-id="${escapeHtml(n.id)}">
          <span class="notif-type ${escapeHtml(n.type)}">${escapeHtml(n.type)}</span>
          <div>${escapeHtml(n.message)}</div>
          <div class="notif-meta">${escapeHtml(when)}</div>
        </button>
      </li>`;
    })
    .join('');
}

async function refreshNotifications({ toastNew = false } = {}) {
  if (!state.userId) {
    state.notifications = [];
    state.unreadCount = 0;
    renderNotifications();
    return null;
  }
  try {
    const data = await api('/api/notifications');
    const next = data.notifications || [];
    if (toastNew) {
      for (const n of next) {
        if (!n.readAt && !state.seenNotifIds.has(n.id)) {
          showToast(n);
          state.seenNotifIds.add(n.id);
        }
      }
      persistSeenNotifs();
    } else {
      for (const n of next) state.seenNotifIds.add(n.id);
      persistSeenNotifs();
    }
    state.notifications = next;
    state.unreadCount = data.unreadCount ?? next.filter((n) => !n.readAt).length;
    renderNotifications();
    return data;
  } catch {
    return null;
  }
}

function toggleNotifPanel(force) {
  const panel = $('#notif-panel');
  const btn = $('#btn-notif');
  if (!panel || !btn) return;
  const open = force != null ? force : panel.hidden;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) refreshNotifications();
}

function setPersonasEnabled(enabled) {
  $all('.persona').forEach((btn) => {
    btn.disabled = !enabled;
  });
  syncUsersPrimary();
}

function selectPersona(key, { navigate = false } = {}) {
  const user = state.users[key];
  if (!user?.id) return;
  state.userId = user.id;
  state.user = user;
  state.kycHint = null;
  persist();
  $all('.persona').forEach((b) => b.classList.toggle('selected', b.dataset.persona === key));
  updateSessionChip();
  refreshVerifyUi();
  refreshNotifications();
  refreshChat();
  renderDepositPanel();
  syncUsersPrimary();
  if (navigate) go('verify');
}

function syncUsersPrimary() {
  const seeded = Object.values(state.users).some((u) => u?.id);
  const seedBtn = $('#btn-seed-users');
  if (seedBtn) seedBtn.hidden = seeded;
  const hint = $('#users-hint');
  if (!hint) return;
  if (!seeded) {
    hint.textContent = 'Next: press Load demo people.';
    return;
  }
  const name = state.user?.name || 'A person';
  hint.textContent = `Next: ${name} is selected. Press a card to open Verify.`;
}

async function refreshMe() {
  if (!state.userId) return null;
  const { user } = await api('/api/auth/me');
  state.user = user;
  const match = Object.entries(state.users).find(([, u]) => u.id === user.id);
  if (match) state.users[match[0]] = { ...state.users[match[0]], ...user };
  updateSessionChip();
  refreshVerifyUi();
  renderDepositPanel();
  return user;
}

function refreshVerifyUi() {
  const kyc = $('#verify-status [data-flag="kyc"] strong');
  const consent = $('#verify-status [data-flag="consent"] strong');
  const kycOn = Boolean(state.user?.govIdVerified);
  const consentOn = Boolean(state.user?.monitoringConsentGranted);
  const method = String(state.user?.kycMethod || state.user?.kycProvider || 'verified').replaceAll('_', ' ');
  kyc.textContent = kycOn ? `yes (${method})` : 'no';
  consent.textContent = consentOn ? 'yes' : 'no';
  $('#verify-status [data-flag="kyc"]').classList.toggle('on', kycOn);
  $('#verify-status [data-flag="consent"]').classList.toggle('on', consentOn);
  const nameEl = $('#consent-name');
  if (nameEl && state.user?.name) {
    const current = nameEl.value.trim();
    const belongsToSomeoneElse = Object.values(state.users).some(
      (person) => person?.name && person.name === current && person.id !== state.user.id
    );
    if (!current || belongsToSomeoneElse) nameEl.value = state.user.name;
  }
  renderKyc();
  syncVerifyActions();
}

function syncVerifyActions() {
  const kycOn = Boolean(state.user?.govIdVerified);
  const consentOn = Boolean(state.user?.monitoringConsentGranted);
  const quick = $('#btn-kyc-quick');
  const consent = $('#btn-consent');
  const next = $('#btn-verify-next');
  const done = $('#kyc-quick-done');
  const hint = $('#verify-hint');
  if (quick) quick.hidden = kycOn;
  if (done) done.hidden = !kycOn;
  if (consent) {
    consent.hidden = consentOn;
    consent.classList.toggle('primary', kycOn);
    consent.classList.toggle('secondary', !kycOn);
  }
  if (next) next.hidden = !(kycOn && consentOn);
  if (!hint) return;
  if (!state.userId) hint.textContent = 'Next: pick a person first.';
  else if (!kycOn) hint.textContent = 'Next: press Quick verify, then sign the agreement.';
  else if (!consentOn) hint.textContent = 'Next: tick the agreement, check the name, and press Sign agreement.';
  else hint.textContent = 'Next: press Continue to the project.';
}

function showKycError(target, err) {
  const el = $(target);
  const msg = err?.data?.message || err?.message || 'Something went wrong';
  if (el) {
    el.hidden = false;
    el.textContent = msg;
  }
  showLog('#log-verify', err?.data || msg);
}

function clearKycError(target) {
  const el = $(target);
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function formatDob(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return iso || '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] || ''} ${match[1]}`.trim();
}

function renderDocList(list, docs) {
  if (!list) return;
  if (!docs) {
    list.innerHTML = '';
    return;
  }
  const rows = [
    ['ID', docs.maskedId],
    ['Name', docs.name],
    ['Date of birth', formatDob(docs.dob)],
    ['Address proof', docs.addressProof || docs.address],
  ];
  list.innerHTML = rows
    .map(
      ([label, value]) =>
        `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd>`
    )
    .join('');
}

function kycDocumentsFromUser() {
  const user = state.user;
  if (!user?.govIdVerified || !user.kycMaskedId) return null;
  const hint = state.kycHint?.forUserId === state.userId ? state.kycHint.demoRecord : null;
  return {
    maskedId: user.kycMaskedId,
    name: hint?.name || user.name,
    dob: hint?.dob || '',
    addressProof: hint?.addressProof || hint?.address || '',
  };
}

function renderKyc() {
  const stepper = $('#kyc-stepper');
  if (!stepper) return;
  const user = state.user;
  const steps = user?.kycSandbox || {};
  const emailVerified = Boolean(user?.govIdVerified || steps.emailVerified);
  const phoneVerified = Boolean(user?.govIdVerified || steps.phoneVerified);
  const hint = state.kycHint?.forUserId === state.userId ? state.kycHint : null;

  const email = $('#kyc-email');
  if (email) email.value = user?.email || '';
  const phone = $('#kyc-phone');
  if (phone && phone.dataset.forUser !== state.userId) {
    phone.value = '';
    phone.dataset.forUser = state.userId;
    phone.dataset.autofilled = '0';
  }
  if (phone && hint?.phoneHint && phone.dataset.autofilled !== 'user') {
    phone.value = hint.phoneHint;
    phone.dataset.autofilled = '1';
  }
  const idInput = $('#kyc-locker-id');
  if (idInput && hint?.sandboxDemoId && !idInput.value) idInput.value = hint.sandboxDemoId;

  const emailBtn = $('#btn-kyc-email-verify');
  const phoneBtn = $('#btn-kyc-phone-verify');
  const idBtn = $('#btn-kyc-id-verify');
  if (emailBtn) emailBtn.hidden = emailVerified;
  if (phoneBtn) {
    phoneBtn.hidden = phoneVerified;
    phoneBtn.disabled = !emailVerified || Boolean(user?.govIdVerified);
  }
  if (idBtn) {
    idBtn.hidden = Boolean(user?.govIdVerified);
    idBtn.disabled = !phoneVerified || Boolean(user?.govIdVerified);
  }

  $('[data-kyc-step="email"]')?.classList.toggle('is-done', emailVerified);
  $('[data-kyc-step="email"]')?.classList.toggle('is-locked', !user);
  $('[data-kyc-step="phone"]')?.classList.toggle('is-done', phoneVerified);
  $('[data-kyc-step="phone"]')?.classList.toggle('is-locked', !emailVerified);
  $('[data-kyc-step="id"]')?.classList.toggle('is-done', Boolean(user?.govIdVerified));
  $('[data-kyc-step="id"]')?.classList.toggle('is-locked', !phoneVerified);

  const emailDone = $('[data-kyc-done="email"]');
  const phoneDone = $('[data-kyc-done="phone"]');
  if (emailDone) emailDone.hidden = !emailVerified;
  if (phoneDone) {
    phoneDone.hidden = !phoneVerified;
    if (phoneVerified && (steps.phoneLast4 || user?.kycPhoneLast4)) {
      phoneDone.textContent = `Phone confirmed · ending ${steps.phoneLast4 || user.kycPhoneLast4}`;
    }
  }

  const lockerHint = $('#kyc-locker-hint');
  if (lockerHint && hint?.sandboxDemoId) {
    lockerHint.textContent = `${hint.sandboxDemoIdLabel}: ${hint.sandboxDemoId}`;
  }

  const result = $('#kyc-result');
  const docs = kycDocumentsFromUser();
  if (result) result.hidden = !docs;
  if (docs) renderDocList($('#kyc-result-list'), docs);
}

async function loadKycHint() {
  if (!state.userId) return null;
  if (state.kycHint?.forUserId === state.userId) {
    renderKyc();
    return state.kycHint;
  }
  try {
    const data = await api('/api/auth/kyc/sandbox');
    state.kycHint = { forUserId: state.userId, ...data };
    renderKyc();
    return data;
  } catch (err) {
    showKycError('#kyc-error', err);
    return null;
  }
}

function sandboxOtp(id) {
  return String($(id)?.value || '123456').trim() || '123456';
}

async function verifyKycEmail() {
  clearKycError('#kyc-error');
  if (!state.user?.email) throw new Error('Pick a user first');
  const started = await api('/api/auth/kyc/sandbox/email/start', {
    method: 'POST',
    body: { email: state.user.email },
  });
  await refreshMe();
  if (started.alreadyVerified) return started;
  const data = await api('/api/auth/kyc/sandbox/email/confirm', {
    method: 'POST',
    body: { otp: sandboxOtp('#kyc-email-otp') },
  });
  showLog('#log-verify', data);
  await refreshMe();
  return data;
}

async function verifyKycPhone() {
  clearKycError('#kyc-error');
  const started = await api('/api/auth/kyc/sandbox/phone/start', {
    method: 'POST',
    body: { phone: $('#kyc-phone')?.value || '' },
  });
  await refreshMe();
  if (started.alreadyVerified) return started;
  const data = await api('/api/auth/kyc/sandbox/phone/confirm', {
    method: 'POST',
    body: { otp: sandboxOtp('#kyc-phone-otp') },
  });
  showLog('#log-verify', data);
  await refreshMe();
  return data;
}

async function verifyKycId() {
  clearKycError('#kyc-error');
  const started = await api('/api/auth/kyc/sandbox/digilocker/start', {
    method: 'POST',
    body: { idNumber: $('#kyc-locker-id')?.value || '' },
  });
  await refreshMe();
  if (started.alreadyVerified) {
    renderDocList($('#kyc-result-list'), started.documents);
    return started;
  }
  const data = await api('/api/auth/kyc/sandbox/digilocker/confirm', {
    method: 'POST',
    body: { otp: sandboxOtp('#kyc-id-otp') },
  });
  showLog('#log-verify', data);
  renderDocList($('#kyc-result-list'), data.documents);
  const result = $('#kyc-result');
  if (result && data.documents) result.hidden = false;
  await refreshMe();
  return data;
}

async function quickVerifyKyc() {
  clearKycError('#kyc-error');
  if (!state.userId) throw new Error('Pick a user first');
  const data = await api('/api/auth/kyc/sandbox/quick', { method: 'POST', body: {} });
  showLog('#log-verify', data);
  await refreshMe();
  const box = $('#consent-box');
  if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function seedUsers() {
  const data = await api('/api/admin/demo/users/seed', { method: 'POST', auth: false, demo: true });
  state.users = {};
  for (const u of data.users) {
    state.users[u.key] = u;
  }
  setPersonasEnabled(true);
  showLog('#log-users', data);
  if (!state.userId && state.users.sarah?.id) selectPersona('sarah');
  else if (state.userId) {
    const key = Object.keys(state.users).find((k) => state.users[k].id === state.userId);
    if (key) selectPersona(key);
  }
  syncUsersPrimary();
}

async function loadConsentAgreement() {
  try {
    const data = await api('/api/consent/agreement', { auth: false });
    const md = $('#consent-md');
    const ver = $('#consent-version');
    if (md) md.textContent = data.markdown || '';
    if (ver) ver.textContent = `v${data.version || '2.0.0'}`;
  } catch {
    const md = $('#consent-md');
    if (md) md.textContent = 'Could not load agreement — try refresh.';
  }
  const dateEl = $('#consent-date');
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }
  const nameEl = $('#consent-name');
  if (nameEl && !nameEl.value && state.user?.name) {
    nameEl.value = state.user.name;
  }
}

async function grantConsent() {
  const agreed = $('#consent-agree')?.checked;
  const agreedName = String($('#consent-name')?.value || '').trim();
  const agreedDate = String($('#consent-date')?.value || '').trim();
  if (!agreed) throw new Error('Tick “I agree” first');
  if (!agreedName) throw new Error('Enter your full name');
  if (!agreedDate) throw new Error('Enter the agreement date');

  const result = await api('/api/consent/monitoring', {
    method: 'POST',
    body: {
      accepted: true,
      agreedName,
      agreedDate,
      consentVersion: '2.0.0',
    },
  });
  showLog('#log-verify', result);
  await refreshMe();
}

async function createProjectAndMilestone(form) {
  const fd = new FormData(form);
  const title = String(fd.get('title') || '').trim();
  const milestoneTitle = String(fd.get('milestoneTitle') || '').trim();
  const amountUsd = Number(fd.get('amountUsd'));
  const acceptanceCriteria = String(fd.get('acceptanceCriteria') || '').trim();

  const sarah = state.users.sarah;
  const rohan = state.users.rohan;
  if (!sarah?.id || !rohan?.id) throw new Error('Seed users first');

  // Act as Sarah (client) for create — restore previous actor after
  const prior = state.userId;
  state.userId = sarah.id;

  // Both parties need KYC+consent; ensure Sarah is verified for create
  await ensureActorReady(sarah.id);

  const penaltyRaw = fd.get('earlyExitPenaltyPercent');
  const depositUsdRaw = fd.get('depositUsd');
  const earlyExitPenaltyPercent =
    penaltyRaw != null && String(penaltyRaw).trim() !== ''
      ? Number(penaltyRaw)
      : 50;
  let freelancerDepositAmountCents;
  if (depositUsdRaw != null && String(depositUsdRaw).trim() !== '') {
    freelancerDepositAmountCents = Math.round(Number(depositUsdRaw) * 100);
  }

  const { project } = await api('/api/projects', {
    method: 'POST',
    body: {
      title,
      description: 'Hackathon demo engagement',
      freelancerId: rohan.id,
      clientId: sarah.id,
      status: 'ACTIVE',
      earlyExitPenaltyPercent,
      ...(freelancerDepositAmountCents != null
        ? { freelancerDepositAmountCents }
        : {}),
    },
  });

  const amountCents = Math.round(amountUsd * 100);
  const requiresManualSignoff = fd.get('requiresManualSignoff') === 'on';
  const { milestone } = await api(`/api/projects/${project.id}/milestones`, {
    method: 'POST',
    body: {
      title: milestoneTitle,
      taskDescription: 'Deliver Milestone 1 per acceptance criteria',
      acceptanceCriteria,
      amountCents,
      requiresManualSignoff,
    },
  });

  state.userId = prior || sarah.id;
  const restored = Object.values(state.users).find((u) => u?.id === state.userId);
  if (restored) state.user = restored;
  updateSessionChip();
  state.projectId = project.id;
  state.milestoneId = milestone.id;
  state.lastMilestone = milestone;
  state.lastProject = project;
  state.depositApprovalUrl = '';
  persist();
  syncProjectActions();
  renderProjectMeta(project, amountCents, milestone);
  renderDepositPanel();
  showLog('#log-project', { project, milestone });
  await refreshChat();
  startChatPolling();
}

function syncProjectActions() {
  const ready = Boolean(state.projectId && state.milestoneId);
  const create = $('#btn-create-project');
  const next = $('#btn-project-next');
  const again = $('#btn-project-again');
  const hint = $('#project-hint');
  if (create) create.hidden = ready;
  if (next) next.hidden = !ready;
  if (again) again.hidden = !ready;
  if (hint) {
    hint.textContent = ready
      ? 'Next: press Continue to funding. You can send a message first.'
      : 'Next: leave the sample text and press Create project.';
  }
}

function renderProjectMeta(project, milestoneTotalCents, milestone) {
  const box = $('#project-meta');
  if (!box || !project) return;
  box.hidden = false;
  const resolved = globalThis.AegisDepositPanel
    ? globalThis.AegisDepositPanel.amountCents(project, milestoneTotalCents)
    : null;
  const deposit =
    resolved != null
      ? resolved
      : (project.freelancerDepositAmountCents ??
          Math.floor(((milestoneTotalCents || 0) * 10) / 100));
  $('#meta-penalty').textContent = String(project.earlyExitPenaltyPercent ?? 50);
  $('#meta-deposit').textContent = `$${(deposit / 100).toFixed(2)} (${project.depositStatus || 'PENDING'})`;
  $('#meta-status').textContent = project.status || '—';
  const signoff = $('#meta-signoff');
  if (signoff) {
    const manual = milestone?.requiresManualSignoff === true || state.lastMilestone?.requiresManualSignoff === true;
    signoff.textContent = manual ? 'client sign-off after AI pass' : 'automatic on AI pass';
  }
}

function stopChatPolling() {
  if (state.chatPollTimer) {
    clearInterval(state.chatPollTimer);
    state.chatPollTimer = null;
  }
}

function startChatPolling() {
  stopChatPolling();
  if (!state.projectId || !state.userId) return;
  state.chatPollTimer = setInterval(() => {
    refreshChat({ silent: true });
  }, 4000);
}

function renderChat() {
  const panel = $('#chat-panel');
  const list = $('#chat-list');
  if (!panel || !list) return;

  if (!state.projectId) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  if (!state.chatMessages.length) {
    list.innerHTML =
      '<li class="chat-empty">No messages yet — say hi to the other party</li>';
    return;
  }

  list.innerHTML = state.chatMessages
    .map((m) => {
      const mine = m.senderUserId === state.userId;
      const name =
        m.sender?.name ||
        m.sender?.email ||
        (mine ? 'You' : 'Them');
      const when = m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : '';
      return `<li class="chat-bubble ${mine ? 'mine' : 'theirs'}">
        <div class="chat-meta"><span>${escapeHtml(name)}</span><span>${escapeHtml(when)}</span></div>
        <div class="chat-body">${escapeHtml(m.body)}</div>
      </li>`;
    })
    .join('');
  list.scrollTop = list.scrollHeight;
}

async function refreshChat({ silent = false } = {}) {
  const hint = $('#chat-hint');
  if (!state.projectId || !state.userId || !isPartyUser()) {
    state.chatMessages = [];
    renderChat();
    return null;
  }
  try {
    const data = await api(`/api/projects/${state.projectId}/messages`);
    state.chatMessages = data.messages || [];
    renderChat();
    if (hint) {
      hint.hidden = true;
      hint.textContent = '';
    }
    return data;
  } catch (err) {
    if (!silent && hint) {
      hint.hidden = false;
      hint.textContent = err.message || 'Could not load chat';
    }
    renderChat();
    return null;
  }
}

async function sendChatMessage(form) {
  if (!state.projectId) throw new Error('Create a project first');
  if (!state.userId) throw new Error('Pick a user first');
  const fd = new FormData(form);
  const body = String(fd.get('body') || '').trim();
  if (!body) throw new Error('Message required');

  const data = await api(`/api/projects/${state.projectId}/messages`, {
    method: 'POST',
    body: { body },
  });
  form.reset();
  if (data.message) {
    state.chatMessages = [...state.chatMessages, data.message];
    renderChat();
  } else {
    await refreshChat();
  }
}

async function ensureActorReady(userId) {
  state.userId = userId;
  let user = (await api('/api/auth/me')).user;
  if (!user.govIdVerified) {
    await api('/api/auth/kyc/sandbox/quick', { method: 'POST', body: {} });
    user = (await api('/api/auth/me')).user;
  }
  if (!user.monitoringConsentGranted) {
    await api('/api/consent/monitoring', {
      method: 'POST',
      body: {
        accepted: true,
        agreedName: user.name || 'Demo User',
        agreedDate: new Date().toISOString().slice(0, 10),
        consentVersion: '2.0.0',
      },
    });
    user = (await api('/api/auth/me')).user;
  }
  state.user = user;
  state.userId = user.id;
  const match = Object.entries(state.users).find(([, row]) => row.id === user.id);
  if (match) state.users[match[0]] = { ...state.users[match[0]], ...user };
  persist();
  updateSessionChip();
  if (typeof renderDepositPanel === 'function') renderDepositPanel();
  return user;
}

function usd(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function formatExitLines(lines = []) {
  return lines
    .map((l) => {
      const usd = `$${(Number(l.amountCents || 0) / 100).toFixed(2)}`;
      return `<li><strong>${escapeHtml(usd)}</strong> → ${escapeHtml(l.to)} — ${escapeHtml(l.label)}</li>`;
    })
    .join('');
}

async function previewExit(path) {
  if (!state.projectId) throw new Error('Create a project first');
  const data = await api(
    `/api/projects/${state.projectId}/exit/preview?path=${encodeURIComponent(path)}`
  );
  state.pendingExitPath = path;
  state.pendingExitPreview = data.preview;
  const box = $('#exit-preview');
  box.hidden = false;
  const previewBtn = $('#btn-exit-preview');
  if (previewBtn) previewBtn.hidden = true;
  const hint = $('#exit-hint');
  if (hint) hint.textContent = 'Next: press Confirm exit. The dialog lists the money one more time.';
  $('#exit-lines').innerHTML = formatExitLines(data.preview?.lines || []);
  $('#exit-warn').textContent =
    path === 'MUTUAL'
      ? 'Mutual cancel: request then the other party accepts. Preview shows money if accepted now.'
      : path === 'CLIENT_ONESIDED'
        ? 'Client one-sided: penalty from remaining vault → freelancer; rest → client; deposit returned.'
        : 'Walk-away: deposit forfeited to client; vault refunded 100% to client.';
  showLog('#log-exit', data);
  return data;
}

async function confirmPendingExit() {
  const path = state.pendingExitPath;
  if (!path || !state.projectId) throw new Error('Preview an exit path first');
  const preview = state.pendingExitPreview;
  const dialog = $('#exit-dialog');
  $('#exit-dialog-summary').textContent = `Confirm ${path} for this project. Money will move as listed:`;
  $('#exit-dialog-lines').innerHTML = formatExitLines(preview?.lines || []);

  const confirmed = await new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'confirm');
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
  if (!confirmed) return null;

  let result;
  if (path === 'MUTUAL') {
    // Ensure request exists from the other actor if needed — demo: request then accept with switch
    result = await api(`/api/projects/${state.projectId}/cancel/request`, {
      method: 'POST',
      body: { reason: 'Demo mutual cancel' },
    });
    showLog('#log-exit', { step: 'requested', ...result });
    return result;
  }
  if (path === 'CLIENT_ONESIDED') {
    const sarah = state.users.sarah;
    if (sarah?.id) await ensureActorReady(sarah.id);
    result = await api(`/api/projects/${state.projectId}/exit/client`, {
      method: 'POST',
      body: { reason: 'Demo client one-sided cancel' },
    });
  } else {
    const rohan = state.users.rohan;
    if (rohan?.id) await ensureActorReady(rohan.id);
    result = await api(`/api/projects/${state.projectId}/exit/abandon`, {
      method: 'POST',
      body: { reason: 'Demo freelancer walk-away' },
    });
  }
  state.lastProject = result.project || state.lastProject;
  if (result.project) renderProjectMeta(result.project);
  showLog('#log-exit', result);
  await refreshNotifications({ toastNew: true });
  return result;
}

function renderDepositPanel() {
  const statusEl = $('#deposit-status');
  const hintEl = $('#deposit-hint');
  const actions = $('#deposit-actions');
  const link = $('#link-deposit-approve');
  const panelApi = globalThis.AegisDepositPanel;
  if (!statusEl || !hintEl || !actions || !panelApi) return;

  const project = state.lastProject;
  const milestoneTotal =
    state.lastMilestone?.amountCents != null ? Number(state.lastMilestone.amountCents) : null;
  const depositView = panelApi.view({
    userId: state.userId || state.user?.id || '',
    userRole: state.user?.role || '',
    project,
    freelancerName: project?.freelancer?.name || state.users.rohan?.name || '',
    milestoneTotalCents: milestoneTotal,
    depositApprovalUrl: state.depositApprovalUrl || '',
  });

  statusEl.hidden = false;
  statusEl.textContent = depositView.statusText;
  hintEl.hidden = !depositView.showHint;
  hintEl.textContent = depositView.hintText;
  actions.hidden = !depositView.showActions;
  if (link) {
    link.hidden = !depositView.showApprove;
    if (depositView.approveUrl) link.href = depositView.approveUrl;
  }
  syncFundActions();
}

function noteVaultFromProject(project) {
  if (!project) return;
  const status = String(project.fundedStatus || '').toUpperCase();
  if (['FUNDED', 'PARTIALLY_FUNDED', 'PAID', 'RELEASED'].includes(status)) {
    state.vaultFunded = true;
  }
  const milestones = project.milestones || [];
  if (
    milestones.some((m) =>
      ['FUNDED', 'IN_PROGRESS', 'PASSED', 'RELEASED', 'PAID', 'FAILED'].includes(String(m.status || ''))
    )
  ) {
    state.vaultFunded = true;
  }
  if ((project.vaultFunds || []).some((row) => row.status === 'CAPTURED')) {
    state.vaultFunded = true;
  }
}

function syncFundActions() {
  const fund = $('#btn-fund');
  const approve = $('#link-approve');
  const next = $('#btn-fund-next');
  const depositBtn = $('#btn-deposit');
  const depositLink = $('#link-deposit-approve');
  const depositActions = $('#deposit-actions');
  let showDeposit = Boolean(depositActions && !depositActions.hidden);
  const depositSettled = / - (paid|returned|forfeited)\b/i.test($('#deposit-status')?.textContent || '');
  if (showDeposit && depositSettled && !(depositLink && !depositLink.hidden)) {
    depositActions.hidden = true;
    if (depositBtn) depositBtn.hidden = true;
    showDeposit = false;
  }
  const needsApprove = Boolean(approve && !approve.hidden);
  const needsDepositApprove = Boolean(depositLink && !depositLink.hidden);
  const funded = state.vaultFunded === true;

  if (fund) fund.hidden = needsApprove || funded;
  if (next) next.hidden = !(funded && (!showDeposit || depositSettled));

  const primary = needsDepositApprove
    ? depositLink
    : showDeposit && !depositSettled && (funded || needsApprove)
      ? depositBtn
      : needsApprove
        ? approve
        : fund && !fund.hidden
          ? fund
          : next && !next.hidden
            ? next
            : fund;

  for (const el of [fund, approve, next, depositBtn, depositLink]) {
    if (!el || el.hidden) continue;
    el.className = el === primary ? 'btn primary' : 'btn secondary';
  }

  const hint = $('#fund-hint');
  if (!hint) return;
  if (needsDepositApprove) hint.textContent = 'Next: open PayPal and approve the deposit.';
  else if (needsApprove && primary === approve) hint.textContent = 'Next: open PayPal and approve the escrow payment.';
  else if (!funded) {
    hint.textContent = showDeposit
      ? 'Next: press Fund escrow, then Pay security deposit. Open More to capture immediately on a local demo.'
      : 'Next: press Fund escrow. Open More to capture immediately on a local demo.';
  } else if (showDeposit && !depositSettled) hint.textContent = 'Next: press Pay security deposit.';
  else hint.textContent = 'Next: press Continue to work.';
}

async function refreshDepositPanel() {
  if (state.projectId && state.userId) {
    try {
      const data = await readProject();
      if (data?.project) {
        state.lastProject = { ...state.lastProject, ...data.project };
        noteVaultFromProject(state.lastProject);
        if (Array.isArray(data.project.freelancerDeposits)) {
          const open = data.project.freelancerDeposits.find(
            (row) => row.status === 'ORDER_CREATED' && row.approvalUrl
          );
          state.depositApprovalUrl = open?.approvalUrl || '';
        }
        if (['HELD', 'RETURNED', 'FORFEITED'].includes(String(data.project.depositStatus || ''))) {
          state.depositApprovalUrl = '';
        }
        renderProjectMeta(
          state.lastProject,
          data.project.milestoneTotalCents ?? state.lastMilestone?.amountCents
        );
      }
    } catch {
      /* keep the last snapshot if the project fetch fails */
    }
  }
  renderDepositPanel();
}

async function fundDeposit() {
  if (!state.projectId) throw new Error('Create a project first');
  let project = state.lastProject;
  if (!project?.freelancerId || project.id !== state.projectId) {
    const data = await api(`/api/projects/${state.projectId}`);
    project = data.project;
    state.lastProject = project;
  }
  if (state.userId !== project.freelancerId) {
    throw new Error('Only the project freelancer can fund the security deposit');
  }
  await ensureActorReady(project.freelancerId);
  updateSessionChip();
  const capture = $('#fund-capture')?.checked;
  const data = await api(`/api/projects/${state.projectId}/deposit/fund`, {
    method: 'POST',
    body: { ...(capture ? { capture: true } : {}) },
  });
  const approvalUrl = data.approveUrl || data.paypal?.approvalUrl || '';
  state.depositApprovalUrl = approvalUrl && !capture ? approvalUrl : '';
  if (data.project) {
    state.lastProject = { ...state.lastProject, ...data.project };
    renderProjectMeta(state.lastProject);
  }
  renderDepositPanel();
  showLog('#log-fund', { deposit: data });
  await refreshNotifications({ toastNew: true });
  syncFundActions();
}

async function fundVault() {
  if (!state.projectId || !state.milestoneId) throw new Error('Create a project first');
  const sarah = state.users.sarah;
  if (!sarah?.id) throw new Error('Seed Sarah first');
  await ensureActorReady(sarah.id);

  const capture = $('#fund-capture').checked;
  const data = await api('/api/vault/fund', {
    method: 'POST',
    body: {
      projectId: state.projectId,
      milestoneId: state.milestoneId,
      ...(capture ? { capture: true } : {}),
    },
  });

  const approvalUrl = data.approveUrl || data.paypal?.approvalUrl || '';
  state.approvalUrl = approvalUrl;
  const link = $('#link-approve');
  if (approvalUrl && !capture) {
    link.hidden = false;
    link.href = approvalUrl;
  } else {
    link.hidden = true;
  }

  const funded =
    data.vaultFund?.status === 'CAPTURED' ||
    data.paypal?.autoCapture === true ||
    Boolean(data.vaultFund?.paypalCaptureId);
  if (funded) state.vaultFunded = true;
  showLog('#log-fund', {
    ...data,
    routes: {
      return: '/api/vault/paypal/return?token=ORDER_ID',
      cancel: '/api/vault/paypal/cancel?token=ORDER_ID',
      note: funded
        ? 'Captured immediately (auto-capture / mock).'
        : 'Open approval URL; PayPal returns to /api/vault/paypal/return which captures when APPROVED.',
    },
  });
  if (funded) await refreshNotifications({ toastNew: true });
  updateSessionChip();
  renderDepositPanel();
}

async function linkGithub(form) {
  if (!state.projectId || !state.milestoneId) throw new Error('Create a project first');
  const fd = new FormData(form);
  const repo = String(fd.get('repo') || '').trim();
  const pr = Number(fd.get('pr'));

  const rohan = state.users.rohan;
  if (!rohan?.id) throw new Error('Seed Rohan first');
  await ensureActorReady(rohan.id);

  const data = await api(
    `/api/projects/${state.projectId}/milestones/${state.milestoneId}/github`,
    {
      method: 'POST',
      body: { githubRepoFullName: repo, githubPrNumber: pr },
    }
  );
  state.lastMilestone = data.milestone;
  showLog('#log-work', data);
}

async function simulateMerge() {
  if (!state.milestoneId) throw new Error('Create a milestone first');
  const actor = state.users.rohan || state.users.sarah;
  if (!actor?.id) throw new Error('Seed users first');
  await ensureActorReady(actor.id);

  const data = await api(`/api/admin/demo/milestones/${state.milestoneId}/simulate-merge`, {
    method: 'POST',
    demo: true,
    body: {},
  });

  state.lastAudit = data.audit || null;
  state.lastMilestone = data.milestone || state.lastMilestone;
  state.awaitingSignoff = data.awaitingClientSignoff === true;
  state.workChecked = true;
  renderAudit(data);
  showLog('#log-work', data);
  await refreshNotifications({ toastNew: true });
}

async function submitWork(form) {
  await linkGithub(form);
  await simulateMerge();
}

function renderSignoffControls(data) {
  const btn = $('#btn-signoff');
  const hint = $('#signoff-hint');
  if (!btn || !hint) return;
  const milestone = data.milestone || state.lastMilestone;
  const waiting =
    data.awaitingClientSignoff === true ||
    (milestone?.requiresManualSignoff === true &&
      milestone?.auditPassed === true &&
      milestone?.status === 'PASSED');
  const paid = milestone?.status === 'PAID' || milestone?.status === 'RELEASED';
  if (!waiting || paid) {
    btn.hidden = true;
    hint.hidden = !milestone?.requiresManualSignoff;
    hint.textContent = paid && milestone?.requiresManualSignoff
      ? 'Sarah signed off. The payout is on the next step.'
      : '';
    if (!hint.textContent) hint.hidden = true;
    syncWorkActions();
    return;
  }
  btn.hidden = false;
  hint.hidden = false;
  const sarahId = state.users.sarah?.id;
  const actingAsClient = sarahId && state.userId === sarahId;
  hint.textContent = actingAsClient
    ? 'The AI check passed. Press Approve and pay. There is no timeout.'
    : 'The AI check passed. Switch to Sarah and press Approve and pay.';
  syncWorkActions();
}

function syncWorkActions() {
  const submit = $('#btn-submit-work');
  const next = $('#btn-work-next');
  const signoff = $('#btn-signoff');
  const hint = $('#work-hint');
  const waiting = Boolean(signoff && !signoff.hidden);
  const ran = state.workChecked || ['PASSED', 'PAID', 'RELEASED', 'FAILED'].includes(state.lastMilestone?.status);
  if (submit) submit.hidden = waiting || ran;
  if (next) next.hidden = !(ran && !waiting);
  if (!hint) return;
  if (waiting) hint.textContent = 'Next: switch to Sarah and press Approve and pay.';
  else if (ran) hint.textContent = 'Next: press See payout.';
  else hint.textContent = 'Next: press Submit work. It links the pull request and runs the AI check.';
}

async function clientSignoff() {
  if (!state.projectId || !state.milestoneId) throw new Error('Create a milestone first');
  const sarah = state.users.sarah;
  if (!sarah?.id) throw new Error('Seed Sarah first');
  await ensureActorReady(sarah.id);
  const data = await api(
    `/api/projects/${state.projectId}/milestones/${state.milestoneId}/signoff`,
    { method: 'POST', body: {} }
  );
  state.lastMilestone = data.milestone || state.lastMilestone;
  state.awaitingSignoff = false;
  renderAudit({
    audit: state.lastAudit,
    milestone: state.lastMilestone,
    awaitingClientSignoff: false,
  });
  showLog('#log-work', data);
  await refreshNotifications({ toastNew: true });
}

async function loadEvidence() {
  if (!state.projectId || !state.userId) throw new Error('Create a project and pick a user first');
  const data = await api(`/api/projects/${state.projectId}/evidence`);
  const evidence = data.evidence || {};
  const board = $('#evidence-board');
  board.hidden = false;
  $('#evidence-note').textContent = evidence.note || '';
  const lines = [];
  lines.push(`Platform fee: ${evidence.platformFeePercent ?? 0}%`);
  lines.push(`Recorded: ${(evidence.recorded || []).join(', ') || '—'}`);
  lines.push(`Not recorded: ${(evidence.notRecorded || []).join(', ') || '—'}`);
  lines.push('');
  (evidence.messages || []).forEach((msg) => {
    const who = msg.senderName || msg.senderRole || 'user';
    lines.push(`[chat] ${who}: ${msg.body}`);
  });
  if (!(evidence.messages || []).length) lines.push('[chat] No messages yet.');
  lines.push('');
  (evidence.merges || []).forEach((ev) => {
    lines.push(`[diff] ${ev.repoFullName || 'repo'} #${ev.prNumber ?? '—'} ${ev.mergeSha || ''}`);
    if (ev.diffPreview) lines.push(ev.diffPreview);
  });
  if (!(evidence.merges || []).length) lines.push('[diff] No merge recorded yet.');
  lines.push('');
  (evidence.milestones || []).forEach((m) => {
    lines.push(`[audit] ${m.title} ${m.status} ${m.auditPassed == null ? '' : m.auditPassed ? 'PASS' : 'FAIL'}`);
    if (m.auditReport) lines.push(m.auditReport);
  });
  $('#evidence-body').textContent = lines.join('\n');
}

function renderAudit(data) {
  const board = $('#audit-board');
  board.hidden = false;
  const passed = data.audit?.passed === true || data.milestone?.auditPassed === true;
  const waiting = data.awaitingClientSignoff === true;
  const engine = data.audit?.engine || data.audit?.provider || '';
  const verdict = $('#audit-verdict');
  let label = passed ? 'PASS — criteria met' : 'FAIL — criteria not met';
  if (data.disputeOpen || data.payoutPaused) label = 'PASS — payout paused (dispute open)';
  else if (waiting) label = 'PASS — waiting for client sign-off';
  if (engine) label += ` (${engine})`;
  verdict.textContent = label;
  verdict.className = `audit-verdict ${passed ? 'pass' : 'fail'}`;
  renderSignoffControls(data);

  const checks = $('#audit-checks');
  const list = data.audit?.checks || [];
  checks.innerHTML = list.length
    ? list
        .map((c) => {
          const ok = c.met === true || c.passed === true;
          const label = c.criterion || c.name || c.check || 'check';
          const evidence = c.evidence || c.reason || '';
          return `<li>${ok ? '✓' : '✗'} <strong>${escapeHtml(label)}</strong>${
            evidence ? ` — ${escapeHtml(evidence)}` : ''
          }</li>`;
        })
        .join('')
    : '<li>No structured checks returned</li>';

  $('#audit-report').textContent =
    data.milestone?.auditReport || data.audit?.report || data.audit?.reason || '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function refreshPaid() {
  if (!state.projectId || !state.userId) return;
  try {
    const { project } = await readProject();
    const milestone =
      project.milestones?.find((m) => m.id === state.milestoneId) || project.milestones?.[0];
    state.lastMilestone = milestone || null;
    renderPaid(milestone);
    showLog('#log-paid', { project, milestone });
    await refreshNotifications({ toastNew: true });
  } catch (err) {
    showLog('#log-paid', err.data || err.message);
  }
}

function renderPaid(milestone) {
  if (!milestone) {
    $('#paid-amount').textContent = '—';
    $('#paid-status').textContent = 'No milestone yet';
    $('#paid-meta').innerHTML = '';
    return;
  }
  const usd = (milestone.amountCents / 100).toFixed(2);
  $('#paid-amount').textContent = `$${usd} ${milestone.currency || 'USD'}`;
  const status = milestone.status;
  const paid = status === 'PAID' || status === 'RELEASED';
  const waitingForClient =
    milestone.requiresManualSignoff === true && status === 'PASSED' && milestone.auditPassed === true;
  $('#paid-status').textContent = paid
    ? `Status: ${status} — full amount released to freelancer (0% platform fee)`
    : waitingForClient
      ? 'Status: PASSED — waiting for the client to sign off'
      : `Status: ${status}${milestone.auditPassed === false ? ' (audit failed)' : ''}`;

  const rows = [
    ['Milestone', milestone.title],
    ['Audit', milestone.auditPassed == null ? '—' : milestone.auditPassed ? 'PASS' : 'FAIL'],
    [
      'Release',
      milestone.requiresManualSignoff ? 'Client sign-off' : 'Automatic after AI pass',
    ],
    ['Platform fee', '0%'],
    ['Payout batch', milestone.paypalPayoutBatchId || '—'],
    ['Payout item', milestone.paypalPayoutItemId || '—'],
    ['Merge SHA', milestone.githubMergeSha || '—'],
    ['Payout email', milestone.payoutEmail || '—'],
  ];
  $('#paid-meta').innerHTML = rows
    .map(
      ([k, v]) =>
        `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`
    )
    .join('');
}

async function raiseDispute(form) {
  if (!state.projectId) throw new Error('Create and fund a project first');
  const reason = String(new FormData(form).get('reason') || '').trim();
  if (reason.length < 3) throw new Error('Write a short reason');
  const data = await api(`/api/projects/${state.projectId}/disputes`, {
    method: 'POST',
    body: {
      reason,
      milestoneId: state.milestoneId || undefined,
    },
  });
  await refreshDisputeOutcome();
  await refreshNotifications({ toastNew: true });
  return data;
}

function renderDisputeOutcome(payload) {
  const boxes = $all('[data-dispute-outcome]');
  const dispute = payload?.dispute;
  if (!dispute) {
    boxes.forEach((box) => {
      box.hidden = true;
      box.innerHTML = '';
    });
    return;
  }
  const settlement = dispute.transferIds?.notice
    ? `<p>${escapeHtml(dispute.transferIds.notice)}</p>`
    : '';
  const money =
    dispute.status === 'RESOLVED'
      ? `<p>Freelancer ${usd(dispute.freelancerAmountCents)} · Client refund ${usd(dispute.clientRefundCents)} · Deposit ${escapeHtml(dispute.depositDisposition || 'NONE')} ${dispute.depositCents ? usd(dispute.depositCents) : ''}</p>
         <p>Decided by ${escapeHtml(dispute.decidedByLabel || 'counselor')} · ${escapeHtml(dispute.decision || '')}${dispute.freelancerPercent != null ? ` (${dispute.freelancerPercent}%)` : ''}</p>
         <p>${escapeHtml(dispute.note || '')}</p>${settlement}`
      : `<p>Payout and exit are paused until the counselor decides.</p><p>${escapeHtml(dispute.reason || '')}</p>`;
  const html = `<h3>Dispute ${escapeHtml(dispute.status)}</h3>${money}`;
  boxes.forEach((box) => {
    box.hidden = false;
    box.innerHTML = html;
  });
}

async function refreshDisputeOutcome() {
  if (!state.projectId || !state.userId || !isPartyUser()) return null;
  try {
    const data = await api(`/api/projects/${state.projectId}/disputes`);
    renderDisputeOutcome(data);
    return data;
  } catch {
    return null;
  }
}

function counselorMoneyLines(lines = []) {
  if (!lines.length) return '<li>No funds to move</li>';
  return lines
    .map(
      (line) =>
        `<li><strong>${escapeHtml(usd(line.amountCents))}</strong> → ${escapeHtml(line.to)} — ${escapeHtml(line.label)}</li>`
    )
    .join('');
}

function renderCounselorCase(row) {
  const evidence = row.evidence || {};
  const vault = evidence.vault || {};
  const deposit = evidence.deposit || {};
  const milestones = evidence.milestones || [];
  const messages = evidence.messages || [];
  const audits = evidence.audits || [];
  const diffs = evidence.diffs || [];
  const consent = evidence.consent || {};
  const recordings = evidence.callRecordings || {};
  const recordingCard = globalThis.AegisCallRecording
    ? globalThis.AegisCallRecording.render(recordings)
    : '';
  const moneyPending = row.transferIds && row.transferIds.pending === true;
  const decided = row.status === 'RESOLVED' && !moneyPending;
  const consentLine = (party, label) => {
    if (!party) return `<p>${label}: no consent log</p>`;
    const when = party.agreedAt ? new Date(party.agreedAt).toLocaleString() : '—';
    return `<p>${label}: version ${escapeHtml(party.consentVersion || '—')} · ${escapeHtml(when)}</p>`;
  };

  return `<article class="counselor-case" data-dispute-id="${escapeHtml(row.id)}">
    <h3>${escapeHtml(evidence.project?.title || row.projectTitle || 'Project')} · ${escapeHtml(row.status)}</h3>
    <p>${escapeHtml(row.raisedByName || 'A party')} raised this. ${escapeHtml(row.reason || '')}</p>
    ${recordingCard}
    <div class="evidence-grid">
      <section class="evidence-card">
        <h4>Milestone and criteria</h4>
        ${milestones
          .map(
            (m) => `<p><strong>${escapeHtml(m.title)}</strong> · ${escapeHtml(m.status)} · ${usd(m.amountCents)}</p>
              <p>${escapeHtml(m.acceptanceCriteria || '')}</p>`
          )
          .join('') || '<p>No milestones</p>'}
      </section>
      <section class="evidence-card">
        <h4>Vault and deposit</h4>
        <p>${
          decided
            ? `At the decision the vault held ${usd(row.remainingVaultCents)}. Freelancer received ${usd(row.freelancerAmountCents)}. Client refund ${usd(row.clientRefundCents)}.`
            : `In the vault: ${usd(vault.remainingVaultCents)} remaining (${usd(vault.capturedVaultCents)} captured, ${usd(vault.paidOutCents)} already paid).`
        }</p>
        <p>Deposit: ${escapeHtml(deposit.status || '—')} · ${usd(deposit.amountCents)}</p>
        ${vault.fundingNote ? `<p>${escapeHtml(vault.fundingNote)}</p>` : ''}
      </section>
      <section class="evidence-card">
        <h4>AI audit</h4>
        ${audits
          .map(
            (a) => `<p><strong>${a.passed ? 'PASS' : 'FAIL'}</strong> · ${escapeHtml(a.title || '')}</p>
              <pre class="audit-snippet">${escapeHtml(a.report || '')}</pre>`
          )
          .join('') || '<p>No audit yet. Simulate the merge after the dispute is open — payout stays paused.</p>'}
      </section>
      <section class="evidence-card">
        <h4>Diff preview</h4>
        ${diffs
          .map(
            (d) => `<p>${escapeHtml(d.repoFullName || '')} #${escapeHtml(d.prNumber || '')}</p>
              <pre class="diff-preview">${escapeHtml(d.diffPreview || '(empty diff)')}</pre>`
          )
          .join('') || '<p>No stored diff yet.</p>'}
      </section>
      <section class="evidence-card">
        <h4>Consent</h4>
        ${consentLine(consent.client, 'Client')}
        ${consentLine(consent.freelancer, 'Freelancer')}
      </section>
    </div>
    <section class="evidence-card">
      <h4>Chat</h4>
      <ul class="counselor-chat">
        ${messages
          .map((msg) => {
            const when = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : '';
            return `<li><strong>${escapeHtml(msg.senderName || msg.senderRole || 'User')}</strong> ${escapeHtml(msg.body || '')}<time>${escapeHtml(when)}</time></li>`;
          })
          .join('') || '<li>No messages</li>'}
      </ul>
    </section>
    ${
      decided
        ? `<div class="dispute-outcome"><h3>${escapeHtml(row.decision || 'Decided')}</h3>
            <p>${escapeHtml(row.decidedByLabel || '')} · Freelancer ${usd(row.freelancerAmountCents)} · Client ${usd(row.clientRefundCents)} · Deposit ${escapeHtml(row.depositDisposition || 'NONE')}</p>
            <p>${escapeHtml(row.note || '')}</p>
            <p class="field-hint">${
              row.transferIds?.notice
                ? escapeHtml(row.transferIds.notice)
                : `The milestone is closed so it cannot be paid a second time. The amounts above are what moved${
                    row.transferIds?.freelancerPayoutBatchId
                      ? `. Payout ${escapeHtml(row.transferIds.freelancerPayoutBatchId)}`
                      : ''
                  }${
                    row.transferIds?.vaultRefunds?.[0]?.refundId
                      ? `. Refund ${escapeHtml(row.transferIds.vaultRefunds[0].refundId)}`
                      : ''
                  }.`
            }</p></div>`
        : `${
            moneyPending
              ? '<p>The last attempt did not finish. Confirm again to finish the same decision.</p>'
              : ''
          }<form class="dispute-form" data-decide-form>
            <fieldset>
              <legend class="sr-only">Counselor decision</legend>
              <label class="check-inline"><input type="radio" name="decision" value="RELEASE_TO_FREELANCER" /> Release to freelancer</label>
              <label class="check-inline"><input type="radio" name="decision" value="REFUND_CLIENT" /> Refund client</label>
              <label class="check-inline"><input type="radio" name="decision" value="SPLIT" checked /> Split</label>
            </fieldset>
            <label>
              Freelancer share %
              <input name="freelancerPercent" type="number" min="0" max="100" step="1" value="50" />
            </label>
            <label class="check-inline">
              <input type="checkbox" name="freelancerAtFault" />
              Freelancer at fault (forfeit deposit). Leave off to return it.
            </label>
            <label>
              Note
              <textarea name="note" rows="2" required minlength="3" placeholder="Why this split?"></textarea>
            </label>
            <ul data-preview-lines hidden></ul>
            <div class="action-row">
              <button type="submit" class="btn primary" data-confirm>Confirm decision</button>
            </div>
          </form>`
    }
  </article>`;
}

async function refreshCounselor() {
  const list = $('#counselor-list');
  if (!list) return;
  try {
    const data = await api(`/api/disputes?status=${encodeURIComponent(state.counselorStatus)}`, {
      demo: true,
    });
    const rows = data.disputes || [];
    list.innerHTML = rows.length
      ? rows.map(renderCounselorCase).join('')
      : `<p class="field-hint">No ${state.counselorStatus === 'ALL' ? '' : state.counselorStatus.toLowerCase() + ' '}disputes.</p>`;
    showLog('#log-counselor', { count: rows.length, status: state.counselorStatus });
  } catch (err) {
    list.innerHTML = `<p class="field-hint">${escapeHtml(err.message || 'Could not load disputes')}</p>`;
    showLog('#log-counselor', err.data || err.message);
  }
}

function decisionBody(form) {
  const fd = new FormData(form);
  const decision = String(fd.get('decision') || 'SPLIT');
  const percentRaw = String(fd.get('freelancerPercent') || '').trim();
  return {
    decision,
    freelancerPercent: decision === 'SPLIT' && percentRaw !== '' ? Number(percentRaw) : undefined,
    freelancerAtFault: fd.get('freelancerAtFault') === 'on',
    note: String(fd.get('note') || '').trim(),
  };
}

async function previewCounselorDecision(form) {
  const article = form.closest('[data-dispute-id]');
  const disputeId = article?.dataset.disputeId;
  if (!disputeId) throw new Error('Missing dispute');
  const body = decisionBody(form);
  const data = await api(`/api/disputes/${disputeId}/preview`, {
    method: 'POST',
    demo: true,
    body,
  });
  const lines = form.querySelector('[data-preview-lines]');
  if (lines) {
    lines.hidden = false;
    lines.innerHTML = counselorMoneyLines(data.lines || []);
  }
  const confirm = form.querySelector('[data-confirm]');
  if (confirm) confirm.disabled = false;
  showLog('#log-counselor', data);
  return data;
}

async function confirmCounselorDecision(form) {
  const article = form.closest('[data-dispute-id]');
  const disputeId = article?.dataset.disputeId;
  const body = decisionBody(form);
  if (!body.note || body.note.length < 3) throw new Error('Write a short note before confirming');
  const data = await api(`/api/disputes/${disputeId}/decide`, {
    method: 'POST',
    demo: true,
    body,
  });
  showLog('#log-counselor', data);
  await refreshCounselor();
  await refreshDisputeOutcome();
  await refreshNotifications({ toastNew: true });
  return data;
}

function agencyPanelApi() {
  return globalThis.AegisAgencyPanel;
}

function paintAgency(dashboard) {
  const apiPanel = agencyPanelApi();
  const body = $('#agency-body');
  if (!apiPanel || !body || !dashboard) return;
  const note = $('#agency-seed-note');
  if (note) note.textContent = state.agencySeedNote || '';
  if (!dashboard.projects || !dashboard.projects.length) {
    body.innerHTML =
      '<p class="field-hint">No projects yet. Load demo agency adds sample rows for Escrow eSports Studio. A real Sarah and Rohan project shows up here as well.</p>';
    return;
  }
  body.innerHTML = apiPanel.render(dashboard);
}

async function refreshAgency() {
  try {
    const dashboard = await api('/api/admin/demo/agency', { auth: false, demo: true });
    paintAgency(dashboard);
  } catch (err) {
    const note = $('#agency-seed-note');
    if (note) note.textContent = err.message || 'Could not load the agency preview.';
  }
}

async function seedAgency() {
  const data = await api('/api/admin/demo/agency/seed', {
    method: 'POST',
    auth: false,
    demo: true,
  });
  const created = data.seed?.createdProjects || 0;
  const existing = data.seed?.existingProjects || 0;
  state.agencySeedNote = created
    ? `Loaded ${created} sample project${created === 1 ? '' : 's'}.`
    : `Already loaded. ${existing} sample project${existing === 1 ? '' : 's'} left as they were.`;
  paintAgency(data.dashboard);
  return data;
}

function bindUi() {
  renderRail();

  document.body.addEventListener('click', (e) => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) {
      e.preventDefault();
      if (goBtn.dataset.openDispute === '1') {
        const box = $('#dispute-more');
        if (box) box.open = true;
      }
      go(goBtn.dataset.go);
    }
  });

  $('#btn-start-demo')?.addEventListener('click', async () => {
    const btn = $('#btn-start-demo');
    if (btn) btn.disabled = true;
    try {
      await seedUsers();
    } catch (err) {
      showLog('#log-users', err.data || err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
    go('users');
  });

  $('#btn-seed-users').addEventListener('click', async () => {
    try {
      await seedUsers();
    } catch (err) {
      showLog('#log-users', err.data || err.message);
    }
  });

  $('#btn-load-agency')?.addEventListener('click', async () => {
    try {
      await seedAgency();
    } catch (err) {
      const note = $('#agency-seed-note');
      if (note) note.textContent = err.message || 'Could not load the agency preview.';
    }
  });

  $all('.persona').forEach((btn) => {
    btn.addEventListener('click', () => selectPersona(btn.dataset.persona, { navigate: true }));
  });

  $('#btn-switch-user').addEventListener('click', () => go('users'));

  $('#kyc-phone')?.addEventListener('input', (event) => {
    event.target.dataset.autofilled = 'user';
  });

  $('#btn-kyc-email-verify')?.addEventListener('click', async () => {
    try {
      await verifyKycEmail();
    } catch (err) {
      showKycError('#kyc-error', err);
    }
  });
  $('#btn-kyc-phone-verify')?.addEventListener('click', async () => {
    try {
      await verifyKycPhone();
    } catch (err) {
      showKycError('#kyc-error', err);
    }
  });
  $('#btn-kyc-id-verify')?.addEventListener('click', async () => {
    try {
      await verifyKycId();
    } catch (err) {
      showKycError('#kyc-error', err);
    }
  });
  $('#btn-kyc-quick')?.addEventListener('click', async () => {
    try {
      await quickVerifyKyc();
    } catch (err) {
      showKycError('#kyc-error', err);
    }
  });
  $('#btn-consent').addEventListener('click', async () => {
    try {
      await grantConsent();
    } catch (err) {
      showLog('#log-verify', err.data || err.message);
    }
  });

  $('#btn-project-again')?.addEventListener('click', () => {
    const create = $('#btn-create-project');
    const next = $('#btn-project-next');
    if (create) create.hidden = false;
    if (next) next.hidden = true;
    const hint = $('#project-hint');
    if (hint) hint.textContent = 'Next: press Create project. This starts another project.';
  });

  $('#form-project').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await createProjectAndMilestone(e.target);
    } catch (err) {
      showLog('#log-project', err.data || err.message);
    }
  });

  $('#form-chat')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hint = $('#chat-hint');
    try {
      await sendChatMessage(e.target);
      if (hint) {
        hint.hidden = true;
        hint.textContent = '';
      }
    } catch (err) {
      if (hint) {
        hint.hidden = false;
        hint.textContent = err.message || 'Could not send';
      }
    }
  });

  $('#btn-fund').addEventListener('click', async () => {
    try {
      await fundVault();
    } catch (err) {
      showLog('#log-fund', err.data || err.message);
    }
  });

  $('#btn-deposit')?.addEventListener('click', async () => {
    try {
      await fundDeposit();
    } catch (err) {
      showLog('#log-fund', err.data || err.message);
    }
  });

  $('#btn-exit-preview')?.addEventListener('click', async () => {
    try {
      await previewExit($('#exit-path')?.value || 'MUTUAL');
    } catch (err) {
      showLog('#log-exit', err.data || err.message);
    }
  });

  $('#btn-exit-confirm')?.addEventListener('click', async () => {
    try {
      await confirmPendingExit();
    } catch (err) {
      showLog('#log-exit', err.data || err.message);
    }
  });

  $('#btn-exit-dismiss')?.addEventListener('click', () => {
    const box = $('#exit-preview');
    if (box) box.hidden = true;
    const previewBtn = $('#btn-exit-preview');
    if (previewBtn) previewBtn.hidden = false;
    state.pendingExitPath = null;
    state.pendingExitPreview = null;
    const hint = $('#exit-hint');
    if (hint) hint.textContent = 'Next: choose who is leaving, press Preview exit, then Confirm.';
  });

  $('#btn-cancel-request')?.addEventListener('click', async () => {
    try {
      if (!state.projectId) throw new Error('Create a project first');
      const data = await api(`/api/projects/${state.projectId}/cancel/request`, {
        method: 'POST',
        body: { reason: 'Demo mutual cancel request' },
      });
      showLog('#log-exit', data);
      await refreshNotifications({ toastNew: true });
    } catch (err) {
      showLog('#log-exit', err.data || err.message);
    }
  });

  $('#btn-cancel-accept')?.addEventListener('click', async () => {
    try {
      if (!state.projectId) throw new Error('Create a project first');
      const preview = await api(
        `/api/projects/${state.projectId}/exit/preview?path=MUTUAL`
      );
      state.pendingExitPath = 'MUTUAL';
      state.pendingExitPreview = preview.preview;
      const dialog = $('#exit-dialog');
      $('#exit-dialog-summary').textContent =
        'Accept mutual cancel? Money will move as listed:';
      $('#exit-dialog-lines').innerHTML = formatExitLines(preview.preview?.lines || []);
      const confirmed = await new Promise((resolve) => {
        const onClose = () => {
          dialog.removeEventListener('close', onClose);
          resolve(dialog.returnValue === 'confirm');
        };
        dialog.addEventListener('close', onClose);
        dialog.showModal();
      });
      if (!confirmed) return;
      const data = await api(`/api/projects/${state.projectId}/cancel/accept`, {
        method: 'POST',
        body: {},
      });
      if (data.project) renderProjectMeta(data.project);
      showLog('#log-exit', data);
      await refreshNotifications({ toastNew: true });
    } catch (err) {
      showLog('#log-exit', err.data || err.message);
    }
  });

  $('#form-work')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await submitWork(e.target);
    } catch (err) {
      showLog('#log-work', err.data || err.message);
    }
  });

  $('#btn-work-again')?.addEventListener('click', async () => {
    try {
      await simulateMerge();
    } catch (err) {
      showLog('#log-work', err.data || err.message);
    }
  });

  $('#btn-signoff')?.addEventListener('click', async () => {
    try {
      await clientSignoff();
    } catch (err) {
      showLog('#log-work', err.data || err.message);
    }
  });

  $('#btn-evidence')?.addEventListener('click', async () => {
    try {
      await loadEvidence();
    } catch (err) {
      showLog('#log-work', err.data || err.message);
    }
  });

  document.body.addEventListener('submit', async (e) => {
    const disputeForm = e.target.closest('[data-dispute-form]');
    if (disputeForm) {
      e.preventDefault();
      const log = disputeForm.closest('.panel')?.querySelector('.log');
      try {
        const data = await raiseDispute(disputeForm);
        if (log) {
          log.hidden = false;
          log.textContent = JSON.stringify(data, null, 2);
        }
      } catch (err) {
        if (log) {
          log.hidden = false;
          log.textContent = JSON.stringify(err.data || err.message, null, 2);
        }
      }
      return;
    }
    const decideForm = e.target.closest('[data-decide-form]');
    if (decideForm) {
      e.preventDefault();
      try {
        if (decideForm.dataset.armed !== '1') {
          await previewCounselorDecision(decideForm);
          decideForm.dataset.armed = '1';
          const confirm = decideForm.querySelector('[data-confirm]');
          if (confirm) confirm.textContent = 'Confirm — send the money';
          return;
        }
        await confirmCounselorDecision(decideForm);
      } catch (err) {
        showLog('#log-counselor', err.data || err.message);
      }
    }
  });

  function disarmDecision(form) {
    if (!form) return;
    form.dataset.armed = '';
    const confirm = form.querySelector('[data-confirm]');
    if (confirm) confirm.textContent = 'Confirm decision';
    const percent = form.querySelector('[name="freelancerPercent"]');
    const decision = form.querySelector('input[name="decision"]:checked')?.value;
    if (percent) percent.disabled = decision !== 'SPLIT';
  }

  $('#counselor-list')?.addEventListener('change', (e) => {
    disarmDecision(e.target.closest('[data-decide-form]'));
  });
  $('#counselor-list')?.addEventListener('input', (e) => {
    const form = e.target.closest('[data-decide-form]');
    if (!form || form.dataset.armed !== '1') return;
    disarmDecision(form);
  });

  $('#btn-counselor-resolved')?.addEventListener('click', () => {
    state.counselorStatus = state.counselorStatus === 'RESOLVED' ? 'OPEN' : 'RESOLVED';
    const btn = $('#btn-counselor-resolved');
    if (btn) btn.textContent = state.counselorStatus === 'RESOLVED' ? 'Show open disputes' : 'Show decided disputes';
    refreshCounselor();
  });

  $('#btn-notif')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNotifPanel();
  });

  $('#btn-notif-mark-all')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!state.userId) return;
    try {
      await api('/api/notifications/mark-read', { method: 'POST', body: { all: true } });
      await refreshNotifications();
    } catch (err) {
      showToast({ type: 'ERROR', message: err.message || 'Could not mark read' });
    }
  });

  $('#notif-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-notif-id]');
    if (!btn) return;
    const id = btn.dataset.notifId;
    try {
      await api('/api/notifications/mark-read', {
        method: 'POST',
        body: { notificationIds: [id] },
      });
      await refreshNotifications();
    } catch {
      /* ignore */
    }
  });

  document.addEventListener('click', (e) => {
    const wrap = $('#notif-wrap');
    if (!wrap || wrap.contains(e.target)) return;
    toggleNotifPanel(false);
  });
}

async function boot() {
  bindUi();
  await loadConsentAgreement();
  const rawHash = (location.hash || '#landing').slice(1);
  const hash = STEP_ALIAS[rawHash] || rawHash;
  go(STEPS.some((s) => s.id === hash) ? hash : 'landing');

  try {
    const health = await api('/health', { auth: false });
    $('#health-dot').className = health.ok ? 'ok' : 'bad';
  } catch {
    $('#health-dot').className = 'bad';
  }

  try {
    const listed = await api('/api/admin/demo/users', { auth: false, demo: true });
    for (const u of listed.users) {
      if (u.id) state.users[u.key] = u;
    }
    if (Object.values(state.users).some((u) => u.id)) {
      setPersonasEnabled(true);
      const key =
        Object.keys(state.users).find((k) => state.users[k].id === state.userId) ||
        (state.users.sarah?.id ? 'sarah' : null);
      if (key) selectPersona(key);
      else if (state.userId) await refreshMe();
      const step = STEP_ALIAS[(location.hash || '').slice(1)] || (location.hash || '').slice(1);
      if (step === 'paid') await refreshPaid();
      if (step === 'fund') await refreshDepositPanel();
    }
  } catch {
    // DB may be down during static preview — UI still loads
  }

  syncUsersPrimary();
  if (state.projectId && state.milestoneId) syncProjectActions();

  await refreshNotifications();
  if (state.projectId) {
    await refreshChat();
    const hash = (location.hash || '').slice(1);
    if (hash === 'project') startChatPolling();
  }
}

boot();
