# `.dunk/comments.json`

A single JSON file holds every review comment for the repo. It lives at
`.dunk/comments.json`, is local to the checkout (`.dunk/` is gitignored), and
is deleted when the last comment is resolved, so an empty review leaves no
file behind.

## Why one file

- One file is the simplest thing that can possibly work.
- Across branches: if a comment references a file that no longer exists or
  has changed, drift detection pins it to the top of the diff. No special
  "current branch" logic.
- The TUI and the `dunk comments` CLI read and write the same file, so a
  human reviewer and a coding agent can ping-pong on one review.

## Layout

```
.dunk/
  comments.json     # review comments (absent when there are none)
  config.toml       # optional repo-local view config
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
      "range": [136, 142],
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
- `line`: 1-based line number in the post-image at write time. Drift-detection
  anchor — typically the hunk's last post-image row.
- `range`: inclusive `[start, end]` 1-based post-image line range of the hunk
  the comment is attached to. dunk only supports hunk-level comments; this
  range tells agents which lines the user was actually pointing at.
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

1. If `file` is missing or unreadable → **drifted** (`missing-file`), rendered in the drifted stack at the top of the diff.
2. If `line` is out of range → **drifted** (`out-of-range`).
3. Recompute the anchor at `line` with the same normalization. If it matches `anchor` → **anchored**, render at `line`.
4. Otherwise look for a unique line within ±10 rows whose context hashes to `anchor`. If exactly one matches, re-pin the comment there and shift `range` by the same delta.
5. Otherwise → **drifted** (`anchor-mismatch`).

The TUI adds one more case: an anchored comment whose line isn't inside any
hunk of the current diff is shown as drifted with reason `not-in-hunk`.

`d` removes the focused drifted comment and `D` clears every drifted comment
(after a confirm); anchored comments are never touched by `D`.

## Atomic write

Write to a unique per-writer temp file in `.dunk/`
(`.comments.json.<pid>.<time>.<random>.tmp`), then `rename(2)` it over
`.dunk/comments.json`. Same filesystem, so the rename is atomic and readers
never see a half-written file. Writers re-read and compare a content hash
before renaming, retrying a few times if another writer landed first.

## Things explicitly _not_ in v1

- Threaded replies. Body is a flat string.
- Resolved/unresolved state. Delete to "resolve".
- Line-range or column-precise anchors.
- Fuzzy drift recovery beyond the bounded ±10-line search.
- Cross-file / cross-comment links.
