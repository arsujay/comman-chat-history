const { app, BrowserWindow, ipcMain, Menu, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { computeDashboardStats } = require('./dashboardStats');
const { resolveDeletableFilePath, deleteSessionFiles } = require('./sessionFs');

let mainWindow;

/** Reload parser modules in dev so title/preview logic updates without restarting Electron. */
function getParsers() {
  if (!app.isPackaged) {
    try {
      delete require.cache[require.resolve('./parsers/codex')];
      delete require.cache[require.resolve('./parsers/copilot')];
      delete require.cache[require.resolve('./parsers/cursor')];
    } catch (_) { /* ignore */ }
  }
  return {
    parseCodexSessions: require('./parsers/codex').parseCodexSessions,
    parseCopilotSessions: require('./parsers/copilot').parseCopilotSessions,
    parseCursorSessions: require('./parsers/cursor').parseCursorSessions,
  };
}

/** Reload full session from disk so IPC sends a fresh JSON-safe payload (large Copilot threads). */
function reloadSessionFromDisk(session) {
  if (!session?.filePath || !fs.existsSync(session.filePath)) {
    return session;
  }
  try {
    if (session.source === 'codex') {
      const { parseRolloutFile } = require('./parsers/codex');
      return parseRolloutFile(session.filePath);
    }
    if (session.source === 'copilot') {
      const { parseCopilotSession } = require('./parsers/copilot');
      return parseCopilotSession({
        filePath: session.filePath,
        workspaceName: session.workspace || '',
      });
    }
    if (session.source === 'cursor') {
      const { parseCursorTranscript } = require('./parsers/cursor');
      return parseCursorTranscript(session.filePath, session.workspace || '');
    }
  } catch (e) {
    console.error('reloadSessionFromDisk:', e.message);
  }
  return session;
}

/** Window / platform icon: project-root CHC.png (dev + packaged in app.asar). */
function getAppIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'CHC.png'),
    path.join(__dirname, '..', 'SA.png'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  const icon = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...(icon ? { icon } : {}),
  });

  // In dev mode, load from Vite dev server (unless dist is forced for docs/screenshots)
  const isDev = !app.isPackaged;
  const useDist =
    process.env.CHAT_HISTORY_VIEWER_USE_DIST === '1' ||
    process.env.CHAT_HISTORY_VIEWER_USE_DIST === 'true';
  if (isDev && !useDist) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// Cache for parsed sessions
let sessionsCache = null;

async function loadAllSessions() {
  if (sessionsCache) return sessionsCache;

  try {
    const { parseCodexSessions, parseCopilotSessions, parseCursorSessions } = getParsers();
    const [codexSessions, copilotSessions, cursorSessions] = await Promise.all([
      parseCodexSessions(),
      parseCopilotSessions(),
      parseCursorSessions(),
    ]);

    sessionsCache = {
      codex: codexSessions,
      copilot: copilotSessions,
      cursor: cursorSessions,
    };

    return sessionsCache;
  } catch (err) {
    console.error('Error loading sessions:', err);
    return { codex: [], copilot: [], cursor: [] };
  }
}

// IPC Handlers
ipcMain.handle('get-sessions', async () => {
  const sessions = await loadAllSessions();

  // Return session list (without full messages for performance)
  const sessionList = [];

  for (const s of sessions.codex) {
    sessionList.push({
      id: s.id,
      source: 'codex',
      title: s.title,
      date: s.date,
      messageCount: s.messages.length,
      model: s.model,
      cwd: s.cwd,
      preview: s.preview,
      filePath: s.filePath,
      codexResumeId: s.codexResumeId ?? null,
    });
  }

  for (const s of sessions.copilot) {
    sessionList.push({
      id: s.id,
      source: 'copilot',
      title: s.title,
      date: s.date,
      messageCount: s.messages.length,
      workspace: s.workspace,
      preview: s.preview,
      filePath: s.filePath,
    });
  }

  for (const s of sessions.cursor) {
    sessionList.push({
      id: s.id,
      source: 'cursor',
      title: s.title,
      date: s.date,
      messageCount: s.messages.length,
      workspace: s.workspace,
      preview: s.preview,
      filePath: s.filePath,
    });
  }

  // Sort by date descending
  sessionList.sort((a, b) => new Date(b.date) - new Date(a.date));
  return sessionList;
});

ipcMain.handle('get-dashboard-stats', async () => {
  const sessions = await loadAllSessions();
  const allSessions = [
    ...sessions.codex,
    ...sessions.copilot,
    ...(sessions.cursor || []),
  ];
  return computeDashboardStats(allSessions);
});

ipcMain.handle('get-session-messages', async (_, sessionId) => {
  const sessions = await loadAllSessions();

  const allSessions = [
    ...sessions.codex,
    ...sessions.copilot,
    ...(sessions.cursor || []),
  ];
  const session = allSessions.find(s => s.id === sessionId);
  if (!session) return null;

  const full = reloadSessionFromDisk(session);
  try {
    return JSON.parse(JSON.stringify(full));
  } catch (e) {
    console.error('get-session-messages serialize:', e.message);
    return full;
  }
});

/** Plain text for searching a single message (any role / content shape). */
function flattenMessageForSearch(m) {
  if (!m) return '';
  const parts = [];
  if (typeof m.content === 'string') parts.push(m.content);
  else if (m.content != null) {
    try {
      parts.push(JSON.stringify(m.content));
    } catch (_) {
      parts.push(String(m.content));
    }
  }
  if (m.metadata && typeof m.metadata === 'object') {
    try {
      parts.push(JSON.stringify(m.metadata));
    } catch (_) { /* ignore */ }
  }
  return parts.join('\n');
}

function sessionMatchesSearchQuery(s, q) {
  const fields = [s.title, s.preview, s.cwd, s.workspace, s.model].filter(Boolean).join('\n').toLowerCase();
  if (fields.includes(q)) return true;
  return (s.messages || []).some(m => flattenMessageForSearch(m).toLowerCase().includes(q));
}

ipcMain.handle('search-sessions', async (_, query) => {
  const sessions = await loadAllSessions();
  const allSessions = [
    ...sessions.codex,
    ...sessions.copilot,
    ...(sessions.cursor || []),
  ];
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results = allSessions.filter(s => sessionMatchesSearchQuery(s, q));

  return results.map(s => ({
    id: s.id,
    source: s.source,
    title: s.title,
    date: s.date,
    messageCount: s.messages.length,
    model: s.model,
    cwd: s.cwd,
    workspace: s.workspace,
    preview: s.preview,
    filePath: s.filePath,
    codexResumeId: s.codexResumeId ?? null,
  }));
});

ipcMain.handle('refresh-sessions', async () => {
  sessionsCache = null;
  return loadAllSessions();
});

/** Match rollout stem `YYYY-MM-DDTHH-MM-SS-<uuid>` — CLI wants `<uuid>` only. */
function normalizeCodexResumeIdForCli(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  const m = s.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/);
  return m ? m[1] : s;
}

/** POSIX-safe single-quoted path for shell `cd`. */
function shellQuotePosixPath(p) {
  const s = typeof p === 'string' ? p.trim() : '';
  if (!s) return '';
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildCodexResumeTemplate(session) {
  const resumeRaw = session.codexResumeId || (session.id?.startsWith('codex-') ? session.id.slice(6) : '');
  const id = normalizeCodexResumeIdForCli(resumeRaw);
  if (!id) return [];

  const cwd = typeof session.cwd === 'string' ? session.cwd.trim() : '';
  const cmd = `codex resume ${id}`;
  const cdArg = shellQuotePosixPath(cwd);
  const cdCmd = cdArg ? `cd ${cdArg}` : '';

  const template = [
    {
      label: `Copy "${cmd}"`,
      click: () => clipboard.writeText(cmd),
    },
    {
      label: 'Copy resume chat ID only',
      click: () => clipboard.writeText(id),
    },
  ];

  if (cdCmd) {
    template.push({ type: 'separator' });
    template.push({
      label: `Copy "${cdCmd}"`,
      click: () => clipboard.writeText(cdCmd),
    });
    template.push({
      label: 'Copy cd + codex resume',
      click: () => clipboard.writeText(`${cdCmd}\n${cmd}`),
    });
  }
  return template;
}

/** Copy helpers for Cursor / Copilot (Codex uses buildCodexResumeTemplate). */
function buildCursorCopilotCopyTemplate(session) {
  const template = [];
  const fp = session.filePath;
  if (!fp || typeof fp !== 'string') return template;

  if (session.source === 'cursor') {
    const sessionId = path.basename(fp, '.jsonl');
    const folderPath = path.dirname(fp);
    template.push({
      label: 'Copy session ID',
      click: () => clipboard.writeText(sessionId),
    });
    template.push({
      label: 'Copy folder path',
      click: () => clipboard.writeText(folderPath),
    });
    template.push({
      label: 'Copy file path',
      click: () => clipboard.writeText(fp),
    });
    if (session.workspace && String(session.workspace).trim()) {
      template.push({
        label: 'Copy workspace label',
        click: () => clipboard.writeText(String(session.workspace).trim()),
      });
    }
  } else if (session.source === 'copilot') {
    template.push({
      label: 'Copy session ID',
      click: () => clipboard.writeText(session.id),
    });
    template.push({
      label: 'Copy folder path',
      click: () => clipboard.writeText(path.dirname(fp)),
    });
    template.push({
      label: 'Copy file path',
      click: () => clipboard.writeText(fp),
    });
    if (session.workspace && String(session.workspace).trim()) {
      template.push({
        label: 'Copy workspace label',
        click: () => clipboard.writeText(String(session.workspace).trim()),
      });
    }
  }

  return template;
}

/** Sidebar / header: Codex copy helpers + delete (removes real file under allowlisted roots). */
ipcMain.handle('open-session-context-menu', async (event, payload) => {
  let sessionId;
  let menuX;
  let menuY;
  let hasAnchor = false;
  if (typeof payload === 'string') {
    sessionId = payload;
  } else if (payload && typeof payload === 'object' && payload.sessionId) {
    sessionId = payload.sessionId;
    if (Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
      menuX = Math.round(payload.x);
      menuY = Math.round(payload.y);
      hasAnchor = true;
    }
  }
  if (!sessionId || typeof sessionId !== 'string') return;

  const sessions = await loadAllSessions();
  const allSessions = [
    ...sessions.codex,
    ...sessions.copilot,
    ...(sessions.cursor || []),
  ];
  const session = allSessions.find((s) => s.id === sessionId);
  if (!session?.filePath) return;

  const win = BrowserWindow.fromWebContents(event.sender);
  const template = [];

  if (session.source === 'codex') {
    template.push(...buildCodexResumeTemplate(session));
  } else if (session.source === 'cursor' || session.source === 'copilot') {
    template.push(...buildCursorCopilotCopyTemplate(session));
  }

  if (template.length > 0) {
    template.push({ type: 'separator' });
  }

  template.push({
    label: 'Delete conversation…',
    click: () => {
      if (!win || win.isDestroyed()) return;
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Cancel', 'Delete'],
        defaultId: 0,
        cancelId: 0,
        message: 'Delete this conversation?',
        detail: `This removes the file from disk. You cannot undo this action.\n\n${session.filePath}`,
      });
      if (choice !== 1) return;

      const check = resolveDeletableFilePath(session.filePath);
      if (!check.ok) {
        dialog.showErrorBox('Cannot delete', check.error);
        return;
      }

      try {
        deleteSessionFiles(check.resolved, session.source);
      } catch (e) {
        dialog.showErrorBox('Delete failed', e.message || String(e));
        return;
      }

      sessionsCache = null;
      if (!win.isDestroyed()) {
        win.webContents.send('session-deleted', sessionId);
      }
    },
  });

  const menu = Menu.buildFromTemplate(template);
  setImmediate(() => {
    if (win && !win.isDestroyed()) {
      if (hasAnchor) {
        menu.popup({ window: win, x: menuX, y: menuY });
      } else {
        menu.popup({ window: win });
      }
    } else {
      menu.popup();
    }
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
