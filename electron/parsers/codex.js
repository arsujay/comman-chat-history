const fs = require('fs');
const path = require('path');
const os = require('os');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');
const ARCHIVED_DIR = path.join(CODEX_DIR, 'archived_sessions');
const HISTORY_FILE = path.join(CODEX_DIR, 'history.jsonl');

/** Opening user turn is the Codex env block (case-insensitive). */
function messageStartsWithEnvironmentContext(content) {
  if (typeof content !== 'string') return false;
  const t = content.trimStart();
  return /^<environment_context[\s>]/i.test(t);
}

/** Normalize Codex JSONL `timestamp` to a Date, or null. */
function timestampToDate(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === 'string' && ts.length > 0) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Sidebar grouping and sort order should follow last activity, not rollout file creation time.
 * Uses max(message timestamps, file mtime) so ongoing chats surface under Today after new turns.
 */
function resolveLastActivityIso(filePath, messages, startedAtIsoFallback) {
  let lastMs = null;

  for (const m of messages) {
    const d = timestampToDate(m.timestamp);
    if (!d) continue;
    const t = d.getTime();
    lastMs = lastMs == null ? t : Math.max(lastMs, t);
  }

  try {
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    lastMs = lastMs == null ? mtimeMs : Math.max(lastMs, mtimeMs);
  } catch (_) {
    /* no file stat */
  }

  if (lastMs == null && startedAtIsoFallback) {
    const d = new Date(startedAtIsoFallback);
    if (!Number.isNaN(d.getTime())) lastMs = d.getTime();
  }

  if (lastMs == null) lastMs = Date.now();
  return new Date(lastMs).toISOString();
}

/** Skip one or more leading messages that are only the env preamble; use next message for title. */
function pickTitleSource(messages) {
  if (!messages.length) return null;
  let i = 0;
  while (i < messages.length && messageStartsWithEnvironmentContext(messages[i].content)) {
    i++;
  }
  if (i > 0) {
    return messages[i] ?? messages[messages.length - 1];
  }
  return messages[0];
}

/**
 * Recursively find all rollout-*.jsonl files
 */
function findRolloutFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findRolloutFiles(fullPath));
    } else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Parse a single Codex rollout JSONL file into a normalized session
 */
function parseRolloutFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  const messages = [];
  let model = null;
  let cwd = null;
  let sessionDate = null;

  // Extract date from filename: rollout-YYYY-MM-DDTHH-MM-SS-uuid.jsonl
  const filenameMatch = path.basename(filePath).match(/rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  if (filenameMatch) {
    sessionDate = filenameMatch[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
  }

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const { type, payload, timestamp } = entry;

      if (type === 'turn_context') {
        model = payload.model || model;
        cwd = payload.cwd || cwd;
        continue;
      }

      if (type === 'response_item' && payload) {
        const role = payload.role;

        // User message
        if (role === 'user' && payload.content) {
          const textParts = payload.content
            .filter(c => c.type === 'input_text')
            .map(c => c.text)
            .filter(t => !t.startsWith('<') || t.length < 200); // filter system instructions

          // Only add if there's meaningful user text (not system instructions)
          const meaningfulText = textParts.filter(t => {
            if (t.startsWith('<permissions instructions>')) return false;
            if (t.startsWith('<collaboration_mode>')) return false;
            if (t.startsWith('<skills_instructions>')) return false;
            if (t.includes('## Skills\nA skill is a set of local instructions')) return false;
            return true;
          });

          if (meaningfulText.length > 0) {
            messages.push({
              role: 'user',
              content: meaningfulText.join('\n'),
              timestamp: timestamp || sessionDate,
            });
          }
        }

        // Assistant message
        if (role === 'assistant' && payload.content) {
          const textParts = payload.content
            .filter(c => c.type === 'output_text')
            .map(c => c.text);

          if (textParts.length > 0) {
            const phase = payload.phase || 'response';
            messages.push({
              role: 'assistant',
              content: textParts.join('\n'),
              timestamp,
              metadata: { phase },
            });
          }
        }

        // Function call (tool use)
        if (payload.type === 'function_call') {
          let args = {};
          try {
            args = JSON.parse(payload.arguments || '{}');
          } catch (e) { /* ignore parse errors */ }

          messages.push({
            role: 'tool_call',
            content: payload.name,
            timestamp,
            metadata: {
              callId: payload.call_id,
              name: payload.name,
              arguments: args,
            },
          });
        }

        // Function call output
        if (payload.type === 'function_call_output') {
          messages.push({
            role: 'tool_output',
            content: payload.output || '',
            timestamp,
            metadata: {
              callId: payload.call_id,
            },
          });
        }
      }

      // Agent message (commentary)
      if (type === 'event_msg' && payload?.type === 'agent_message') {
        messages.push({
          role: 'assistant',
          content: payload.message,
          timestamp,
          metadata: { phase: 'commentary' },
        });
      }
    } catch (e) {
      // Skip unparseable lines
      continue;
    }
  }

  const titleSource = pickTitleSource(messages);

  let title = titleSource && typeof titleSource.content === 'string'
    ? titleSource.content.substring(0, 100).replace(/\n/g, ' ')
    : path.basename(filePath, '.jsonl');

  if (title.length >= 100) title = title + '…';

  const preview = titleSource && typeof titleSource.content === 'string'
    ? titleSource.content.substring(0, 150).replace(/\n/g, ' ')
    : '';

  // Extract session ID from filename (stem after "rollout-"); matches `codex resume <id>`
  const idMatch = path.basename(filePath).match(/rollout-(.+)\.jsonl$/);
  const codexResumeId = idMatch ? idMatch[1] : null;
  const id = codexResumeId ? `codex-${codexResumeId}` : `codex-${Date.now()}`;

  const date = resolveLastActivityIso(filePath, messages, sessionDate);

  return {
    id,
    source: 'codex',
    title,
    date,
    model,
    cwd,
    messages,
    preview,
    filePath,
    codexResumeId,
  };
}

/**
 * Parse all Codex sessions (active + archived)
 */
async function parseCodexSessions() {
  const sessions = [];

  // Active sessions
  const activeFiles = findRolloutFiles(SESSIONS_DIR);
  for (const f of activeFiles) {
    try {
      const session = parseRolloutFile(f);
      if (session.messages.length > 0) {
        sessions.push(session);
      }
    } catch (e) {
      console.error(`Error parsing ${f}:`, e.message);
    }
  }

  // Archived sessions
  const archivedFiles = findRolloutFiles(ARCHIVED_DIR);
  for (const f of archivedFiles) {
    try {
      const session = parseRolloutFile(f);
      if (session.messages.length > 0) {
        session.archived = true;
        sessions.push(session);
      }
    } catch (e) {
      console.error(`Error parsing ${f}:`, e.message);
    }
  }

  // Sort by date descending
  sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
  return sessions;
}

module.exports = { parseCodexSessions, parseRolloutFile };
