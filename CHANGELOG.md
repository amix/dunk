# Changelog

All notable user-visible changes to `dunk` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`dunk` was hard-forked from [`hunk`](https://github.com/modem-dev/hunk) at version `0.11.0`. Pre-fork history is preserved in the upstream repository.

## [Unreleased]

### Added

- `watch = true` in `.dunk/config.toml` (or `~/.config/dunk/config.toml`) now enables watch mode without passing `--watch` every time. The `--watch`/absence of it on the command line still overrides the config value.
- Ctrl-Z suspends `dunk` as a normal shell job (the terminal is restored, the process group gets SIGTSTP, and `fg` resumes the renderer). Previously Ctrl-Z was swallowed in raw mode and `dunk` could not be suspended. No-op on Windows.

### Removed

- Jujutsu support. `dunk` now targets Git only — there's no more `vcs` config key, jj workspace auto-detection, or jj revset handling for `dunk diff`/`dunk show`. Use a colocated Git checkout if you work in jj.

### Fixed

- `}`/`{` (next/previous comment) now jump to the nearest comment relative to your position in the review stream. Pressing them from a hunk that has no comment of its own previously snapped to the first or last comment in the whole review instead of the closest one.
- Ctrl-C now exits through `dunk`'s ordered shutdown (renderer torn down, terminal screen restored) instead of OpenTUI's hard exit. `dunk` also shuts down cleanly on SIGINT/SIGTERM.

## [0.13.0] - 2026-05-14

### Added

- `dunk diff --branch[=base]` reviews everything that differs between the current branch and its base — committed, staged, unstaged, and untracked — in one pass. Resolution order: explicit `--branch=<base>`, then `[branch_review] base` in `.dunk/config.toml`, then `origin/HEAD`, then `origin/main`/`main`/`origin/master`/`master`/`origin/trunk`/`trunk`. The resolved base shows up in the status bar so auto-detection is visible. Works in both Git and Jujutsu (uses `fork_point(@ | "<base>")` for jj).

## [0.12.2] - 2026-05-11

### Fixed

- Preserve scroll position when a comment is added, edited, or deleted (and when `.dunk/comments.json` reloads externally). The review pane re-anchors on a surviving diff row so inserting or removing inline comment cards no longer pushes the code you were reading out from under the viewport.

## [0.12.1] - 2026-05-11

### Fixed

- Prebuilt npm release pipeline. `scripts/build-prebuilt-artifact.ts` was still looking for the binary at the pre-rename path (`dist/dunkdiff`) while `scripts/build-bin.sh` writes to `dist/dunk`, so every release run since the rename failed at the host-build step and nothing reached npm. `npm i -g dunkdiff` now resolves once this version publishes.

## [0.12.0] - 2026-05-11

First `dunkdiff` release after the hard-fork rename. Bundles the agent-facing CLI, on-disk comments model, startup perf work, and a polished comment UI.

### Added

- `dunk comments {list,show,resolve}` — first-class CLI for coding agents to inspect and resolve review comments without entering the TUI or hand-editing `.dunk/comments.json`. `show <id>` prints the comment plus 10 lines of post-image context (configurable via `--context <N>`); `resolve <id>...` is atomic and refuses partial success when an id is missing. `--json` on `list`/`show` returns a stable shape with drift state.
- Transient startup notice when a newer `dunkdiff` is published to npm — shows `dunk X.Y.Z is out — npm i -g dunkdiff to update` in the status bar a moment after launch. Network failures are silent; pager mode opts out.
- Inline review comments backed by a single committed `.dunk/comments.json` per repo, with anchor-based drift detection so comments survive small edits.
- Watch-mode integration: edits to `.dunk/comments.json` (e.g., from a coding agent fixing comments) refresh the diff in real time.
- Sample `skills/dunk-review/SKILL.md` describing the read/fix/prune loop for Claude Code / Codex agents.
- New keybindings: `a` to add a comment on the focused hunk, `d` to delete the focused comment, `D` to clear all drifted comments (with confirm — anchored review comments are left alone), `e` to open the focused file in `$EDITOR`, `J`/`K` (also `[`/`]`) to jump between hunks, `gg`/`G` to jump to the first/last hunk, `?` for help.
- Auto-copy on selection (configurable via `selection_auto_copy`, default on).

### Changed

- Renamed binary, npm package, and config directory from `hunk` / `hunkdiff` / `.hunk/` to `dunk` / `dunkdiff` / `.dunk/`.
- Default view preferences: word wrap on, line numbers off. Comments now render unconditionally — the `c` toggle, `--comments`/`--no-comments` flags, and `comments` config key are gone.
- Startup is ~4-5× faster on cold paths (`--help`, `--version`, `dunk comments {list,show,resolve}`, `dunk skill path`): ~120 ms → ~25 ms via `bun run`, ~480 ms → ~50 ms on the prebuilt npm binary. Heavy modules (OpenTUI, React, `@pierre/diffs`) are dynamic-imported only after the CLI parser decides we're launching the TUI.
- Inline comments and drifted-comment entries now share one body-first card design (`#id` metadata header, accent bar, wrapped prose). Drifted comments dock as their own section above the diff and accept click-to-select.
- Stripped the top menu bar in favor of a minimal status row with a `?` hint.
- File header now uses an accent background to anchor the eye while scrolling.
- Local install (`scripts/install-bin.sh`) uses a tiny shell wrapper around `bun run` instead of `bun build --compile`, cutting startup time roughly 6×.

### Removed

- Daemon, broker, and MCP session subsystems. Agent integration now flows through the on-disk comments file.
- Update-notice prompts.
- `--agent-context` CLI flag and the `AgentContext` sidecar JSON model.
- Dead `AgentCard` floating-popover surface — the inline `CommentCard` has been the canonical surface for a while.

[Unreleased]: https://github.com/amix/dunk/compare/v0.12.1...HEAD
[0.12.1]: https://github.com/amix/dunk/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/amix/dunk/releases/tag/v0.12.0
