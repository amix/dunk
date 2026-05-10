# tunk follow-ups

Working list for the fork. Order matters: the Codex review (`.expert/letter-…response.codex.md`) flagged that purging sessions before deciding the note model would be premature, so the note schema lands first.

## Goal

A *smaller* terminal diff + notes tool than upstream `hunk`. Sharing happens by committing a single `.tunk/comments.json` file through normal git, not via a daemon.

## Execution order

1. **`.tunk/comments.json` schema** (see `docs/notes-schema.md`). One committed file, integer ids, simple anchor (line + 16-hex content hash). No per-note files, no ULID, no sophisticated drift recovery.
2. **Rename `.hunk/` → `.tunk/` everywhere.** This includes the existing local view config (`.tunk/config.toml`) and cache (`.tunk/latest.json`). Update `.gitignore` so `.tunk/comments.json` is tracked but config/cache stay local-only.
3. **Remove session/MCP/daemon/broker code and agent-note ingestion.** Confirm reload/watch has a non-session path before pulling. Audit `useHunkSessionBridge` for hidden coupling (live comments, jump-to-location, note visibility, reload callbacks).
4. **Simplify hunk navigation pipeline.** Port the simplified version from `/Users/amix/Desktop/GitHub/hunk-amix`. Notes depend on a stable "current hunk."
5. **User comments CRUD** on the new file model. Keys:
   - `n` adds a comment for the current hunk. **Open in a focused modal first** (inline TUI editing collides with global shortcuts; revisit inline polish later).
   - `d` deletes the focused comment.
   - `D` deletes **all comments at the current location** — i.e. all comments on the focused hunk, *or* all drifted comments if the drifted-comments stack is focused. Never a whole-file wipe.
   - Drifted comments render in a stack at the top of the diff with a darker background. The same `d` / `D` keys dismiss them — so cleaning up after a refactor is just "select drifted, hit `D`". Exact-match + pinned only; no fuzzy matching.
6. **`e` opens current file at current line** via `$VISUAL`/`$EDITOR` with flag conventions for nvim, vim, code, cursor, zed, subl. Suspend tunk for terminal editors; spawn detached for GUI editors.
7. **`J` / `K` for hunk navigation** (replace `[` / `]`). `gg` top, `Shift-G` bottom.
8. **Layout polish**: drop residual top margin from the removed menu; subtle "Press ? for help" hint on the otherwise-idle status line.
9. **Selection auto-copy** — last, and reconsider. Fights native terminal selection on most terminals; platform-sensitive. May be the wrong feature.

## LLM-facing principles

When tunk surfaces review comments to an LLM (skill, JSON export, MCP-style bridge — *if* we keep one), emit **file paths + line numbers + comment bodies only**. Never feed raw code snippets. The LLM can read the files itself; keeping the output free of content avoids stale snippets, reduces context bloat, and keeps `.tunk/comments.json` itself snippet-free as a side benefit. This applies to any `tunk export`, `tunk review --json`, or skill SKILL.md flow we ship.

## LLM-driven refresh

The LLM doesn't need a daemon or RPC. It works on the file system:

- LLM edits a tracked file (resolves an issue) → tunk re-reads the diff.
- LLM edits or deletes entries in `.tunk/comments.json` (resolves a comment) → tunk re-reads the comment list.

Mechanism is plain `fs.watch` on the relevant paths, layered on the existing `--watch` flag. Keep the watch surface tight: the diff inputs and `.tunk/comments.json` only.

## Rethinks (locked in from review)

- `D` scope: **current hunk only**, never the whole file.
- Don't evolve agent-comment lifecycle into user notes. Build user notes as a separate file-backed model and delete the live-comment path.
- Note authoring is **modal**, not on the status line. Inline polish is a later pass.

## Top risks to watch

1. **Hidden session coupling.** `useHunkSessionBridge` in `App.tsx` owns live comments *and* reload callbacks; verify the local reload/watch path stands on its own before deletion.
2. **Tracked `.tunk/comments.json` can leak.** Avoid storing snippets verbatim, usernames-by-default, timestamps with seconds, or local paths. Default to opt-in author and minimal deterministic fields.
3. **Input-mode collisions.** Note editing, `gg`/`G`/`J`/`K`/`d`/`D`, filter focus, help, and quit all share one keyboard layer. Introduce an explicit "note editing" mode before binding destructive shortcuts.

## Process notes

- The `simple-git-hooks` + `lint-staged` pre-commit chain in this repo silently wiped a working tree of menu-removal changes once. Use `SKIP_SIMPLE_GIT_HOOKS=1` for surgical commits until the root cause is investigated, or remove the hook from the fork.
- Codex review: `.expert/letter-20260510T063205Z-20120-32389-1.response.codex.md`.
