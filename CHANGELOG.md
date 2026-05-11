# Changelog

All notable user-visible changes to `dunk` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`dunk` was hard-forked from [`hunk`](https://github.com/modem-dev/hunk) at version `0.11.0`. Pre-fork history is preserved in the upstream repository.

## [Unreleased]

### Added

- `dunk comments {list,show,resolve}` — first-class CLI for coding agents to inspect and resolve review comments without entering the TUI or hand-editing `.dunk/comments.json`. `show <id>` prints the comment plus 10 lines of post-image context (configurable via `--context <N>`); `resolve <id>...` is atomic and refuses partial success when an id is missing. `--json` on `list`/`show` returns a stable shape with drift state.
- Inline review comments backed by a single committed `.dunk/comments.json` per repo, with anchor-based drift detection so comments survive small edits.
- Watch-mode integration: edits to `.dunk/comments.json` (e.g., from a coding agent fixing comments) refresh the diff in real time.
- Sample `skills/dunk-review/SKILL.md` describing the read/fix/prune loop for Claude Code / Codex agents.
- New keybindings: `a` to add a comment on the focused hunk, `c` to toggle comments, `d` to delete one, `D` to delete all comments in the current diff (with confirm), `e` to open the focused file in `$EDITOR`, `[`/`]` to jump between hunks, `J`/`K` to step within a hunk, `gg` and `G` for top/bottom navigation, `?` for help.
- Auto-copy on selection (configurable via `selection_auto_copy`, default on).

### Changed

- Renamed binary, npm package, and config directory from `hunk` / `hunkdiff` / `.hunk/` to `dunk` / `dunk` / `.dunk/`.
- Default view preferences: comments visible, word wrap on, line numbers off.
- Stripped the top menu bar in favor of a minimal status row with a `?` hint.
- File header now uses an accent background to anchor the eye while scrolling.
- Local install (`scripts/install-bin.sh`) uses a tiny shell wrapper around `bun run` instead of `bun build --compile`, cutting startup time roughly 6×.

### Removed

- Daemon, broker, and MCP session subsystems. Agent integration now flows through the on-disk comments file.
- Update-notice prompts.
- `--agent-context` CLI flag and the `AgentContext` sidecar JSON model.

[Unreleased]: https://github.com/amix/dunk/commits/main
