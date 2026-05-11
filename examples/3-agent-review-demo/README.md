# 3-agent-review-demo

A flagship dunk demo: a small command-palette refactor with inline agent rationale attached to the interesting hunks.

## Run

```bash
dunk patch examples/3-agent-review-demo/change.patch
```

The companion `agent-context.json` is preserved as historical reference — the current dunk drives review through `.dunk/comments.json` and the `dunk comments {list,show,resolve}` CLI instead.

## What to look for

- query normalization extracted into its own helper
- ranking logic that prefers strong matches over loose substring hits
- the kind of hunks where you would drop a comment on the agent so it can address it via `dunk comments`
