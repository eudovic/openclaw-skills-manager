const bootstrap = JSON.parse(document.getElementById("bootstrap-data").textContent);
const skillPage = JSON.parse(document.getElementById("skill-page-data").textContent);
const i18n = window.OpenClawI18n;
const t = (key, values) => (i18n ? i18n.t(key, values) : key);
const formatTimeLabel = () =>
  new Intl.DateTimeFormat(i18n ? i18n.getLocale() : undefined, { timeStyle: "medium" }).format(new Date());

const state = {
  bootstrap,
  skillSlug: String(skillPage.slug || "").trim(),
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
  studioStatus: null,
  history: [],
  skillTree: null,
  selectedPath: null,
  selectedFile: null,
  fileLoading: false,
  selectedFileContent: "",
  lastSavedContent: "",
  editorView: "edit",
  loadingSkillContext: true,
  syncingSkill: false,
  directoryCollapsed: false,
  directoryWidth: null,
  directoryWidthMode: "auto",
  editorHeight: null,
  editorDetached: false,
  currentFileMeta: null,
  logs: [],
};

const els = {
  skillBreadcrumb: document.getElementById("skillBreadcrumb"),
  selectedPathBadge: document.getElementById("selectedPathBadge"),
  skillPageTitle: document.getElementById("skillPageTitle"),
  skillPageRoot: document.getElementById("skillPageRoot"),
  pageStatus: document.getElementById("pageStatus"),
  skillModeBadge: document.getElementById("skillModeBadge"),
  syncStatusBadge: document.getElementById("syncStatusBadge"),
  selectionTypeBadge: document.getElementById("selectionTypeBadge"),
  gatewayStatusPill: document.getElementById("gatewayStatusPill"),
  reconnectButton: document.getElementById("reconnectButton"),
  toggleDirectoryButton: document.getElementById("toggleDirectoryButton"),
  syncSkillButton: document.getElementById("syncSkillButton"),
  newFileButton: document.getElementById("newFileButton"),
  newFolderButton: document.getElementById("newFolderButton"),
  createSkillButton: document.getElementById("createSkillButton"),
  skillWorkbench: document.getElementById("skillWorkbench"),
  skillLoadingOverlay: document.getElementById("skillLoadingOverlay"),
  skillLoadingCopy: document.getElementById("skillLoadingCopy"),
  skillMainShell: document.getElementById("skillMainShell"),
  directoryPanel: document.getElementById("directoryPanel"),
  directoryResizeHandle: document.getElementById("directoryResizeHandle"),
  expandDirectoryButton: document.getElementById("expandDirectoryButton"),
  editorSection: document.getElementById("editorSection"),
  directoryColumns: document.getElementById("directoryColumns"),
  editorPane: document.getElementById("editorPane"),
  editorSurface: document.getElementById("editorSurface"),
  editorHeightResizer: document.getElementById("editorHeightResizer"),
  editorEmptyState: document.getElementById("editorEmptyState"),
  emptyStateCopy: document.getElementById("emptyStateCopy"),
  editorFileTitle: document.getElementById("editorFileTitle"),
  editorFileMeta: document.getElementById("editorFileMeta"),
  editorModeToolbar: document.getElementById("editorModeToolbar"),
  editorModeEditButton: document.getElementById("editorModeEditButton"),
  editorModePreviewButton: document.getElementById("editorModePreviewButton"),
  detachEditorButton: document.getElementById("detachEditorButton"),
  fileEditor: document.getElementById("fileEditor"),
  markdownPreview: document.getElementById("markdownPreview"),
  editorDetachBackdrop: document.getElementById("editorDetachBackdrop"),
  dirtyIndicator: document.getElementById("dirtyIndicator"),
  formatFileButton: document.getElementById("formatFileButton"),
  saveFileButton: document.getElementById("saveFileButton"),
  reloadFileButton: document.getElementById("reloadFileButton"),
  openManifestButton: document.getElementById("openManifestButton"),
  downloadFileButton: document.getElementById("downloadFileButton"),
  renameNodeButton: document.getElementById("renameNodeButton"),
  deleteNodeButton: document.getElementById("deleteNodeButton"),
  detailIcon: document.getElementById("detailIcon"),
  detailTitle: document.getElementById("detailTitle"),
  detailMeta: document.getElementById("detailMeta"),
  detailCreated: document.getElementById("detailCreated"),
  detailModified: document.getElementById("detailModified"),
  detailPermissions: document.getElementById("detailPermissions"),
  detailOwner: document.getElementById("detailOwner"),
  refreshHistoryButton: document.getElementById("refreshHistoryButton"),
  historyList: document.getElementById("historyList"),
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
  deleteDialog: document.getElementById("deleteDialog"),
  deleteDialogForm: document.getElementById("deleteDialogForm"),
  deleteDialogTitle: document.getElementById("deleteDialogTitle"),
  deleteDialogTarget: document.getElementById("deleteDialogTarget"),
  deleteDialogCopy: document.getElementById("deleteDialogCopy"),
  deleteDialogReason: document.getElementById("deleteDialogReason"),
  deleteDialogSubmitButton: document.getElementById("deleteDialogSubmitButton"),
};

const pathDialogState = { mode: null };
const deleteDialogState = { path: null, nodeType: null };
let codeEditor = null;
let suppressEditorChange = false;
let directoryResizeState = null;
let editorHeightResizeState = null;
let workbenchResizeObserver = null;

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setPageStatus(message, mode = "info") {
  els.pageStatus.textContent = message;
  if (mode === "error") {
    els.pageStatus.style.color = "#ffb4ab";
  } else if (mode === "success") {
    els.pageStatus.style.color = "#71f8e4";
  } else {
    els.pageStatus.style.color = "";
  }
}

function setSkillLoadingState(isLoading, message = t("loading.preparingCopy")) {
  state.loadingSkillContext = Boolean(isLoading);
  els.skillWorkbench.classList.toggle("is-loading", state.loadingSkillContext);
  els.skillLoadingOverlay.classList.toggle("hidden", !state.loadingSkillContext);
  els.skillLoadingCopy.textContent = message;
}

function updateSyncButton() {
  let idleLabel = t("action.syncThisSkill");
  if (studioSourceType() === "workspace" && (bootstrap.remoteSync?.mirrorRoot || bootstrap.remoteSync?.hasPushCommand)) {
    idleLabel = "Publish this skill";
  }
  const label = state.syncingSkill ? t("sync.syncing") : idleLabel;
  els.syncSkillButton.textContent = label;
  els.syncSkillButton.classList.toggle("is-loading", state.syncingSkill);
}

function loadWorkbenchLayout() {
  const raw = window.localStorage.getItem("openclaw-skill-workbench-layout");
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    state.directoryCollapsed = Boolean(parsed.directoryCollapsed);
    state.directoryWidthMode = "auto";
    state.directoryWidth = null;
    const editorHeight = Number(parsed.editorHeight);
    if (Number.isFinite(editorHeight) && editorHeight >= 320) {
      state.editorHeight = editorHeight;
    }
  } catch (error) {
    // ignore invalid local storage
  }
}

function persistWorkbenchLayout() {
  window.localStorage.setItem(
    "openclaw-skill-workbench-layout",
    JSON.stringify({
      directoryCollapsed: state.directoryCollapsed,
      directoryWidthMode: state.directoryWidthMode,
      directoryWidth: state.directoryWidth,
      editorHeight: state.editorHeight,
    })
  );
}

function directoryWidthBounds(shellWidth = els.skillMainShell?.getBoundingClientRect().width || 0) {
  const inspectorOffset = window.innerWidth >= 1024 ? 320 : 0;
  const maxWidth = shellWidth
    ? Math.max(320, Math.min(960, shellWidth - inspectorOffset - 360))
    : 960;
  return {
    minWidth: 260,
    maxWidth,
  };
}

function syncDirectoryPanelWidth() {
  if (!els.skillMainShell || !els.directoryColumns) {
    return;
  }
  const { minWidth, maxWidth } = directoryWidthBounds();
  const autoWidth = Math.ceil(els.directoryColumns.scrollWidth || minWidth);
  const requestedWidth = state.directoryWidthMode === "manual" && Number.isFinite(state.directoryWidth)
    ? state.directoryWidth
    : autoWidth;
  const clampedWidth = Math.min(maxWidth, Math.max(minWidth, requestedWidth));
  els.skillMainShell.style.setProperty("--directory-panel-width", `${clampedWidth}px`);
}

function syncEditorSurfaceHeight() {
  if (!els.editorSurface || !els.editorPane || !state.selectedFile) {
    if (els.editorSurface) {
      els.editorSurface.style.removeProperty("height");
    }
    return;
  }
  const handleHeight = els.editorHeightResizer?.offsetHeight || 0;
  const availableHeight = Math.max(320, els.editorPane.clientHeight - handleHeight - 4);
  if (!Number.isFinite(state.editorHeight) || state.editorHeight === null) {
    els.editorSurface.style.removeProperty("height");
    return;
  }
  const clampedHeight = Math.min(availableHeight, Math.max(320, state.editorHeight));
  els.editorSurface.style.height = `${clampedHeight}px`;
}

function applyWorkbenchLayout() {
  els.skillMainShell.classList.toggle("is-directory-collapsed", state.directoryCollapsed);
  els.editorSection.classList.toggle("is-detached", state.editorDetached);
  els.editorDetachBackdrop.classList.toggle("hidden", !state.editorDetached);
  els.expandDirectoryButton.classList.toggle("hidden", !state.directoryCollapsed);
  els.toggleDirectoryButton.textContent = state.directoryCollapsed ? t("action.showFolders") : t("action.hideFolders");
  els.detachEditorButton.textContent = state.editorDetached ? "Back" : t("action.detach");
  if (!state.directoryCollapsed) {
    syncDirectoryPanelWidth();
  }
  syncEditorSurfaceHeight();
  refreshEditorLayout();
}

function toggleDirectoryPanel(forceCollapsed = null) {
  state.directoryCollapsed = forceCollapsed === null ? !state.directoryCollapsed : Boolean(forceCollapsed);
  persistWorkbenchLayout();
  applyWorkbenchLayout();
}

function setEditorDetached(nextValue) {
  state.editorDetached = Boolean(nextValue);
  applyWorkbenchLayout();
}

function beginDirectoryResize(event) {
  if (state.directoryCollapsed) {
    return;
  }
  const rect = els.skillMainShell.getBoundingClientRect();
  directoryResizeState = { shellLeft: rect.left, shellWidth: rect.width };
  document.body.classList.add("is-resizing-panels");
  event.preventDefault();
}

function updateDirectoryResize(clientX) {
  if (!directoryResizeState || state.directoryCollapsed) {
    return;
  }
  const { minWidth, maxWidth } = directoryWidthBounds(directoryResizeState.shellWidth);
  state.directoryWidthMode = "manual";
  state.directoryWidth = Math.min(maxWidth, Math.max(minWidth, clientX - directoryResizeState.shellLeft));
  persistWorkbenchLayout();
  applyWorkbenchLayout();
}

function endDirectoryResize() {
  directoryResizeState = null;
  document.body.classList.remove("is-resizing-panels");
}

function beginEditorHeightResize(event) {
  if (!state.selectedFile || !els.editorSurface || !els.editorPane) {
    return;
  }
  editorHeightResizeState = {
    startY: event.clientY,
    startHeight: els.editorSurface.getBoundingClientRect().height,
  };
  document.body.classList.add("is-resizing-editor-height");
  event.preventDefault();
}

function updateEditorHeightResize(clientY) {
  if (!editorHeightResizeState || !els.editorPane) {
    return;
  }
  const handleHeight = els.editorHeightResizer?.offsetHeight || 0;
  const availableHeight = Math.max(320, els.editorPane.clientHeight - handleHeight - 4);
  const nextHeight = editorHeightResizeState.startHeight + (clientY - editorHeightResizeState.startY);
  state.editorHeight = Math.min(availableHeight, Math.max(320, nextHeight));
  persistWorkbenchLayout();
  syncEditorSurfaceHeight();
  refreshEditorLayout();
}

function endEditorHeightResize() {
  editorHeightResizeState = null;
  document.body.classList.remove("is-resizing-editor-height");
}

function currentEditorValue() {
  return codeEditor ? codeEditor.getValue() : els.fileEditor.value;
}

function setEditorContent(value) {
  const content = String(value ?? "");
  if (!codeEditor) {
    els.fileEditor.value = content;
    return;
  }
  suppressEditorChange = true;
  codeEditor.setValue(content);
  suppressEditorChange = false;
}

function refreshEditorLayout() {
  if (codeEditor) {
    const surfaceHeight = els.editorSurface?.clientHeight || 0;
    if (surfaceHeight > 0) {
      codeEditor.setSize(null, surfaceHeight);
    }
    codeEditor.refresh();
  }
}

function initializeWorkbenchResizeObserver() {
  if (!window.ResizeObserver || workbenchResizeObserver) {
    return;
  }
  workbenchResizeObserver = new window.ResizeObserver(() => {
    window.requestAnimationFrame(() => {
      syncEditorSurfaceHeight();
      refreshEditorLayout();
    });
  });
  workbenchResizeObserver.observe(els.skillWorkbench);
  if (els.editorSurface) {
    workbenchResizeObserver.observe(els.editorSurface);
  }
}

function editorModeForPath(path) {
  const ext = fileExtension(path);
  if ([".md", ".markdown"].includes(ext)) {
    return "markdown";
  }
  if ([".py", ".pyi"].includes(ext)) {
    return "python";
  }
  if ([".sh", ".bash"].includes(ext)) {
    return "shell";
  }
  if (ext === ".json") {
    return { name: "javascript", json: true };
  }
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(ext)) {
    return "javascript";
  }
  if ([".yml", ".yaml"].includes(ext)) {
    return "yaml";
  }
  if ([".html", ".htm"].includes(ext)) {
    return "htmlmixed";
  }
  if (ext === ".css") {
    return "css";
  }
  return "text/plain";
}

function applyEditorLanguage(path) {
  if (codeEditor) {
    codeEditor.setOption("mode", editorModeForPath(path));
  }
}

function initializeCodeEditor() {
  if (!window.CodeMirror || codeEditor) {
    return;
  }
  codeEditor = window.CodeMirror.fromTextArea(els.fileEditor, {
    mode: "text/plain",
    theme: "material-darker",
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    autoCloseBrackets: true,
    styleActiveLine: true,
    lineWrapping: false,
  });
  codeEditor.on("change", () => {
    if (suppressEditorChange) {
      return;
    }
    state.selectedFileContent = codeEditor.getValue();
    if (isMarkdownFile(state.selectedFile)) {
      renderMarkdownPreview();
    }
    updateDirtyIndicator();
  });
}

function setAppLoginError(message = "") {
  els.appLoginError.textContent = message;
}

function setLoginError(message = "") {
  els.loginError.textContent = message;
}

function addLog(title, data) {
  state.logs.unshift({
    title,
    at: formatTimeLabel(),
    data,
  });
  state.logs = state.logs.slice(0, 20);
}

function handleError(error, context = t("status.failed")) {
  const message = error instanceof Error ? error.message : String(error);
  setSkillLoadingState(false);
  addLog(context, { message });
  if (!els.appLoginOverlay.classList.contains("hidden")) {
    setAppLoginError(`${context}: ${message}`);
  } else if (!els.loginOverlay.classList.contains("hidden")) {
    setLoginError(`${context}: ${message}`);
  }
  setPageStatus(`${context}: ${message}`, "error");
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

function syncGatewayInputs() {
  els.gatewayUrlInput.value = state.auth.gatewayUrl;
  els.gatewayTokenInput.value = state.auth.gatewayToken;
  els.gatewayBasicUserInput.value = state.auth.basicUser;
  els.gatewayBasicPassInput.value = state.auth.basicPass;
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

function preferredGatewayUrl() {
  return state.auth.gatewayUrl || bootstrap.gateway.url || "";
}

function canAttemptGatewayAutoConnect() {
  return Boolean(preferredGatewayUrl());
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
  syncGatewayInputs();
  persistAuth();
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

function selectedSkillRecord() {
  return state.skills.find((skill) => skill.slug === state.skillSlug) || null;
}

function studioSourceType() {
  return state.studioStatus?.sourceType || "workspace";
}

function studioSourceLabel() {
  const sourceType = studioSourceType();
  if (sourceType === "workspace") {
    return t("skill.workspaceStaged");
  }
  if (sourceType === "remote-mirror") {
    return t("skill.remoteMirror");
  }
  if (sourceType === "remote-command") {
    return t("skill.remoteReplica");
  }
  if (sourceType === "remote-metadata") {
    return t("skill.legacySnapshot");
  }
  return t("skill.studioCache");
}

function gatewayCredentialPayload() {
  return {
    gatewayUrl: preferredGatewayUrl(),
    gatewayToken: state.auth.gatewayToken,
    basicUser: state.auth.basicUser,
    basicPass: state.auth.basicPass,
  };
}

async function connectGateway(nextAuth, { auto = false } = {}) {
  await probeGateway(nextAuth.gatewayUrl, nextAuth.basicUser, nextAuth.basicPass);
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
  addLog(auto ? "Gateway connected automatically" : "Gateway validated", {
    gatewayUrl: state.auth.gatewayUrl,
    workspaceDir: remoteSnapshot?.workspaceDir || "",
    workspaceSkillCount: remoteSnapshot?.workspaceSkillCount || 0,
    auto,
  });
  await loadSkillContext({ remoteSnapshot });
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
    setLoginError(`Auto-connect failed: ${message}`);
    addLog("Auto-connect failed", { message });
    return false;
  } finally {
    state.gatewayAutoAttempted = true;
    state.gatewayConnecting = false;
    updateGatewayBadge();
    updateOverlayVisibility();
  }
}

function updateGatewayBadge() {
  if (state.appAuth.required && !state.appAuth.authenticated) {
    els.gatewayStatusPill.textContent = t("gateway.appLocked");
    els.gatewayStatusPill.classList.remove("is-connected");
    els.reconnectButton.textContent = t("action.signIn");
    return;
  }
  if (state.gatewayConnecting) {
    els.gatewayStatusPill.textContent = t("gateway.connecting", {
      url: preferredGatewayUrl() || t("gateway.offlineMode"),
    });
    els.gatewayStatusPill.classList.remove("is-connected");
    els.reconnectButton.textContent = state.appAuth.required ? t("action.signOut") : t("action.connect");
    return;
  }
  if (state.auth.connected) {
    els.gatewayStatusPill.textContent = t("gateway.authenticated", {
      url: state.auth.gatewayUrl || t("gateway.offlineMode"),
    });
    els.gatewayStatusPill.classList.add("is-connected");
  } else {
    els.gatewayStatusPill.textContent = bootstrap.gateway.url
      ? t("gateway.ready", { url: bootstrap.gateway.url })
      : t("status.gatewayDisconnected");
    els.gatewayStatusPill.classList.remove("is-connected");
  }
  els.reconnectButton.textContent = state.appAuth.required ? t("action.signOut") : t("action.connect");
}

function updateOverlayVisibility() {
  if (state.appAuth.required && !state.appAuth.authenticated) {
    els.appLoginOverlay.classList.remove("hidden");
    els.loginOverlay.classList.add("hidden");
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

function renderBootstrap() {
  els.skillBreadcrumb.textContent = state.skillSlug || "skill";
  els.skillPageTitle.textContent = state.skillSlug || "Skill";
  els.skillPageRoot.textContent = `${bootstrap.skillsDir}/${state.skillSlug}`;
  els.loginWorkspace.textContent = bootstrap.workspaceRoot;
  els.loginSkillsRoot.textContent = bootstrap.skillsDir;
  els.gatewayDefaultsHint.textContent =
    bootstrap.gateway.hasServerTokenDefault || bootstrap.gateway.hasServerBasicAuthDefault
      ? t("dashboard.serverDefaultsHint")
      : "";
  syncGatewayInputs();

  els.templateSelect.innerHTML = bootstrap.templates
    .map(
      (template) =>
        `<option value="${escapeHtml(template.id)}">${escapeHtml(template.label)} - ${escapeHtml(template.description)}</option>`
    )
    .join("");

  els.creationDocs.innerHTML = bootstrap.docs
    .map(
      (doc) => `
        <a class="resource-card" href="${escapeHtml(doc.url)}" target="_blank" rel="noreferrer">
          <strong>${escapeHtml(doc.title)}</strong>
          <span>${escapeHtml(doc.summary)}</span>
        </a>
      `
    )
    .join("");
}

function fileSizeLabel(bytes) {
  const value = Number(bytes || 0);
  if (!value) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value) {
  if (!value) {
    return "-";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return i18n ? i18n.formatDateTime(value) : new Date(timestamp).toLocaleString();
}

function fileExtension(path) {
  const name = String(path || "").split("/").pop() || "";
  const lastDot = name.lastIndexOf(".");
  return lastDot >= 0 ? name.slice(lastDot).toLowerCase() : "";
}

function isMarkdownFile(path) {
  return [".md", ".markdown"].includes(fileExtension(path));
}

function isFormattableFile(path) {
  return [
    ".py",
    ".pyi",
    ".sh",
    ".bash",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".css",
    ".html",
    ".htm",
    ".json",
    ".yml",
    ".yaml",
  ].includes(fileExtension(path));
}

function renderMarkdownPreview() {
  if (!state.selectedFile || !isMarkdownFile(state.selectedFile)) {
    els.markdownPreview.innerHTML = "";
    return;
  }
  const raw = currentEditorValue() || "";
  if (window.marked && window.DOMPurify) {
    const html = window.marked.parse(raw, { breaks: true, gfm: true });
    els.markdownPreview.innerHTML = window.DOMPurify.sanitize(html);
    return;
  }
  els.markdownPreview.innerHTML = `<pre>${escapeHtml(raw)}</pre>`;
}

function iconForNode(node) {
  if (!node) {
    return "folder";
  }
  if (node.type === "directory") {
    return "folder_open";
  }
  const ext = node.name.includes(".") ? node.name.split(".").pop().toLowerCase() : "";
  if (ext === "md") {
    return "description";
  }
  if (ext === "json" || ext === "yaml" || ext === "yml") {
    return "settings_suggest";
  }
  if (ext === "py") {
    return "data_object";
  }
  if (ext === "js" || ext === "ts") {
    return "javascript";
  }
  if (ext === "css") {
    return "palette";
  }
  if (ext === "sh") {
    return "terminal";
  }
  return "draft";
}

function findNodeByPath(node, targetPath) {
  if (!node) {
    return null;
  }
  if (node.path === targetPath) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findNodeByPath(child, targetPath);
    if (found) {
      return found;
    }
  }
  return null;
}

function fileExistsInTree(node, targetPath) {
  return Boolean(findNodeByPath(node, targetPath));
}

function parentPath(path) {
  if (!path || path === state.skillSlug) {
    return null;
  }
  const segments = path.split("/");
  if (segments.length <= 1) {
    return null;
  }
  segments.pop();
  return segments.join("/");
}

function directoryTrail(path) {
  const selectedNode = findNodeByPath(state.skillTree, path);
  const segments = String(path || state.skillSlug).split("/");
  const limit = selectedNode?.type === "directory" ? segments.length : Math.max(1, segments.length - 1);
  const trail = [segments[0]];
  let current = segments[0];
  for (let index = 1; index < limit; index += 1) {
    current = `${current}/${segments[index]}`;
    trail.push(current);
  }
  return trail;
}

function relativeSelectionLabel() {
  if (!state.selectedPath || state.selectedPath === state.skillSlug) {
    return t("detail.root");
  }
  return state.selectedPath.replace(`${state.skillSlug}/`, "");
}

function renderDirectoryColumns() {
  if (!state.skillTree) {
    els.directoryColumns.innerHTML = `
      <div class="flex min-w-full items-center justify-center p-8">
        <div class="max-w-xl rounded-xl border border-outline-variant/10 bg-surface-container p-6 text-center">
          <h3 class="mb-3 text-xl font-bold text-slate-100">${escapeHtml(t("detail.skillNotFound"))}</h3>
          <p class="text-sm leading-7 text-on-surface-variant">
            ${escapeHtml(t("detail.skillNotFoundCopy"))}
          </p>
        </div>
      </div>
    `;
    return;
  }

  const currentPath = state.selectedPath || state.skillSlug;
  const trail = directoryTrail(currentPath);
  els.directoryColumns.innerHTML = trail
    .map((dirPath, index) => {
      const node = findNodeByPath(state.skillTree, dirPath);
      const children = node?.children || [];
      let highlighted = null;
      if (index < trail.length - 1) {
        highlighted = trail[index + 1];
      } else if (parentPath(currentPath) === dirPath) {
        highlighted = currentPath;
      }
      const title = dirPath === state.skillSlug ? t("detail.directory") : `${node?.name || dirPath}/`;
      const itemsMarkup = children.length
        ? children
            .map((child) => {
              const isSelected = child.path === highlighted;
              const itemTone = child.type === "directory" ? "text-tertiary" : "text-primary";
              return `
                <button
                  class="group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all ${
                    isSelected
                      ? "border-l-2 border-secondary bg-surface-container-high text-primary"
                      : "text-on-surface-variant hover:bg-surface-container-high"
                  }"
                  data-path="${escapeHtml(child.path)}"
                  data-type="${escapeHtml(child.type)}"
                >
                  <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-lg ${child.type === "directory" ? itemTone : ""}">${escapeHtml(iconForNode(child))}</span>
                    <span class="font-mono text-xs">${escapeHtml(child.name)}</span>
                  </div>
                  ${
                    child.type === "directory"
                      ? `<span class="material-symbols-outlined text-xs transition-opacity ${isSelected ? "opacity-60" : "opacity-0 group-hover:opacity-100"}">chevron_right</span>`
                      : ""
                  }
                </button>
              `;
            })
            .join("")
        : `<div class="rounded-lg border border-outline-variant/10 bg-surface-container-high/40 px-3 py-4 text-xs text-on-surface-variant">${escapeHtml(t("detail.emptyDirectory"))}</div>`;
      return `
        <div class="flex w-72 shrink-0 flex-col border-r border-outline-variant/5 bg-surface">
          <div class="flex items-center justify-between border-b border-outline-variant/10 bg-surface-container-low/50 px-4 py-3">
            <span class="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">${escapeHtml(title)}</span>
            <span class="material-symbols-outlined text-xs text-on-surface-variant">unfold_more</span>
          </div>
          <div class="flex-1 overflow-y-auto p-2 space-y-0.5">
            ${itemsMarkup}
          </div>
        </div>
      `;
    })
    .join("");
  if (!state.directoryCollapsed) {
    syncDirectoryPanelWidth();
  }
}

function updateDirtyIndicator() {
  const dirty = !state.fileLoading && state.selectedFileContent !== state.lastSavedContent;
  els.dirtyIndicator.textContent = dirty ? t("editor.pendingChanges") : t("status.noChanges");
  els.dirtyIndicator.classList.toggle("is-dirty", dirty);
}

function renderEditor() {
  if (!state.selectedFile) {
    els.editorPane.classList.add("hidden");
    els.editorEmptyState.classList.remove("hidden");
    els.editorModeToolbar.classList.add("hidden");
    els.editorModeToolbar.classList.remove("flex");
    els.emptyStateCopy.textContent =
      t("editor.emptyCopy");
    els.editorFileTitle.textContent = t("dashboard.selectSkill");
    els.editorFileMeta.textContent = t("editor.chooseFileOrCreate");
    setEditorContent("");
    els.markdownPreview.classList.add("hidden");
    els.fileEditor.classList.remove("hidden");
    if (codeEditor) {
      codeEditor.getWrapperElement().classList.remove("hidden");
    }
    syncEditorSurfaceHeight();
    updateDirtyIndicator();
    return;
  }

  els.editorPane.classList.remove("hidden");
  els.editorEmptyState.classList.add("hidden");
  els.editorFileTitle.textContent = state.selectedFile.split("/").pop();
  els.editorFileMeta.textContent = state.fileLoading ? `${state.selectedFile} • ${t("loading.loading").toLowerCase()}...` : state.selectedFile;
  setEditorContent(state.fileLoading ? "" : state.selectedFileContent);
  applyEditorLanguage(state.selectedFile);
  if (state.fileLoading) {
    state.editorView = "edit";
    els.editorModeToolbar.classList.add("hidden");
    els.editorModeToolbar.classList.remove("flex");
    els.fileEditor.classList.remove("hidden");
    if (codeEditor) {
      codeEditor.getWrapperElement().classList.remove("hidden");
    }
    els.markdownPreview.classList.add("hidden");
    els.editorModeEditButton.classList.remove("active");
    els.editorModePreviewButton.classList.remove("active");
    syncEditorSurfaceHeight();
    refreshEditorLayout();
    updateDirtyIndicator();
    return;
  }
  const markdown = isMarkdownFile(state.selectedFile);
  if (markdown) {
    els.editorModeToolbar.classList.remove("hidden");
    els.editorModeToolbar.classList.add("flex");
    renderMarkdownPreview();
    const previewMode = state.editorView === "preview";
    els.fileEditor.classList.toggle("hidden", previewMode);
    if (codeEditor) {
      codeEditor.getWrapperElement().classList.toggle("hidden", previewMode);
    }
    els.markdownPreview.classList.toggle("hidden", !previewMode);
    els.editorModeEditButton.classList.toggle("active", !previewMode);
    els.editorModePreviewButton.classList.toggle("active", previewMode);
  } else {
    state.editorView = "edit";
    els.editorModeToolbar.classList.add("hidden");
    els.editorModeToolbar.classList.remove("flex");
    els.fileEditor.classList.remove("hidden");
    if (codeEditor) {
      codeEditor.getWrapperElement().classList.remove("hidden");
    }
    els.markdownPreview.classList.add("hidden");
    els.editorModeEditButton.classList.remove("active");
    els.editorModePreviewButton.classList.remove("active");
  }
  syncEditorSurfaceHeight();
  refreshEditorLayout();
  updateDirtyIndicator();
}

function renderInspector() {
  const node = findNodeByPath(state.skillTree, state.selectedPath || state.skillSlug);
  const metadata = state.currentFileMeta || node;
  const typeLabel = node?.type === "directory" ? t("detail.directory") : t("detail.file");
  const sourceLabel = studioSourceLabel();

  els.detailIcon.textContent = iconForNode(node || { type: "directory", name: state.skillSlug });
  els.detailTitle.textContent = node?.name || state.skillSlug || "Skill";
  els.detailMeta.innerHTML = `
    <span class="h-2 w-2 rounded-full bg-secondary"></span>
    ${escapeHtml(typeLabel)} • ${escapeHtml(sourceLabel)}${metadata?.size ? ` • ${escapeHtml(fileSizeLabel(metadata.size))}` : ""}
  `;
  els.detailCreated.textContent = formatTimestamp(metadata?.createdAt);
  els.detailModified.textContent = formatTimestamp(metadata?.updatedAt);
  els.detailPermissions.textContent = metadata?.permissions || "-";
  els.detailOwner.textContent = metadata?.owner || "-";
}

function renderHistory() {
  if (!els.historyList) {
    return;
  }
  if (!state.history.length) {
    els.historyList.innerHTML = `<div class="muted-copy">${escapeHtml(t("history.noneRecorded"))}</div>`;
    return;
  }
  els.historyList.innerHTML = state.history
    .map((entry) => {
      const stateLabel = entry.synced ? t("history.syncedBadge") : entry.current ? t("history.currentBadge") : t("history.snapshotBadge");
      return `
        <article class="studio-history-entry">
          <div class="studio-history-head">
            <strong>r${escapeHtml(entry.revisionNumber)}</strong>
            <span>${escapeHtml(stateLabel)}</span>
          </div>
          <p>${escapeHtml(entry.note)}</p>
          ${entry.changedPath ? `<small class="studio-history-path">${escapeHtml(entry.changedPath)}</small>` : ""}
          <small>${escapeHtml(formatTimestamp(entry.createdAt))}</small>
          <div class="studio-history-actions">
            <button class="ghost-button small-button" data-restore-mode="skill" data-revision-id="${escapeHtml(entry.id)}" type="button">${escapeHtml(t("history.skillAction"))}</button>
            ${
              state.selectedFile
                ? `<button class="ghost-button small-button" data-restore-mode="file" data-revision-id="${escapeHtml(entry.id)}" type="button">${escapeHtml(t("history.fileAction"))}</button>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSyncState() {
  updateSyncButton();
  if (state.syncingSkill) {
    els.syncStatusBadge.textContent = t("sync.syncing");
    return;
  }
  const status = state.studioStatus;
  if (!status) {
    els.syncStatusBadge.textContent = t("sync.noWorkingCopy");
    return;
  }
  if (status.dirty) {
    els.syncStatusBadge.textContent = t("sync.pending", { revision: status.currentRevisionNumber });
  } else if (status.lastSyncedRevisionNumber) {
    els.syncStatusBadge.textContent = t("sync.synced", { revision: status.lastSyncedRevisionNumber });
  } else {
    els.syncStatusBadge.textContent = t("sync.noInitial");
  }
}

function updateActionAvailability() {
  const selectedNode = findNodeByPath(state.skillTree, state.selectedPath || state.skillSlug);
  const hasTree = Boolean(state.skillTree);
  const hasFile = Boolean(state.selectedFile) && hasTree && !state.fileLoading;

  els.newFileButton.disabled = !hasTree;
  els.newFolderButton.disabled = !hasTree;
  els.saveFileButton.disabled = !hasFile;
  els.formatFileButton.disabled = !hasFile || !isFormattableFile(state.selectedFile);
  els.reloadFileButton.disabled = !hasFile;
  els.downloadFileButton.disabled = !hasFile;
  els.renameNodeButton.disabled = !selectedNode || !hasTree;
  els.deleteNodeButton.disabled = !selectedNode || !hasTree;
  els.openManifestButton.disabled = !hasTree || !fileExistsInTree(state.skillTree, `${state.skillSlug}/SKILL.md`);
  els.syncSkillButton.disabled = state.syncingSkill || !state.studioStatus || !state.studioStatus.dirty;
  if (els.refreshHistoryButton) {
    els.refreshHistoryButton.disabled = !state.studioStatus;
  }
  els.selectionTypeBadge.textContent = selectedNode
    ? selectedNode.type === "directory"
      ? t("detail.directory")
      : t("detail.file")
    : t("selection.none");
  els.skillModeBadge.textContent = studioSourceLabel();
}

function renderHeader() {
  const current = selectedSkillRecord();
  els.skillBreadcrumb.textContent = state.skillSlug || "skill";
  els.selectedPathBadge.textContent = relativeSelectionLabel();
  els.skillPageTitle.textContent = current?.slug || state.skillSlug || "Skill";
  els.skillPageRoot.textContent =
    studioSourceType() !== "workspace"
      ? state.studioStatus?.managedRoot || "studio cache"
      : state.studioStatus?.workspaceTarget || `${bootstrap.skillsDir}/${state.skillSlug}`;
}

function renderAll() {
  renderHeader();
  renderDirectoryColumns();
  renderEditor();
  renderInspector();
  renderHistory();
  renderSyncState();
  updateActionAvailability();
}

async function loadSkillsSnapshot(remoteSnapshot = undefined) {
  state.localSkills = await apiFetch("/api/skills");
  if (state.auth.connected && state.auth.gatewayUrl) {
    state.remoteInfo = remoteSnapshot === undefined ? await fetchRemoteSkillsSnapshot() : remoteSnapshot;
    state.remoteSkills = state.remoteInfo?.skills || [];
  } else {
    state.remoteInfo = null;
    state.remoteSkills = [];
  }
  state.skills = mergeSkills(state.localSkills, state.remoteSkills);
}

async function ensureStudioSkill() {
  const result = await apiFetch(`/api/studio/skills/${encodeURIComponent(state.skillSlug)}/ensure`, {
    method: "POST",
    body: JSON.stringify(gatewayCredentialPayload()),
  });
  state.studioStatus = result.status;
  state.history = result.history || [];
}

async function loadStudioHistory() {
  const data = await apiFetch(`/api/studio/skills/${encodeURIComponent(state.skillSlug)}/history`);
  state.studioStatus = data.status;
  state.history = data.history || [];
}

async function loadSkillContext({ remoteSnapshot = undefined } = {}) {
  setSkillLoadingState(true);
  setPageStatus(t("status.skillLoading"), "info");
  try {
    await loadSkillsSnapshot(remoteSnapshot);
    await ensureStudioSkill();
    state.skillTree = await apiFetch(`/api/studio/skills/${encodeURIComponent(state.skillSlug)}/tree`);
    const preferredPath =
      state.selectedFile && fileExistsInTree(state.skillTree, state.selectedFile)
        ? state.selectedFile
        : fileExistsInTree(state.skillTree, `${state.skillSlug}/SKILL.md`)
          ? `${state.skillSlug}/SKILL.md`
          : state.skillSlug;
    if (preferredPath === state.skillSlug) {
      state.selectedPath = state.skillSlug;
      state.selectedFile = null;
      state.fileLoading = false;
      state.currentFileMeta = findNodeByPath(state.skillTree, state.skillSlug);
      renderAll();
    } else {
      await openFile(preferredPath, { skipPrompt: true });
    }
    if (studioSourceType() === "remote-mirror") {
      setPageStatus(
        t("status.remoteMirrorLoaded"),
        "success"
      );
    } else if (studioSourceType() === "remote-command") {
      setPageStatus(
        t("status.remoteReplicaLoaded"),
        "success"
      );
    } else {
      setPageStatus(t("status.workingCopyLoaded"), "success");
    }
  } finally {
    setSkillLoadingState(false);
  }
}

async function openFile(path, { skipPrompt = false } = {}) {
  if (!skipPrompt && state.selectedFileContent !== state.lastSavedContent) {
    const proceed = window.confirm("There are unsaved changes in the current file. Discard them?");
    if (!proceed) {
      return;
    }
  }
  const pendingNode = findNodeByPath(state.skillTree, path);
  state.selectedPath = path;
  state.selectedFile = path;
  state.directoryWidthMode = "auto";
  state.directoryWidth = null;
  state.fileLoading = true;
  state.selectedFileContent = "";
  state.lastSavedContent = "";
  state.currentFileMeta = pendingNode || state.currentFileMeta;
  persistWorkbenchLayout();
  renderAll();
  try {
    const data = await apiFetch(`/api/studio/file?path=${encodeURIComponent(path)}`);
    state.selectedPath = data.path;
    state.selectedFile = data.path;
    state.fileLoading = false;
    state.selectedFileContent = data.content;
    state.lastSavedContent = data.content;
    state.editorView = isMarkdownFile(data.path) ? state.editorView : "edit";
    state.currentFileMeta = data;
    renderAll();
    if (state.editorView !== "preview" && codeEditor) {
      codeEditor.focus();
    }
  } catch (error) {
    state.fileLoading = false;
    renderAll();
    throw error;
  }
}

function selectDirectory(path) {
  state.selectedPath = path;
  state.selectedFile = null;
  state.directoryWidthMode = "auto";
  state.directoryWidth = null;
  state.fileLoading = false;
  state.selectedFileContent = "";
  state.lastSavedContent = "";
  state.currentFileMeta = findNodeByPath(state.skillTree, path);
  persistWorkbenchLayout();
  renderAll();
}

async function saveCurrentFile() {
  if (!state.selectedFile) {
    return;
  }
  const content = currentEditorValue();
  const data = await apiFetch("/api/studio/file", {
    method: "PUT",
    body: JSON.stringify({ path: state.selectedFile, content }),
  });
  state.selectedFileContent = content;
  state.lastSavedContent = content;
  state.currentFileMeta = { ...(state.currentFileMeta || {}), ...data };
  state.studioStatus = data.studioStatus || state.studioStatus;
  await loadStudioHistory();
  updateDirtyIndicator();
  renderAll();
  setPageStatus(t("status.fileSaved", { path: data.path }), "success");
}

async function formatCurrentFile() {
  if (!state.selectedFile) {
    return;
  }
  const data = await apiFetch("/api/studio/format", {
    method: "POST",
    body: JSON.stringify({ path: state.selectedFile, content: currentEditorValue() }),
  });
  state.selectedFileContent = data.content;
  setEditorContent(data.content);
  if (isMarkdownFile(state.selectedFile)) {
    renderMarkdownPreview();
  }
  updateDirtyIndicator();
  setPageStatus(t("status.fileFormatted", { formatter: data.formatter }), "success");
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
    const basePath = state.selectedPath || state.skillSlug;
    await apiFetch("/api/studio/fs/create", {
      method: "POST",
      body: JSON.stringify({
        basePath,
        name: value,
        type: pathDialogState.mode === "create-file" ? "file" : "folder",
      }),
    });
    els.pathDialog.close();
    setPageStatus(t("status.itemCreatedIn", { path: basePath }), "success");
    await loadSkillContext();
    if (pathDialogState.mode === "create-file") {
      const baseDir = parentPath(basePath) && findNodeByPath(state.skillTree, basePath)?.type === "file" ? parentPath(basePath) : basePath;
      await openFile(`${baseDir || state.skillSlug}/${value}`.replaceAll("//", "/"), { skipPrompt: true });
    }
    return;
  }

  if (pathDialogState.mode === "rename" && state.selectedPath) {
    await apiFetch("/api/studio/fs/rename", {
      method: "POST",
      body: JSON.stringify({
        path: state.selectedPath,
        newName: value,
      }),
    });
    els.pathDialog.close();
    setPageStatus(t("status.itemRenamedTo", { name: value }), "success");
    state.selectedFile = null;
    state.selectedPath = null;
    await loadSkillContext();
  }
}

async function deleteCurrentNode() {
  if (!state.selectedPath) {
    return;
  }
  const targetNode = findNodeByPath(state.skillTree, state.selectedPath);
  deleteDialogState.path = state.selectedPath;
  deleteDialogState.nodeType = targetNode?.type || "file";
  els.deleteDialogTitle.textContent =
    deleteDialogState.nodeType === "directory" ? t("delete.deleteFolderWorkingCopy") : t("delete.deleteFileWorkingCopy");
  els.deleteDialogTarget.textContent = state.selectedPath;
  els.deleteDialogCopy.textContent =
    deleteDialogState.nodeType === "directory"
      ? t("delete.folderCopy")
      : t("delete.fileCopy");
  els.deleteDialogReason.value = "";
  els.deleteDialogSubmitButton.textContent =
    deleteDialogState.nodeType === "directory" ? t("action.deleteFolder") : t("action.deleteFile");
  els.deleteDialog.showModal();
  window.requestAnimationFrame(() => {
    els.deleteDialogReason.focus();
  });
}

async function handleDeleteDialogSubmit() {
  const path = deleteDialogState.path;
  if (!path) {
    return;
  }
  const reason = els.deleteDialogReason.value.trim();
  await apiFetch("/api/studio/fs/delete", {
    method: "DELETE",
    body: JSON.stringify({ path, reason }),
  });
  els.deleteDialog.close();
  deleteDialogState.path = null;
  deleteDialogState.nodeType = null;
  state.selectedFile = null;
  state.selectedPath = state.skillSlug;
  state.selectedFileContent = "";
  state.lastSavedContent = "";
  await loadSkillContext();
  setPageStatus(
    reason
      ? t("status.itemRemovedWithReason")
      : t("status.itemRemoved"),
    "success"
  );
}

function downloadCurrentFile() {
  if (!state.selectedFile) {
    return;
  }
  const blob = new Blob([currentEditorValue()], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = state.selectedFile.split("/").pop();
  anchor.click();
  URL.revokeObjectURL(href);
}

async function syncStudioSkill() {
  state.syncingSkill = true;
  renderSyncState();
  updateActionAvailability();
  setPageStatus(t("sync.syncSkill"), "info");
  try {
    const result = await apiFetch(`/api/studio/skills/${encodeURIComponent(state.skillSlug)}/sync`, {
      method: "POST",
      body: JSON.stringify(gatewayCredentialPayload()),
    });
    state.studioStatus = result.studioStatus || state.studioStatus;
    await loadStudioHistory();
    renderAll();
    const mode = result.syncTargetType === "workspace" ? "info" : "success";
    setPageStatus(result.message || "Working copy synchronized.", mode);
  } finally {
    state.syncingSkill = false;
    renderSyncState();
    updateActionAvailability();
  }
}

async function restoreRevision(revisionId, mode) {
  const payload = {
    revisionId,
    mode,
    path: mode === "file" ? state.selectedFile : "",
  };
  await apiFetch(`/api/studio/skills/${encodeURIComponent(state.skillSlug)}/restore`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.selectedFile = mode === "file" ? state.selectedFile : null;
  state.selectedPath = state.skillSlug;
  state.selectedFileContent = "";
  state.lastSavedContent = "";
  state.currentFileMeta = null;
  await loadSkillContext();
}

function bindEvents() {
  els.reconnectButton.addEventListener("click", guard(async () => {
    if (state.appAuth.required && state.appAuth.authenticated) {
      await appLogout();
      state.appAuth.authenticated = false;
      resetGatewayAuth({ preserveUrl: true });
      updateGatewayBadge();
      updateOverlayVisibility();
      return;
    }
    resetGatewayAuth({ preserveUrl: true });
    updateGatewayBadge();
    updateOverlayVisibility();
  }, "Failed to sign out"));

  els.toggleDirectoryButton.addEventListener("click", () => {
    toggleDirectoryPanel();
  });

  els.expandDirectoryButton.addEventListener("click", () => {
    toggleDirectoryPanel(false);
  });

  els.detachEditorButton.addEventListener("click", () => {
    setEditorDetached(!state.editorDetached);
  });

  els.editorDetachBackdrop.addEventListener("click", () => {
    setEditorDetached(false);
  });

  els.directoryResizeHandle.addEventListener("mousedown", (event) => {
    beginDirectoryResize(event);
  });

  els.directoryResizeHandle.addEventListener("dblclick", () => {
    state.directoryWidthMode = "auto";
    state.directoryWidth = null;
    persistWorkbenchLayout();
    applyWorkbenchLayout();
  });

  els.editorHeightResizer.addEventListener("mousedown", (event) => {
    beginEditorHeightResize(event);
  });

  els.editorHeightResizer.addEventListener("dblclick", () => {
    state.editorHeight = null;
    persistWorkbenchLayout();
    applyWorkbenchLayout();
  });

  els.appLoginForm.addEventListener("submit", guard(async (event) => {
    event.preventDefault();
    const username = els.appLoginUserInput.value.trim();
    const password = els.appLoginPassInput.value;
    const authState = await appLogin(username, password);
    state.appAuth.authenticated = Boolean(authState.authenticated);
    els.appLoginPassInput.value = "";
    setAppLoginError("");
    if (state.appAuth.authenticated) {
      if (canAttemptGatewayAutoConnect()) {
        const connected = await tryAutoGatewayConnect();
        if (!connected) {
          await loadSkillContext();
        }
      } else {
        await loadSkillContext();
      }
    }
    updateGatewayBadge();
    updateOverlayVisibility();
  }, "Failed to sign in to the app"));

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
    persistAuth();
    updateGatewayBadge();
    updateOverlayVisibility();
    await loadSkillContext();
  }, "Failed to open the workspace offline"));

  els.createSkillButton.addEventListener("click", () => {
    els.createSkillDialog.showModal();
  });

  els.newFileButton.addEventListener("click", () => {
    configurePathDialog("create-file", {
      eyebrow: "File",
      title: "Create file",
      label: "File name",
      hint: "You can include subfolders, for example src/main.py or docs/guide.md.",
      confirmLabel: "Create file",
    });
  });

  els.newFolderButton.addEventListener("click", () => {
    configurePathDialog("create-folder", {
      eyebrow: "Folder",
      title: "Create folder",
      label: "Folder name",
      hint: "Use relative paths such as src/components or docs/runbooks.",
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
  els.downloadFileButton.addEventListener("click", guard(async () => downloadCurrentFile(), "Failed to download the file"));
  els.formatFileButton.addEventListener("click", guard(formatCurrentFile, "Failed to format the file"));
  els.saveFileButton.addEventListener("click", guard(saveCurrentFile, "Failed to save the file"));
  els.syncSkillButton.addEventListener("click", guard(syncStudioSkill, "Failed to sync the working copy"));
  if (els.refreshHistoryButton) {
    els.refreshHistoryButton.addEventListener("click", guard(async () => {
      await loadStudioHistory();
      renderAll();
    }, "Failed to refresh history"));
  }
  els.reloadFileButton.addEventListener("click", guard(async () => {
    if (state.selectedFile) {
      await openFile(state.selectedFile, { skipPrompt: true });
    }
  }, "Failed to reload the file"));

  els.openManifestButton.addEventListener("click", guard(async () => {
    const manifest = `${state.skillSlug}/SKILL.md`;
    if (state.skillTree && fileExistsInTree(state.skillTree, manifest)) {
      await openFile(manifest, { skipPrompt: true });
    }
  }, "Failed to open SKILL.md"));

  els.directoryColumns.addEventListener("click", guard(async (event) => {
    const target = event.target.closest("[data-path]");
    if (!target) {
      return;
    }
    const { path, type } = target.dataset;
    if (type === "directory") {
      selectDirectory(path);
      return;
    }
    await openFile(path);
  }, "Failed to open the item"));

  if (els.historyList) {
    els.historyList.addEventListener("click", guard(async (event) => {
      const action = event.target.closest("[data-revision-id]");
      if (!action) {
        return;
      }
      const revisionId = action.dataset.revisionId;
      const mode = action.dataset.restoreMode;
      const confirmed = window.confirm(
        mode === "file"
          ? `Restore the current file to revision ${revisionId}?`
          : `Restore the entire skill to revision ${revisionId}?`
      );
      if (!confirmed) {
        return;
      }
      await restoreRevision(revisionId, mode);
    }, "Failed to restore the revision"));
  }

  if (!window.CodeMirror) {
    els.fileEditor.addEventListener("input", (event) => {
      state.selectedFileContent = event.target.value;
      if (isMarkdownFile(state.selectedFile)) {
        renderMarkdownPreview();
      }
      updateDirtyIndicator();
    });
  }

  els.editorModeEditButton.addEventListener("click", () => {
    state.editorView = "edit";
    renderEditor();
  });

  els.editorModePreviewButton.addEventListener("click", () => {
    state.editorView = "preview";
    renderEditor();
  });

  els.createSkillForm.addEventListener("submit", guard(async (event) => {
    const submitter = event.submitter;
    if (!submitter || submitter.value === "cancel") {
      return;
    }
    event.preventDefault();
    const payload = {};
    const data = new FormData(els.createSkillForm);
    for (const [key, value] of data.entries()) {
      payload[key] = value;
    }
    els.createSkillForm.querySelectorAll('input[type="checkbox"]').forEach((field) => {
      payload[field.name] = field.checked;
    });
    const result = await apiFetch("/api/skills", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    window.location.href = `/skills/${encodeURIComponent(result.slug)}`;
  }, "Failed to create the skill"));

  els.pathDialogForm.addEventListener("submit", guard(async (event) => {
    const submitter = event.submitter;
    if (!submitter || submitter.value === "cancel") {
      return;
    }
    event.preventDefault();
    await handlePathDialogSubmit();
  }, "Failed to save the path change"));

  els.deleteDialogForm.addEventListener("submit", guard(async (event) => {
    const submitter = event.submitter;
    if (!submitter || submitter.value === "cancel") {
      deleteDialogState.path = null;
      deleteDialogState.nodeType = null;
      return;
    }
    event.preventDefault();
    await handleDeleteDialogSubmit();
  }, "Failed to delete the item"));

  els.deleteDialog.addEventListener("close", () => {
    deleteDialogState.path = null;
    deleteDialogState.nodeType = null;
    els.deleteDialogReason.value = "";
  });

  document.addEventListener("keydown", guard(async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      await saveCurrentFile();
    }
    if (event.key === "Escape" && state.editorDetached) {
      setEditorDetached(false);
    }
  }, "Failed to save from the shortcut"));

  window.addEventListener("mousemove", (event) => {
    if (directoryResizeState) {
      updateDirectoryResize(event.clientX);
    }
    if (editorHeightResizeState) {
      updateEditorHeightResize(event.clientY);
    }
  });

  window.addEventListener("mouseup", () => {
    endDirectoryResize();
    endEditorHeightResize();
  });

  window.addEventListener("resize", () => {
    applyWorkbenchLayout();
  });

  window.addEventListener("beforeunload", (event) => {
    if (state.selectedFileContent !== state.lastSavedContent) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function initialize() {
  loadAuthFromStorage();
  loadWorkbenchLayout();
  setSkillLoadingState(true);
  renderBootstrap();
  initializeCodeEditor();
  initializeWorkbenchResizeObserver();
  applyWorkbenchLayout();
  updateGatewayBadge();
  updateOverlayVisibility();
  bindEvents();

  if (!state.appAuth.required || state.appAuth.authenticated) {
    if (!state.auth.connected && canAttemptGatewayAutoConnect()) {
      const connected = await tryAutoGatewayConnect();
      if (!connected) {
        await loadSkillContext();
      }
    } else {
      await loadSkillContext();
    }
  }

  window.addEventListener("unhandledrejection", (event) => {
    handleError(event.reason, "Unhandled error");
  });
}

initialize().catch((error) => {
  handleError(error, "Failed during initialization");
});
