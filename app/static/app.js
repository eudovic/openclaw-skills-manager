const bootstrap = JSON.parse(document.getElementById("bootstrap-data").textContent);
const isDashboardPage = Boolean(document.getElementById("skillList"));
const i18n = window.OpenClawI18n;
const t = (key, values) => (i18n ? i18n.t(key, values) : key);
const formatTimeLabel = () =>
  new Intl.DateTimeFormat(i18n ? i18n.getLocale() : undefined, { timeStyle: "medium" }).format(new Date());

const state = {
  bootstrap,
  appAuth: {
    required: Boolean(bootstrap.appAuth?.required),
    authenticated: Boolean(bootstrap.appAuth?.authenticated),
  },
  auth: {
    gatewayUrl: "",
    gatewayToken: "",
    basicUser: "",
    basicPass: "",
    connected: false,
  },
  gatewayConnecting: false,
  gatewayAutoAttempted: false,
  localSkills: [],
  remoteSkills: [],
  remoteInfo: null,
  skills: [],
  syncingSkillSlugs: new Set(),
  selectedSkill: null,
  skillTree: null,
  selectedPath: null,
  selectedFile: null,
  selectedFileContent: "",
  lastSavedContent: "",
  activeTab: "metadata",
  searchResults: [],
  filterText: "",
  expandedPaths: new Set(),
  metadataFields: {},
  metadataWarnings: [],
};

const els = {
  appTitle: document.getElementById("appTitle"),
  workspaceSummary: document.getElementById("workspaceSummary"),
  gatewayStatusPill: document.getElementById("gatewayStatusPill"),
  gatewayHeroStatus: document.getElementById("gatewayHeroStatus"),
  gatewayHeroDot: document.getElementById("gatewayHeroDot"),
  gatewayHeroBar: document.getElementById("gatewayHeroBar"),
  reconnectButton: document.getElementById("reconnectButton"),
  createSkillButton: document.getElementById("createSkillButton"),
  refreshSkillsButton: document.getElementById("refreshSkillsButton"),
  skillFilterInput: document.getElementById("skillFilterInput"),
  skillCounter: document.getElementById("skillCounter"),
  metricTotalSkills: document.getElementById("metricTotalSkills"),
  metricLocalSkills: document.getElementById("metricLocalSkills"),
  metricRemoteSkills: document.getElementById("metricRemoteSkills"),
  skillList: document.getElementById("skillList"),
  selectedSkillTitle: document.getElementById("selectedSkillTitle"),
  selectedSkillSubtitle: document.getElementById("selectedSkillSubtitle"),
  openManifestButton: document.getElementById("openManifestButton"),
  saveFileButton: document.getElementById("saveFileButton"),
  skillSummaryGrid: document.getElementById("skillSummaryGrid"),
  statusBanner: document.getElementById("statusBanner"),
  treeView: document.getElementById("treeView"),
  newFileButton: document.getElementById("newFileButton"),
  newFolderButton: document.getElementById("newFolderButton"),
  renameNodeButton: document.getElementById("renameNodeButton"),
  deleteNodeButton: document.getElementById("deleteNodeButton"),
  searchForm: document.getElementById("searchForm"),
  searchInput: document.getElementById("searchInput"),
  searchResults: document.getElementById("searchResults"),
  editorFileTitle: document.getElementById("editorFileTitle"),
  editorFileMeta: document.getElementById("editorFileMeta"),
  dirtyIndicator: document.getElementById("dirtyIndicator"),
  reloadFileButton: document.getElementById("reloadFileButton"),
  copyCommandButton: document.getElementById("copyCommandButton"),
  fileEditor: document.getElementById("fileEditor"),
  tabs: document.getElementById("tabs"),
  metadataForm: document.getElementById("metadataForm"),
  metadataWarnings: document.getElementById("metadataWarnings"),
  resourceList: document.getElementById("resourceList"),
  resourceGrid: document.getElementById("resourceGrid"),
  docNoteList: document.getElementById("docNoteList"),
  runSkillsListButton: document.getElementById("runSkillsListButton"),
  runSkillsCheckButton: document.getElementById("runSkillsCheckButton"),
  runGatewayStatusButton: document.getElementById("runGatewayStatusButton"),
  applySkillButton: document.getElementById("applySkillButton"),
  restartGatewayButton: document.getElementById("restartGatewayButton"),
  testSkillButton: document.getElementById("testSkillButton"),
  workspaceCode: document.getElementById("workspaceCode"),
  appLoginOverlay: document.getElementById("appLoginOverlay"),
  appLoginForm: document.getElementById("appLoginForm"),
  appLoginUserInput: document.getElementById("appLoginUserInput"),
  appLoginPassInput: document.getElementById("appLoginPassInput"),
  appLoginError: document.getElementById("appLoginError"),
  loginOverlay: document.getElementById("loginOverlay"),
  loginForm: document.getElementById("loginForm"),
  gatewayUrlInput: document.getElementById("gatewayUrlInput"),
  gatewayTokenInput: document.getElementById("gatewayTokenInput"),
  gatewayBasicUserInput: document.getElementById("gatewayBasicUserInput"),
  gatewayBasicPassInput: document.getElementById("gatewayBasicPassInput"),
  offlineModeButton: document.getElementById("offlineModeButton"),
  loginError: document.getElementById("loginError"),
  loginWorkspace: document.getElementById("loginWorkspace"),
  loginSkillsRoot: document.getElementById("loginSkillsRoot"),
  gatewayDefaultsHint: document.getElementById("gatewayDefaultsHint"),
  createSkillDialog: document.getElementById("createSkillDialog"),
  createSkillForm: document.getElementById("createSkillForm"),
  templateSelect: document.getElementById("templateSelect"),
  creationDocs: document.getElementById("creationDocs"),
  pathDialog: document.getElementById("pathDialog"),
  pathDialogForm: document.getElementById("pathDialogForm"),
  pathDialogEyebrow: document.getElementById("pathDialogEyebrow"),
  pathDialogTitle: document.getElementById("pathDialogTitle"),
  pathDialogLabel: document.getElementById("pathDialogLabel"),
  pathDialogInput: document.getElementById("pathDialogInput"),
  pathDialogHint: document.getElementById("pathDialogHint"),
  pathDialogSubmitButton: document.getElementById("pathDialogSubmitButton"),
};

const hasDashboardWorkbench = Boolean(
  els.selectedSkillTitle &&
  els.selectedSkillSubtitle &&
  els.skillSummaryGrid &&
  els.statusBanner &&
  els.treeView &&
  els.fileEditor &&
  els.metadataForm &&
  els.tabs
);

const pathDialogState = {
  mode: null,
};

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, mode = "info") {
  if (!els.statusBanner) {
    addLog("Status", { mode, message });
    return;
  }
  els.statusBanner.classList.remove("is-error");
  if (mode === "error") {
    els.statusBanner.classList.add("is-error");
  }
  els.statusBanner.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function setLoginError(message = "") {
  els.loginError.textContent = message;
}

function handleError(error, context = t("status.failed")) {
  const message = error instanceof Error ? error.message : String(error);
  addLog(context, { message });
  if (!els.appLoginOverlay.classList.contains("hidden")) {
    setAppLoginError(`${context}: ${message}`);
  } else if (!els.loginOverlay.classList.contains("hidden")) {
    setLoginError(`${context}: ${message}`);
  }
  setStatus(`${context}: ${message}`, "error");
}

function guard(handler, context) {
  return async (event) => {
    try {
      await handler(event);
    } catch (error) {
      handleError(error, context);
    }
  };
}

function migrateGatewayUrl(savedUrl, defaultUrl) {
  if (!savedUrl || !defaultUrl) {
    return savedUrl || defaultUrl || "";
  }
  try {
    const saved = new URL(savedUrl);
    const next = new URL(defaultUrl);
    const isLegacyDirectPort =
      saved.hostname === next.hostname &&
      (saved.protocol === "ws:" || saved.protocol === "wss:") &&
      saved.port === "18789" &&
      !saved.pathname.replaceAll("/", "") &&
      next.protocol === "wss:" &&
      next.port === "";
    return isLegacyDirectPort ? defaultUrl : savedUrl;
  } catch (error) {
    return savedUrl;
  }
}

function loadAuthFromStorage() {
  const persisted = window.localStorage.getItem("openclaw-skill-studio-auth");
  const defaults = {
    gatewayUrl: bootstrap.gateway.url || "",
    gatewayToken: "",
    basicUser: "",
    basicPass: "",
    connected: false,
  };
  if (!persisted) {
    state.auth = defaults;
    return;
  }
  try {
    const parsed = JSON.parse(persisted);
    state.auth = {
      ...defaults,
      gatewayUrl: migrateGatewayUrl(parsed.gatewayUrl || "", defaults.gatewayUrl),
      connected: false,
    };
  } catch (error) {
    state.auth = defaults;
  }
}

function persistAuth() {
  window.localStorage.setItem(
    "openclaw-skill-studio-auth",
    JSON.stringify({
      gatewayUrl: state.auth.gatewayUrl,
    })
  );
}

function setAppLoginError(message = "") {
  els.appLoginError.textContent = message;
}

function syncGatewayInputs() {
  els.gatewayUrlInput.value = state.auth.gatewayUrl;
  els.gatewayTokenInput.value = state.auth.gatewayToken;
  els.gatewayBasicUserInput.value = state.auth.basicUser;
  els.gatewayBasicPassInput.value = state.auth.basicPass;
}

async function appLogin(username, password) {
  return apiFetch("/api/app-auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

async function appLogout() {
  return apiFetch("/api/app-auth/logout", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

function gatewayCredentialPayload() {
  return {
    gatewayUrl: state.auth.gatewayUrl,
    gatewayToken: state.auth.gatewayToken,
    basicUser: state.auth.basicUser,
    basicPass: state.auth.basicPass,
  };
}

function resetGatewayAuth({ preserveUrl = true } = {}) {
  state.auth = {
    gatewayUrl: preserveUrl ? state.auth.gatewayUrl || bootstrap.gateway.url || "" : bootstrap.gateway.url || "",
    gatewayToken: "",
    basicUser: "",
    basicPass: "",
    connected: false,
  };
  state.remoteInfo = null;
  state.remoteSkills = [];
  state.gatewayAutoAttempted = false;
  state.skills = [...state.localSkills];
  state.selectedSkill = null;
  state.skillTree = null;
  state.selectedPath = null;
  state.selectedFile = null;
  state.selectedFileContent = "";
  state.syncingSkillSlugs = new Set();
  state.lastSavedContent = "";
  syncGatewayInputs();
  persistAuth();
}

function preferredGatewayUrl() {
  return state.auth.gatewayUrl || bootstrap.gateway.url || "";
}

function canAttemptGatewayAutoConnect() {
  return Boolean(preferredGatewayUrl());
}

async function connectGateway(nextAuth, { auto = false } = {}) {
  const gatewayProbe = await probeGateway(nextAuth.gatewayUrl, nextAuth.basicUser, nextAuth.basicPass);
  const remoteSnapshot = await fetchRemoteSkillsSnapshot({
    ...nextAuth,
    connected: false,
  });
  state.auth.gatewayUrl = nextAuth.gatewayUrl;
  state.auth.gatewayToken = nextAuth.gatewayToken;
  state.auth.basicUser = nextAuth.basicUser;
  state.auth.basicPass = nextAuth.basicPass;
  state.auth.connected = true;
  syncGatewayInputs();
  persistAuth();
  updateGatewayBadge();
  updateOverlayVisibility();
  addLog(auto ? "Gateway conectado automaticamente" : "Gateway validado", {
    gatewayUrl: state.auth.gatewayUrl,
    host: gatewayProbe.host,
    ip: gatewayProbe.ip,
    port: gatewayProbe.port,
    workspaceDir: remoteSnapshot?.workspaceDir || gatewayProbe.workspaceDir || "",
    workspaceSkillCount: remoteSnapshot?.workspaceSkillCount || gatewayProbe.workspaceSkillCount || 0,
    hasToken: Boolean(state.auth.gatewayToken || bootstrap.gateway.hasServerTokenDefault),
    hasBasicAuth: Boolean(
      (state.auth.basicUser && state.auth.basicPass) || bootstrap.gateway.hasServerBasicAuthDefault
    ),
    auto,
  });
  await loadSkills({ keepSelection: false, remoteSnapshot });
}

async function tryAutoGatewayConnect() {
  if (!canAttemptGatewayAutoConnect()) {
    state.gatewayAutoAttempted = true;
    return false;
  }
  const nextAuth = {
    gatewayUrl: preferredGatewayUrl(),
    gatewayToken: "",
    basicUser: "",
    basicPass: "",
    connected: false,
  };
  state.gatewayConnecting = true;
  state.auth.connected = false;
  setLoginError("");
  updateGatewayBadge();
  updateOverlayVisibility();
  try {
    await connectGateway(nextAuth, { auto: true });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.auth.connected = false;
    syncGatewayInputs();
    setLoginError(`Failed to auto-connect: ${message}`);
    addLog("Auto-connect failed", { message });
    return false;
  } finally {
    state.gatewayAutoAttempted = true;
    state.gatewayConnecting = false;
    updateGatewayBadge();
    updateOverlayVisibility();
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (response.status === 401) {
    state.appAuth.authenticated = false;
    resetGatewayAuth({ preserveUrl: true });
    updateGatewayBadge();
    updateOverlayVisibility();
  }
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || t("status.requestFailed"));
  }
  return payload.data;
}

async function probeGateway(gatewayUrl, basicUser, basicPass) {
  return apiFetch("/api/gateway/probe", {
    method: "POST",
    body: JSON.stringify({
      gatewayUrl,
      gatewayToken: els.gatewayTokenInput.value.trim(),
      basicUser,
      basicPass,
    }),
  });
}

async function fetchRemoteSkillsSnapshot(auth = state.auth) {
  if (!auth.gatewayUrl) {
    return null;
  }
  return apiFetch("/api/gateway/skills", {
    method: "POST",
    body: JSON.stringify({
      gatewayUrl: auth.gatewayUrl,
      gatewayToken: auth.gatewayToken,
      basicUser: auth.basicUser,
      basicPass: auth.basicPass,
    }),
  });
}

function selectedSkillRecord() {
  return state.skills.find((skill) => skill.slug === state.selectedSkill) || null;
}

function isRemoteSkill(skill = selectedSkillRecord()) {
  return Boolean(skill && skill.remote);
}

function mergeSkills(localSkills, remoteSkills) {
  const merged = [...localSkills];
  const seen = new Set(localSkills.map((skill) => skill.slug));
  remoteSkills.forEach((skill) => {
    if (!seen.has(skill.slug)) {
      merged.push(skill);
    }
  });
  return merged.sort((left, right) => left.slug.localeCompare(right.slug));
}

function addLog(title, data) {
  if (window.console && typeof window.console.debug === "function") {
    window.console.debug(`[OpenClaw] ${title}`, { at: formatTimeLabel(), data });
  }
}

function openSkillDetail(skillSlug) {
  if (!skillSlug) {
    return;
  }
  window.location.href = `/skills/${encodeURIComponent(skillSlug)}`;
}

function renderBootstrap() {
  els.appTitle.textContent = bootstrap.appTitle;
  const skillsLabel = bootstrap.skillsDirAutoDetected
    ? `${bootstrap.skillsDir} (autodetected from ${bootstrap.skillsDirConfigured})`
    : bootstrap.skillsDir;
  els.workspaceSummary.textContent = t("dashboard.workspaceSummary", {
    workspace: bootstrap.workspaceRoot,
    skills: skillsLabel,
  });
  if (els.workspaceCode) {
    els.workspaceCode.textContent = bootstrap.workspaceRoot;
  }
  els.loginWorkspace.textContent = bootstrap.workspaceRoot;
  els.loginSkillsRoot.textContent = bootstrap.skillsDir;
  syncGatewayInputs();
  els.gatewayDefaultsHint.textContent =
    bootstrap.gateway.hasServerTokenDefault || bootstrap.gateway.hasServerBasicAuthDefault
      ? t("dashboard.serverDefaultsHint")
      : "";

  els.templateSelect.innerHTML = bootstrap.templates
    .map(
      (template) =>
        `<option value="${escapeHtml(template.id)}">${escapeHtml(template.label)} - ${escapeHtml(template.description)}</option>`
    )
    .join("");

  const resourcesMarkup = bootstrap.docs
    .map(
      (doc) => `
        <a class="resource-card" href="${escapeHtml(doc.url)}" target="_blank" rel="noreferrer">
          <strong>${escapeHtml(doc.title)}</strong>
          <span>${escapeHtml(doc.summary)}</span>
        </a>
      `
    )
    .join("");

  if (els.resourceList) {
    els.resourceList.innerHTML = resourcesMarkup;
  }
  if (els.resourceGrid) {
    els.resourceGrid.innerHTML = resourcesMarkup;
  }
  if (els.creationDocs) {
    els.creationDocs.innerHTML = resourcesMarkup;
  }
  if (els.docNoteList) {
    els.docNoteList.innerHTML = bootstrap.notes
      .map((note) => `<div class="doc-note">${escapeHtml(note)}</div>`)
      .join("");
  }
}

function updateGatewayBadge() {
  const setHeroState = (message, tone) => {
    if (els.gatewayHeroStatus) {
      els.gatewayHeroStatus.textContent = message;
    }
    if (els.gatewayHeroDot) {
      els.gatewayHeroDot.classList.remove("is-connected", "is-warning");
      if (tone === "connected") {
        els.gatewayHeroDot.classList.add("is-connected");
      } else if (tone === "warning") {
        els.gatewayHeroDot.classList.add("is-warning");
      }
    }
    if (els.gatewayHeroBar) {
      els.gatewayHeroBar.classList.remove("is-connected", "is-warning");
      if (tone === "connected") {
        els.gatewayHeroBar.classList.add("is-connected");
      } else if (tone === "warning") {
        els.gatewayHeroBar.classList.add("is-warning");
      }
    }
  };

  if (state.appAuth.required && !state.appAuth.authenticated) {
    els.gatewayStatusPill.textContent = t("gateway.appLocked");
    els.gatewayStatusPill.classList.remove("is-connected");
    setHeroState(t("dashboard.waitingAuthentication"), "warning");
    els.reconnectButton.textContent = t("action.signIn");
    return;
  }
  if (state.gatewayConnecting) {
    els.gatewayStatusPill.textContent = t("gateway.connecting", {
      url: preferredGatewayUrl() || t("gateway.offlineMode"),
    });
    els.gatewayStatusPill.classList.remove("is-connected");
    setHeroState(t("dashboard.connectingGateway"), "warning");
    els.reconnectButton.textContent = state.appAuth.required ? t("action.signOut") : t("action.connect");
    return;
  }
  if (state.auth.connected) {
    const label = state.auth.gatewayUrl ? state.auth.gatewayUrl : bootstrap.gateway.url || t("gateway.offlineMode");
    els.gatewayStatusPill.textContent = t("gateway.authenticated", { url: label || t("gateway.offlineMode") });
    els.gatewayStatusPill.classList.add("is-connected");
    setHeroState(t("dashboard.systemNominal"), "connected");
  } else {
    els.gatewayStatusPill.textContent = bootstrap.gateway.url
      ? t("gateway.ready", { url: bootstrap.gateway.url })
      : t("status.gatewayDisconnected");
    els.gatewayStatusPill.classList.remove("is-connected");
    setHeroState(bootstrap.gateway.url ? t("gateway.readyForLogin") : t("status.gatewayDisconnected"), "warning");
  }
  els.reconnectButton.textContent = state.appAuth.required ? t("action.signOut") : t("action.connect");
}

function updateOverlayVisibility() {
  if (state.appAuth.required && !state.appAuth.authenticated) {
    els.appLoginOverlay.classList.remove("hidden");
    els.loginOverlay.classList.add("hidden");
    setAppLoginError("");
    return;
  }
  els.appLoginOverlay.classList.add("hidden");
  if (!state.auth.connected && canAttemptGatewayAutoConnect() && !state.gatewayAutoAttempted) {
    els.loginOverlay.classList.add("hidden");
    return;
  }
  if (state.gatewayConnecting) {
    els.loginOverlay.classList.add("hidden");
    return;
  }
  if (state.auth.connected) {
    els.loginOverlay.classList.add("hidden");
    setLoginError("");
  } else {
    els.loginOverlay.classList.remove("hidden");
  }
}

function renderSkillList() {
  const filter = state.filterText.trim().toLowerCase();
  const filtered = state.skills.filter((skill) => {
    if (!filter) {
      return true;
    }
    const haystack = [skill.slug, skill.name, skill.description, ...(skill.warnings || [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(filter);
  });

  const localCount = state.skills.filter((skill) => !skill.remote).length;
  const remoteCount = state.skills.filter((skill) => skill.remote).length;
  if (els.metricTotalSkills) {
    els.metricTotalSkills.textContent = String(state.skills.length);
  }
  if (els.metricLocalSkills) {
    els.metricLocalSkills.textContent = String(localCount);
  }
  if (els.metricRemoteSkills) {
    els.metricRemoteSkills.textContent = String(remoteCount);
  }
  els.skillCounter.textContent = remoteCount
    ? t("dashboard.visibleCount", { count: filtered.length, local: localCount, remote: remoteCount })
    : t("dashboard.workspaceCount", { count: filtered.length });

  if (!filtered.length) {
    const emptyHint =
      state.auth.connected && state.auth.gatewayUrl
        ? t("dashboard.noSkillRemoteHint")
        : !bootstrap.workspaceRootExists
          ? t("dashboard.noSkillMountHint", { workspace: bootstrap.workspaceRoot })
          : t("dashboard.noSkillFolderHint", { skillsDir: bootstrap.skillsDir });
    els.skillList.innerHTML = `
      <article class="skill-empty-state md:col-span-2 xl:col-span-3">
        <div class="skill-empty-icon">
          <span class="material-symbols-outlined">add_circle</span>
        </div>
        <h3>${escapeHtml(t("dashboard.noSkillFound"))}</h3>
        <p>${escapeHtml(emptyHint)}</p>
      </article>
    `;
    return;
  }

  const categoryForSkill = (skill) => skill.category || skill.metadataFields?.category || t("filter.automation");
  const iconForSkill = (skill) => skill.icon || skill.metadataFields?.icon || "auto_fix";
  const toneForSkill = (skill) => {
    if (skill.remote) {
      return "primary";
    }
    if (skill.warnings.length || !skill.hasManifest) {
      return "warning";
    }
    return "secondary";
  };
  const statusForSkill = (skill) => {
    if (skill.remote) {
      return t("dashboard.remoteStatus");
    }
    if (!skill.hasManifest) {
      return t("dashboard.draftStatus");
    }
    if (skill.warnings.length) {
      return t("dashboard.alertStatus");
    }
    return t("dashboard.activeStatus");
  };
  const formatUpdated = (value) => {
    if (!value) {
      return "--";
    }
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return value;
    }
    const delta = Date.now() - timestamp;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < hour) {
      const minutes = Math.max(1, Math.round(delta / minute));
      return `${minutes}m`;
    }
    if (delta < day) {
      return `${Math.max(1, Math.round(delta / hour))}h`;
    }
    if (delta < 7 * day) {
      return `${Math.max(1, Math.round(delta / day))}d`;
    }
    return i18n ? i18n.formatDateTime(value, { dateStyle: "short" }) : new Date(timestamp).toLocaleDateString();
  };

  els.skillList.innerHTML = filtered
    .map((skill, index) => {
      const selected = skill.slug === state.selectedSkill;
      const tone = toneForSkill(skill);
      const status = statusForSkill(skill);
      const category = categoryForSkill(skill);
      const icon = iconForSkill(skill);
      const filesLabel = skill.remote ? t("filter.gateway") : String(skill.fileCount);
      const updatedLabel = skill.remote
        ? skill.source || t("filter.gateway")
        : formatUpdated(skill.lastUpdated);
      const description = skill.description || "No description in frontmatter";
      const canSyncSkill = !skill.remote && skill.hasManifest;
      const syncingSkill = state.syncingSkillSlugs.has(skill.slug);
      const syncActionLabel = syncingSkill
        ? t("sync.syncing")
        : bootstrap.remoteSync?.mirrorRoot || bootstrap.remoteSync?.hasPushCommand
          ? t("action.publish")
          : t("action.sync");
      return `
        <article class="skill-tile ${selected ? "selected" : ""}" data-skill="${escapeHtml(skill.slug)}" style="animation-delay:${index * 40}ms">
          <div class="skill-tile-head">
            <div class="skill-tile-icon ${tone}">
              <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
            </div>
            <span class="skill-tile-category ${tone}">${escapeHtml(category)}</span>
          </div>
          <div class="skill-tile-body">
            <div>
              <h3>${escapeHtml(skill.slug)}</h3>
              <p class="skill-tile-slug">${escapeHtml(skill.name || skill.slug)}</p>
            </div>
            <p>${escapeHtml(description)}</p>
          </div>
          <div class="skill-tile-meta">
            <div>
              <span>${escapeHtml(t("common.files"))}</span>
              <strong>${escapeHtml(filesLabel)}</strong>
            </div>
            <div>
              <span>${escapeHtml(t("common.updated"))}</span>
              <strong>${escapeHtml(updatedLabel)}</strong>
            </div>
            <div class="text-right">
              <span>${escapeHtml(t("table.status"))}</span>
              <strong class="skill-tile-status ${tone}">${escapeHtml(status)}</strong>
            </div>
          </div>
          <div class="skill-tile-actions">
            <a class="ghost-button small-button" href="/skills/${encodeURIComponent(skill.slug)}">${escapeHtml(t("action.openCockpit"))}</a>
            ${
              canSyncSkill
                ? `<button class="ghost-button small-button ${syncingSkill ? "is-loading" : ""}" data-action="sync-skill" data-skill-slug="${escapeHtml(skill.slug)}" type="button" ${syncingSkill ? "disabled" : ""}>${syncActionLabel}</button>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSummary() {
  if (!hasDashboardWorkbench) {
    return;
  }
  const current = selectedSkillRecord();
  if (!current) {
    els.selectedSkillTitle.textContent = t("dashboard.selectSkill");
    els.selectedSkillSubtitle.textContent = t("dashboard.loadTreeAfterConnection");
    els.skillSummaryGrid.innerHTML = "";
    els.statusBanner.textContent = t("dashboard.editWorkspaceHint");
    updateActionAvailability();
    return;
  }

  els.selectedSkillTitle.textContent = current.slug;
  els.selectedSkillSubtitle.textContent = current.remote
    ? current.description || t("dashboard.remoteSkillDetected")
    : current.description || t("dashboard.missingDescription");

  if (current.remote) {
    const remoteWorkspace = state.remoteInfo?.workspaceDir || "remote workspace";
    const remoteWarnings = current.warnings.length
      ? current.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")
      : `<li>${escapeHtml(t("dashboard.remoteSkillLoaded"))}</li>`;
    els.skillSummaryGrid.innerHTML = `
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(t("common.source"))}</span>
        <strong>${escapeHtml(current.source || "gateway")}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(t("common.eligible"))}</span>
        <strong>${escapeHtml(current.eligible ? t("common.yes") : t("common.no"))}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(t("common.remoteWorkspace"))}</span>
        <strong>${escapeHtml(remoteWorkspace)}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">${escapeHtml(t("common.remoteManifest"))}</span>
        <strong>${escapeHtml(current.remoteFilePath || "not provided")}</strong>
      </div>
    `;
    els.statusBanner.classList.remove("is-error");
    els.statusBanner.innerHTML = `
      <ul>${remoteWarnings}</ul>
      <p>${escapeHtml("This skill exists on the remote gateway, but its files are not mounted in this container. Local editing stays disabled.")}</p>
    `;
    updateActionAvailability();
    return;
  }

  const warningsMarkup = current.warnings.length
    ? current.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")
    : `<li>${escapeHtml(t("dashboard.noStructuralWarnings"))}</li>`;

  els.skillSummaryGrid.innerHTML = `
    <div class="summary-card">
      <span class="summary-label">${escapeHtml(t("common.name"))}</span>
      <strong>${escapeHtml(current.name)}</strong>
    </div>
    <div class="summary-card">
      <span class="summary-label">${escapeHtml(t("common.files"))}</span>
      <strong>${escapeHtml(current.fileCount)}</strong>
    </div>
    <div class="summary-card">
      <span class="summary-label">${escapeHtml(t("common.primaryEnv"))}</span>
      <strong>${escapeHtml(current.primaryEnv || "not defined")}</strong>
    </div>
    <div class="summary-card">
      <span class="summary-label">${escapeHtml(t("common.lastUpdated"))}</span>
      <strong>${escapeHtml(current.lastUpdated)}</strong>
    </div>
  `;

  const docsHint = [
    t("dashboard.activationTip"),
  ];
  current.warnings.forEach((warning) => docsHint.push(warning));
  els.statusBanner.classList.remove("is-error");
  els.statusBanner.innerHTML = `<ul>${warningsMarkup}</ul><p>${escapeHtml(docsHint[0])}</p>`;
  updateActionAvailability();
}

function renderTreeNode(node) {
  if (!node) {
    return "";
  }
  if (node.type === "file") {
    const selected = state.selectedFile === node.path;
    return `
      <button class="tree-item file ${selected ? "selected" : ""}" data-path="${escapeHtml(node.path)}" data-type="file">
        <span>${escapeHtml(node.name)}</span>
      </button>
    `;
  }

  const expanded = state.expandedPaths.has(node.path) || node.path === state.selectedSkill;
  const childMarkup = (node.children || []).map((child) => renderTreeNode(child)).join("");
  return `
    <div class="tree-group">
      <button class="tree-item directory ${expanded ? "expanded" : ""}" data-path="${escapeHtml(node.path)}" data-type="directory">
        <span>${escapeHtml(node.name)}</span>
      </button>
      <div class="tree-children ${expanded ? "expanded" : ""}">
        ${childMarkup}
      </div>
    </div>
  `;
}

function renderTree() {
  if (!hasDashboardWorkbench) {
    return;
  }
  const current = selectedSkillRecord();
  if (current && current.remote) {
    els.treeView.innerHTML = `
      <div class="empty-card">
        <strong>${escapeHtml(t("dashboard.remoteSkillTitle"))}</strong>
        <span>${escapeHtml(current.remoteBaseDir || t("dashboard.gatewayPathMissing"))}</span>
      </div>
    `;
    return;
  }
  if (!state.skillTree) {
    els.treeView.innerHTML = `<div class="empty-card"><strong>${escapeHtml(t("dashboard.selectSkill"))}</strong><span>${escapeHtml(t("dashboard.chooseSkillFiles"))}</span></div>`;
    return;
  }
  els.treeView.innerHTML = renderTreeNode(state.skillTree);
}

function updateDirtyIndicator() {
  if (!hasDashboardWorkbench) {
    return;
  }
  const dirty = state.selectedFileContent !== state.lastSavedContent;
  els.dirtyIndicator.textContent = dirty ? t("editor.pendingChanges") : t("status.noChanges");
  els.dirtyIndicator.classList.toggle("is-dirty", dirty);
}

function renderEditor() {
  if (!hasDashboardWorkbench) {
    return;
  }
  const current = selectedSkillRecord();
  if (current && current.remote) {
    els.editorFileTitle.textContent = t("section.editor");
    els.editorFileMeta.textContent = t("editor.remoteSkillFound");
    els.fileEditor.value = "";
    els.fileEditor.disabled = true;
    state.selectedFileContent = "";
    state.lastSavedContent = "";
    updateDirtyIndicator();
    return;
  }
  if (!state.selectedFile) {
    els.editorFileTitle.textContent = t("section.editor");
    els.editorFileMeta.textContent = t("editor.selectFileToEdit");
    els.fileEditor.value = "";
    els.fileEditor.disabled = true;
    state.selectedFileContent = "";
    state.lastSavedContent = "";
    updateDirtyIndicator();
    return;
  }
  els.editorFileTitle.textContent = state.selectedFile;
  els.editorFileMeta.textContent = state.selectedPath || state.selectedFile;
  els.fileEditor.disabled = false;
  els.fileEditor.value = state.selectedFileContent;
  updateDirtyIndicator();
}

function fillMetadataForm(fields = {}) {
  if (!els.metadataForm) {
    return;
  }
  state.metadataFields = fields;
  const form = els.metadataForm;
  form.querySelectorAll("input, textarea, select").forEach((field) => {
    const key = field.name;
    if (!key) {
      return;
    }
    const currentField = form.elements.namedItem(key);
    if (!currentField) {
      return;
    }
    if (currentField.type === "checkbox") {
      currentField.checked = false;
    } else {
      currentField.value = "";
    }
  });

  Object.entries({
    userInvocable: true,
    disableModelInvocation: false,
    ...fields,
  }).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) {
      return;
    }
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value || "";
    }
  });
}

function renderMetadataWarnings() {
  if (!els.metadataWarnings) {
    return;
  }
  if (!state.metadataWarnings.length) {
    els.metadataWarnings.innerHTML = `<div class="success-chip">${
      isRemoteSkill() ? t("metadata.noWarningsRemote") : t("metadata.noWarningsLocal")
    }</div>`;
    return;
  }
  els.metadataWarnings.innerHTML = state.metadataWarnings
    .map((warning) => `<div class="warning-chip block">${escapeHtml(warning)}</div>`)
    .join("");
}

function renderSearchResults() {
  if (!els.searchResults) {
    return;
  }
  if (!state.searchResults.length) {
    els.searchResults.innerHTML = `<div class="muted-copy">${escapeHtml(t("search.noRecentResults"))}</div>`;
    return;
  }
  els.searchResults.innerHTML = state.searchResults
    .map(
      (result) => `
        <button class="search-result" data-path="${escapeHtml(result.path)}" data-line="${escapeHtml(result.lineNumber)}">
          <strong>${escapeHtml(result.path)}:${escapeHtml(result.lineNumber)}</strong>
          <span>${escapeHtml(result.excerpt)}</span>
        </button>
      `
    )
    .join("");
}

function setActiveTab(tabName) {
  if (!els.tabs) {
    return;
  }
  const nextTab = document.querySelector(`.tab-button[data-tab="${tabName}"]`) ? tabName : "metadata";
  state.activeTab = nextTab;
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === nextTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === nextTab);
  });
}

async function loadSkills({ keepSelection = true, remoteSnapshot = undefined } = {}) {
  state.localSkills = await apiFetch("/api/skills");
  if (state.auth.connected && state.auth.gatewayUrl) {
    state.remoteInfo = remoteSnapshot === undefined ? await fetchRemoteSkillsSnapshot() : remoteSnapshot;
    state.remoteSkills = state.remoteInfo?.skills || [];
  } else {
    state.remoteInfo = null;
    state.remoteSkills = [];
  }
  state.skills = mergeSkills(state.localSkills, state.remoteSkills);
  if (!hasDashboardWorkbench) {
    state.selectedSkill = null;
    renderSkillList();
    return;
  }
  if (!keepSelection || !state.skills.some((skill) => skill.slug === state.selectedSkill)) {
    state.selectedSkill = state.skills.length ? state.skills[0].slug : null;
  }
  renderSkillList();
  renderSummary();
  if (state.selectedSkill) {
    await openSkill(state.selectedSkill, { preserveSelectedFile: keepSelection });
  } else {
    state.skillTree = null;
    state.selectedFile = null;
    state.selectedPath = null;
    fillMetadataForm();
    state.metadataWarnings = [];
    renderTree();
    renderEditor();
    renderMetadataWarnings();
    updateActionAvailability();
  }
}

function updateActionAvailability() {
  if (!hasDashboardWorkbench) {
    return;
  }
  const current = selectedSkillRecord();
  const hasSkill = Boolean(current);
  const isRemote = Boolean(current && current.remote);
  const hasLocalSkill = hasSkill && !isRemote;
  const hasLocalFile = Boolean(state.selectedFile) && hasLocalSkill;

  els.openManifestButton.disabled = !hasLocalSkill;
  els.saveFileButton.disabled = !hasLocalFile;
  els.newFileButton.disabled = !hasLocalSkill;
  els.newFolderButton.disabled = !hasLocalSkill;
  els.renameNodeButton.disabled = !state.selectedPath || !hasLocalSkill;
  els.deleteNodeButton.disabled = !state.selectedPath || !hasLocalSkill;
  els.searchInput.disabled = !hasLocalSkill;
  els.reloadFileButton.disabled = !hasLocalFile;
  Array.from(els.metadataForm.elements).forEach((field) => {
    field.disabled = !hasLocalSkill;
  });
}

async function openSkill(skillSlug, { preserveSelectedFile = false } = {}) {
  if (!hasDashboardWorkbench) {
    openSkillDetail(skillSlug);
    return;
  }
  state.selectedSkill = skillSlug;
  state.expandedPaths.add(skillSlug);
  renderSkillList();
  renderSummary();

  const current = selectedSkillRecord();
  if (current && current.remote) {
    state.skillTree = null;
    state.selectedFile = null;
    state.selectedPath = current.slug;
    fillMetadataForm(current.metadataFields || {});
    state.metadataWarnings = current.warnings || [];
    renderTree();
    renderEditor();
    renderMetadataWarnings();
    updateActionAvailability();
    return;
  }

  state.skillTree = await apiFetch(`/api/skills/${encodeURIComponent(skillSlug)}/tree`);
  renderTree();
  await loadMetadata();

  const preferredFile =
    preserveSelectedFile &&
    state.selectedFile &&
    state.selectedFile.startsWith(`${skillSlug}/`)
      ? state.selectedFile
      : `${skillSlug}/SKILL.md`;
  if (fileExistsInTree(state.skillTree, preferredFile)) {
    await openFile(preferredFile);
  } else {
    state.selectedFile = null;
    state.selectedPath = skillSlug;
    renderEditor();
    updateActionAvailability();
  }
}

function fileExistsInTree(node, targetPath) {
  if (!node) {
    return false;
  }
  if (node.path === targetPath) {
    return true;
  }
  return (node.children || []).some((child) => fileExistsInTree(child, targetPath));
}

async function loadMetadata() {
  if (!state.selectedSkill) {
    fillMetadataForm();
    state.metadataWarnings = [];
    renderMetadataWarnings();
    updateActionAvailability();
    return;
  }
  const current = selectedSkillRecord();
  if (current && current.remote) {
    fillMetadataForm(current.metadataFields || {});
    state.metadataWarnings = current.warnings || [];
    renderMetadataWarnings();
    updateActionAvailability();
    return;
  }
  try {
    const metadata = await apiFetch(`/api/skills/${encodeURIComponent(state.selectedSkill)}/metadata`);
    fillMetadataForm(metadata.fields);
    state.metadataWarnings = metadata.warnings || [];
    renderMetadataWarnings();
  } catch (error) {
    fillMetadataForm();
    state.metadataWarnings = [error.message];
    renderMetadataWarnings();
  }
  updateActionAvailability();
}

async function openFile(path) {
  if (state.selectedFileContent !== state.lastSavedContent) {
    const proceed = window.confirm("There are unsaved changes in the current file. Discard them?");
    if (!proceed) {
      return;
    }
  }
  const data = await apiFetch(`/api/file?path=${encodeURIComponent(path)}`);
  state.selectedPath = data.path;
  state.selectedFile = data.path;
  state.selectedFileContent = data.content;
  state.lastSavedContent = data.content;
  renderTree();
  renderEditor();
  if (data.name === "SKILL.md") {
    await loadMetadata();
  }
}

async function saveCurrentFile() {
  if (!state.selectedFile) {
    return;
  }
  const content = els.fileEditor.value;
  const data = await apiFetch("/api/file", {
    method: "PUT",
    body: JSON.stringify({ path: state.selectedFile, content }),
  });
  state.selectedFileContent = content;
  state.lastSavedContent = content;
  updateDirtyIndicator();
  addLog("File saved", data);
  setStatus(t("status.fileSaved", { path: data.path }), "success");
  await loadSkills();
}

async function runOperation(action) {
  const payload = {
    action,
    skill: state.selectedSkill,
    gatewayUrl: state.auth.gatewayUrl,
    gatewayToken: state.auth.gatewayToken,
    basicUser: state.auth.basicUser,
    basicPass: state.auth.basicPass,
    message: `test the ${state.selectedSkill || "custom"} skill`,
  };
  const result = await apiFetch("/api/operations/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  addLog(result.label, result);
  setStatus(result.helpText || `${result.label} completed.`, "success");
}

async function syncSkillFromDashboard(skillSlug) {
  if (!skillSlug || state.syncingSkillSlugs.has(skillSlug)) {
    return;
  }
  state.syncingSkillSlugs.add(skillSlug);
  renderSkillList();
  setStatus(`Syncing skill ${skillSlug}...`);
  try {
    await apiFetch(`/api/studio/skills/${encodeURIComponent(skillSlug)}/ensure`, {
      method: "POST",
      body: JSON.stringify(gatewayCredentialPayload()),
    });
    const result = await apiFetch(`/api/studio/skills/${encodeURIComponent(skillSlug)}/sync`, {
      method: "POST",
      body: JSON.stringify(gatewayCredentialPayload()),
    });
    const mode = result.syncTargetType === "workspace" ? "info" : "success";
    setStatus(`${skillSlug}: ${result.message || "Working copy synchronized."}`, mode);
    addLog("Skill synchronized", {
      skill: skillSlug,
      target: result.syncTargetType || "unknown",
      message: result.message || "",
    });
    if (state.selectedSkill === skillSlug) {
      await openSkill(skillSlug, { preserveSelectedFile: true });
    }
  } finally {
    state.syncingSkillSlugs.delete(skillSlug);
    renderSkillList();
  }
}

function collectFormData(form) {
  const payload = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    payload[key] = value;
  }
  form.querySelectorAll('input[type="checkbox"]').forEach((field) => {
    payload[field.name] = field.checked;
  });
  return payload;
}

function configurePathDialog(mode, options) {
  pathDialogState.mode = mode;
  els.pathDialogEyebrow.textContent = options.eyebrow;
  els.pathDialogTitle.textContent = options.title;
  els.pathDialogLabel.textContent = options.label;
  els.pathDialogHint.textContent = options.hint || "";
  els.pathDialogInput.value = options.value || "";
  els.pathDialogSubmitButton.textContent = options.confirmLabel || t("action.confirm");
  els.pathDialog.showModal();
}

async function handlePathDialogSubmit() {
  const value = els.pathDialogInput.value.trim();
  if (!value) {
    return;
  }

  if (pathDialogState.mode === "create-file" || pathDialogState.mode === "create-folder") {
    const basePath = state.selectedPath || state.selectedSkill;
    await apiFetch("/api/fs/create", {
      method: "POST",
      body: JSON.stringify({
        basePath,
        name: value,
        type: pathDialogState.mode === "create-file" ? "file" : "folder",
      }),
    });
    addLog("Item created", { basePath, value, mode: pathDialogState.mode });
    setStatus(t("status.itemCreatedIn", { path: basePath }), "success");
    await openSkill(state.selectedSkill, { preserveSelectedFile: true });
    els.pathDialog.close();
    return;
  }

  if (pathDialogState.mode === "rename" && state.selectedPath) {
    await apiFetch("/api/fs/rename", {
      method: "POST",
      body: JSON.stringify({
        path: state.selectedPath,
        newName: value,
      }),
    });
    addLog("Item renamed", { path: state.selectedPath, newName: value });
    setStatus(t("status.itemRenamedTo", { name: value }), "success");
    state.selectedFile = null;
    state.selectedPath = null;
    await openSkill(state.selectedSkill);
    els.pathDialog.close();
  }
}

async function deleteCurrentNode() {
  if (!state.selectedPath) {
    return;
  }
  const confirmed = window.confirm(`Delete ${state.selectedPath}?`);
  if (!confirmed) {
    return;
  }
  await apiFetch("/api/fs/delete", {
    method: "DELETE",
    body: JSON.stringify({ path: state.selectedPath }),
  });
  addLog("Item removed", { path: state.selectedPath });
  setStatus(t("status.itemRemoved"), "success");
  state.selectedFile = null;
  state.selectedPath = null;
  await loadSkills({ keepSelection: false });
}

async function runSearch() {
  if (!state.selectedSkill || isRemoteSkill()) {
    return;
  }
  const query = els.searchInput.value.trim();
  if (query.length < 2) {
    state.searchResults = [];
    renderSearchResults();
    return;
  }
  const results = await apiFetch(
    `/api/search?skill=${encodeURIComponent(state.selectedSkill)}&q=${encodeURIComponent(query)}`
  );
  state.searchResults = results;
  renderSearchResults();
}

function bindEvents() {
  els.reconnectButton.addEventListener("click", guard(async () => {
    if (state.appAuth.required && state.appAuth.authenticated) {
      await appLogout();
      state.appAuth.authenticated = false;
      resetGatewayAuth({ preserveUrl: true });
      setAppLoginError("");
      updateGatewayBadge();
      updateOverlayVisibility();
      renderSkillList();
      renderSummary();
      renderTree();
      renderEditor();
      renderMetadataWarnings();
      updateActionAvailability();
      return;
    }
    resetGatewayAuth({ preserveUrl: true });
    updateGatewayBadge();
    updateOverlayVisibility();
  }, "Failed to end the session"));

  els.appLoginForm.addEventListener("submit", guard(async (event) => {
    event.preventDefault();
    const username = els.appLoginUserInput.value.trim();
    const password = els.appLoginPassInput.value;
    const authState = await appLogin(username, password);
    state.appAuth.authenticated = Boolean(authState.authenticated);
    els.appLoginPassInput.value = "";
    setAppLoginError("");
    if (state.appAuth.authenticated) {
      await tryAutoGatewayConnect();
    }
    updateGatewayBadge();
    updateOverlayVisibility();
  }, "Failed to sign in to the application"));

  els.loginForm.addEventListener("submit", guard(async (event) => {
    event.preventDefault();
    const nextAuth = {
      gatewayUrl: els.gatewayUrlInput.value.trim(),
      gatewayToken: els.gatewayTokenInput.value.trim(),
      basicUser: els.gatewayBasicUserInput.value.trim(),
      basicPass: els.gatewayBasicPassInput.value.trim(),
      connected: false,
    };
    setLoginError("");
    await connectGateway(nextAuth, { auto: false });
  }, "Failed to validate the gateway"));

  els.offlineModeButton.addEventListener("click", guard(async () => {
    resetGatewayAuth({ preserveUrl: false });
    state.auth.connected = true;
    setLoginError("");
    persistAuth();
    updateGatewayBadge();
    updateOverlayVisibility();
    addLog("Offline mode", { workspace: bootstrap.workspaceRoot });
    setStatus("Offline workspace opened.", "success");
    await loadSkills({ keepSelection: false });
  }, "Failed to open the workspace offline"));

  els.createSkillButton.addEventListener("click", () => {
    els.createSkillDialog.showModal();
  });

  els.refreshSkillsButton.addEventListener("click", guard(async () => {
    await loadSkills();
    addLog("Workspace refreshed", {
      localSkills: state.localSkills.length,
      remoteSkills: state.remoteSkills.length,
      totalSkills: state.skills.length,
    });
    setStatus("Workspace refreshed.", "success");
  }, "Failed to refresh the workspace"));

  els.skillFilterInput.addEventListener("input", (event) => {
    state.filterText = event.target.value;
    renderSkillList();
  });

  if (els.skillList) {
    els.skillList.addEventListener("click", guard(async (event) => {
      const syncButton = event.target.closest("[data-action='sync-skill']");
      if (syncButton) {
        event.preventDefault();
        await syncSkillFromDashboard(syncButton.dataset.skillSlug);
        return;
      }
      const card = event.target.closest("[data-skill]");
      if (!card || card.matches("a[href]")) {
        return;
      }
      if (!hasDashboardWorkbench) {
        openSkillDetail(card.dataset.skill);
        return;
      }
      await openSkill(card.dataset.skill);
    }, "Failed to open the skill"));
  }

  if (hasDashboardWorkbench) {
    document.addEventListener("keydown", guard(async (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        await saveCurrentFile();
      }
    }, "Failed to save using the shortcut"));
  }

  window.addEventListener("beforeunload", (event) => {
    if (state.selectedFileContent !== state.lastSavedContent) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  if (hasDashboardWorkbench) {
    els.treeView.addEventListener("click", guard(async (event) => {
      const node = event.target.closest("[data-path]");
      if (!node) {
        return;
      }
      const { path, type } = node.dataset;
      state.selectedPath = path;
      if (type === "directory") {
        if (state.expandedPaths.has(path)) {
          state.expandedPaths.delete(path);
        } else {
          state.expandedPaths.add(path);
        }
        renderTree();
        return;
      }
      await openFile(path);
    }, "Failed to open the tree item"));

    els.fileEditor.addEventListener("input", (event) => {
      state.selectedFileContent = event.target.value;
      updateDirtyIndicator();
    });

    els.saveFileButton.addEventListener("click", guard(saveCurrentFile, "Failed to save the file"));
    els.reloadFileButton.addEventListener("click", guard(async () => {
      if (state.selectedFile) {
        await openFile(state.selectedFile);
      }
    }, "Failed to reload the file"));

    els.copyCommandButton.addEventListener("click", guard(async () => {
      await navigator.clipboard.writeText("/new");
      addLog("Copied", { command: "/new" });
      setStatus("Command copied: /new", "success");
    }, "Failed to copy the command"));

    els.openManifestButton.addEventListener("click", guard(async () => {
      if (!state.selectedSkill) {
        return;
      }
      const manifest = `${state.selectedSkill}/SKILL.md`;
      if (fileExistsInTree(state.skillTree, manifest)) {
        await openFile(manifest);
      }
    }, "Failed to open SKILL.md"));

    els.tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (!button) {
        return;
      }
      setActiveTab(button.dataset.tab);
    });

    els.metadataForm.addEventListener("submit", guard(async (event) => {
      event.preventDefault();
      if (!state.selectedSkill) {
        return;
      }
      if (state.selectedFile === `${state.selectedSkill}/SKILL.md` && state.selectedFileContent !== state.lastSavedContent) {
        window.alert("Save SKILL.md in the editor before overwriting metadata through the form.");
        return;
      }
      const payload = collectFormData(els.metadataForm);
      const result = await apiFetch(`/api/skills/${encodeURIComponent(state.selectedSkill)}/metadata`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      addLog("Metadata updated", result);
      await loadSkills();
      await openFile(`${state.selectedSkill}/SKILL.md`);
    }, "Failed to save metadata"));

    els.runSkillsListButton.addEventListener("click", guard(async () => runOperation("skills_list"), "openclaw skills list failed"));
    els.runSkillsCheckButton.addEventListener("click", guard(async () => runOperation("skills_check"), "Skills validation failed"));
    els.runGatewayStatusButton.addEventListener("click", guard(async () => runOperation("gateway_skills_status"), "skills.status failed"));
    els.applySkillButton.addEventListener("click", guard(async () => runOperation("apply_skill"), "Failed to apply the skill"));
    els.restartGatewayButton.addEventListener("click", guard(async () => runOperation("restart_gateway_local"), "Failed to restart the gateway"));
    els.testSkillButton.addEventListener("click", guard(async () => runOperation("test_skill"), "Failed to test the skill"));

    els.newFileButton.addEventListener("click", () => {
      if (!state.selectedSkill) {
        return;
      }
      configurePathDialog("create-file", {
        eyebrow: "File",
        title: "Create file",
        label: "File name",
        hint: "Use relative paths such as scripts/run.sh or docs/notes.md.",
        confirmLabel: "Create file",
      });
    });

    els.newFolderButton.addEventListener("click", () => {
      if (!state.selectedSkill) {
        return;
      }
      configurePathDialog("create-folder", {
        eyebrow: "Folder",
        title: "Create folder",
        label: "Folder name",
        hint: "Subfolders are allowed, for example runbooks/incidents.",
        confirmLabel: "Create folder",
      });
    });

    els.renameNodeButton.addEventListener("click", () => {
      if (!state.selectedPath) {
        return;
      }
      const currentName = state.selectedPath.split("/").pop();
      configurePathDialog("rename", {
        eyebrow: "Rename",
        title: "Rename item",
        label: "New name",
        value: currentName,
        hint: state.selectedPath,
        confirmLabel: "Rename",
      });
    });

    els.deleteNodeButton.addEventListener("click", guard(deleteCurrentNode, "Failed to delete the item"));

    els.pathDialogForm.addEventListener("submit", guard(async (event) => {
      const submitter = event.submitter;
      if (!submitter || submitter.value === "cancel") {
        return;
      }
      event.preventDefault();
      await handlePathDialogSubmit();
    }, "Failed to save the path change"));

    els.searchForm.addEventListener("submit", guard(async (event) => {
      event.preventDefault();
      await runSearch();
    }, "Internal search failed"));

    els.searchResults.addEventListener("click", guard(async (event) => {
      const target = event.target.closest("[data-path]");
      if (!target) {
        return;
      }
      await openFile(target.dataset.path);
    }, "Failed to open the search result"));
  }

  els.createSkillForm.addEventListener("submit", guard(async (event) => {
    const submitter = event.submitter;
    if (!submitter || submitter.value === "cancel") {
      return;
    }
    event.preventDefault();
    const payload = collectFormData(els.createSkillForm);
    const result = await apiFetch("/api/skills", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    addLog("Skill created", result);
    setStatus(`Skill created: ${result.slug}`, "success");
    els.createSkillDialog.close();
    els.createSkillForm.reset();
    await loadSkills({ keepSelection: false });
    await openSkill(result.slug);
  }, "Failed to create the skill"));
}

async function initialize() {
  loadAuthFromStorage();
  renderBootstrap();
  updateGatewayBadge();
  updateOverlayVisibility();
  renderSearchResults();
  renderSkillList();
  renderSummary();
  renderTree();
  renderEditor();
  renderMetadataWarnings();
  updateActionAvailability();
  setActiveTab("metadata");
  bindEvents();

  if (!state.appAuth.required || state.appAuth.authenticated) {
    if (state.auth.connected) {
      await loadSkills({ keepSelection: false });
    } else {
      await tryAutoGatewayConnect();
    }
  }

  window.addEventListener("unhandledrejection", (event) => {
    handleError(event.reason, "Unhandled error");
  });
}

initialize().catch((error) => {
  addLog("Initialization failed", { message: error.message });
});
