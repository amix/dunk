---
name: dunk-review
description: Read user-authored review comments from `.dunk/comments.json` for the active repo and address each one. The TUI is for humans; agents only touch the on-disk file and the source tree.
---

# Dunk review

Dunk is an interactive terminal diff viewer. The TUI is for the user — never run `dunk diff`, `dunk show`, or other interactive commands directly. Comments live on disk in `.dunk/comments.json` (one committed file per repo). Read it, fix what's flagged, and remove the comment by editing the file.

If `.dunk/comments.json` is missing or empty, the user has nothing pending; ask before doing speculative work.

## Workflow

```text
1. cat .dunk/comments.json                # list every pending comment
2. for each comment:                      #
   - open `file` at `line` to address it  # use Read / Edit, not the TUI
   - fix the underlying issue             #
   - remove that comment from the array   # mutate comments.json in place
3. tell the user what you changed         # one paragraph max
```

## File shape

```json
{
  "schema": 1,
  "comments": [
    { "id": 1, "file": "src/ui/App.tsx", "line": 142, "anchor": "7b8d4a9c2e1f3a06", "body": "Why redeclare the theme here?" }
  ]
}
```

- `file` is repo-relative (POSIX).
- `line` is 1-based against the post-image content at the time the comment was written. The user's edit since then may have moved the target — re-read the file and use the surrounding code to locate the right place rather than blindly jumping to that line.
- `anchor` is a 16-hex SHA-256 prefix of `line ± 1` context, normalized (right-trimmed). The TUI uses it to decide whether the comment is still anchored or has drifted; agents can ignore it and instead navigate by content.
- `body` is the comment text. Treat it as the user's instruction.

## Operating principles

- **No raw snippets in messages back to the user.** If you summarize what was fixed, cite `file:line` only — the user can open the file. Mirrors the on-disk schema, which itself stores zero snippet content.
- **Resolve = remove the entry.** When a comment is addressed, drop the matching `{ id, file, line, ... }` object from the `comments` array and write the file back. Preserve other entries' ids; do not renumber.
- **Atomic write.** Write the full file as one JSON document with a trailing newline. The TUI tolerates anything `JSON.parse` accepts; keep the format stable.
- **Drifted comments are still real.** If `file` or `line` no longer points at the right place, do not silently delete — re-read the surrounding code to find the intended target, address the underlying intent, then remove the entry.
- **Don't add new comments.** Authoring is a human action via `a` in the TUI. If you need to flag something for the user, raise it in chat.

## Refresh behaviour

The user's TUI watches `.dunk/comments.json` and the diff source files. After you remove a comment or edit a tracked file, the active dunk session reloads on its own when the user has `--watch` on, or when they hit `r`. No daemon, no extra step.
