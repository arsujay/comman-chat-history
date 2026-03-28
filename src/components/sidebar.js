import { formatDate } from '../utils/dateFormat.js';
import { getCodexResumeChatId } from '../utils/codexResumeId.js';

/** JSON: string (open folder key) or null (all collapsed). Accordion: at most one open. */
const OPEN_FOLDER_KEY = 'chv-sidebar-open-folder';
/** @deprecated migrated once */
const LEGACY_EXPANDED_FOLDERS_KEY = 'chv-sidebar-expanded-folders';
/** @deprecated migrated once */
const LEGACY_COLLAPSED_FOLDERS_KEY = 'chv-sidebar-collapsed-folders';

/**
 * Sidebar component — manages session list with search, filter, and folder grouping
 */
export class Sidebar {
  constructor({ onSessionSelect }) {
    this.onSessionSelect = onSessionSelect;
    this.sessions = [];
    this.filteredSessions = [];
    this.activeFilter = 'all';
    this.activeSessionId = null;
    this.searchQuery = '';
    this._searchSeq = 0;
    this._searchDebounce = null;

    this.sessionListEl = document.getElementById('session-list');
    this.searchInput = document.getElementById('search-input');

    this.bindEvents();
  }

  bindEvents() {
    // Search: debounced IPC search across full message history
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value;
      clearTimeout(this._searchDebounce);
      const trimmed = this.searchQuery.trim();
      if (!trimmed) {
        void this.filterAndRender();
        return;
      }
      this._searchDebounce = setTimeout(() => void this.filterAndRender(), 280);
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.searchInput.value = '';
        this.searchQuery = '';
        clearTimeout(this._searchDebounce);
        void this.filterAndRender();
      }
    });

    // Cmd+K shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
      }
    });

    // Filter tabs
    const tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeFilter = tab.dataset.filter;
        void this.filterAndRender();
      });
    });
  }

  setSessions(sessions) {
    this.sessions = sessions;
    this.updateCounts();
    void this.filterAndRender();
  }

  updateCounts() {
    const countAll = document.getElementById('count-all');
    const countCodex = document.getElementById('count-codex');
    const countCopilot = document.getElementById('count-copilot');
    const countCursor = document.getElementById('count-cursor');

    countAll.textContent = this.sessions.length;
    countCodex.textContent = this.sessions.filter(s => s.source === 'codex').length;
    countCopilot.textContent = this.sessions.filter(s => s.source === 'copilot').length;
    if (countCursor) {
      countCursor.textContent = this.sessions.filter(s => s.source === 'cursor').length;
    }
  }

  async filterAndRender() {
    const trimmed = this.searchQuery.trim();
    let filtered;

    if (trimmed) {
      const seq = ++this._searchSeq;
      try {
        filtered = await window.chatHistory.searchSessions(trimmed);
      } catch {
        filtered = [];
      }
      if (seq !== this._searchSeq) return;
    } else {
      filtered = [...this.sessions];
    }

    if (this.activeFilter !== 'all') {
      filtered = filtered.filter(s => s.source === this.activeFilter);
    }

    this.filteredSessions = filtered;
    this.render();
  }

  render() {
    const container = this.sessionListEl;
    container.innerHTML = '';

    if (this.filteredSessions.length === 0) {
      container.innerHTML = `
        <div class="no-results">
          <div class="no-results-icon">🔍</div>
          <h3>No conversations found</h3>
          <p>${this.searchQuery ? 'Try a different search term' : 'No sessions available for this filter'}</p>
        </div>
      `;
      return;
    }

    const byFolder = new Map();
    for (const session of this.filteredSessions) {
      const key = getFolderKey(session);
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key).push(session);
    }

    for (const sessions of byFolder.values()) {
      sessions.sort((a, b) => sessionSortMs(b) - sessionSortMs(a));
    }

    const folderRows = [...byFolder.entries()].map(([key, sessions]) => ({
      key,
      sessions,
      maxMs: Math.max(0, ...sessions.map((s) => sessionSortMs(s))),
    }));
    folderRows.sort((a, b) => b.maxMs - a.maxMs);

    const folderKeys = folderRows.map((r) => r.key);
    const openKey = loadOpenFolderKey(folderKeys);

    for (const { key, sessions } of folderRows) {
      const label = getFolderLabel(key);
      const expanded = openKey === key;
      const collapsed = !expanded;

      const folderEl = document.createElement('div');
      folderEl.className = 'session-folder';
      if (collapsed) folderEl.classList.add('collapsed');

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'session-folder-header';
      header.title = key === '__other__' ? 'Sessions without workspace path' : key;
      header.innerHTML = `
        <span class="session-folder-chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
        <span class="session-folder-name">${escapeHtml(label)}</span>
        <span class="session-folder-count">${sessions.length}</span>
      `;

      const body = document.createElement('div');
      body.className = 'session-folder-body';
      body.hidden = collapsed;

      for (const session of sessions) {
        body.appendChild(this.createSessionCard(session));
      }

      header.addEventListener('click', (e) => {
        e.preventDefault();
        const wasOpen = !folderEl.classList.contains('collapsed');
        if (wasOpen) {
          folderEl.classList.add('collapsed');
          body.hidden = true;
          saveOpenFolderKey(null);
          return;
        }
        container.querySelectorAll('.session-folder').forEach((el) => {
          el.classList.add('collapsed');
          const b = el.querySelector('.session-folder-body');
          if (b) b.hidden = true;
        });
        folderEl.classList.remove('collapsed');
        body.hidden = false;
        saveOpenFolderKey(key);
      });

      folderEl.appendChild(header);
      folderEl.appendChild(body);
      container.appendChild(folderEl);
    }
  }

  createSessionCard(session) {
    const card = document.createElement('div');
    card.className = `session-card${session.id === this.activeSessionId ? ' active' : ''}`;
    card.dataset.sessionId = session.id;

    const workspaceInfo = session.workspace
      ? `<span class="meta-item">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
           ${session.workspace}
         </span>`
      : '';

    const cwdInfo = session.cwd
      ? `<span class="meta-item">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
           ${session.cwd.split('/').pop()}
         </span>`
      : '';

    const codexRid = getCodexResumeChatId(session);
    if (codexRid) {
      card.classList.add('session-card-codex-resume');
    }

    card.innerHTML = `
      <div class="session-card-header">
        <div class="session-card-title">${escapeHtml(session.title)}</div>
        <div class="session-card-header-actions">
          <span class="session-card-source ${session.source}">${session.source}</span>
          <button type="button" class="session-card-menu-btn" aria-label="Conversation options" title="More options">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="6" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="18" r="2" />
            </svg>
          </button>
        </div>
      </div>
      ${session.preview ? `<div class="session-card-preview">${escapeHtml(session.preview)}</div>` : ''}
      <div class="session-card-meta">
        <span class="meta-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${formatDate(session.date)}
        </span>
        <span class="meta-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ${session.messageCount}
        </span>
        ${workspaceInfo}
        ${cwdInfo}
      </div>
    `;

    card.addEventListener('click', () => {
      this.setActiveSession(session.id);
      this.onSessionSelect(session.id);
    });

    const menuBtn = card.querySelector('.session-card-menu-btn');
    menuBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      window.chatHistory.openSessionContextMenu({
        sessionId: session.id,
        x: Math.round(rect.right),
        y: Math.round(rect.bottom),
      });
    });

    return card;
  }

  setActiveSession(sessionId) {
    this.activeSessionId = sessionId;
    const cards = this.sessionListEl.querySelectorAll('.session-card');
    cards.forEach(card => {
      const id = card.dataset.sessionId;
      card.classList.toggle('active', sessionId != null && id === sessionId);
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function normalizePathKey(s) {
  return String(s).replace(/\\/g, '/').trim();
}

function getFolderKey(session) {
  const cwd = session.cwd && String(session.cwd).trim();
  if (cwd) return normalizePathKey(cwd);
  const ws = session.workspace && String(session.workspace).trim();
  if (ws) return normalizePathKey(ws);
  return '__other__';
}

function getFolderLabel(folderKey) {
  if (folderKey === '__other__') return 'Other';
  const parts = folderKey.split('/').filter(Boolean);
  const leaf = parts[parts.length - 1] || folderKey;
  return leaf.length > 48 ? `${leaf.slice(0, 45)}…` : leaf;
}

function sessionSortMs(session) {
  const t = new Date(session.date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * At most one open folder (accordion). `null` = all collapsed.
 * Migrates from legacy multi-expand or collapsed-only storage.
 */
function loadOpenFolderKey(currentFolderKeys) {
  const valid = new Set(currentFolderKeys);

  try {
    const raw = localStorage.getItem(OPEN_FOLDER_KEY);
    if (raw != null && raw !== '') {
      const parsed = JSON.parse(raw);
      if (parsed === null) return null;
      if (typeof parsed === 'string') {
        if (valid.has(parsed)) return parsed;
        saveOpenFolderKey(null);
        return null;
      }
    }
  } catch {
    /* fall through to migration */
  }

  try {
    const oldRaw = localStorage.getItem(LEGACY_EXPANDED_FOLDERS_KEY);
    if (oldRaw != null) {
      const arr = JSON.parse(oldRaw);
      localStorage.removeItem(LEGACY_EXPANDED_FOLDERS_KEY);
      if (Array.isArray(arr)) {
        const first = arr.find((x) => typeof x === 'string' && valid.has(x));
        if (first != null) {
          saveOpenFolderKey(first);
          return first;
        }
        return null;
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_COLLAPSED_FOLDERS_KEY);
    if (legacyRaw != null) {
      let collapsed = new Set();
      try {
        const arr = JSON.parse(legacyRaw);
        if (Array.isArray(arr)) {
          collapsed = new Set(arr.filter((x) => typeof x === 'string'));
        }
      } catch {
        /* ignore */
      }
      localStorage.removeItem(LEGACY_COLLAPSED_FOLDERS_KEY);
      const firstOpen = currentFolderKeys.find((k) => !collapsed.has(k));
      if (firstOpen != null) {
        saveOpenFolderKey(firstOpen);
        return firstOpen;
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}

function saveOpenFolderKey(key) {
  try {
    localStorage.setItem(OPEN_FOLDER_KEY, JSON.stringify(key == null ? null : key));
  } catch {
    /* ignore */
  }
}
