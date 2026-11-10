const STEPS = [
  { id: 'landing', label: 'Home' },
  { id: 'users', label: 'Users' },
  { id: 'verify', label: 'Verify' },
  { id: 'project', label: 'Project' },
  { id: 'fund', label: 'Fund' },
  { id: 'github', label: 'GitHub' },
  { id: 'audit', label: 'Audit' },
  { id: 'paid', label: 'Paid' },
  { id: 'exit', label: 'Exit' },
  { id: 'counselor', label: 'Counselor' },
];

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
  if (step === 'fund') refreshDepositPanel();
  if (step === 'project') {
    refreshChat();
    startChatPolling();
  } else {
    stopChatPolling();
  }
  if (step === 'project' || step === 'exit' || step === 'paid') refreshDisputeOutcome();
  if (step === 'counselor') refreshCounselor();
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
  refreshNotifications();
  refreshChat();
  renderDepositPanel();
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
  $('#btn-project-next').disabled = false;
  renderProjectMeta(project, amountCents, milestone);
  renderDepositPanel();
  showLog('#log-project', { project, milestone });
  await refreshChat();
  startChatPolling();
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
  if (!state.projectId || !state.userId) {
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
}

async function refreshDepositPanel() {
  if (state.projectId && state.userId) {
    try {
      const data = await api(`/api/projects/${state.projectId}`);
      if (data?.project) {
        state.lastProject = { ...state.lastProject, ...data.project };
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
  state.lastMilestone = data.milestone || state.lastMilestone;
  state.awaitingSignoff = data.awaitingClientSignoff === true;
  renderAudit(data);
  $('#btn-audit-next').disabled = false;
  showLog('#log-audit', data);
  await refreshNotifications({ toastNew: true });
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
      ? 'Sarah signed off. PayPal payout is recorded on the next step.'
      : '';
    if (!hint.textContent) hint.hidden = true;
    return;
  }
  btn.hidden = false;
  hint.hidden = false;
  const sarahId = state.users.sarah?.id;
  const actingAsClient = sarahId && state.userId === sarahId;
  hint.textContent = actingAsClient
    ? 'AI passed the diff. Press sign-off to pay the full milestone. There is no auto-timeout.'
    : 'AI passed the diff. Switch to Sarah (client) and press sign-off to pay. Rohan cannot release this himself.';
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
  showLog('#log-audit', data);
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
    const { project } = await api(`/api/projects/${state.projectId}`);
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
  const money =
    dispute.status === 'RESOLVED'
      ? `<p>Freelancer ${usd(dispute.freelancerAmountCents)} · Client refund ${usd(dispute.clientRefundCents)} · Deposit ${escapeHtml(dispute.depositDisposition || 'NONE')} ${dispute.depositCents ? usd(dispute.depositCents) : ''}</p>
         <p>Decided by ${escapeHtml(dispute.decidedByLabel || 'counselor')} · ${escapeHtml(dispute.decision || '')}${dispute.freelancerPercent != null ? ` (${dispute.freelancerPercent}%)` : ''}</p>
         <p>${escapeHtml(dispute.note || '')}</p>`
      : `<p>Payout and exit are paused until the counselor decides.</p><p>${escapeHtml(dispute.reason || '')}</p>`;
  const html = `<h3>Dispute ${escapeHtml(dispute.status)}</h3>${money}`;
  boxes.forEach((box) => {
    box.hidden = false;
    box.innerHTML = html;
  });
}

async function refreshDisputeOutcome() {
  if (!state.projectId || !state.userId) return null;
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
  const recordings = evidence.callRecordings || {
    label: 'Evidence: call recordings — coming soon',
    roadmap: true,
    note: 'Roadmap only. This demo does not record calls and does not invent recordings.',
  };
  const decided = row.status === 'RESOLVED';
  const consentLine = (party, label) => {
    if (!party) return `<p>${label}: no consent log</p>`;
    const when = party.agreedAt ? new Date(party.agreedAt).toLocaleString() : '—';
    return `<p>${label}: version ${escapeHtml(party.consentVersion || '—')} · ${escapeHtml(when)}</p>`;
  };

  return `<article class="counselor-case" data-dispute-id="${escapeHtml(row.id)}">
    <h3>${escapeHtml(evidence.project?.title || row.projectTitle || 'Project')} · ${escapeHtml(row.status)}</h3>
    <p>${escapeHtml(row.raisedByName || 'A party')} raised this. ${escapeHtml(row.reason || '')}</p>
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
      <section class="evidence-card roadmap">
        <h4>${escapeHtml(recordings.label || 'Evidence: call recordings — coming soon')} <span class="roadmap-tag">Roadmap</span></h4>
        <p>${escapeHtml(recordings.note || 'Roadmap only. Calls are not recorded in this demo.')}</p>
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
            <p class="field-hint">The milestone is closed so it cannot be paid a second time. The amounts above are what moved${
              row.transferIds?.freelancerPayoutBatchId
                ? `. Payout ${escapeHtml(row.transferIds.freelancerPayoutBatchId)}`
                : ''
            }${
              row.transferIds?.vaultRefunds?.[0]?.refundId
                ? `. Refund ${escapeHtml(row.transferIds.vaultRefunds[0].refundId)}`
                : ''
            }.</p></div>`
        : `<form class="dispute-form" data-decide-form>
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
              <button type="button" class="btn secondary" data-preview>Preview split</button>
              <button type="submit" class="btn primary" data-confirm disabled>Confirm decision</button>
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

  $all('[data-path]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await previewExit(btn.dataset.path);
      } catch (err) {
        showLog('#log-exit', err.data || err.message);
      }
    });
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
    state.pendingExitPath = null;
    state.pendingExitPreview = null;
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

  $('#form-github').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await linkGithub(e.target);
    } catch (err) {
      showLog('#log-github', err.data || err.message);
    }
  });

  $('#btn-signoff')?.addEventListener('click', async () => {
    try {
      await clientSignoff();
    } catch (err) {
      showLog('#log-audit', err.data || err.message);
    }
  });

  $('#btn-evidence')?.addEventListener('click', async () => {
    try {
      await loadEvidence();
    } catch (err) {
      showLog('#log-audit', err.data || err.message);
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
        await confirmCounselorDecision(decideForm);
      } catch (err) {
        showLog('#log-counselor', err.data || err.message);
      }
    }
  });

  $('#counselor-list')?.addEventListener('click', async (e) => {
    const previewBtn = e.target.closest('[data-preview]');
    if (!previewBtn) return;
    const form = previewBtn.closest('[data-decide-form]');
    if (!form) return;
    try {
      await previewCounselorDecision(form);
    } catch (err) {
      showLog('#log-counselor', err.data || err.message);
    }
  });

  $('#counselor-list')?.addEventListener('change', (e) => {
    const form = e.target.closest('[data-decide-form]');
    if (!form) return;
    const confirm = form.querySelector('[data-confirm]');
    if (confirm) confirm.disabled = true;
    const percent = form.querySelector('[name="freelancerPercent"]');
    const decision = form.querySelector('input[name="decision"]:checked')?.value;
    if (percent) percent.disabled = decision !== 'SPLIT';
  });

  $('#btn-counselor-refresh')?.addEventListener('click', () => {
    state.counselorStatus = 'OPEN';
    refreshCounselor();
  });

  $('#btn-counselor-resolved')?.addEventListener('click', () => {
    state.counselorStatus = state.counselorStatus === 'RESOLVED' ? 'OPEN' : 'RESOLVED';
    const btn = $('#btn-counselor-resolved');
    if (btn) btn.textContent = state.counselorStatus === 'RESOLVED' ? 'Show open' : 'Show decided';
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

  await refreshNotifications();
  if (state.projectId) {
    await refreshChat();
    const hash = (location.hash || '').slice(1);
    if (hash === 'project') startChatPolling();
  }
}

boot();
