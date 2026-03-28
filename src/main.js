import { Sidebar } from './components/sidebar.js';
import { ChatView } from './components/chatView.js';
import { Dashboard } from './components/dashboard.js';

const SIDEBAR_WIDTH_STORAGE_KEY = 'chv-sidebar-width-px';
const SIDEBAR_MIN_PX = 200;
const SIDEBAR_MAX_CAP_PX = 560;

function clampSidebarWidth(px) {
  const max = Math.min(SIDEBAR_MAX_CAP_PX, Math.floor(window.innerWidth * 0.75));
  return Math.max(SIDEBAR_MIN_PX, Math.min(max, px));
}

function applySidebarWidth(px) {
  const w = clampSidebarWidth(px);
  document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
  return w;
}

function initSidebarResize() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  if (!sidebar || !resizer) return;

  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw != null) {
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) applySidebarWidth(parsed);
    }
  } catch {
    /* ignore */
  }

  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    document.body.classList.add('sidebar-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    const dx = e.clientX - startX;
    applySidebarWidth(startWidth + dx);
  }

  function onUp() {
    document.body.classList.remove('sidebar-resizing');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    try {
      const w = Math.round(sidebar.getBoundingClientRect().width);
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(w)));
    } catch {
      /* ignore */
    }
  }

  window.addEventListener('resize', () => {
    const current = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim(),
      10
    );
    if (!Number.isNaN(current)) applySidebarWidth(current);
  });
}

/**
 * Main application entry point
 * Orchestrates sidebar and chat view, manages state
 */

class App {
  constructor() {
    this.sidebar = null;
    this.chatView = null;
    this.dashboard = null;
    this.sessions = [];
    /** @type {'chats' | 'dashboard'} */
    this.mainView = 'chats';

    this.init();
  }

  async init() {
    // Show loading state
    this.showLoading(true);

    // Initialize components
    this.chatView = new ChatView();

    this.dashboard = new Dashboard();

    this.sidebar = new Sidebar({
      onSessionSelect: (sessionId) => this.onSessionSelect(sessionId),
    });

    initSidebarResize();

    const btnDash = document.getElementById('btn-dashboard');
    btnDash?.addEventListener('click', () => {
      this.setMainView(this.mainView === 'dashboard' ? 'chats' : 'dashboard');
    });

    // Refresh button
    document.getElementById('btn-refresh').addEventListener('click', () => {
      this.refresh();
    });

    // Load sessions
    await this.loadSessions();

    window.addEventListener('chat-history:session-deleted', (ev) => {
      const sid = ev.detail?.sessionId;
      if (sid) void this.onSessionDeleted(sid);
    });

    // Hide loading state
    this.showLoading(false);
    this.chatView.showEmpty();
  }

  setMainView(mode, opts = {}) {
    const chats = document.getElementById('view-chats');
    const dash = document.getElementById('view-dashboard');
    const btn = document.getElementById('btn-dashboard');
    this.mainView = mode;

    if (mode === 'dashboard') {
      chats?.classList.add('hidden');
      dash?.classList.remove('hidden');
      if (dash) dash.setAttribute('aria-hidden', 'false');
      btn?.setAttribute('aria-pressed', 'true');
      btn?.classList.add('active');
      if (!opts.skipDashboardLoad) void this.dashboard.loadAndRender();
    } else {
      dash?.classList.add('hidden');
      chats?.classList.remove('hidden');
      if (dash) dash.setAttribute('aria-hidden', 'true');
      btn?.setAttribute('aria-pressed', 'false');
      btn?.classList.remove('active');
    }
  }

  async onSessionDeleted(sessionId) {
    await this.loadSessions();
    if (this.sidebar.activeSessionId === sessionId) {
      this.sidebar.setActiveSession(null);
      this.chatView.showEmpty();
    }
  }

  showLoading(show) {
    const loadingState = document.getElementById('loading-state');
    const emptyState = document.getElementById('empty-state');

    if (show) {
      loadingState.classList.remove('hidden');
      emptyState.classList.add('hidden');
    } else {
      loadingState.classList.add('hidden');
    }
  }

  async loadSessions() {
    try {
      this.sessions = await window.chatHistory.getSessions();
      this.sidebar.setSessions(this.sessions);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      this.sessions = [];
      this.sidebar.setSessions([]);
    }
  }

  async onSessionSelect(sessionId) {
    this.setMainView('chats', { skipDashboardLoad: true });
    try {
      const session = await window.chatHistory.getSessionMessages(sessionId);
      if (session) {
        this.chatView.displaySession(session);
      }
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  }

  async refresh() {
    this.showLoading(true);
    try {
      await window.chatHistory.refreshSessions();
      await this.loadSessions();
    } catch (err) {
      console.error('Failed to refresh:', err);
    }
    this.showLoading(false);
    this.chatView.showEmpty();
    if (this.mainView === 'dashboard') {
      void this.dashboard.loadAndRender();
    }
  }
}

// Initialize the app
new App();
