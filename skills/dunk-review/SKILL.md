---
name: dunk-review
description: Read user-authored review comments via `dunk comments` (or `.dunk/comments.json` for the active repo) and address each one. The TUI is for humans; agents drive the review through the CLI.
---

# Dunk review

Dunk is an interactive terminal diff viewer. The TUI is for the user — never run `dunk diff`, `dunk show`, or other interactive commands directly. Review comments live on disk in `.dunk/comments.json` (one committed file per repo). Drive them through the `dunk comments` CLI; only fall back to editing the JSON by hand when the binary isn't available.

If `dunk comments list` reports "No pending comments." (or `.dunk/comments.json` is missing/empty), the user has nothing pending; ask before doing speculative work.

## Workflow

```text
1. dunk comments list                    # see every pending comment with drift
2. for each comment:                     #
   - dunk comments show <id>             # comment + 10 lines of surrounding code
   - fix the underlying issue            # use Read / Edit, not the TUI
   - dunk comments resolve <id>          # remove that entry from the file
3. tell the user what you changed        # one paragraph max, cite file:line
```

`show` is the preferred starting point: it carries enough context for most fixes without re-reading the whole file. Only fall back to a full Read when the change spans far outside the hunk.

## CLI surface

```text
dunk comments                            # bare, equivalent to `list`
dunk comments list [--json]              # list pending comments + drift status
dunk comments show <id> [--json]         # print one comment plus the hunk lines
dunk comments resolve <id> [<id>...]     # atomically remove one or more entries
```

- `list` prints `#<id>  <file>:<start-end>` followed by the indented body. Drifted entries show `drifted: missing-file | out-of-range | anchor-mismatch` on the header line.
- `show` defaults to 10 lines of surrounding post-image context; pass `--context <N>` to widen or narrow it. In-range lines are prefixed `>`, surrounding lines with a leading space.
- `--json` on `list` returns `{ schema, comments: [{ id, file, line, range, anchor, body, state, reason? }] }`. `--json` on `show` returns a single comment object plus a `context` field: `{ window: [start, end], total, lines: [{ number, text, inRange }] }` — `lines` are byte-stable against the file on disk.
- `resolve` is all-or-nothing: if any id is missing it errors and writes nothing. Pass several ids to remove them in one atomic write.
- Empty list exits 0; missing ids in `show`/`resolve` exit non-zero with a clear message. No daemon, no MCP — the command writes `.dunk/comments.json` directly.

## Operating principles

- **No raw snippets in messages back to the user.** If you summarize what was fixed, cite `file:line` only — the user can open the file. Mirrors the on-disk schema, which itself stores zero snippet content.
- **Resolve = remove the entry.** When a comment is addressed, run `dunk comments resolve <id>`. Don't renumber, don't edit other entries.
- **Drifted comments are still real.** A `drifted: ...` marker means the recorded anchor no longer matches the file (file removed, line out of range, or content moved). Don't silently `resolve` to make it go away — re-read the surrounding code, address the underlying intent, then resolve.
- **Don't add new comments.** Authoring is a human action via `a` in the TUI. If you need to flag something for the user, raise it in chat.
- **Comments are hunk-scoped.** `range` is the inclusive 1-based `[start, end]` post-image line range of the _hunk_ the comment is attached to. Read the whole range before deciding what to fix — the comment is about every line in it, not just one.

## Refresh behaviour

The user's TUI watches `.dunk/comments.json` and the diff source files. After you `dunk comments resolve` or edit a tracked file, the active dunk session reloads on its own when the user has `--watch` on, or when they hit `r`. No daemon, no extra step.

## Fallback: editing `.dunk/comments.json` directly

Use this only when `dunk` is unavailable in the environment.

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
      "body": "Why redeclare the theme here?"
    }
  ]
}
```

- `file` is repo-relative (POSIX).
- `range` and `body` are described above.
- `line` is the row used internally for drift detection — opaque, do not navigate by it.
- `anchor` is a 16-hex SHA-256 prefix of context around `line`. The TUI uses it to decide whether the comment is still anchored or has drifted; agents can ignore it.
- To resolve manually, drop the matching `{ id, file, line, ... }` object from `comments` and write the file back as one JSON document with a trailing newline. Preserve other entries' ids; do not renumber.
