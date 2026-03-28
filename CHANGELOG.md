# Changelog

## [1.0.300] — 2026-03-28

### Fixed

- **GitHub Actions:** Switched Release job from **npm** to **pnpm** — npm repeatedly crashed on macOS runners (`Exit handler never called!`). Added **`pnpm-lock.yaml`** (from `pnpm import`).
- **Versioning:** App version **`1.0.300`** is used as the build train until a DMG publishes successfully from CI; then semver can return to normal patch bumps.

## [1.0.3] — 2026-03-27

### Fixed

- **GitHub Actions:** `npm ci` intermittently crashes on macOS runners with `npm error Exit handler never called!` (npm/cli issue). Install step now uses `npm install --frozen-lockfile` and disables the setup-node npm cache on Release builds to avoid flaky installs.

## [1.0.2] — 2026-03-27

### Fixed

- **GitHub Actions (Release):** The upload step used `mapfile`, which **does not exist in Bash 3.2** on `macos-latest` runners, so the job failed and **no DMG** was published. Replaced with a Bash-3-compatible loop so **DMG + ZIP** upload succeeds.

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

[1.0.300]: https://github.com/arsujay/comman-chat-history/releases/tag/v1.0.300
[1.0.3]: https://github.com/arsujay/comman-chat-history/releases/tag/v1.0.3
[1.0.2]: https://github.com/arsujay/comman-chat-history/releases/tag/v1.0.2
[1.0.1]: https://github.com/arsujay/comman-chat-history/releases/tag/v1.0.1
[1.0.0]: https://github.com/arsujay/comman-chat-history/releases/tag/v1.0.0
