const bootstrap = JSON.parse(document.getElementById("bootstrap-data").textContent);
const historyPage = JSON.parse(document.getElementById("history-page-data").textContent);
const i18n = window.OpenClawI18n;
const t = (key, values) => (i18n ? i18n.t(key, values) : key);

const state = {
  bootstrap,
  skillSlug: String(historyPage.slug || "").trim(),
  history: [],
  selectedRevisionId: null,
  selectedRevision: null,
  selectedEntries: [],
  selectedSummary: null,
  studioStatus: null,
  loadingHistory: false,
  loadingRevision: false,
  restoring: false,
};

const els = {
  historySkillRoot: document.getElementById("historySkillRoot"),
  historyStatusPill: document.getElementById("historyStatusPill"),
  historyBanner: document.getElementById("historyBanner"),
  historyRevisionBadge: document.getElementById("historyRevisionBadge"),
  historyCompareBadge: document.getElementById("historyCompareBadge"),
  refreshHistoryPageButton: document.getElementById("refreshHistoryPageButton"),
  restoreRevisionButton: document.getElementById("restoreRevisionButton"),
  revisionTimeline: document.getElementById("revisionTimeline"),
  revisionTitle: document.getElementById("revisionTitle"),
  revisionMeta: document.getElementById("revisionMeta"),
  revisionNote: document.getElementById("revisionNote"),
  revisionSummaryGrid: document.getElementById("revisionSummaryGrid"),
  revisionEmptyState: document.getElementById("revisionEmptyState"),
  revisionTableWrap: document.getElementById("revisionTableWrap"),
  revisionEntries: document.getElementById("revisionEntries"),
};

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setBanner(message, mode = "info") {
  els.historyBanner.textContent = message;
  if (mode === "error") {
    els.historyBanner.style.color = "#ffb4ab";
  } else if (mode === "success") {
    els.historyBanner.style.color = "#71f8e4";
  } else {
    els.historyBanner.style.color = "";
  }
}

function formatTimestamp(value) {
  if (!value) {
    return "--";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return i18n ? i18n.formatDateTime(value) : new Date(timestamp).toLocaleString();
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size < 0) {
    return "--";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function apiPath(path) {
  return `/api/studio/skills/${encodeURIComponent(state.skillSlug)}${path}`;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload.data;
}

function renderStatusPill() {
  if (!state.studioStatus) {
    els.historyStatusPill.textContent = t("sync.noWorkingCopy");
    return;
  }
  els.historySkillRoot.textContent = state.studioStatus.workspaceTarget || state.studioStatus.managedRoot || "";
  if (state.restoring) {
    els.historyStatusPill.textContent = `${t("action.restoreRevision")}...`;
    return;
  }
  if (state.loadingHistory || state.loadingRevision) {
    els.historyStatusPill.textContent = t("history.loadingHistory");
    return;
  }
  if (state.studioStatus.dirty) {
    els.historyStatusPill.textContent = t("sync.pending", { revision: state.studioStatus.currentRevisionNumber });
    return;
  }
  if (state.studioStatus.lastSyncedRevisionNumber) {
    els.historyStatusPill.textContent = t("sync.synced", { revision: state.studioStatus.lastSyncedRevisionNumber });
    return;
  }
  els.historyStatusPill.textContent = t("sync.noInitial");
}

function originLabel(origin) {
  const labels = {
    import: "Import",
    reimport: "Reimport",
    save: "Save file",
    create: "Create",
    rename: "Rename",
    delete: "Delete",
    "restore-skill": "Restore skill",
    "restore-file": "Restore file",
  };
  return labels[origin] || origin || "Revision";
}

function statusLabel(status) {
  const labels = {
    added: "Added",
    modified: "Modified",
    deleted: "Deleted",
    unchanged: "Unchanged",
  };
  return labels[status] || status || "Unchanged";
}

function entryIcon(entry) {
  if (entry.type === "directory") {
    return entry.status === "deleted" ? "folder_delete" : "folder";
  }
  return entry.path.endsWith(".json") ? "data_object" : "description";
}

function renderTimeline() {
  if (state.loadingHistory && !state.history.length) {
    els.revisionTimeline.innerHTML = `<div class="empty-card"><strong>${escapeHtml(t("loading.loading"))}</strong><span>${escapeHtml(t("history.readingLocalRevisions"))}</span></div>`;
    return;
  }
  if (!state.history.length) {
    els.revisionTimeline.innerHTML = `<div class="empty-card"><strong>${escapeHtml(t("history.label"))}</strong><span>${escapeHtml(t("history.noLocalRevisions"))}</span></div>`;
    return;
  }
  els.revisionTimeline.innerHTML = state.history
    .map((entry) => {
      const selected = Number(entry.id) === Number(state.selectedRevisionId);
      const stateBadge = entry.current ? t("history.currentBadge") : entry.synced ? t("history.syncedBadge") : t("history.snapshotBadge");
      return `
        <button class="history-timeline-entry ${selected ? "is-selected" : ""}" data-revision-id="${escapeHtml(entry.id)}" type="button">
          <div class="history-timeline-dot ${entry.current ? "is-current" : entry.synced ? "is-synced" : ""}"></div>
          <div class="history-timeline-card">
            <div class="history-timeline-head">
              <strong>r${escapeHtml(entry.revisionNumber)}</strong>
              <span class="history-inline-badge ${entry.current ? "is-current" : entry.synced ? "is-synced" : ""}">${escapeHtml(stateBadge)}</span>
            </div>
            <p>${escapeHtml(entry.note)}</p>
            <div class="history-timeline-meta">
              <span>${escapeHtml(originLabel(entry.origin))}</span>
              <span>${escapeHtml(formatTimestamp(entry.createdAt))}</span>
            </div>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderRevisionDetail() {
  const revision = state.selectedRevision;
  if (!revision) {
    els.revisionTitle.textContent = t("history.selectRevision");
    els.revisionMeta.textContent = t("history.selectRevisionCopy");
    els.revisionNote.textContent = t("history.reasonOrigin");
    els.historyRevisionBadge.textContent = t("history.noRevision");
    els.historyCompareBadge.textContent = t("history.noComparison");
    els.revisionSummaryGrid.innerHTML = "";
    els.revisionEntries.innerHTML = "";
    els.revisionTableWrap.classList.add("hidden");
    els.revisionEmptyState.classList.remove("hidden");
    els.restoreRevisionButton.disabled = true;
    els.restoreRevisionButton.textContent = t("action.restoreRevision");
    return;
  }

  const compareNumber = Number(revision.compareToRevisionNumber || 0);
  const summary = state.selectedSummary || { files: 0, added: 0, modified: 0, deleted: 0, unchanged: 0 };
  els.revisionTitle.textContent = t("history.revisionLabel", { revision: revision.revisionNumber });
  els.revisionMeta.textContent = `${originLabel(revision.origin)} • ${formatTimestamp(revision.createdAt)}`;
  els.revisionNote.textContent = revision.note || t("history.noNote");
  els.historyRevisionBadge.textContent = revision.current
    ? t("history.currentRevision", { revision: revision.revisionNumber })
    : revision.synced
      ? t("history.syncedRevision", { revision: revision.revisionNumber })
      : t("history.snapshotRevision", { revision: revision.revisionNumber });
  els.historyCompareBadge.textContent = compareNumber ? t("history.comparedWith", { revision: compareNumber }) : t("history.firstRevision");
  els.restoreRevisionButton.disabled = state.restoring;
  els.restoreRevisionButton.textContent = state.restoring ? `${t("action.restoreRevision")}...` : t("action.restoreRevision");

  els.revisionSummaryGrid.innerHTML = `
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(t("common.files"))}</span>
      <strong>${escapeHtml(summary.files)}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(t("summary.added"))}</span>
      <strong>${escapeHtml(summary.added)}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(t("summary.modified"))}</span>
      <strong>${escapeHtml(summary.modified)}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(t("summary.deleted"))}</span>
      <strong>${escapeHtml(summary.deleted)}</strong>
    </article>
  `;

  if (state.loadingRevision && !state.selectedEntries.length) {
    els.revisionEntries.innerHTML = "";
    els.revisionTableWrap.classList.add("hidden");
    els.revisionEmptyState.classList.remove("hidden");
    els.revisionEmptyState.innerHTML = `<strong>${escapeHtml(t("history.loadingRevision"))}</strong><span>${escapeHtml(t("history.loadingRevisionCopy"))}</span>`;
    return;
  }

  if (!state.selectedEntries.length) {
    els.revisionEntries.innerHTML = "";
    els.revisionTableWrap.classList.add("hidden");
    els.revisionEmptyState.classList.remove("hidden");
    els.revisionEmptyState.innerHTML = `<strong>${escapeHtml(t("history.noItems"))}</strong><span>${escapeHtml(t("history.noItemsCopy"))}</span>`;
    return;
  }

  els.revisionEntries.innerHTML = state.selectedEntries
    .map(
      (entry) => `
        <tr>
          <td>
            <div class="history-file-name">
              <span class="material-symbols-outlined">${escapeHtml(entryIcon(entry))}</span>
              <div>
                <strong>${escapeHtml(entry.name)}</strong>
                <small>${escapeHtml(entry.path)}</small>
              </div>
            </div>
          </td>
          <td>
            <span class="history-status-badge is-${escapeHtml(entry.status)}">${escapeHtml(statusLabel(entry.status))}</span>
          </td>
          <td class="history-files-size">${escapeHtml(entry.type === "directory" ? "--" : formatBytes(entry.size))}</td>
          <td class="history-files-action">
            ${
              entry.restorable
                ? `<button class="ghost-button small-button" data-action="restore-file" data-path="${escapeHtml(entry.path)}" type="button" ${state.restoring ? "disabled" : ""}>${escapeHtml(t("action.restoreRevision"))}</button>`
                : `<span class="muted-copy">--</span>`
            }
          </td>
        </tr>
      `
    )
    .join("");
  els.revisionEmptyState.classList.add("hidden");
  els.revisionTableWrap.classList.remove("hidden");
}

function renderAll() {
  renderStatusPill();
  renderTimeline();
  renderRevisionDetail();
}

async function loadRevisionDetail(revisionId) {
  if (!revisionId) {
    state.selectedRevisionId = null;
    state.selectedRevision = null;
    state.selectedEntries = [];
    state.selectedSummary = null;
    renderAll();
    return;
  }
  state.loadingRevision = true;
  state.selectedRevisionId = Number(revisionId);
  renderAll();
  try {
    const data = await apiFetch(apiPath(`/history/${encodeURIComponent(revisionId)}`));
    state.selectedRevision = {
      ...data.revision,
      compareToRevisionNumber: data.compareToRevisionNumber,
    };
    state.selectedEntries = data.entries || [];
    state.selectedSummary = data.summary || null;
    state.studioStatus = data.status || state.studioStatus;
  } finally {
    state.loadingRevision = false;
    renderAll();
  }
}

async function loadHistory(preferredRevisionId = null) {
  state.loadingHistory = true;
  renderAll();
  try {
    await apiFetch(apiPath("/ensure"), {
      method: "POST",
      body: JSON.stringify({}),
    });
    const data = await apiFetch(apiPath("/history"));
    state.history = data.history || [];
    state.studioStatus = data.status || null;
    const nextRevisionId = preferredRevisionId && state.history.some((entry) => Number(entry.id) === Number(preferredRevisionId))
      ? Number(preferredRevisionId)
      : Number(state.history.find((entry) => entry.current)?.id || state.history[0]?.id || 0);
    if (nextRevisionId) {
      await loadRevisionDetail(nextRevisionId);
    } else {
      state.selectedRevisionId = null;
      state.selectedRevision = null;
      state.selectedEntries = [];
      state.selectedSummary = null;
    }
    setBanner(
      t("history.loadedBanner"),
      "success"
    );
  } catch (error) {
    setBanner(`Failed to load history: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    state.loadingHistory = false;
    renderAll();
  }
}

async function restoreRevision(mode, path = "") {
  if (!state.selectedRevision) {
    return;
  }
  const confirmed = window.confirm(
    mode === "skill"
      ? `Restore the entire working copy to revision r${state.selectedRevision.revisionNumber}?`
      : `Restore ${path} from revision r${state.selectedRevision.revisionNumber}?`
  );
  if (!confirmed) {
    return;
  }
  state.restoring = true;
  renderAll();
  try {
    const result = await apiFetch(apiPath("/restore"), {
      method: "POST",
      body: JSON.stringify({
        revisionId: state.selectedRevision.id,
        mode,
        path,
      }),
    });
    state.history = result.history || state.history;
    state.studioStatus = result.studioStatus || state.studioStatus;
    const currentRevisionId = Number(state.history.find((entry) => entry.current)?.id || 0);
    await loadHistory(currentRevisionId);
    setBanner(
      mode === "skill"
        ? "Working copy restored. A new local revision was created with that state."
        : `File restored from ${path}. A new local revision was created with that change.`,
      "success"
    );
  } catch (error) {
    setBanner(`Failed to restore revision: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    state.restoring = false;
    renderAll();
  }
}

function bindEvents() {
  els.refreshHistoryPageButton.addEventListener("click", async () => {
    await loadHistory(state.selectedRevisionId);
  });

  els.restoreRevisionButton.addEventListener("click", async () => {
    await restoreRevision("skill");
  });

  els.revisionTimeline.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-revision-id]");
    if (!target) {
      return;
    }
    await loadRevisionDetail(Number(target.dataset.revisionId));
  });

  els.revisionEntries.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action='restore-file']");
    if (!action) {
      return;
    }
    await restoreRevision("file", action.dataset.path || "");
  });
}

async function main() {
  renderAll();
  bindEvents();
  await loadHistory();
}

void main();
