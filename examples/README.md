# Examples

Ready-to-run demos for dunk and the exported OpenTUI diff component.

Each folder tells a small review story and includes the exact command to run from the repository root.

## Quick menu

| Example               | Best for                               | Command                                                                              |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `1-hello-diff`        | fastest first run                      | `dunk diff examples/1-hello-diff/before.ts examples/1-hello-diff/after.ts`           |
| `2-mini-app-refactor` | realistic multi-file review            | `dunk patch examples/2-mini-app-refactor/change.patch`                               |
| `3-agent-review-demo` | small refactor for agent review        | `dunk patch examples/3-agent-review-demo/change.patch`                               |
| `4-ui-polish`         | screenshot-friendly TSX diff           | `dunk diff examples/4-ui-polish/before.tsx examples/4-ui-polish/after.tsx`           |
| `5-pager-tour`        | line scrolling, paging, and hunk jumps | `dunk diff --pager examples/5-pager-tour/before.ts examples/5-pager-tour/after.ts`   |
| `6-readme-screenshot` | README screenshot                      | `dunk patch examples/6-readme-screenshot/change.patch --mode split --theme midnight` |
| `7-opentui-component` | embedding `DunkDiffView` in OpenTUI    | `bun run examples/7-opentui-component/from-files.tsx`                                |

## Notes

- The patch-based examples include checked-in `change.patch` files, so you can open them without creating a temporary repo.
- The agent demos include legacy `agent-context.json` sidecars from the pre-fork era; current dunk drives review through `.dunk/comments.json` and `dunk comments {list,show,resolve}`.
- The pager tour is intentionally taller than a typical terminal viewport so you can try `↑`, `↓`, `PageUp`, `PageDown`, `Home`, `End`, and `[` / `]` right away.
- The OpenTUI component example folder also includes `from-patch.tsx` if you want the same demo driven by raw unified diff text instead of `before` / `after` contents.
