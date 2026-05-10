# tunk follow-ups

Working list for the fork. Order matters: the Codex review (`.expert/letter-…response.codex.md`) flagged that purging sessions before deciding the note model would be premature, so the note schema lands first.

## Goal

A *smaller* terminal diff + notes tool than upstream `hunk`. Sharing happens by committing a `.hunk/` directory through normal git, not via a daemon.

## Execution order

1. **`.hunk/` note schema + anchor format** (see `docs/notes-schema.md`). Decide schema, anchor identity, atomic-write behavior, conflict story before any UI work.
2. **Remove session/MCP/daemon/broker code and agent-note ingestion.** Confirm reload/watch has a non-session path before pulling. Audit `useHunkSessionBridge` for hidden coupling (live comments, jump-to-location, note visibility, reload callbacks).
3. **Simplify hunk navigation pipeline.** Port the simplified version from `/Users/amix/Desktop/GitHub/hunk-amix`. Notes depend on a stable "current hunk."
4. **User notes CRUD** on the new model. Keys:
   - `n` adds a note for the current hunk. **Open in a focused modal first** (inline TUI editing collides with global shortcuts; revisit inline polish later).
   - `d` deletes the focused note.
   - `D` deletes **all notes on the current hunk** (not the whole file — too destructive).
   - Drifted notes pin to the top of the diff, darker background. Start with **exact-match + pinned** drift detection only; no fuzzy matching.
5. **`e` opens current file at current line** via `$VISUAL`/`$EDITOR` with flag conventions for nvim, vim, code, cursor, zed, subl. Suspend tunk for terminal editors; spawn detached for GUI editors.
6. **`J` / `K` for hunk navigation** (replace `[` / `]`). `gg` top, `Shift-G` bottom.
7. **Layout polish**: drop residual top margin from the removed menu; subtle "Press ? for help" hint on the otherwise-idle status line.
8. **Selection auto-copy** — last, and reconsider. Fights native terminal selection on most terminals; platform-sensitive. May be the wrong feature.

## Rethinks (locked in from review)

- `D` scope: **current hunk only**, never the whole file.
- Don't evolve agent-comment lifecycle into user notes. Build user notes as a separate file-backed model and delete the live-comment path.
- Note authoring is **modal**, not on the status line. Inline polish is a later pass.

## Top risks to watch

1. **Hidden session coupling.** `useHunkSessionBridge` in `App.tsx` owns live comments *and* reload callbacks; verify the local reload/watch path stands on its own before deletion.
2. **Tracked `.hunk/` can leak.** Avoid storing snippets verbatim, usernames-by-default, timestamps with seconds, or local paths. Default to opt-in author and minimal deterministic fields.
3. **Input-mode collisions.** Note editing, `gg`/`G`/`J`/`K`/`d`/`D`, filter focus, help, and quit all share one keyboard layer. Introduce an explicit "note editing" mode before binding destructive shortcuts.

## Process notes

- The `simple-git-hooks` + `lint-staged` pre-commit chain in this repo silently wiped a working tree of menu-removal changes once. Use `SKIP_SIMPLE_GIT_HOOKS=1` for surgical commits until the root cause is investigated, or remove the hook from the fork.
- Codex review: `.expert/letter-20260510T063205Z-20120-32389-1.response.codex.md`.
