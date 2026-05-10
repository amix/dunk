# dunk

Review diffs in a TUI, leave inline comments, and let a coding agent resolve them.

`dunk` is a hard fork of [hunk](https://github.com/modem-dev/hunk): the same OpenTUI / [Pierre](https://www.npmjs.com/package/@pierre/diffs) diff-viewer foundation, without the daemon, MCP, or session-broker layer. A human reviewer marks issues in the diff; dunk writes anchored comments to one committed `.dunk/comments.json`; Claude Code, Codex, or another agent fixes the code and removes resolved entries; watch mode reloads the loop in place.

- press `a` on a hunk to save an anchored `file` / `line` / `body` comment
- comments live in `.dunk/comments.json`, so agents can read, fix, and prune them without a service process
- `--watch` reloads both code changes and comment edits; resolved comments disappear, drifted anchors surface instead of getting lost
- built on hunk's terminal diff viewer with sidebar navigation, split/stack layouts, pager support, and `git difftool` adapters

## Install

`dunk` is shipped via npm with prebuilt binaries for macOS and Linux:

```bash
npm i -g dunk
```

Requirements: Node.js 18+, Git for most workflows.

## Quick start

```bash
dunk            # show help
dunk --version  # print the installed version

dunk diff             # review the working tree (includes untracked)
dunk diff --watch     # auto-reload as files (and comments.json) change
dunk show             # review the latest commit
dunk show HEAD~1      # review an earlier commit
dunk diff before.ts after.ts            # compare two concrete files
git diff --no-color | dunk patch -      # review a patch from stdin
```

## Workflow with Claude Code / Codex

`dunk` is designed for the back-and-forth between a human reviewer in a terminal window and a coding agent in another. The bridge is `.dunk/comments.json`, which is committed to the repo:

1. You open `dunk diff --watch` (or `dunk show <ref> --watch`).
2. Press `a` to drop an inline comment on the focused hunk. It gets saved to `.dunk/comments.json` with a file path, line number, and an anchor hash of nearby context so it survives small edits.
3. Hand the comments to your agent — paste the JSON, or just point Claude Code / Codex at `.dunk/comments.json`. Each comment carries `file`, `line`, and `body`; the agent fixes the issue at that exact location and removes its entry from the JSON.
4. Watch mode picks up the JSON edits. Resolved comments disappear from the diff in real time; remaining ones stay pinned to the right hunks.
5. When the file the comment was anchored to changes too much, the comment surfaces as **drifted** at the top of the diff so it doesn't get lost. `D` clears all drifted comments at once.

There's a sample agent skill at `skills/dunk-review/SKILL.md` (also reachable via `dunk skill path`) that you can load into Claude Code or any skill-aware agent. It tells the agent how to read, fix, and prune `.dunk/comments.json`.

Tip: keep the diff and the agent in two side-by-side terminals. Mark a comment with `a`, save the file, and the agent on the other side notices the JSON change and starts working.

## Git integration

Wire `dunk` as your Git pager so `git diff` and `git show` open in `dunk` automatically:

```bash
git config --global core.pager "dunk pager"
```

Or in `~/.gitconfig`:

```ini
[core]
    pager = dunk pager
```

Prefer to keep Git's default pager and add opt-in aliases:

```bash
git config --global alias.ddiff "-c core.pager=\"dunk pager\" diff"
git config --global alias.dshow "-c core.pager=\"dunk pager\" show"
```

> [!NOTE]
> Untracked files are auto-included only for `dunk diff` (the working-tree loader). When you go through `dunk pager`, Git decides what's in the patch — untracked files won't appear there.

### Jujutsu

`dunk` auto-detects Jujutsu workspaces, so `dunk diff [revset]` and `dunk show [revset]` use jj revsets when run inside one. To force a backend, set `vcs = "git"` or `vcs = "jj"` in [config](#config).

To use `dunk` as jj's pager, run `jj config edit --user` and add:

```toml
[ui]
pager = ["dunk", "pager"]
diff-formatter = ":git"
```

## Config

Persist preferences in either:

- `~/.config/dunk/config.toml`
- `.dunk/config.toml` (per-repo)

```toml
theme = "graphite"   # graphite, midnight, paper, ember
mode = "auto"        # auto, split, stack
vcs = "git"          # git, jj
exclude_untracked = false
line_numbers = false
wrap_lines = true
comments = true
selection_auto_copy = true
```

`exclude_untracked` only affects `dunk diff` working-tree sessions.

## OpenTUI component

`dunk` exports `DunkDiffView` from `dunk/opentui` for embedding the diff renderer in your own OpenTUI app. See [docs/opentui-component.md](docs/opentui-component.md).

## Examples

Runnable demo diffs live in [`examples/`](examples/README.md). Each one prints the exact command to run from the repo root.

## License

[MIT](LICENSE) — same as upstream hunk, of which this is a hard fork.
