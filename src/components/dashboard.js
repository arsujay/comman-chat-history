/**
 * Usage dashboard — monthly activity, productivity index, PR-related text signals.
 */

function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

function maxMetric(monthly, fn) {
  const vals = monthly.map(fn);
  return Math.max(1, ...vals);
}

export class Dashboard {
  constructor() {
    this.root = document.getElementById('dashboard-root');
    this._lastData = null;
  }

  showLoading() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="dashboard-loading">
        <div class="loading-spinner"></div>
        <p>Computing usage…</p>
      </div>
    `;
  }

  showError(message) {
    if (!this.root) return;
    this.root.innerHTML = `<div class="dashboard-error"><p>${escapeHtml(message)}</p></div>`;
  }

  async loadAndRender() {
    if (!this.root) return;
    this.showLoading();
    try {
      const data = await window.chatHistory.getDashboardStats();
      this._lastData = data;
      this.render(data);
    } catch (e) {
      console.error(e);
      this.showError('Could not load dashboard statistics.');
    }
  }

  render(data) {
    if (!this.root || !data) return;
    const { totals, monthly, topRepos, generatedAt } = data;
    const maxSessions = maxMetric(monthly, (m) => m.sessions);
    const maxProd = maxMetric(monthly, (m) => m.productiveScore);
    const maxPr = maxMetric(monthly, (m) => m.prSignals);

    const monthRows = monthly
      .map((m) => {
        const wS = (m.sessions / maxSessions) * 100;
        const wP = (m.productiveScore / maxProd) * 100;
        const wPr = (m.prSignals / maxPr) * 100;
        return `
          <tr>
            <td class="dashboard-td-label">${escapeHtml(m.label)}</td>
            <td class="dashboard-td-num">${fmtNum(m.sessions)}</td>
            <td class="dashboard-td-num">${fmtNum(m.messages)}</td>
            <td class="dashboard-td-num">${fmtNum(m.prSignals)}</td>
            <td class="dashboard-td-num">${fmtNum(m.productiveScore)}</td>
            <td class="dashboard-td-bars">
              <div class="dashboard-bar-row" title="Sessions">
                <span class="dashboard-bar-fill dashboard-bar-sessions" style="width:${wS.toFixed(1)}%"></span>
              </div>
              <div class="dashboard-bar-row" title="Productivity index">
                <span class="dashboard-bar-fill dashboard-bar-prod" style="width:${wP.toFixed(1)}%"></span>
              </div>
              <div class="dashboard-bar-row" title="PR-related mentions">
                <span class="dashboard-bar-fill dashboard-bar-pr" style="width:${wPr.toFixed(1)}%"></span>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    const repoRows = topRepos
      .map(
        (r) => `
      <li class="dashboard-repo-item">
        <span class="dashboard-repo-name">${escapeHtml(r.name)}</span>
        <span class="dashboard-repo-count">${fmtNum(r.sessions)}</span>
      </li>
    `
      )
      .join('');

    const gen = generatedAt ? new Date(generatedAt).toLocaleString() : '';

    this.root.innerHTML = `
      <div class="dashboard-inner">
        <p class="dashboard-disclaimer">
          PR counts are <strong>mentions in chat</strong> (URLs, “pull request”, etc.), not live GitHub data.
          Productivity index weights assistant replies, tool use, code blocks, and PR-related text.
        </p>
        <div class="dashboard-kpi-grid">
          <div class="dashboard-kpi">
            <span class="dashboard-kpi-label">Conversations</span>
            <span class="dashboard-kpi-value">${fmtNum(totals.sessions)}</span>
          </div>
          <div class="dashboard-kpi">
            <span class="dashboard-kpi-label">Messages</span>
            <span class="dashboard-kpi-value">${fmtNum(totals.messages)}</span>
          </div>
          <div class="dashboard-kpi">
            <span class="dashboard-kpi-label">PR-related signals</span>
            <span class="dashboard-kpi-value">${fmtNum(totals.prSignals)}</span>
          </div>
          <div class="dashboard-kpi">
            <span class="dashboard-kpi-label">Code blocks (pairs)</span>
            <span class="dashboard-kpi-value">${fmtNum(totals.codeFencePairs)}</span>
          </div>
          <div class="dashboard-kpi dashboard-kpi-wide">
            <span class="dashboard-kpi-label">Productivity index (sum)</span>
            <span class="dashboard-kpi-value">${fmtNum(totals.productiveScore)}</span>
          </div>
        </div>

        <h3 class="dashboard-section-title">Per month</h3>
        <div class="dashboard-table-wrap">
          <table class="dashboard-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Sessions</th>
                <th>Msgs</th>
                <th>PR sig.</th>
                <th>Prod. idx</th>
                <th>Activity (relative)</th>
              </tr>
            </thead>
            <tbody>
              ${monthRows || '<tr><td colspan="6" class="dashboard-td-empty">No dated sessions yet.</td></tr>'}
            </tbody>
          </table>
        </div>
        <p class="dashboard-legend">
          <span class="dashboard-legend-dot dashboard-bar-sessions"></span> sessions
          <span class="dashboard-legend-dot dashboard-bar-prod"></span> productivity
          <span class="dashboard-legend-dot dashboard-bar-pr"></span> PR signals
        </p>

        <div class="dashboard-split">
          <div>
            <h3 class="dashboard-section-title">Top workspaces / repos</h3>
            <ul class="dashboard-repo-list">
              ${repoRows || '<li class="dashboard-td-empty">No workspace path on sessions.</li>'}
            </ul>
          </div>
          <div class="dashboard-source-card">
            <h3 class="dashboard-section-title">This month breakdown</h3>
            ${this.renderLatestMonthSources(monthly)}
          </div>
        </div>
        ${gen ? `<p class="dashboard-generated">Updated ${escapeHtml(gen)}</p>` : ''}
      </div>
    `;
  }

  renderLatestMonthSources(monthly) {
    if (!monthly.length) {
      return '<p class="dashboard-muted">No data.</p>';
    }
    const last = monthly[monthly.length - 1];
    const { bySource } = last;
    const total = (bySource.codex || 0) + (bySource.copilot || 0) + (bySource.cursor || 0) || 1;
    const row = (label, key, cls) => {
      const n = bySource[key] || 0;
      const pct = (n / total) * 100;
      return `
        <div class="dashboard-source-row">
          <span class="source-dot ${cls}"></span>
          <span class="dashboard-source-name">${label}</span>
          <span class="dashboard-source-pct">${fmtNum(n)} (${pct.toFixed(0)}%)</span>
        </div>
      `;
    };
    return `
      <div class="dashboard-source-rows">
        ${row('Codex', 'codex', 'codex')}
        ${row('Copilot', 'copilot', 'copilot')}
        ${row('Cursor', 'cursor', 'cursor')}
      </div>
      <p class="dashboard-muted dashboard-source-note">${escapeHtml(last.label)}</p>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
