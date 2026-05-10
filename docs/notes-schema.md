# `.dunk/comments.json` (draft)

Status: **draft**, not yet implemented.

A single JSON file holds every comment for the repo. It lives at
`.dunk/comments.json` and is meant to be **committed**, so notes ride
through normal git workflows.

## Why one file

- One file is the simplest thing that can possibly work.
- Across branches: the file just is what it is on each branch. If a comment
  references a file that no longer exists or has changed, drift detection
  pins it to the top of the diff. No special "current branch" logic.
- Merge conflicts are easier to read than reconciling many tiny files when
  two authors edit the same comments.

## Layout

```
.dunk/
  comments.json     # committed, the source of truth for review comments
  config.toml       # gitignored, local view config (carried over from upstream)
  latest.json       # gitignored, local cache
```

## Schema

```json
{
  "schema": 1,
  "comments": [
    {
      "id": 1,
      "file": "src/ui/App.tsx",
      "line": 142,
      "anchor": "7b8d4a9c2e1f3a06",
      "body": "Why redeclare the theme here? See PaneDivider."
    }
  ]
}
```

### Fields

- `schema`: integer. Bump on incompatible changes.
- `comments`: array, ordered by `id`.
- `id`: integer, unique within the file. Next id = `max(existing) + 1`.
  Stable across edits so deleting one comment doesn't renumber the rest.
- `file`: repo-relative POSIX path (post-image at write time).
- `line`: 1-based line number in the post-image at write time. The line the
  comment is anchored to — usually the bottom line of the targeted hunk.
- `anchor`: lowercase hex, **16 chars** (truncated SHA-256). Hashed input is
  the line at `line`, prefixed by the line above and suffixed by the line
  below if they exist. Each line is right-trimmed; lines are joined with
  `\n`; no trailing newline. 16 hex chars give 64 bits — collision-safe at
  this scale and keeps file size down.
- `body`: free text. Multi-line is allowed (use `\n`).

### Intentionally omitted

- `author`, `created_at`, `updated_at` — opt-in if we ever need them. Default
  to omitting to avoid leaking identity / churn.
- `kind`, `post_line_count`, `pre_image_*` — out of scope for v1. Notes are
  per-line; "at the bottom of the hunk" is a UI choice driven by which line
  we pick at write time.

## Drift detection (v1)

For each comment on load:

1. If `file` is missing → **drifted** (render in the drifted stack at the top of the diff, dark background).
2. If `line` is out of range → **drifted**.
3. Recompute the anchor at `line` with the same normalization. If it matches `anchor` → **anchored**, render at `line`.
4. Otherwise → **drifted**. No fuzzy fallback in v1.

Drifted comments are dismissed with the same shortcuts as anchored ones:
`d` removes one, `D` removes all in the focused stack. Cleaning up stale
review chatter after a refactor is just "focus the drifted stack, hit `D`."

## Atomic write

Write to `.dunk/.comments.json.tmp`, then `rename(2)` over
`.dunk/comments.json`. Same filesystem, so the rename is atomic and
readers never see a half-written file.

## Conflicts

A single committed file means concurrent edits can conflict. That's the
trade for simplicity. Resolve like any other JSON merge — the array is
ordered by `id` so diffs stay localized.

## Things explicitly *not* in v1

- Threaded replies. Body is a flat string.
- Resolved/unresolved state. Delete to "resolve".
- Line-range or column-precise anchors.
- Fuzzy drift recovery.
- Cross-file / cross-comment links.
