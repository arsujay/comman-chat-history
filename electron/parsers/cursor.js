const fs = require('fs');
const path = require('path');
const os = require('os');

const CURSOR_PROJECTS = path.join(os.homedir(), '.cursor', 'projects');

/**
 * Cursor agent transcripts: ~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl
 * Each line: {"role":"user|assistant","message":{"content":[{"type":"text","text":"..."}]}}
 */
function extractTextFromLine(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const inner = obj.message != null ? obj.message : obj;
  if (typeof inner === 'string') return inner;
  if (typeof inner.content === 'string') return inner.content;
  if (Array.isArray(inner.content)) {
    return inner.content
      .map((c) => {
        if (!c || typeof c !== 'object') return '';
        if (c.type === 'text' && typeof c.text === 'string') return c.text;
        if (typeof c.text === 'string') return c.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Cursor stores user turns wrapped in <user_query>...</user_query> — strip for titles and bubbles.
 * Keeps any text outside those tags (e.g. [Image] / <image_files> blocks).
 */
function stripUserQueryTags(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(/<user_query\s*>\s*([\s\S]*?)\s*<\/user_query\s*>/gi, (_, inner) => inner.trim())
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

function findCursorTranscriptFiles() {
  const out = [];
  if (!fs.existsSync(CURSOR_PROJECTS)) return out;

  const projects = fs.readdirSync(CURSOR_PROJECTS, { withFileTypes: true });
  for (const ent of projects) {
    if (!ent.isDirectory()) continue;
    const projectSlug = ent.name;
    const transcriptsRoot = path.join(CURSOR_PROJECTS, projectSlug, 'agent-transcripts');
    if (!fs.existsSync(transcriptsRoot)) continue;

    const sessions = fs.readdirSync(transcriptsRoot, { withFileTypes: true });
    for (const sub of sessions) {
      if (!sub.isDirectory()) continue;
      const sessionId = sub.name;
      const fp = path.join(transcriptsRoot, sessionId, `${sessionId}.jsonl`);
      if (fs.existsSync(fp)) {
        out.push({ filePath: fp, workspaceName: projectSlug });
      }
    }
  }
  return out;
}

function parseCursorTranscript(filePath, workspaceName) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const messages = [];

  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      const role = o.role === 'user' ? 'user' : 'assistant';
      let text = extractTextFromLine(o).trim();
      if (role === 'user') text = stripUserQueryTags(text);
      if (!text.trim()) continue;
      messages.push({
        role,
        content: text,
        timestamp: null,
      });
    } catch (e) {
      /* skip malformed lines */
    }
  }

  const firstUser = messages.find((m) => m.role === 'user');
  let title = firstUser
    ? firstUser.content.replace(/\n/g, ' ').substring(0, 100)
    : path.basename(filePath, '.jsonl');
  if (title.length >= 100) title = title + '…';

  const preview = firstUser
    ? firstUser.content.substring(0, 150).replace(/\n/g, ' ')
    : '';

  const slug = (workspaceName || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
  const baseId = path.basename(filePath, '.jsonl');
  const id = `cursor-${slug}-${baseId}`;

  const stat = fs.statSync(filePath);

  return {
    id,
    source: 'cursor',
    title,
    date: stat.mtime.toISOString(),
    workspace: workspaceName || '',
    messages,
    preview,
    filePath,
  };
}

async function parseCursorSessions() {
  const sessions = [];
  for (const f of findCursorTranscriptFiles()) {
    try {
      const session = parseCursorTranscript(f.filePath, f.workspaceName);
      if (session.messages.length > 0) {
        sessions.push(session);
      }
    } catch (e) {
      console.error(`Error parsing ${f.filePath}:`, e.message);
    }
  }
  sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
  return sessions;
}

module.exports = { parseCursorSessions, parseCursorTranscript };
