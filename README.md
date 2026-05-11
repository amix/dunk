# dunk

Review diffs in a terminal UI, leave inline comments, and let a coding agent fix them.

`dunk` is built for the review loop between a human and a coding agent. You mark issues directly in the diff. `dunk` writes hunk-anchored comments to `.dunk/comments.json`. Claude Code, Codex, or another agent reads the comments, fixes the code, and removes resolved entries. With `--watch`, the diff reloads in place as code and comments change.

`dunk` is a hard fork of [hunk](https://github.com/modem-dev/hunk). It keeps the OpenTUI / [Pierre](https://www.npmjs.com/package/@pierre/diffs) diff-viewer foundation and removes the daemon, MCP, and session-broker layers.

- Press `a` on a hunk to save a comment scoped to that hunk. Comments are hunk-level — you don't pick a specific line.
- Comments live in `.dunk/comments.json`. Don't commit it; treat it as a local review scratchpad. Add `.dunk/` to your `.gitignore`.
- `--watch` reloads code changes and comment edits automatically.
- Resolved comments disappear as the agent removes them.
- Drifted anchors surface at the top of the diff instead of getting lost.
- Built on hunk’s terminal diff viewer, with sidebar navigation, split/stack layouts, pager support, and `git difftool` adapters.

## Install

`dunk` ships through npm with prebuilt binaries for macOS and Linux:

```bash
npm i -g dunkdiff
```

Requirements: Node.js 18+ and Git for most workflows.

## Quick start

```bash
dunk             # show help
dunk --version   # print the installed version

dunk diff                    # review the working tree, including untracked files
dunk diff --watch            # auto-reload as files and comments change
dunk show                    # review the latest commit
dunk show HEAD~1             # review an earlier commit
dunk diff before.ts after.ts # compare two concrete files
git diff --no-color | dunk patch - # review a patch from stdin
```

## Screenshots & Demo

<img height="1000" alt="dunk alongside Claude Code" src="https://github.com/user-attachments/assets/f28fe57a-e833-49ea-846a-91310e403e77" />

<img height="1000" alt="dunk standalone" src="https://github.com/user-attachments/assets/c390752f-046d-4f97-ae55-a68649726997" />

Demo: https://x.com/amix3k/status/2053773348719444360

## Agent review workflow

`dunk` is designed for a human reviewer in one terminal and a coding agent in another.

1. Start a watched review:

   ```bash
   dunk diff --watch
   ```

   You can also review a commit or revision:

   ```bash
   dunk show <ref> --watch
   ```

2. Move to a hunk and press `a` to add a comment.

   Comments are hunk-scoped, not line-scoped — pick a hunk with `J`/`K`, then drop a comment on it. `dunk` saves it to `.dunk/comments.json` with the file path, the hunk's anchor line, the comment body, and a context hash so the comment survives small edits to nearby code.

   `.dunk/comments.json` is intentionally a local file — keep `.dunk/` in your `.gitignore` so review chatter doesn't leak into commits.

3. Point your agent at `dunk comments`.

   Each comment tells the agent what to fix and where. The agent runs `dunk comments list` to see what's pending, `dunk comments show <id>` to read the hunk in context, fixes the issue, then `dunk comments resolve <id>` to drop the entry. Hand-editing `.dunk/comments.json` is the fallback when the binary isn't available.

4. Keep reviewing while the agent works.

   Watch mode reloads code and comment changes automatically. Resolved comments disappear from the diff. Remaining comments stay pinned to their hunks.

5. Handle drifted comments.

   If a file changes too much for an anchor to be matched, `dunk` shows the comment as **drifted** at the top of the diff. Press `d` to clear the focused drifted comment or `D` to clear all drifted comments (anchored review comments are never touched).

A sample agent skill lives at `skills/dunk-review/SKILL.md`. You can also find it with:

```bash
dunk skill path
```

Load that skill into Claude Code or any skill-aware agent to teach it how to use `dunk comments` for review.

Tip: keep `dunk diff --watch` and your agent side by side. Add comments with `a`; as the agent updates `.dunk/comments.json`, the review updates in place.

## Git integration

Use `dunk` as your Git pager so `git diff` and `git show` open in `dunk` automatically:

```bash
git config --global core.pager "dunk pager"
```

Or add it to `~/.gitconfig`:

```ini
[core]
    pager = dunk pager
```

To keep Git’s default pager and add opt-in aliases:

```bash
git config --global alias.ddiff "-c core.pager=\"dunk pager\" diff"
git config --global alias.dshow "-c core.pager=\"dunk pager\" show"
```

> [!NOTE]
> Untracked files are included automatically only by `dunk diff`, which uses the working-tree loader. When you use `dunk pager`, Git decides what goes into the patch, so untracked files won’t appear.

## Jujutsu

`dunk` auto-detects Jujutsu workspaces. Inside one, `dunk diff [revset]` and `dunk show [revset]` use jj revsets.

To force a backend, set `vcs = "git"` or `vcs = "jj"` in [config](#config).

To use `dunk` as jj’s pager, run:

```bash
jj config edit --user
```

Then add:

```toml
[ui]
pager = ["dunk", "pager"]
diff-formatter = ":git"
```

## Config

`dunk` reads config from either location:

- `~/.config/dunk/config.toml`
- `.dunk/config.toml`

Example:

```toml
theme = "graphite"   # graphite, midnight, paper, ember
mode = "auto"        # auto, split, stack
vcs = "git"          # git, jj
exclude_untracked = false
line_numbers = false
wrap_lines = true
selection_auto_copy = true
```

`exclude_untracked` only affects `dunk diff` working-tree sessions.

## OpenTUI component

`dunk` exports `DunkDiffView` from `dunkdiff/opentui` for embedding the diff renderer in your own OpenTUI app.

See [docs/opentui-component.md](docs/opentui-component.md).

## Examples

Runnable demo diffs live in [`examples/`](examples/README.md). Each example prints the exact command to run from the repo root.

## License

[MIT](LICENSE) — same as upstream hunk, of which this is a hard fork.
