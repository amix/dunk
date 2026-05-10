# `.hunk/` notes schema (draft)

Status: **draft**, not yet implemented.

This is the file-backed note contract for `tunk`. Notes are user-authored
review comments attached to specific hunks. They live in `.hunk/notes/` so
they ride through normal git commits — no daemon, no session broker.

## Design constraints (from the Codex review)

1. Pick the schema *before* any UI or removal work.
2. Don't store snippets verbatim — leak risk for tracked `.hunk/`.
3. Atomic writes; no half-written files visible to other processes.
4. Friendly to git merges across multiple authors.
5. Drift detection starts simple: **exact match or pinned**, no fuzzy matching.

## Layout

```
.hunk/
  notes/
    01HVKRX9ZEXAMPLE001.json        # one file per note
    01HVKRX9ZEXAMPLE002.json
    01HVKRX9ZEXAMPLE003.json
```

- One file per note. Avoids merge conflicts when two authors add notes for
  different hunks. Deletion is `rm <id>.json`.
- File name = note id = ULID. ULIDs sort lexicographically by creation time
  and don't require a separate timestamp field. Lower leak risk than RFC 3339
  with seconds, since ULID time resolution is millisecond-prefix only.

## Note record (JSON)

```json
{
  "schema": 1,
  "id": "01HVKRX9ZEXAMPLE001",
  "anchor": {
    "file": "src/ui/App.tsx",
    "kind": "hunk",
    "post_line_start": 142,
    "post_line_count": 6,
    "fingerprint": "sha256:7b8d…"
  },
  "body": "Why are we re-declaring the theme here? See note in PaneDivider."
}
```

### Field-by-field

- `schema`: integer, monotonically increasing. Future migrations check this
  before parsing.
- `id`: ULID, also the filename stem.
- `anchor.file`: repo-relative POSIX path of the **post-image** file. We
  intentionally don't track renames at write time — drift detection handles
  the rename case by trying the recorded fingerprint against the current
  tree.
- `anchor.kind`: `"hunk"` only for v1. (`"line"` reserved for v2.)
- `anchor.post_line_start` / `anchor.post_line_count`: 1-based line range in
  the post-image file at write time. Used to render notes near the right
  spot when the file hasn't drifted.
- `anchor.fingerprint`: `sha256:<hex>` of normalized post-image lines in the
  range. Normalization: trim trailing whitespace per line, no trailing
  newline. The fingerprint is the *only* content reference — we never store
  the snippet itself.
- `body`: the note text. Markdown is allowed but not required. UTF-8.

### Intentionally omitted

- **`author`** — opt-in only. If the user sets `TUNK_AUTHOR` (or we add a
  config later), include `"author": "..."`. Default: omit. Avoids leaking
  identity through tracked files.
- **`created_at` / `updated_at`** — ULID embeds creation time at millisecond
  resolution; no need for a separate timestamp. Omit to keep the file
  minimal and reduce diff churn.
- **Local paths beyond `anchor.file`**, machine name, OS, terminal info.

## Drift detection (v1)

For each note, on load:

1. Read the post-image file at `anchor.file`.
2. If the file is missing → **drifted**, pin to top of diff with a darker
   background.
3. Slice lines `[post_line_start, post_line_start + post_line_count)`.
4. Re-fingerprint with the same normalization.
5. If the new fingerprint matches `anchor.fingerprint` → **anchored**.
6. Else → **drifted** (no fuzzy fallback in v1). Pin to top.

## Atomic writes

Use the standard "write to sibling temp + rename" pattern:

```
.hunk/notes/.<id>.json.tmp   →  .hunk/notes/<id>.json
```

`rename(2)` on the same filesystem is atomic. Other processes will never
observe a half-written `<id>.json`. The temp file uses a leading dot so a
crash mid-write doesn't litter visible IDs.

Deletion is plain `unlink(2)`.

## Conflicts and merges

Per-note files mean concurrent authors editing different notes never
conflict. The two interesting cases:

- **Two authors edit the same note**: a 3-way merge on a single note file.
  Resolve manually like any other conflict.
- **Author A deletes a note that Author B edited**: git reports a
  delete/modify conflict; resolve by re-adding or accepting the deletion.

Both feel correct enough for v1.

## Things explicitly *not* in v1

- Threaded replies. A note is a flat string body.
- Resolved/unresolved state. Delete a note to "resolve" it.
- Hunk-line precision. Hunk-level only; line-level is v2.
- Fuzzy drift recovery. Drifted means pinned, full stop.
- Cross-file linking, references, mentions.

## Open questions

1. Should `body` allow newlines? (Probably yes; multiline review prose.)
2. Should we hash the *pre-image* range too, so a note authored on the
   right side of a diff still resolves when applied to other branches? V1:
   no; v2: maybe.
3. Is sha256 overkill? Truncated sha256 (16 hex chars) would be enough for
   collision resistance and shrinks the file. Decide before first commit.
