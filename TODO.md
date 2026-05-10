# tunk follow-ups

Working list for the fork. Items are in rough priority order; reorder freely.

## Layout / chrome

- Top margin: the menu bar is gone but a top-row's worth of spacing remains. Trim it so the diff stream butts against the terminal top edge.
- Status line: when no filter / notice is active, show a subtle "Press ? for help" hint on the status line.

## Navigation

- Use `J` / `K` for hunk navigation in place of `[` / `]`. Port the simplified hunk-navigation logic from `/Users/amix/Desktop/GitHub/hunk-amix` rather than re-deriving it.
- Add `gg` (top) and `Shift+G` (bottom) vim-style jumps for the diff stream.
- General: simplify the hunk-navigation pipeline — the upstream one is more elaborate than this fork needs.

## Selection / clipboard

- Selecting text in the diff auto-copies to the clipboard and shows a small ephemeral status message ("copied to clipboard").

## Notes

- Remove agent notes entirely. Replace with user-authored notes attached to hunks.
  - `n` adds a new note at the bottom of the selected hunk.
  - `d` deletes a single note.
  - `D` deletes all notes on the current hunk (or whole file — pick once and document).
  - Note authoring opens **inline** at the hunk, not on the status line.
  - When a note has drifted (target line no longer matches), pin it to the top of the diff so it's still visible. Render drifted notes with a darker background (e.g. dark gray) to flag the state.
- Goal: easy "review and comment" loop, no agent ingestion in the loop.

## Help

- `?` opens the existing help dialog (already wired). Make the dialog shortcut list reflect the new bindings as they land.

## Sessions / sharing

- Remove the session/MCP/daemon/broker code entirely. Sharing happens via the `.hunk` directory on disk so notes are committable / shareable through normal git flows.

## Process notes

- The `simple-git-hooks` + `lint-staged` pre-commit chain in this repo silently wiped a working-tree of menu-removal changes once. Until that is investigated, commit with `SKIP_SIMPLE_GIT_HOOKS=1` for any large surgical change, or remove the hook from the fork.
