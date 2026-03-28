/**
 * Aggregate dashboard metrics from parsed sessions (messages on disk).
 * PR / productivity signals are heuristics from message text, not GitHub API data.
 */

/** @param {object} m */
function flattenMessageForDashboard(m) {
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
    } catch (_) {
      /* ignore */
    }
  }
  return parts.join('\n');
}

function sessionFullText(session) {
  return (session.messages || []).map(flattenMessageForDashboard).join('\n');
}

function monthKeyFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${mo}`;
}

function countCodeFencePairs(text) {
  if (!text) return 0;
  const n = (text.match(/```/g) || []).length;
  return Math.floor(n / 2);
}

/**
 * Heuristic count of pull-request-related mentions in chat (not actual GitHub PR count).
 */
function countPrSignals(text) {
  if (!text || typeof text !== 'string') return 0;
  let n = 0;
  const lower = text.toLowerCase();
  n += (text.match(/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/gi) || []).length;
  n += (lower.match(/\bpull request\b/g) || []).length;
  n += (lower.match(/\bmerge pull request\b/g) || []).length;
  n += (lower.match(/\bopened a pull request\b/g) || []).length;
  n += (lower.match(/\bclosed pull request\b/g) || []).length;
  n += (lower.match(/\bgh pr\b/g) || []).length;
  n += (lower.match(/\bpr\s*#\s*\d+/g) || []).length;
  n += (lower.match(/\bpull\s*#\s*\d+/g) || []).length;
  return n;
}

function roleCounts(messages) {
  const out = { user: 0, assistant: 0, tool: 0, other: 0 };
  for (const m of messages || []) {
    const r = m.role;
    if (r === 'user') out.user++;
    else if (r === 'assistant') out.assistant++;
    else if (r === 'tool_call' || r === 'tool_output') out.tool++;
    else out.other++;
  }
  return out;
}

/**
 * Rough "productive work" index: assistant output, tools, code, PR-related discussion.
 */
function sessionProductiveScore(session, text, fences, prSignals) {
  const rc = roleCounts(session.messages);
  return (
    rc.assistant * 2 +
    rc.tool * 3 +
    rc.user * 0.5 +
    Math.min(fences, 80) * 0.75 +
    prSignals * 1.5
  );
}

function repoLabel(session) {
  if (session.cwd && String(session.cwd).trim()) {
    const p = String(session.cwd).replace(/\\/g, '/').split('/').filter(Boolean);
    return p[p.length - 1] || '';
  }
  if (session.workspace && String(session.workspace).trim()) {
    const p = String(session.workspace).replace(/\\/g, '/').split('/').filter(Boolean);
    return p[p.length - 1] || session.workspace;
  }
  return '';
}

/**
 * @param {Array<object>} allSessions — full parsed sessions with messages
 */
function computeDashboardStats(allSessions) {
  const monthlyMap = new Map();
  const repoMap = new Map();
  let totalMessages = 0;

  for (const s of allSessions) {
    const mk = monthKeyFromIso(s.date);
    if (!mk) continue;

    const messages = s.messages || [];
    totalMessages += messages.length;
    const text = sessionFullText(s);
    const fences = countCodeFencePairs(text);
    const prSignals = countPrSignals(text);
    const prod = sessionProductiveScore(s, text, fences, prSignals);
    const rc = roleCounts(messages);

    if (!monthlyMap.has(mk)) {
      monthlyMap.set(mk, {
        monthKey: mk,
        label: '',
        sessions: 0,
        messages: 0,
        prSignals: 0,
        codeFencePairs: 0,
        productiveScore: 0,
        bySource: { codex: 0, copilot: 0, cursor: 0 },
        userTurns: 0,
        assistantTurns: 0,
        toolTurns: 0,
      });
    }
    const row = monthlyMap.get(mk);
    row.sessions += 1;
    row.messages += messages.length;
    row.prSignals += prSignals;
    row.codeFencePairs += fences;
    row.productiveScore += prod;
    row.userTurns += rc.user;
    row.assistantTurns += rc.assistant;
    row.toolTurns += rc.tool;
    const src = s.source;
    if (src && row.bySource[src] != null) row.bySource[src] += 1;

    const repo = repoLabel(s);
    if (repo) {
      repoMap.set(repo, (repoMap.get(repo) || 0) + 1);
    }
  }

  const monthly = [...monthlyMap.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  for (const m of monthly) {
    const [y, mo] = m.monthKey.split('-').map(Number);
    m.label = new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  }

  const topRepos = [...repoMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, sessions: count }));

  const totals = {
    sessions: allSessions.length,
    messages: totalMessages,
    prSignals: monthly.reduce((a, m) => a + m.prSignals, 0),
    codeFencePairs: monthly.reduce((a, m) => a + m.codeFencePairs, 0),
    productiveScore: monthly.reduce((a, m) => a + m.productiveScore, 0),
  };

  return {
    totals,
    monthly,
    topRepos,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  computeDashboardStats,
  flattenMessageForDashboard,
};
