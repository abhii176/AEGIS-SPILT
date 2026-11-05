const STEPS = [
  { id: 'landing', label: 'Home' },
  { id: 'users', label: 'Users' },
  { id: 'verify', label: 'Verify' },
  { id: 'project', label: 'Project' },
  { id: 'fund', label: 'Fund' },
  { id: 'github', label: 'GitHub' },
  { id: 'audit', label: 'Audit' },
  { id: 'paid', label: 'Paid' },
];

const state = {
  demoKey: localStorage.getItem('aegis.demoKey') || 'hackathon-demo-key',
  userId: localStorage.getItem('aegis.userId') || '',
  user: null,
  users: {},
  projectId: localStorage.getItem('aegis.projectId') || '',
  milestoneId: localStorage.getItem('aegis.milestoneId') || '',
  approvalUrl: '',
  lastAudit: null,
  lastMilestone: null,
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
  el.hidden = false;
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
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
  if (!STEPS.some((s) => s.id === step)) return;
  $all('.panel').forEach((p) => p.classList.toggle('active', p.dataset.step === step));
  $all('.step-rail button').forEach((b) => b.classList.toggle('active', b.dataset.go === step));
  history.replaceState(null, '', `#${step}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (step === 'verify') refreshVerifyUi();
  if (step === 'paid') refreshPaid();
}

function renderRail() {
  const rail = $('#step-rail');
  rail.innerHTML = STEPS.map(
    (s) => `<button type="button" data-go="${s.id}">${s.label}</button>`
  ).join('');
}

function updateSessionChip() {
  const chip = $('#session-chip');
  if (!state.user) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  $('#session-name').textContent = `${state.user.name || state.user.email} · ${state.user.role}`;
}

function setPersonasEnabled(enabled) {
  $all('.persona').forEach((btn) => {
    btn.disabled = !enabled;
  });
}

function selectPersona(key) {
  const user = state.users[key];
  if (!user?.id) return;
  state.userId = user.id;
  state.user = user;
  persist();
  $all('.persona').forEach((b) => b.classList.toggle('selected', b.dataset.persona === key));
  $('#btn-users-next').disabled = false;
  updateSessionChip();
  refreshVerifyUi();
}

async function refreshMe() {
  if (!state.userId) return null;
  const { user } = await api('/api/auth/me');
  state.user = user;
  const match = Object.entries(state.users).find(([, u]) => u.id === user.id);
  if (match) state.users[match[0]] = { ...state.users[match[0]], ...user };
  updateSessionChip();
  refreshVerifyUi();
  return user;
}

function refreshVerifyUi() {
  const kyc = $('#verify-status [data-flag="kyc"] strong');
  const consent = $('#verify-status [data-flag="consent"] strong');
  const kycOn = Boolean(state.user?.govIdVerified);
  const consentOn = Boolean(state.user?.monitoringConsentGranted);
  kyc.textContent = kycOn ? `yes (${state.user.kycProvider || 'verified'})` : 'no';
  consent.textContent = consentOn ? 'yes' : 'no';
  $('#verify-status [data-flag="kyc"]').classList.toggle('on', kycOn);
  $('#verify-status [data-flag="consent"]').classList.toggle('on', consentOn);
  $('#btn-verify-next').disabled = !(kycOn && consentOn);
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
  $('#btn-users-next').disabled = !state.userId;
}

async function verifyIdentity() {
  if (!state.userId) throw new Error('Pick a user first');
  const country = state.user?.countryCode || 'US';
  const start = await api('/api/auth/verify-identity', {
    method: 'POST',
    body: { countryCode: country },
  });

  let result;
  if (start.provider === 'digilocker' && start.authorizeUrl) {
    const url = new URL(start.authorizeUrl);
    const oauthState = url.searchParams.get('state');
    result = await api(
      `/api/auth/verify-identity/callback/digilocker?code=demo-scaffold&state=${encodeURIComponent(oauthState || '')}`,
      { auth: false }
    );
  } else if (start.verificationUrl) {
    const url = new URL(start.verificationUrl, window.location.origin);
    result = await api(`${url.pathname}${url.search}`, { auth: false });
  } else {
    throw new Error('Unexpected verify-identity response');
  }

  showLog('#log-verify', { start, result });
  await refreshMe();
}

async function grantConsent() {
  const result = await api('/api/consent/monitoring', {
    method: 'POST',
    body: { accepted: true },
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

  const { project } = await api('/api/projects', {
    method: 'POST',
    body: {
      title,
      description: 'Hackathon demo engagement',
      freelancerId: rohan.id,
      clientId: sarah.id,
      status: 'ACTIVE',
    },
  });

  const amountCents = Math.round(amountUsd * 100);
  const { milestone } = await api(`/api/projects/${project.id}/milestones`, {
    method: 'POST',
    body: {
      title: milestoneTitle,
      taskDescription: 'Deliver Milestone 1 per acceptance criteria',
      acceptanceCriteria,
      amountCents,
    },
  });

  state.userId = prior || sarah.id;
  state.projectId = project.id;
  state.milestoneId = milestone.id;
  state.lastMilestone = milestone;
  persist();
  $('#btn-project-next').disabled = false;
  showLog('#log-project', { project, milestone });
}

async function ensureActorReady(userId) {
  state.userId = userId;
  let user = (await api('/api/auth/me')).user;
  if (!user.govIdVerified) {
    const country = user.countryCode || 'US';
    const start = await api('/api/auth/verify-identity', {
      method: 'POST',
      body: { countryCode: country },
    });
    if (start.provider === 'digilocker' && start.authorizeUrl) {
      const url = new URL(start.authorizeUrl);
      await api(
        `/api/auth/verify-identity/callback/digilocker?code=demo-scaffold&state=${encodeURIComponent(url.searchParams.get('state') || '')}`,
        { auth: false }
      );
    } else if (start.verificationUrl) {
      const url = new URL(start.verificationUrl, window.location.origin);
      await api(`${url.pathname}${url.search}`, { auth: false });
    }
    user = (await api('/api/auth/me')).user;
  }
  if (!user.monitoringConsentGranted) {
    await api('/api/consent/monitoring', { method: 'POST', body: { accepted: true } });
    user = (await api('/api/auth/me')).user;
  }
  state.user = user;
  return user;
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
  $('#btn-fund-next').disabled = false;
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
  $('#btn-github-next').disabled = false;
  showLog('#log-github', data);
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
  state.lastMilestone = data.milestone || null;
  renderAudit(data);
  $('#btn-audit-next').disabled = false;
  showLog('#log-audit', data);
}

function renderAudit(data) {
  const board = $('#audit-board');
  board.hidden = false;
  const passed = data.audit?.passed === true || data.milestone?.auditPassed === true;
  const verdict = $('#audit-verdict');
  verdict.textContent = passed ? 'PASS — criteria met' : 'FAIL — criteria not met';
  verdict.className = `audit-verdict ${passed ? 'pass' : 'fail'}`;

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
    const { project } = await api(`/api/projects/${state.projectId}`);
    const milestone =
      project.milestones?.find((m) => m.id === state.milestoneId) || project.milestones?.[0];
    state.lastMilestone = milestone || null;
    renderPaid(milestone);
    showLog('#log-paid', { project, milestone });
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
  $('#paid-status').textContent = paid
    ? `Status: ${status} — vault released to freelancer`
    : `Status: ${status}${milestone.auditPassed === false ? ' (audit failed)' : ''}`;

  const rows = [
    ['Milestone', milestone.title],
    ['Audit', milestone.auditPassed == null ? '—' : milestone.auditPassed ? 'PASS' : 'FAIL'],
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

function bindUi() {
  renderRail();

  document.body.addEventListener('click', (e) => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) {
      e.preventDefault();
      go(goBtn.dataset.go);
    }
  });

  $('#btn-seed-users').addEventListener('click', async () => {
    try {
      await seedUsers();
    } catch (err) {
      showLog('#log-users', err.data || err.message);
    }
  });

  $all('.persona').forEach((btn) => {
    btn.addEventListener('click', () => selectPersona(btn.dataset.persona));
  });

  $('#btn-switch-user').addEventListener('click', () => go('users'));

  $('#btn-verify-id').addEventListener('click', async () => {
    try {
      await verifyIdentity();
    } catch (err) {
      showLog('#log-verify', err.data || err.message);
    }
  });

  $('#btn-consent').addEventListener('click', async () => {
    try {
      await grantConsent();
    } catch (err) {
      showLog('#log-verify', err.data || err.message);
    }
  });

  $('#form-project').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await createProjectAndMilestone(e.target);
    } catch (err) {
      showLog('#log-project', err.data || err.message);
    }
  });

  $('#btn-fund').addEventListener('click', async () => {
    try {
      await fundVault();
    } catch (err) {
      showLog('#log-fund', err.data || err.message);
    }
  });

  $('#form-github').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await linkGithub(e.target);
    } catch (err) {
      showLog('#log-github', err.data || err.message);
    }
  });

  $('#btn-simulate').addEventListener('click', async () => {
    try {
      await simulateMerge();
    } catch (err) {
      showLog('#log-audit', err.data || err.message);
    }
  });

  $('#btn-refresh-paid').addEventListener('click', () => refreshPaid());
}

async function boot() {
  bindUi();
  const hash = (location.hash || '#landing').slice(1);
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
    }
  } catch {
    // DB may be down during static preview — UI still loads
  }

  if (state.projectId && state.milestoneId) {
    $('#btn-project-next').disabled = false;
    $('#btn-fund-next').disabled = false;
    $('#btn-github-next').disabled = false;
  }
}

boot();
