import { renderMarkdown } from '../utils/markdown.js';
import { formatFullDate, formatTimestamp } from '../utils/dateFormat.js';
import { getCodexResumeChatId } from '../utils/codexResumeId.js';

function asMarkdownString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Chat View component — renders the full message thread for a selected session
 */
export class ChatView {
  constructor() {
    this.chatView = document.getElementById('chat-view');
    this.emptyState = document.getElementById('empty-state');
    this.chatTitle = document.getElementById('chat-title');
    this.chatHeaderMenuBtn = document.getElementById('chat-header-menu-btn');
    this.chatSource = document.getElementById('chat-source');
    this.chatDate = document.getElementById('chat-date');
    this.chatModel = document.getElementById('chat-model');
    this.chatWorkspace = document.getElementById('chat-workspace');
    this.chatMessages = document.getElementById('chat-messages');
    this.scrollTopBtn = document.getElementById('btn-scroll-top');
    this.chatFindBar = document.getElementById('chat-find-bar');
    this.chatFindInput = document.getElementById('chat-find-input');
    this.chatFindCount = document.getElementById('chat-find-count');
    this.chatFindPrev = document.getElementById('chat-find-prev');
    this.chatFindNext = document.getElementById('chat-find-next');
    this._findHits = [];
    this._findIndex = -1;
    this._findDebounce = null;
    this.currentSessionId = null;

    this.bindEvents();
  }

  bindEvents() {
    this.chatHeaderMenuBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.currentSessionId) return;
      const rect = this.chatHeaderMenuBtn.getBoundingClientRect();
      window.chatHistory.openSessionContextMenu({
        sessionId: this.currentSessionId,
        x: Math.round(rect.right),
        y: Math.round(rect.bottom),
      });
    });

    // Scroll to top button
    this.scrollTopBtn.addEventListener('click', () => {
      this.chatMessages.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Show scroll-to-top when user has scrolled up (not when pinned at latest / bottom)
    this.chatMessages.addEventListener('scroll', () => this.updateScrollTopButtonVisibility());

    document.addEventListener('keydown', (e) => {
      if (this.chatView.classList.contains('hidden')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        this.chatFindBar?.classList.remove('hidden');
        this.chatFindInput?.focus();
        this.chatFindInput?.select();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g' && this._findHits.length) {
        if (!this.chatFindBar?.classList.contains('hidden')) {
          e.preventDefault();
          if (e.shiftKey) this.findPrev();
          else this.findNext();
        }
      }
    });

    this.chatFindInput?.addEventListener('input', () => {
      clearTimeout(this._findDebounce);
      this._findDebounce = setTimeout(() => this.applyInChatFind(), 120);
    });
    this.chatFindInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.chatFindInput.value = '';
        this.applyInChatFind();
        this.chatFindInput.blur();
      }
    });
    this.chatFindPrev?.addEventListener('click', () => this.findPrev());
    this.chatFindNext?.addEventListener('click', () => this.findNext());
  }

  showEmpty() {
    this.currentSessionId = null;
    this.chatView.classList.add('hidden');
    this.emptyState.classList.remove('hidden');
    delete this.chatTitle.dataset.codexResumeId;
    delete this.chatTitle.dataset.codexCwd;
    this.chatTitle.classList.remove('chat-title-codex-resume');
    this.chatTitle.removeAttribute('title');
    this.chatHeaderMenuBtn?.classList.add('hidden');
    this.chatFindBar?.classList.add('hidden');
    if (this.chatFindInput) this.chatFindInput.value = '';
    this.clearInChatFindMarks();
    this._updateFindCountUi();
  }

  /**
   * Display a full session with all messages
   */
  displaySession(session) {
    this.currentSessionId = session.id ?? null;
    this.emptyState.classList.add('hidden');
    this.chatView.classList.remove('hidden');

    // Update header
    this.chatTitle.textContent = session.title;
    const codexRid = getCodexResumeChatId(session);
    if (codexRid) {
      this.chatTitle.dataset.codexResumeId = codexRid;
      if (session.cwd && String(session.cwd).trim()) {
        this.chatTitle.dataset.codexCwd = String(session.cwd).trim();
      } else {
        delete this.chatTitle.dataset.codexCwd;
      }
    } else {
      delete this.chatTitle.dataset.codexResumeId;
      delete this.chatTitle.dataset.codexCwd;
    }
    this.chatTitle.classList.toggle('chat-title-codex-resume', !!codexRid);
    this.chatTitle.title = '';
    this.chatHeaderMenuBtn?.classList.remove('hidden');

    this.chatSource.textContent = session.source;
    this.chatSource.className = `chat-source-badge ${session.source}`;

    this.chatDate.textContent = formatFullDate(session.date);

    if (session.model) {
      this.chatModel.textContent = session.model;
      this.chatModel.style.display = '';
    } else {
      this.chatModel.style.display = 'none';
    }

    if (session.workspace) {
      this.chatWorkspace.textContent = `📁 ${session.workspace}`;
      this.chatWorkspace.style.display = '';
    } else if (session.cwd) {
      this.chatWorkspace.textContent = `📁 ${session.cwd}`;
      this.chatWorkspace.style.display = '';
    } else {
      this.chatWorkspace.style.display = 'none';
    }

    // Render messages
    this.chatMessages.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (const message of session.messages) {
      try {
        const el = this.renderMessage(message);
        if (el) fragment.appendChild(el);
      } catch (err) {
        console.error('Failed to render message:', message?.role, err);
      }
    }

    this.chatMessages.appendChild(fragment);

    // Syntax highlight all code blocks
    this.chatMessages.querySelectorAll('pre code').forEach(block => {
      try {
        if (window.hljs) {
          window.hljs.highlightElement(block);
        }
      } catch (e) { /* ignore highlight errors */ }
    });

    // Scroll to latest messages (bottom); re-run after layout so height is correct
    this.scrollChatToBottom();

    this.chatFindBar?.classList.remove('hidden');
    if (this.chatFindInput) {
      this.chatFindInput.value = '';
      this.clearInChatFindMarks();
      this._updateFindCountUi();
    }
  }

  updateScrollTopButtonVisibility() {
    const el = this.chatMessages;
    if (!el) return;
    const gapBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = gapBottom < 48;
    const hasScroll = el.scrollHeight > el.clientHeight + 4;
    const show = hasScroll && !nearBottom;
    this.scrollTopBtn.classList.toggle('hidden', !show);
  }

  /** Scroll thread to the most recent messages. */
  scrollChatToBottom() {
    const el = this.chatMessages;
    if (!el) return;
    const apply = () => {
      el.scrollTop = el.scrollHeight;
    };
    apply();
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(() => {
        apply();
        this.updateScrollTopButtonVisibility();
      });
    });
  }

  clearInChatFindMarks() {
    this.chatMessages?.querySelectorAll('.message-wrapper').forEach((el) => {
      el.classList.remove('chat-find-hit', 'chat-find-active');
    });
    this._findHits = [];
    this._findIndex = -1;
  }

  applyInChatFind() {
    const q = this.chatFindInput?.value.trim().toLowerCase() ?? '';
    this.clearInChatFindMarks();
    if (!q) {
      this._updateFindCountUi();
      return;
    }
    const hits = [];
    this.chatMessages?.querySelectorAll('.message-wrapper').forEach((el) => {
      if (el.textContent.toLowerCase().includes(q)) {
        hits.push(el);
        el.classList.add('chat-find-hit');
      }
    });
    this._findHits = hits;
    this._findIndex = hits.length ? 0 : -1;
    this._applyActiveFind();
    this._updateFindCountUi();
  }

  _applyActiveFind() {
    this.chatMessages?.querySelectorAll('.message-wrapper.chat-find-active').forEach((el) => {
      el.classList.remove('chat-find-active');
    });
    const el = this._findHits[this._findIndex];
    if (el) {
      el.classList.add('chat-find-active');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  findNext() {
    if (!this._findHits.length) return;
    this._findIndex = (this._findIndex + 1) % this._findHits.length;
    this._applyActiveFind();
    this._updateFindCountUi();
  }

  findPrev() {
    if (!this._findHits.length) return;
    this._findIndex = (this._findIndex - 1 + this._findHits.length) % this._findHits.length;
    this._applyActiveFind();
    this._updateFindCountUi();
  }

  _updateFindCountUi() {
    if (!this.chatFindCount) return;
    const q = this.chatFindInput?.value.trim() ?? '';
    if (!q) {
      this.chatFindCount.textContent = '';
      return;
    }
    const n = this._findHits.length;
    if (n === 0) {
      this.chatFindCount.textContent = 'No matches';
      return;
    }
    this.chatFindCount.textContent = `${this._findIndex + 1} / ${n}`;
  }

  renderMessage(message) {
    switch (message.role) {
      case 'user':
        return this.renderUserMessage(message);
      case 'assistant':
        return this.renderAssistantMessage(message);
      case 'tool_call':
        return this.renderToolCall(message);
      case 'tool_output':
        return this.renderToolOutput(message);
      case 'thinking':
        return this.renderThinking(message);
      case 'reference':
        return this.renderReference(message);
      case 'context':
        return this.renderContext(message);
      case 'code_edit':
        return this.renderCodeEdit(message);
      default:
        return null;
    }
  }

  renderUserMessage(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper message-user';
    wrapper.innerHTML = `
      <div>
        <div class="message-role">
          <span>You</span>
          <span class="role-icon">👤</span>
        </div>
        <div class="message-bubble">${renderMarkdown(asMarkdownString(message.content))}</div>
        <div class="message-timestamp">${formatTimestamp(message.timestamp)}</div>
      </div>
    `;
    return wrapper;
  }

  renderAssistantMessage(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper message-assistant';

    const phaseLabel = message.metadata?.phase === 'commentary' ? ' · Commentary' : '';

    wrapper.innerHTML = `
      <div>
        <div class="message-role">
          <span class="role-icon">✨</span>
          <span>Assistant${phaseLabel}</span>
        </div>
        <div class="message-bubble">${renderMarkdown(asMarkdownString(message.content))}</div>
        <div class="message-timestamp">${formatTimestamp(message.timestamp)}</div>
      </div>
    `;
    return wrapper;
  }

  renderToolCall(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper message-tool-call';

    const name = message.metadata?.name || message.content;
    const args = message.metadata?.arguments || {};
    const argsStr = JSON.stringify(args, null, 2);

    // For exec_command, show the command prominently
    let displayContent = argsStr;
    if (name === 'exec_command' && args.cmd) {
      displayContent = args.cmd;
    }

    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    wrapper.innerHTML = `
      <div class="tool-call-card">
        <div class="tool-call-header" onclick="toggleCollapsible('${id}')">
          <svg class="tool-call-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span class="tool-call-name">${escapeHtmlStr(name)}</span>
          <span class="tool-call-badge">Tool Call</span>
        </div>
        <div class="tool-call-body" id="${id}">
          <div class="tool-call-args">${escapeHtmlStr(displayContent)}</div>
        </div>
      </div>
    `;
    return wrapper;
  }

  renderToolOutput(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper message-tool-output';

    const content = message.content;
    const truncated = content.length > 2000 ? content.substring(0, 2000) + '\n... (truncated)' : content;
    const id = `output-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    wrapper.innerHTML = `
      <div class="tool-output-card">
        <div class="tool-output-header" onclick="toggleCollapsible('${id}')">
          <svg class="tool-call-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span class="tool-output-label">Output</span>
          <span style="font-size: 11px; color: var(--text-tertiary)">${content.split('\n').length} lines</span>
        </div>
        <div class="tool-output-body" id="${id}">
          <div class="tool-output-content">${escapeHtmlStr(truncated)}</div>
        </div>
      </div>
    `;
    return wrapper;
  }

  renderThinking(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper message-thinking';

    const title = message.metadata?.generatedTitle || 'Thinking...';
    const id = `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    wrapper.innerHTML = `
      <div class="thinking-card">
        <div class="thinking-header" onclick="toggleCollapsible('${id}')">
          <svg class="tool-call-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span class="thinking-label">💭 ${escapeHtmlStr(title)}</span>
        </div>
        <div class="thinking-body" id="${id}">
          <div class="thinking-content">${renderMarkdown(asMarkdownString(message.content))}</div>
        </div>
      </div>
    `;
    return wrapper;
  }

  renderReference(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper message-reference';

    const filePath = message.content;
    const fileName = filePath.split('/').pop();

    wrapper.innerHTML = `
      <span class="reference-pill">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
        </svg>
        ${escapeHtmlStr(fileName)}
      </span>
    `;
    return wrapper;
  }

  renderContext(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper message-context';
    wrapper.innerHTML = `
      <span class="context-pill">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        ${escapeHtmlStr(message.content)}
      </span>
    `;
    return wrapper;
  }

  renderCodeEdit(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper message-assistant';

    const uri = message.metadata?.uri;
    const fileName = uri ? uri.split('/').pop() : 'Code Edit';

    wrapper.innerHTML = `
      <div>
        <div class="message-role">
          <span class="role-icon">✏️</span>
          <span>Code Edit · ${escapeHtmlStr(fileName)}</span>
        </div>
        <div class="message-bubble">${renderMarkdown(asMarkdownString(message.content))}</div>
      </div>
    `;
    return wrapper;
  }
}

function escapeHtmlStr(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Global function for collapsible toggle (used in onclick handlers)
window.toggleCollapsible = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('expanded');
  // Toggle chevron on the header
  const header = el.previousElementSibling;
  if (header) header.classList.toggle('expanded');
};

// Global function for code copy
window.copyCode = function(btn) {
  const codeBlock = btn.closest('.code-block-wrapper');
  const code = codeBlock.querySelector('code');
  if (!code) return;

  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      Copied!
    `;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy
      `;
    }, 2000);
  });
};
