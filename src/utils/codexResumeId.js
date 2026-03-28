/**
 * Rollout filenames use stem `YYYY-MM-DDTHH-MM-SS-<uuid>`.
 * `codex resume` expects the session id (UUID), not the date prefix.
 */
export function stripCodexRolloutDatePrefix(stem) {
  if (!stem || typeof stem !== 'string') return '';
  const s = stem.trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/);
  return m ? m[1] : s;
}

/** Id passed to `codex resume <id>` — from parser or derived from internal `codex-…` id (UUID only when dated stem). */
export function getCodexResumeChatId(session) {
  if (!session || session.source !== 'codex') return '';
  let stem = '';
  const raw = session.codexResumeId;
  if (raw != null && String(raw).trim() !== '') stem = String(raw).trim();
  else if (typeof session.id === 'string' && session.id.startsWith('codex-')) stem = session.id.slice(6);
  return stripCodexRolloutDatePrefix(stem);
}
