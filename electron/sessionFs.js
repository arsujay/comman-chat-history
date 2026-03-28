const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Only paths under these roots may be deleted (matches Codex / Copilot / Cursor parser roots).
 */
function getDeleteAllowlistRoots() {
  const home = os.homedir();
  const roots = [
    path.join(home, '.codex', 'sessions'),
    path.join(home, '.codex', 'archived_sessions'),
    path.join(home, '.cursor', 'projects'),
  ];
  if (process.platform === 'win32') {
    roots.push(path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'));
  } else {
    roots.push(
      path.join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage')
    );
  }
  return roots.map((p) => path.resolve(p));
}

function isPathUnderRoots(resolvedTarget, roots) {
  const norm = path.normalize(resolvedTarget);
  for (const root of roots) {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (norm === root || norm.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Resolve real path and verify it is under allowlisted roots.
 * @returns {{ ok: true, resolved: string } | { ok: false, error: string }}
 */
function resolveDeletableFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: 'No file path' };
  }
  const resolved = path.resolve(filePath);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    return { ok: false, error: 'File not found or unreadable' };
  }
  const stat = fs.statSync(real);
  if (!stat.isFile()) {
    return { ok: false, error: 'Not a file' };
  }
  const roots = getDeleteAllowlistRoots();
  if (!isPathUnderRoots(real, roots)) {
    return { ok: false, error: 'Path is not inside known chat history folders' };
  }
  return { ok: true, resolved: real };
}

/**
 * @param {string} resolvedFilePath - output of resolveDeletableFilePath
 * @param {'codex'|'copilot'|'cursor'} source
 */
function deleteSessionFiles(resolvedFilePath, source) {
  fs.unlinkSync(resolvedFilePath);
  if (source === 'cursor') {
    const sessionDir = path.dirname(resolvedFilePath);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      /* session dir may already be gone */
    }
  }
}

module.exports = {
  getDeleteAllowlistRoots,
  resolveDeletableFilePath,
  deleteSessionFiles,
};
