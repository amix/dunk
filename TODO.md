# dunk follow-ups

Working list for the fork. Order matters: the Codex review (`.expert/letter-…response.codex.md`) flagged that purging sessions before deciding the note model would be premature, so the note schema lands first.

## Goal

A *smaller* terminal diff + notes tool than upstream `hunk`. Sharing happens by committing a single `.dunk/comments.json` file through normal git, not via a daemon.

## Execution order

1. **`.dunk/comments.json` schema** (see `docs/notes-schema.md`). One committed file, integer ids, simple anchor (line + 16-hex content hash). No per-note files, no ULID, no sophisticated drift recovery.
2. **Rename `.hunk/` → `.dunk/` everywhere.** This includes the existing local view config (`.dunk/config.toml`) and cache (`.dunk/latest.json`). Update `.gitignore` so `.dunk/comments.json` is tracked but config/cache stay local-only.
3. **Remove session/MCP/daemon/broker code and agent-note ingestion.** Confirm reload/watch has a non-session path before pulling. Audit `useHunkSessionBridge` for hidden coupling (live comments, jump-to-location, note visibility, reload callbacks).
4. **Simplify hunk navigation pipeline.** Port the simplified version from `/Users/amix/Desktop/GitHub/hunk-amix`. Notes depend on a stable "current hunk."
5. **User comments CRUD** on the new file model. Keys:
   - `a` adds a comment for the current hunk via a focused modal.
   - `d` deletes the focused comment.
   - `D` deletes all comments on the focused hunk.
   - `c` toggles comment visibility (default: on).
   - Drifted comments render in a stack at the top of the diff with a darker background. The same `d` / `D` keys dismiss them. Exact-match + pinned only; no fuzzy matching.

   Open polish: comment authoring is single-line today; multi-line input requires a custom component since OpenTUI's `<input>` is single-line.
6. **`e` opens current file at current line** via `$VISUAL`/`$EDITOR` with flag conventions for nvim, vim, code, cursor, zed, subl. Suspend dunk for terminal editors; spawn detached for GUI editors.
7. **`J` / `K` for hunk navigation** (replace `[` / `]`). `gg` top, `Shift-G` bottom.
8. **Layout polish**: drop residual top margin from the removed menu; subtle "Press ? for help" hint on the otherwise-idle status line.
9. **Selection auto-copy** — selecting text in the diff auto-copies to the clipboard with a small ephemeral status-line confirmation ("copied to clipboard"). Configurable via `.dunk/config.toml` (`selection.autoCopy = true | false`); default is **on**. Note: this can collide with native terminal selection on some terminals — explicitly opt-out path needs to work cleanly.

## LLM-facing principles

When dunk surfaces review comments to an LLM (skill, JSON export, MCP-style bridge — *if* we keep one), emit **file paths + line numbers + comment bodies only**. Never feed raw code snippets. The LLM can read the files itself; keeping the output free of content avoids stale snippets, reduces context bloat, and keeps `.dunk/comments.json` itself snippet-free as a side benefit. This applies to any `dunk export`, `dunk review --json`, or skill SKILL.md flow we ship.

## Selected hunk visibility

Make the selected hunk visually brighter so it's obvious where you are. Today the selection rail is subtle. Options: brighten the hunk rail to `theme.accent`, give the selected hunk a slightly tinted background, or both. Whatever change lands here also has to look reasonable on every theme (graphite/midnight/paper/ember).

## Hunk selection — remaining polish

Done: the viewport-centered tracker that fought J/K reveals is gone, and the active rail blends 55% toward `theme.accent` so the selected hunk is unmistakable. Still pending:

- **Click-to-select on hunk rows.** Clicking anywhere inside a hunk's rendered rows should mark it as the current hunk. Requires threading an `onSelectHunk(fileId, hunkIndex)` callback through `DiffSection` → `PierreDiffView` → `renderRows` and attaching `onMouseUp` on each row's outer container. Sidebar file-clicks and the file-header click already work.
- **Top of stream → first hunk.** Scrolling all the way up should reselect the first visible hunk.
- **Smart mouse-scroll selection.** Track which hunk's body owns the viewport center on wheel scroll, with debounce. Reintroducing the tracker will need a tighter cooldown than the previous one.

## LLM-driven refresh

The LLM doesn't need a daemon or RPC. It works on the file system:

- LLM edits a tracked file (resolves an issue) → dunk re-reads the diff.
- LLM edits or deletes entries in `.dunk/comments.json` (resolves a comment) → dunk re-reads the comment list.

Mechanism is plain `fs.watch` on the relevant paths, layered on the existing `--watch` flag. Keep the watch surface tight: the diff inputs and `.dunk/comments.json` only.

## Locked-in decisions

- `d` deletes the lowest-id comment on the focused hunk. `D` deletes **every** comment in the current diff, gated by a Y/N confirm modal — user override of the earlier "current hunk only" lock-in. No undo (regret-watch).
- User comments are a separate file-backed model in `.dunk/comments.json`; the agent-comment lifecycle was deleted, not evolved.
- Comment authoring uses a focused modal, not status-line input. Inline editing polish stays a later pass.
- Selection auto-copy defaults **on**, configurable via `.dunk/config.toml` (`selection_auto_copy = false`). Suppressed while a modal or filter input owns the keyboard.

## Top risks to watch

1. **Hidden session coupling.** `useHunkSessionBridge` in `App.tsx` owns live comments *and* reload callbacks; verify the local reload/watch path stands on its own before deletion.
2. **Tracked `.dunk/comments.json` can leak.** Avoid storing snippets verbatim, usernames-by-default, timestamps with seconds, or local paths. Default to opt-in author and minimal deterministic fields.
3. **Input-mode collisions.** Note editing, `gg`/`G`/`J`/`K`/`d`/`D`, filter focus, help, and quit all share one keyboard layer. Introduce an explicit "note editing" mode before binding destructive shortcuts.

## Process notes

- The `simple-git-hooks` + `lint-staged` pre-commit chain in this repo silently wiped a working tree of menu-removal changes once. Use `SKIP_SIMPLE_GIT_HOOKS=1` for surgical commits until the root cause is investigated, or remove the hook from the fork.
- Codex review: `.expert/letter-20260510T063205Z-20120-32389-1.response.codex.md`.
