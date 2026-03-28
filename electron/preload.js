const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('session-deleted', (_, sessionId) => {
  window.dispatchEvent(
    new CustomEvent('chat-history:session-deleted', { detail: { sessionId } })
  );
});

contextBridge.exposeInMainWorld('chatHistory', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),
  getSessionMessages: (sessionId) => ipcRenderer.invoke('get-session-messages', sessionId),
  searchSessions: (query) => ipcRenderer.invoke('search-sessions', query),
  refreshSessions: () => ipcRenderer.invoke('refresh-sessions'),
  openSessionContextMenu: (sessionIdOrPayload) =>
    ipcRenderer.invoke('open-session-context-menu', sessionIdOrPayload),
});
