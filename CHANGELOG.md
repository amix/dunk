# Changelog

All notable user-visible changes to `dunk` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`dunk` was hard-forked from [`hunk`](https://github.com/modem-dev/hunk) at version `0.11.0`. Pre-fork history is preserved in the upstream repository.

## [Unreleased]

### Added

- `dunk comments {list,show,resolve}` — first-class CLI for coding agents to inspect and resolve review comments without entering the TUI or hand-editing `.dunk/comments.json`. `show <id>` prints the comment plus 10 lines of post-image context (configurable via `--context <N>`); `resolve <id>...` is atomic and refuses partial success when an id is missing. `--json` on `list`/`show` returns a stable shape with drift state.
- Transient startup notice when a newer `dunkdiff` is published to npm — shows `dunk X.Y.Z is out — npm i -g dunkdiff to update` in the status bar a moment after launch. Network failures are silent; pager mode opts out.
- Inline review comments backed by a single committed `.dunk/comments.json` per repo, with anchor-based drift detection so comments survive small edits.
- Watch-mode integration: edits to `.dunk/comments.json` (e.g., from a coding agent fixing comments) refresh the diff in real time.
- Sample `skills/dunk-review/SKILL.md` describing the read/fix/prune loop for Claude Code / Codex agents.
- New keybindings: `a` to add a comment on the focused hunk, `d` to delete the focused comment, `D` to clear all drifted comments (with confirm — anchored review comments are left alone), `e` to open the focused file in `$EDITOR`, `J`/`K` (also `[`/`]`) to jump between hunks, `gg`/`G` to jump to the first/last hunk, `?` for help.
- Auto-copy on selection (configurable via `selection_auto_copy`, default on).

### Changed

- Renamed binary, npm package, and config directory from `hunk` / `hunkdiff` / `.hunk/` to `dunk` / `dunk` / `.dunk/`.
- Default view preferences: word wrap on, line numbers off. Comments now render unconditionally — the `c` toggle, `--comments`/`--no-comments` flags, and `comments` config key are gone.
- Startup is ~4-5× faster on cold paths (`--help`, `--version`, `dunk comments {list,show,resolve}`, `dunk skill path`): ~120 ms → ~25 ms via `bun run`, ~480 ms → ~50 ms on the prebuilt npm binary. Heavy modules (OpenTUI, React, `@pierre/diffs`) are dynamic-imported only after the CLI parser decides we're launching the TUI.
- Stripped the top menu bar in favor of a minimal status row with a `?` hint.
- File header now uses an accent background to anchor the eye while scrolling.
- Local install (`scripts/install-bin.sh`) uses a tiny shell wrapper around `bun run` instead of `bun build --compile`, cutting startup time roughly 6×.

### Removed

- Daemon, broker, and MCP session subsystems. Agent integration now flows through the on-disk comments file.
- Update-notice prompts.
- `--agent-context` CLI flag and the `AgentContext` sidecar JSON model.

[Unreleased]: https://github.com/amix/dunk/commits/main
