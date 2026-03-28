const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE_STORAGE_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Code',
  'User',
  'workspaceStorage'
);

function messageStartsWithEnvironmentContext(content) {
  if (typeof content !== 'string') return false;
  const t = content.trimStart();
  return /^<environment_context[\s>]/i.test(t);
}

/** Copilot sometimes uses [], objects, or markdown objects for `value` — always coerce for IPC/renderer. */
function normalizeCopilotContent(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    if (value.every((x) => typeof x === 'string')) return value.join('\n');
    return value
      .map((x) => {
        if (x != null && typeof x === 'object' && typeof x.text === 'string') return x.text;
        return typeof x === 'string' ? x : JSON.stringify(x);
      })
      .join('\n');
  }
  if (typeof value === 'object' && typeof value.text === 'string') return value.text;
  return JSON.stringify(value);
}

/** User turn is often `{ parts: [{ text }], text }` rather than a plain string. */
function extractUserMessageText(message) {
  if (message == null) return '';
  if (typeof message === 'string') return message;
  if (typeof message === 'object') {
    if (typeof message.text === 'string' && message.text.length > 0) return message.text;
    if (Array.isArray(message.parts)) {
      const joined = message.parts
        .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n');
      if (joined) return joined;
    }
  }
  return JSON.stringify(message);
}

/** Kinds that are not plain assistant markdown (handled elsewhere or have no `value`). */
const SKIP_ASSISTANT_KINDS = new Set([
  'inlineReference',
  'prepareToolInvocation',
  'toolInvocationSerialized',
  'undoStop',
  'codeblockUri',
  'textEdit',
  'textEditGroup',
]);

function extractCodeEditContent(part) {
  if (part.kind === 'textEditGroup' && Array.isArray(part.edits)) {
    const chunks = [];
    for (const group of part.edits) {
      if (!Array.isArray(group)) continue;
      for (const e of group) {
        if (e && typeof e.text === 'string') chunks.push(e.text);
      }
    }
    if (chunks.length) return chunks.join('\n---\n');
  }
  let t = normalizeCopilotContent(part.text ?? part.value ?? '');
  if (!t && part.uri && typeof part.uri.fsPath === 'string') {
    t = `(file) ${part.uri.fsPath}`;
  }
  return t;
}

/**
 * Find all Copilot chat session JSON files across all workspaces
 */
function findCopilotSessionFiles() {
  const files = [];
  if (!fs.existsSync(WORKSPACE_STORAGE_DIR)) return files;

  const workspaceDirs = fs.readdirSync(WORKSPACE_STORAGE_DIR, { withFileTypes: true });

  for (const wsDir of workspaceDirs) {
    if (!wsDir.isDirectory()) continue;

    const chatSessionsDir = path.join(WORKSPACE_STORAGE_DIR, wsDir.name, 'chatSessions');
    if (!fs.existsSync(chatSessionsDir)) continue;

    // Read workspace.json to get project name
    let workspaceName = wsDir.name;
    const workspaceJsonPath = path.join(WORKSPACE_STORAGE_DIR, wsDir.name, 'workspace.json');
    if (fs.existsSync(workspaceJsonPath)) {
      try {
        const wsJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
        if (wsJson.folder) {
          // Extract folder name from URI like file:///path/to/project
          const folderUri = wsJson.folder;
          workspaceName = folderUri.replace(/^file:\/\//, '').split('/').filter(Boolean).pop() || wsDir.name;
        }
      } catch (e) { /* use hash as fallback */ }
    }

    const sessionFiles = fs.readdirSync(chatSessionsDir).filter(f => f.endsWith('.json'));
    for (const sf of sessionFiles) {
      files.push({
        filePath: path.join(chatSessionsDir, sf),
        workspaceName,
        workspaceHash: wsDir.name,
      });
    }
  }

  return files;
}

/**
 * Parse a single Copilot chat session JSON file
 */
function parseCopilotSession(fileInfo) {
  const { filePath, workspaceName } = fileInfo;
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  const messages = [];
  let title = '';
  let titleFromGenerated = false;
  let sessionDate = null;

  // Copilot sessions have a "requests" array
  const requests = data.requests || data.interactions || [];

  for (const req of requests) {
    // User message
    if (req.message || req.prompt) {
      const raw = req.message || req.prompt || '';
      const userText = extractUserMessageText(raw);
      const timestamp = req.timestamp ? new Date(req.timestamp).toISOString() : null;

      if (!sessionDate && timestamp) {
        sessionDate = timestamp;
      }

      messages.push({
        role: 'user',
        content: userText,
        timestamp,
      });

      // Capture variable data (attached files, selections)
      if (req.variableData?.variables?.length > 0) {
        const vars = req.variableData.variables
          .map(v => v.name || v.value)
          .filter(Boolean);
        if (vars.length > 0) {
          messages.push({
            role: 'context',
            content: `Attached: ${vars.join(', ')}`,
            timestamp,
            metadata: { variables: req.variableData.variables },
          });
        }
      }
    }

    // Response
    if (req.response) {
      const responseParts = Array.isArray(req.response) ? req.response : [req.response];

      for (const part of responseParts) {
        // Thinking block (value may be "", [] or an object in newer VS Code formats)
        if (part.kind === 'thinking') {
          const thinkingText = normalizeCopilotContent(part.value);
          if (thinkingText.trim()) {
            messages.push({
              role: 'thinking',
              content: thinkingText,
              timestamp: sessionDate,
              metadata: {
                generatedTitle: part.generatedTitle,
              },
            });
          }

          if (part.generatedTitle && !title) {
            title = part.generatedTitle;
            titleFromGenerated = true;
          }
        }

        // Plain assistant markdown (exclude structured parts handled below)
        if (
          part.value != null &&
          part.kind !== 'thinking' &&
          part.kind !== 'mcpServersStarting' &&
          !SKIP_ASSISTANT_KINDS.has(part.kind)
        ) {
          const assistantText = normalizeCopilotContent(part.value);
          if (assistantText.trim()) {
            messages.push({
              role: 'assistant',
              content: assistantText,
              timestamp: sessionDate,
              metadata: {
                baseUri: part.baseUri?.path,
              },
            });
          }
        }

        // Code citation / inline reference
        if (part.kind === 'inlineReference' && part.inlineReference) {
          const ir = part.inlineReference;
          const refPath =
            ir.fsPath ||
            ir.path ||
            ir.location?.uri?.fsPath ||
            ir.location?.uri?.path ||
            (typeof ir.external === 'string' ? ir.external.replace(/^file:\/\//, '') : null);
          if (refPath) {
            messages.push({
              role: 'reference',
              content: refPath,
              timestamp: sessionDate,
            });
          }
        }

        // Code edit
        if (part.kind === 'textEdit' || part.kind === 'codeblockUri' || part.kind === 'textEditGroup') {
          const editText = extractCodeEditContent(part);
          if (editText.trim()) {
            messages.push({
              role: 'code_edit',
              content: editText,
              timestamp: sessionDate,
              metadata: {
                uri: part.uri || part.codeBlockUri,
                edits: part.edits,
              },
            });
          }
        }
      }
    }
  }

  let idx = 0;
  while (idx < messages.length && messageStartsWithEnvironmentContext(messages[idx].content)) {
    idx++;
  }
  const skippedLeadingEnv = idx > 0;

  if (!title) {
    const pick = skippedLeadingEnv && idx < messages.length
      ? messages[idx]
      : messages.find(m => m.role === 'user') || messages[0];
    title = pick && typeof pick.content === 'string'
      ? pick.content.substring(0, 100).replace(/\n/g, ' ')
      : path.basename(filePath, '.json');
    if (title.length >= 100) title = title + '…';
  }

  const previewPick = titleFromGenerated
    ? messages.find(m => m.role === 'user')
    : skippedLeadingEnv && idx < messages.length
      ? messages[idx]
      : messages.find(m => m.role === 'user') || messages[0];
  const preview = previewPick && typeof previewPick.content === 'string'
    ? previewPick.content.substring(0, 150).replace(/\n/g, ' ')
    : '';

  const id = `copilot-${path.basename(filePath, '.json')}`;

  return {
    id,
    source: 'copilot',
    title,
    date: sessionDate || fs.statSync(filePath).mtime.toISOString(),
    workspace: workspaceName,
    messages,
    preview,
    filePath,
  };
}

/**
 * Parse all Copilot sessions
 */
async function parseCopilotSessions() {
  const sessions = [];
  const files = findCopilotSessionFiles();

  for (const fileInfo of files) {
    try {
      const session = parseCopilotSession(fileInfo);
      if (session.messages.length > 0) {
        sessions.push(session);
      }
    } catch (e) {
      console.error(`Error parsing ${fileInfo.filePath}:`, e.message);
    }
  }

  sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
  return sessions;
}

module.exports = { parseCopilotSessions, parseCopilotSession };
