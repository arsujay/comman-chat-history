# Changelog

## [1.0.1] — 2026-03-27

### Fixed

- **GitHub Releases:** CI now uploads **both** the macOS **DMG** and **ZIP** (previous workflow often attached only the ZIP). Release assets use predictable names: `ChatHistoryViewer-<version>-<arch>.dmg` / `.zip`.

### Changed

- **macOS** `artifactName` in `electron-builder`: `ChatHistoryViewer-${version}-${arch}.${ext}` (no spaces; stable download URLs).

## [1.0.0] — 2026-03-27

First public release.

### Added

- README **screenshots** of the main window, usage dashboard, sidebar filters, and conversation view (`docs/screenshots/`), plus `npm run screenshots` to regenerate them.
- Browse **Codex CLI**, **GitHub Copilot** (VS Code storage), and **Cursor** chat history from local disk.
- **Session list** with workspace folders, search, and filters by source.
- **Full transcript** view with Markdown and syntax-highlighted code blocks.
- **Usage dashboard** with per-month activity and heuristic productivity / PR-related text signals.
- **Resizable sidebar** and accordion folder expansion.
- **macOS** installers: **DMG** and **ZIP** (Apple Silicon/arm64 builds from CI).

[1.0.1]: https://github.com/arsujay/comman-chat-history/releases/tag/v1.0.1
[1.0.0]: https://github.com/arsujay/comman-chat-history/releases/tag/v1.0.0
